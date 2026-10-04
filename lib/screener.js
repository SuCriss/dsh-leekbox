// LeekBox technical indicator screener engine.
//
// Pipeline: universe snapshot (Eastmoney clist via ./emrank.js) → basic filters
// → per-stock daily K-lines (Tencent fqkline, 120 bars) → indicator computation
// → signal matching + weighted score → sorted results.
import { fetchJson, fetchText, decodeGbk, fetchJsonAcrossHosts } from "./fetch-utils.js";
import { fetchEmRankRows, fetchEmDailyKline } from "./emrank.js";

//#region constants

/** Tencent fqkline hosts — web.* intermittently serves anti-bot challenges. */
const TENCENT_FQKLINE_HOSTS = ["https://ifzq.gtimg.cn", "https://web.ifzq.gtimg.cn"];

const UNIVERSE_TTL = 60 * 1000; // 1 min
const KLINE_CAP = 4000;
const SLEEP_MS = 35; // ms between kline requests — gentler pacing avoids source rate limits
const KLINE_CONCURRENCY = 5;

// Screener result cache with LRU eviction (max entries) and TTL-based expiration.
const RESULT_CACHE_MAX = 500; // max entries in cache
let resultCache = [];         // [{ key, data, at }]
let resultCacheHits = 0;      // total cache hits for monitoring
let resultCacheMisses = 0;    // total cache misses for monitoring

/** Compute a deterministic cache key from screener params. */
function computeResultCacheKey(params) {
	return JSON.stringify({
		node: params.node, universe: params.universe,
		priceMin: params.priceMin, priceMax: params.priceMax,
		turnoverMin: params.turnoverMin, turnoverMax: params.turnoverMax,
		changeMin: params.changeMin, changeMax: params.changeMax,
		excludeST: params.excludeST,
		require: params.require?.slice().sort(),
		minScore: params.minScore, lookback: params.lookback,
		mode: params.mode, strategies: params.strategies?.slice().sort(),
		minStrategyHits: params.minStrategyHits,
	});
}

/** Try to get cached result by key. Returns null if not found or expired. */
function getCachedResult(key) {
	const CACHE_TTL = 15 * 60 * 1000; // 15 minutes
	const now = Date.now();
	let entry = null;
	for (const e of resultCache) {
		if (e.key === key && now - e.at < CACHE_TTL) {
			entry = e;
			break;
		}
	}
	if (!entry) return null;
	resultCache = resultCache.filter((x) => x !== entry);
	resultCache.push(entry);
	resultCacheHits++;
	return entry.data;
}

/** Store result with current timestamp; evicts oldest if over capacity. */
function setCachedResult(key, data) {
	const CACHE_TTL = 15 * 60 * 1000; // 15 minutes
	resultCache.push({ key, data, at: Date.now() });
	while (resultCache.length > RESULT_CACHE_MAX) {
		resultCache.shift();
	}
	resultCacheMisses++;
}

/** Get cache stats for /meta endpoint monitoring. */
export function screenerCacheStats() {
	const active = resultCache.filter((e) => Date.now() - e.at < 15 * 60 * 1000);
	return {
		total: active.length,
		hits: resultCacheHits,
		misses: resultCacheMisses,
		hitRate: resultCacheHits + resultCacheMisses > 0 ? 
			Number(((resultCacheHits / (resultCacheHits + resultCacheMisses)) * 100).toFixed(1)) : 0,
	};
}


/** Signal definitions: key → { label, weight }. */
const SIGNAL_META = {
	macdGold: { label: "MACD金叉", weight: 20 },
	macdZero: { label: "MACD零轴上", weight: 5 },
	kdjGold: { label: "KDJ金叉", weight: 12 },
	jOversold: { label: "J值超卖", weight: 8 },
	rsiGold: { label: "RSI金叉", weight: 8 },
	rsiOversold: { label: "RSI超卖", weight: 6 },
	maBullish: { label: "均线多头", weight: 15 },
	aboveMa20: { label: "站上MA20", weight: 6 },
	aboveMa60: { label: "站上MA60", weight: 6 },
	bollBreak: { label: "突破布林上轨", weight: 10 },
	volumeSurge: { label: "放量", weight: 10 },
	upStreak: { label: "连涨", weight: 8 },
	newHigh60: { label: "创60日新高", weight: 12 },
};

