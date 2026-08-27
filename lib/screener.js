// LeekBox technical indicator screener engine.
//
// Pipeline: universe snapshot (Eastmoney clist via ./emrank.js) → basic filters
// → per-stock daily K-lines (Tencent fqkline, 120 bars) → indicator computation
// → signal matching + weighted score → sorted results.
import { fetchJson, fetchText, decodeGbk, fetchJsonAcrossHosts } from "./fetch-utils.js";
import { fetchEmRankRows } from "./emrank.js";

//#region constants

/** Tencent fqkline hosts — web.* intermittently serves anti-bot challenges. */
const TENCENT_FQKLINE_HOSTS = ["https://ifzq.gtimg.cn", "https://web.ifzq.gtimg.cn"];

const KLINE_TTL = 10 * 60 * 1000; // 10 min
const UNIVERSE_TTL = 60 * 1000; // 1 min
const KLINE_CAP = 4000;
const SLEEP_MS = 25; // polite delay between kline batches
const KLINE_CONCURRENCY = 7;

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

//#endregion

//#region caches

const universeCache = { key: "", at: 0, rows: null };
const klineCache = new Map();
const _progress = { running: false, stage: "", done: 0, total: 0, scanned: 0, candidates: 0, error: "" };

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
	const rows = [];
	let page = 1;
	outer: while (page <= maxPages) {
		const chunk = [];
		for (let i = 0; i < 5 && page <= maxPages; i++, page++) chunk.push(page);
		const results = await Promise.all(
			chunk.map((p) =>
				fetchEmRankRows({ node, sort: "amount", order: "desc", page: p, size: 100 }).catch(() => null)
			)
		);
		for (const res of results) {
			if (!Array.isArray(res) || res.length === 0) break outer;
			rows.push(...res);
			if (res.length < 100) break outer;
		}
	}
	return limit > 0 ? rows.slice(0, limit) : rows;
}

//#endregion

//#region kline fetch

async function getKline(code) {
	const cached = klineCache.get(code);
	if (cached && Date.now() - cached.at < KLINE_TTL) return cached.klines;
	const { payload } = await fetchJsonAcrossHosts(TENCENT_FQKLINE_HOSTS, (host) =>
		`${host}/appstock/app/fqkline/get?param=${encodeURIComponent(`${code},day,,,120,qfq`)}`
	);
	const rows =
		payload?.data?.[code]?.qfqday ?? payload?.data?.[code]?.day;
	if (!Array.isArray(rows) || rows.length < 10) return null;
	const klines = rows.map((r) => ({
		date: r[0],
		open: Number(r[1]),
		close: Number(r[2]),
		high: Number(r[3]),
		low: Number(r[4]),
		volume: Number(r[5]),
	}));
	if (klineCache.size >= KLINE_CAP) {
		const first = klineCache.keys().next().value;
		klineCache.delete(first);
	}
	klineCache.set(code, { at: Date.now(), klines });
	return klines;
}

async function fetchKlinesConcurrent(codes) {
	const out = new Map();
	let idx = 0;
	const worker = async () => {
		while (idx < codes.length) {
			const code = codes[idx++];
			_progress.done = idx;
			const klines = await getKline(code);
			if (klines) out.set(code, klines);
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
 * @returns {Promise<{rows:object[], scanned:number, candidates:number, computed:number, matched:number, elapsed:number, signals:object[]}>}
 */
export async function runScreener(params) {
	if (_progress.running) throw new Error("screener already running");
	// Ensure the fetch utilities are available (they're imported)
	_resetProgress();
	_progress.running = true;
	const t0 = Date.now();
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
		const klinesMap = await fetchKlinesConcurrent(codes);
		_progress.stage = "indicators";
		const require = new Set(params.require ?? []);
		const lookback = params.lookback ?? 3;
		const rows = [];
		for (const r of candidates) {
			const code = (r.symbol ?? "").toLowerCase();
			const klines = klinesMap.get(code);
			if (!klines || klines.length < 30) continue;
			const sig = computeSignals(klines, lookback);
			let pass = true;
			for (const req of require) if (!sig[req]) {
				pass = false;
				break;
			}
			if (!pass) continue;
			const score = scoreOf(sig);
			if ((params.minScore ?? 0) > score) continue;
			rows.push({
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
				score,
				volumeRatio: sig.volumeRatio,
				signals: Object.keys(SIGNAL_META).filter((k) => sig[k]).map((k) => SIGNAL_META[k].label),
			});
		}
		rows.sort((a, b) => b.score - a.score || (b.changePct ?? -999) - (a.changePct ?? -999));
		_progress.stage = "done";
		return {
			scanned: snapshot.length,
			candidates: candidates.length,
			computed: klinesMap.size,
			matched: rows.length,
			elapsed: Math.round((Date.now() - t0) / 1000) + "s",
			rows,
		};
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
}

export { progress as screenerProgress };

//#endregion