/**
 * Preset strategies for multi-strategy intersection mode.
 * Each strategy lists the signals that must ALL be true (AND) for a stock to
 * "hit" that strategy. A stock is selected when it hits ≥ minStrategyHits
 * strategies simultaneously.
 */
const STRATEGY_META = {
	macdGold: { label: "MACD金叉", desc: "MACD金叉买入信号", signals: ["macdGold"] },
	maBullish: { label: "均线多头", desc: "5日>10日>20日均线多头排列", signals: ["maBullish"] },
	volBreak: { label: "放量突破", desc: "放量突破布林上轨", signals: ["bollBreak", "volumeSurge"] },
	oversold: { label: "超卖反弹", desc: "J值或RSI超卖", signals: ["jOversold", "rsiOversold"] },
	trendUp: { label: "趋势转强", desc: "MACD零轴上+站上MA20", signals: ["macdZero", "aboveMa20"] },
	newHigh: { label: "创60日新高", desc: "创60日新高+站上MA60", signals: ["newHigh60", "aboveMa60"] },
	strongRise: { label: "强势连涨", desc: "连涨且均线多头", signals: ["upStreak", "maBullish"] },
};

//#endregion

//#region caches

const universeCache = { key: "", at: 0, rows: null };
const klineCache = new Map();
// Adaptive K-line cache TTL. Intraday candles shift between scans, so a longer
// TTL trades freshness for fewer fetches. We tune the tradeoff from observed
// reuse: a batch that mostly re-hits the cache means scans are close enough in
// time to stretch the TTL; near-zero reuse means the cache isn't paying off.
// Cold-start misses must NOT shrink the TTL (see MIN_BATCH_REUSES) — that would
// self-reinforce into a stampede.
let ttlHits = 0, ttlMisses = 0;
let currentKlineTTL = 10 * 60 * 1000; // start mid-band: 10 min
const MIN_KLINE_TTL = 5 * 60 * 1000; // floor: 5 min
const MAX_KLINE_TTL = 30 * 60 * 1000; // ceiling: 30 min
const TTL_BATCH_SIZE = 200; // evaluate once per 200 cache lookups
const MIN_BATCH_REUSES = 0.3; // below 30% reuse the batch is treated as cold
// Exponential moving average of reuse ratio — smooths single-scan spikes and is
// what klineCacheStats exposes for monitoring.
let reuseEma = 0;

/** Re-evaluate the TTL after a full batch of cache lookups. */
function adjustKlineTTL() {
	const total = ttlHits + ttlMisses;
	if (total < TTL_BATCH_SIZE) return;
	const reuse = ttlHits / total;
	// EMA with ~5-batch horizon; cold batches don't drag the average down.
	reuseEma = reuseEma === 0 ? reuse : reuseEma * 0.7 + reuse * 0.3;
	if (reuse > 0.6 && currentKlineTTL < MAX_KLINE_TTL) {
		currentKlineTTL = Math.min(MAX_KLINE_TTL, currentKlineTTL * 1.25);
	} else if (reuse < 0.2 && reuseEma >= MIN_BATCH_REUSES && currentKlineTTL > MIN_KLINE_TTL) {
		// Only shrink once we've seen real reuse before — breaks the death spiral.
		currentKlineTTL = Math.max(MIN_KLINE_TTL, currentKlineTTL * 0.8);
	}
	ttlHits = 0;
	ttlMisses = 0;
}

const _progress = { running: false, stage: "", done: 0, total: 0, scanned: 0, candidates: 0, error: "", partial: [] };

function progress() {
	return { ..._progress };
}

//#endregion

//#region helpers

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function num(v) {
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

//#endregion

//#region universe snapshot

async function buildUniverse(node, limit) {
	const maxPages = limit > 0 ? Math.ceil(limit / 100) : 60;
	const byPage = new Map(); // page → rows, stitched in page order at the end
	const failed = []; // pages to retry once after the walk
	let page = 1;
	outer: while (page <= maxPages) {
		const chunk = [];
		for (let i = 0; i < 5 && page <= maxPages; i++, page++) chunk.push(page);
		const results = await Promise.all(
			chunk.map((p) =>
				fetchEmRankRows({ node, sort: "amount", order: "desc", page: p, size: 100 }).catch(() => null)
			)
		);
		for (let i = 0; i < results.length; i++) {
			const res = results[i];
			// A transient failure must NOT end the walk (it would silently
			// truncate the universe and get cached as a "successful" snapshot);
			// only a genuine empty/short page ends it.
			if (!Array.isArray(res)) { failed.push(chunk[i]); continue; }
			if (res.length === 0) break outer;
			byPage.set(chunk[i], res);
			if (res.length < 100) break outer;
		}
	}
	// Retry failed pages once, sequentially — page 1 holds the top-amount names,
	// so dropping it would skew the whole universe. Stitch in page order so
	// limit-slicing still means "top N by amount".
	for (const p of failed) {
		const res = await fetchEmRankRows({ node, sort: "amount", order: "desc", page: p, size: 100 }).catch(() => null);
		if (Array.isArray(res) && res.length > 0) byPage.set(p, res);
	}
	if (byPage.size === 0) throw new Error("股票池快照为空 —— 行情源暂时不可用，请稍后重试");
	const stitched = [...byPage.keys()].sort((a, b) => a - b).flatMap((p) => byPage.get(p));
	// Deduplicate by code: concurrent page fetching期间，成交额排名在翻页间隙
	// 漂移，同一股票可能落进两页。保留首次出现的条目（页序即金额序，即更高排名），
	// 否则重复行既浪费 K 线请求，又会让 slice(limit) 少给几只票。
	const rows = [];
	const seen = new Set();
	for (const r of stitched) {
		if (seen.has(r.code)) continue;
		seen.add(r.code);
		rows.push(r);
	}
	return limit > 0 ? rows.slice(0, limit) : rows;
}

//#endregion

//#region kline fetch

/** Set when both Tencent hosts fail; skip Tencent until it expires so a bulk
 * scan does not waste two requests per symbol against an anti-bot wall. */
let tencentDownUntil = 0;
const TENCENT_COOLDOWN_MS = 3 * 60 * 1000;

async function getKline(code) {
	const cached = klineCache.get(code);
	if (cached && Date.now() - cached.at < currentKlineTTL) {
		ttlHits++;
		return cached.klines;
	}
	// Count the lookup itself so failed fetches still feed the reuse signal
	// (a miss that later errors is a miss, not a free pass).
	ttlMisses++;
	adjustKlineTTL();
	let klines = null;
	if (Date.now() >= tencentDownUntil) {
		try {
			const { payload } = await fetchJsonAcrossHosts(TENCENT_FQKLINE_HOSTS, (host) =>
				`${host}/appstock/app/fqkline/get?param=${encodeURIComponent(`${code},day,,,120,qfq`)}`
			);
			const rows = payload?.data?.[code]?.qfqday ?? payload?.data?.[code]?.day;
			if (Array.isArray(rows) && rows.length >= 10) {
				klines = rows.map((r) => ({
					date: r[0],
					open: Number(r[1]),
					close: Number(r[2]),
					high: Number(r[3]),
					low: Number(r[4]),
					volume: Number(r[5]),
				}));
			}
		} catch {
			tencentDownUntil = Date.now() + TENCENT_COOLDOWN_MS;
		}
	}
	if (klines === null) {
		// Tencent blocked/empty for this symbol — use the independent EM feed.
		const em = await fetchEmDailyKline(code);
		if (Array.isArray(em) && em.length >= 10) klines = em;
	}
	if (klines === null) return null;
	if (klineCache.size >= KLINE_CAP) {
		const first = klineCache.keys().next().value;
		klineCache.delete(first);
	}
	klineCache.set(code, { at: Date.now(), klines });
	return klines;
}

async function fetchKlinesConcurrent(codes, onEach) {
	const out = new Map();
	let idx = 0;
	let consecFailures = 0;
	let aborted = false; // stops the surviving workers once one trips the breaker
	const worker = async () => {
		while (!aborted && idx < codes.length) {
			const code = codes[idx++];
			_progress.done = idx;
			try {
				const klines = await getKline(code);
				if (klines) {
					out.set(code, klines);
					consecFailures = 0;
					// Stream the freshly-fetched series into scoring so partial
					// results grow live while the rest of the scan is still running.
					if (onEach) {
						try {
							onEach(code, klines);
						} catch {
							// A single bad computation must not abort the whole scan.
						}
					}
				}
			} catch {
				// A single stock failing (rate limit, flaky mirror) must not kill
				// the whole scan — skip it and back off briefly. Only give up when
				// failures pile up consecutively across all workers, which means
				// the feed itself is down rather than one symbol being unlucky.
				consecFailures++;
				if (consecFailures >= 60 && !aborted) {
					// Flag BEFORE throwing: the other workers are not cancellable,
					// so without this they keep draining the queue (and hammering
					// an already-throttling host) after Promise.all has rejected.
					aborted = true;
					throw new Error("行情数据源被限流或不可用 — 请稍后重试，或改用较小的样本范围");
				}
				await sleep(1200);
			}
			if (SLEEP_MS > 0) await sleep(SLEEP_MS);
		}
	};
	await Promise.all(Array.from({ length: KLINE_CONCURRENCY }, worker));
	return out;
}

//#endregion

//#region indicator math

function ema(values, period) {
	const k = 2 / (period + 1);
	const out = [];
	let prev = values[0];
	out.push(prev);
	for (let i = 1; i < values.length; i++) {
		prev = values[i] * k + prev * (1 - k);
		out.push(prev);
	}
	return out;
}

function macd(closes, fast = 12, slow = 26, signal = 9) {
	const ef = ema(closes, fast);
	const es = ema(closes, slow);
	const dif = closes.map((_, i) => ef[i] - es[i]);
	const dea = ema(dif, signal);
	const hist = dif.map((d, i) => (d - dea[i]) * 2);
	return { dif, dea, hist };
}

function rsi(closes, period) {
	const out = new Array(closes.length).fill(null);
	if (closes.length <= period) return out;
	let gain = 0, loss = 0;
	for (let i = 1; i <= period; i++) {
		const ch = closes[i] - closes[i - 1];
		if (ch >= 0) gain += ch;
		else loss -= ch;
	}
	let avgGain = gain / period, avgLoss = loss / period;
	out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
	for (let i = period + 1; i < closes.length; i++) {
		const ch = closes[i] - closes[i - 1];
		const g = ch > 0 ? ch : 0;
		const l = ch < 0 ? -ch : 0;
		avgGain = (avgGain * (period - 1) + g) / period;
		avgLoss = (avgLoss * (period - 1) + l) / period;
		out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
	}
	return out;
}

function kdj(klines, n = 9) {
	const kArr = [];
	const dArr = [];
	const jArr = [];
	let k = 50;
	let d = 50;
	for (let i = 0; i < klines.length; i++) {
		const lo = klines.slice(Math.max(0, i - n + 1), i + 1);
		const llv = Math.min(...lo.map((x) => x.low));
		const hhv = Math.max(...lo.map((x) => x.high));
		const rsv = hhv === llv ? 50 : ((klines[i].close - llv) / (hhv - llv)) * 100;
		k = (2 / 3) * k + (1 / 3) * rsv;
		d = (2 / 3) * d + (1 / 3) * k;
		const j = 3 * k - 2 * d;
		kArr.push(k);
		dArr.push(d);
		jArr.push(j);
	}
	return { k: kArr, d: dArr, j: jArr };
}

function sma(values, period) {
	const out = new Array(values.length).fill(null);
	let sum = 0;
	for (let i = 0; i < values.length; i++) {
		sum += values[i];
		if (i >= period) sum -= values[i - period];
		if (i >= period - 1) out[i] = sum / period;
	}
	return out;
}

function boll(closes, n = 20, k = 2) {
	const mid = sma(closes, n);
	const upper = new Array(closes.length).fill(null);
	const lower = new Array(closes.length).fill(null);
	for (let i = 0; i < closes.length; i++) {
		if (mid[i] === null) continue;
		const start = i - n + 1;
		const slice = closes.slice(Math.max(0, start), i + 1);
		const mean = mid[i];
		let variance = 0;
		for (const v of slice) variance += (v - mean) ** 2;
		variance /= slice.length;
		const std = Math.sqrt(variance);
		upper[i] = mean + k * std;
		lower[i] = mean - k * std;
	}
	return { mid, upper, lower };
}

function crossUp(a, b, last, lookback) {
	if (a[last] === null || b[last] === null) return false;
	for (let i = last; i > Math.max(0, last - lookback); i--) {
		if (a[i] === null || b[i] === null || a[i - 1] === null || b[i - 1] === null) continue;
		if (a[i] > b[i] && a[i - 1] <= b[i - 1]) return true;
	}
	return false;
}

//#endregion

//#region signals + score

function computeSignals(klines, lookback = 3) {
	const L = klines.length;
	if (L < 30) return { volumeRatio: null };
	const last = L - 1;
	const closes = klines.map((k) => k.close);
	const highs = klines.map((k) => k.high);
	const lows = klines.map((k) => k.low);
	const volumes = klines.map((k) => k.volume);
	const m = macd(closes);
	const r6 = rsi(closes, 6);
	const r12 = rsi(closes, 12);
	const kd = kdj(klines);
	const ma5 = sma(closes, 5);
	const ma10 = sma(closes, 10);
	const ma20 = sma(closes, 20);
	const ma60 = sma(closes, 60);
	const bl = boll(closes);
	const vol5 = sma(volumes, 5);
	const c = closes[last];
	const v = volumes[last];
	const sig = { volumeRatio: null };
	// MACD
	if (m.dif[last] > m.dea[last] && crossUp(m.dif, m.dea, last, lookback)) sig.macdGold = true;
	if (m.dif[last] > 0 && m.dea[last] > 0) sig.macdZero = true;
	// KDJ
	if (kd.k[last] > kd.d[last] && crossUp(kd.k, kd.d, last, lookback)) sig.kdjGold = true;
	if (kd.j[last] < 20) sig.jOversold = true;
	// RSI
	if (crossUp(r6, r12, last, lookback)) sig.rsiGold = true;
	if (r6[last] < 20) sig.rsiOversold = true;
	// MA
	if (ma5[last] !== null && ma10[last] !== null && ma20[last] !== null && ma5[last] > ma10[last] && ma10[last] > ma20[last]) sig.maBullish = true;
	if (ma20[last] !== null && c > ma20[last]) sig.aboveMa20 = true;
	if (ma60[last] !== null && c > ma60[last]) sig.aboveMa60 = true;
	// BOLL
	if (bl.upper[last] !== null && c > bl.upper[last]) sig.bollBreak = true;
	// volume
	if (vol5[last] !== null && vol5[last] > 0) {
		sig.volumeRatio = Number((v / vol5[last]).toFixed(2));
		if (v > vol5[last] * 1.5) sig.volumeSurge = true;
	}
	// streak
	let streak = 0;
	for (let i = last; i > 0 && klines[i].close >= klines[i - 1].close; i--) streak++;
	if (streak >= 3) sig.upStreak = true;
	// new high
	const windowCloses = closes.slice(Math.max(0, L - 60), L - 1);
	if (windowCloses.length > 0 && c >= Math.max(...windowCloses)) sig.newHigh60 = true;
	return sig;
}

function scoreOf(sig) {
	let s = 0;
	for (const [k, v] of Object.entries(SIGNAL_META)) if (sig[k]) s += v.weight;
	return s;
}

/**
 * Compute which preset strategies a stock's signal set satisfies.
 * A strategy is "hit" when ALL of its constituent signals are true.
 * @param {object} sig - signal map from computeSignals
 * @param {string[]} strategyKeys - strategy keys to evaluate
 * @returns {{ key: string, label: string }[]}
 */
function strategyHits(sig, strategyKeys) {
	const hits = [];
	for (const sk of strategyKeys) {
		const meta = STRATEGY_META[sk];
		if (!meta) continue;
		if (meta.signals.every((s) => sig[s])) hits.push({ key: sk, label: meta.label });
	}
	return hits;
}

//#endregion

//#region main screen entry

/**
 * Run the technical screener.
 * @param {object} params
 * @param {string} params.node - market node (hs_a/sh_a/sz_a/cyb/kcb)
 * @param {number} params.universe - universe size limit (0 = full)
 * @param {number|null} params.priceMin
 * @param {number|null} params.priceMax
 * @param {number|null} params.turnoverMin
 * @param {number|null} params.turnoverMax
 * @param {number|null} params.changeMin
 * @param {number|null} params.changeMax
 * @param {boolean} params.excludeST
 * @param {string[]} params.require - required signal keys (AND)
 * @param {number} params.minScore - minimum score threshold
 * @param {number} params.lookback - cross-up lookback window (default 3)
 * @param {string} params.mode - "standard" (weighted score, default) or "multi" (multi-strategy intersection)
 * @param {string[]} params.strategies - preset strategy keys to evaluate in "multi" mode
 * @param {number} params.minStrategyHits - minimum number of strategies a stock must hit (default 2)
 * @returns {Promise<{rows:object[], scanned:number, candidates:number, computed:number, matched:number, elapsed:number, signals:object[], strategies:object[]}>}
 */
export async function runScreener(params) {
	// 前端按 code 判断"已经有任务在跑"(要提示等待,不是报错),别靠匹配文案。
	if (_progress.running) {
		const error = new Error("选股任务正在运行中，请等当前任务跑完再试");
		error.code = "screener_already_running";
		throw error;
	}

	// Check result cache before network work - return cached response if params match (TTL=15min)
	const resultKey = computeResultCacheKey(params);
	const cached = getCachedResult(resultKey);
	if (cached) {
		return { ...cached, elapsed: `Cached result (${cached.matched} stocks)`, cacheHit: true };
	}
	const t0 = Date.now();
	// Validate client input BEFORE any network work: unknown keys used to crawl
	// the whole universe first and then silently match nothing.
	{
		const requireKeys = Array.isArray(params.require)
			? params.require.filter((k) => typeof k === "string")
			: [];
		const unknownRequire = requireKeys.filter((k) => !SIGNAL_META[k]);
		if (unknownRequire.length > 0) throw new Error(`未知的技术信号: ${unknownRequire.join(", ")}`);
		if (params.mode === "multi") {
			const rawStrategies = Array.isArray(params.strategies)
				? params.strategies.filter((k) => typeof k === "string")
				: [];
			const unknownStrategies = rawStrategies.filter((k) => !STRATEGY_META[k]);
			if (unknownStrategies.length > 0) throw new Error(`未知的选股策略: ${unknownStrategies.join(", ")}`);
			if (rawStrategies.length === 0) throw new Error("multi 模式需要至少选择一个有效策略");
		}
	}
	// Ensure the fetch utilities are available (they're imported)
	_resetProgress();
	_progress.running = true;
	try {
		_progress.stage = "universe";
		const node = params.node ?? "hs_a";
		const limit = typeof params.universe === "number" && params.universe > 0 ? params.universe : 0;
		const cacheKey = `${node}:${limit}`;
		let snapshot =
			universeCache.key === cacheKey && Date.now() - universeCache.at < UNIVERSE_TTL
				? universeCache.rows
				: null;
		if (!snapshot) {
			snapshot = await buildUniverse(node, limit);
			universeCache.key = cacheKey;
			universeCache.at = Date.now();
			universeCache.rows = snapshot;
		}
		_progress.scanned = snapshot.length;
		_progress.stage = "filter";
		const candidates = snapshot.filter((r) => {
			const price = num(r.trade);
			if (price === null) return false;
			if (params.excludeST && /ST/i.test(r.name ?? "")) return false;
			const change = num(r.changepercent);
			const turnover = num(r.turnoverratio);
			if (params.priceMin != null && price < params.priceMin) return false;
			if (params.priceMax != null && price > params.priceMax) return false;
			if (params.turnoverMin != null && (turnover === null || turnover < params.turnoverMin)) return false;
			if (params.turnoverMax != null && (turnover === null || turnover > params.turnoverMax)) return false;
			if (params.changeMin != null && (change === null || change < params.changeMin)) return false;
			if (params.changeMax != null && (change === null || change > params.changeMax)) return false;
			return true;
		});
		_progress.candidates = candidates.length;
		if (candidates.length === 0) {
			_progress.stage = "done";
			return { scanned: snapshot.length, candidates: 0, computed: 0, matched: 0, elapsed: Date.now() - t0, rows: [] };
		}
		_progress.stage = "kline";
		_progress.total = candidates.length;
		_progress.done = 0;
		const codes = candidates.map((r) => (r.symbol ?? "").toLowerCase());
		// require/strategies were validated at the top of runScreener (fail fast
		// before any network work); build the scoring config here so each K-line can
		// be scored the instant it arrives, feeding the live partial results.
		const require = new Set(Array.isArray(params.require) ? params.require.filter((k) => typeof k === "string") : []);
		const lookback = params.lookback ?? 3;
		const mode = params.mode === "multi" ? "multi" : "standard";
		const strategyKeys = Array.isArray(params.strategies)
			? params.strategies.filter((k) => typeof k === "string" && STRATEGY_META[k])
			: [];
		// >1 hit required; also cap at the number of selected strategies so an
		// impossible threshold degrades to "all of them" instead of always [].
		const minStrategyHits = Math.max(1, Math.min(Number(params.minStrategyHits) || 2, strategyKeys.length));
		// Index candidates by lowercased symbol so the fetch callback can recover the
		// quote row that belongs to a code it just fetched series for.
		const byCode = new Map();
		for (const r of candidates) byCode.set((r.symbol ?? "").toLowerCase(), r);
		// Score one candidate + its series into a result row, or null if it fails the
		// filters. Shared by the live scan; the selection gate in multi mode is the
		// strategy-hit count, while score stays as ranking context.
		const scoreRow = (r, klines) => {
			if (!klines || klines.length < 30) return null;
			const code = (r.symbol ?? "").toLowerCase();
			const sig = computeSignals(klines, lookback);
			const base = {
				code: r.code,
				name: r.name,
				symbol: code,
				price: num(r.trade),
				changePct: num(r.changepercent),
				change: num(r.pricechange),
				open: num(r.open),
				high: num(r.high),
				low: num(r.low),
				volume: num(r.volume),
				amount: num(r.amount),
				turnoverRate: num(r.turnoverratio),
				volumeRatio: sig.volumeRatio,
				signals: Object.keys(SIGNAL_META).filter((k) => sig[k]).map((k) => SIGNAL_META[k].label),
			};
			if (mode === "multi") {
				if (strategyKeys.length === 0) return null;
				const hits = strategyHits(sig, strategyKeys);
				if (hits.length < minStrategyHits) return null;
				return { ...base, score: scoreOf(sig), strategyCount: hits.length, strategies: hits.map((x) => x.label) };
			}
			for (const req of require) if (!sig[req]) return null;
			const score = scoreOf(sig);
			if ((params.minScore ?? 0) > score) return null;
			return { ...base, score };
		};
		const rows = [];
		_progress.partial = rows; // live handle: the SSE stream reads the growing array
		const klinesMap = await fetchKlinesConcurrent(codes, (code, klines) => {
			const r = byCode.get(code);
			if (!r) return;
			const row = scoreRow(r, klines);
			if (row) rows.push(row);
		});
		if (mode === "multi") {
			rows.sort((a, b) => b.strategyCount - a.strategyCount || b.score - a.score || (b.changePct ?? -999) - (a.changePct ?? -999));
		} else {
			rows.sort((a, b) => b.score - a.score || (b.changePct ?? -999) - (a.changePct ?? -999));
		}
		_progress.stage = "done";
		const resultData = {
			scanned: snapshot.length,
			candidates: candidates.length,
			computed: klinesMap.size,
			matched: rows.length,
			elapsed: Math.round((Date.now() - t0) / 1000) + "s",
			rows,
			mode,
			strategies: strategyKeys.map((k) => ({ key: k, label: STRATEGY_META[k].label })),
		};
		setCachedResult(resultKey, resultData);
		return resultData;
	} catch (error) {
		// Record the failure on the shared progress so an SSE stream (or a polling
		// client) sees why the scan ended instead of a bare stop. Rethrow unchanged:
		// the POST handler still maps this to 400/409/502.
		_progress.error = error instanceof Error ? error.message : String(error);
		_progress.stage = "error";
		throw error;
	} finally {
		_progress.running = false;
		// Reset progress after a short delay so the client can still read the final state.
		setTimeout(() => { if (!_progress.running) _resetProgress(); }, 5000);
	}
}

function _resetProgress() {
	_progress.stage = "";
	_progress.done = 0;
	_progress.total = 0;
	_progress.scanned = 0;
	_progress.candidates = 0;
	_progress.error = "";
	_progress.partial = [];
}

export { progress as screenerProgress };

/** K-line cache statistics and the current adaptive TTL (for monitoring/debugging). */
export function klineCacheStats() {
	const total = ttlHits + ttlMisses;
	return {
		cacheSize: klineCache.size,
		currentKlineTTL: currentKlineTTL,
		minKlineTTL: MIN_KLINE_TTL,
		maxKlineTTL: MAX_KLINE_TTL,
		batchSize: TTL_BATCH_SIZE,
		batchHits: ttlHits,
		batchMisses: ttlMisses,
		batchReuse: total > 0 ? ttlHits / total : null,
		reuseEma,
	};
}

//#endregion