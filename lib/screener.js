// LeekBox 选股引擎（编排层）。
//
// 流水线：股票池快照（东财 clist，见 ./emrank.js）→ 基础条件过滤
// → 逐只拉日K（腾讯 fqkline，120 根）→ 指标计算 → 信号/策略匹配 + 加权评分
// → 排序输出；扫描过程中把命中的票实时推进进度快照，供 SSE 流式下发。
//
// 本文件只负责"编排与取数"，其余职责已拆到独立模块：
//   ./indicators.js         纯指标数学（无 I/O）
//   ./signals.js            信号与策略的唯一定义处 + 打分
//   ./screener-cache.js     结果缓存 / 日K缓存（含自适应 TTL）
//   ./screener-validate.js  参数归一化 + 带错误码的校验异常
//
// 对外契约（runScreener 参数与返回字段、screenerProgress 快照形状）保持不变。
import { fetchJsonAcrossHosts } from "./fetch-utils.js";
import { fetchEmRankRows, fetchEmDailyKline } from "./emrank.js";
import { computeSignals, scoreOf, strategyHits, STRATEGY_META, SIGNAL_META, SIGNAL_KEYS, MIN_BARS } from "./signals.js";
import {
	getCachedResult, setCachedResult, computeResultCacheKey, screenerCacheStats,
	getCachedKline, setCachedKline, klineCacheStats,
} from "./screener-cache.js";
import {
	normalizeScreenerParams, ScreenerError, ERR_ALREADY_RUNNING,
} from "./screener-validate.js";

export { screenerCacheStats, klineCacheStats };
export { screenerMeta } from "./signals.js";

//#region constants

/** 腾讯 fqkline 主机；web.* 会间歇性返回反爬挑战，故多源轮询。 */
const TENCENT_FQKLINE_HOSTS = ["https://ifzq.gtimg.cn", "https://web.ifzq.gtimg.cn"];
/** 一次拉取的日K根数（前复权）。 */
const KLINE_BARS = 120;
/** 股票池快照存活时间。 */
const UNIVERSE_TTL = 60 * 1000;
// 注意：buildUniverse 里的页大小 100、最多 60 页、每批并发 5，以及抓取循环里的
// 熔断阈值 60 与退避 1200ms 都保持**字面量**，没有抽成常量 —— verify-fixes.mjs
// 会按源码字符串抽取 buildUniverse 独立执行（A1–A6），并正则校验 worker 熔断的
// 标志位写法（F1），改动这两处的函数体形状会让那组用例失效。
/** 两次 K 线请求之间的间隔：放慢节奏以避开上游限流。 */
const SLEEP_MS = 35;
/** K 线抓取并发。 */
const KLINE_CONCURRENCY = 5;
/** 腾讯整体不可用时的冷却时长。 */
const TENCENT_COOLDOWN_MS = 3 * 60 * 1000;

//#endregion

//#region 进度快照

/**
 * 全局进度快照。选股是全局串行的，同一时刻只有一个扫描，所以不需要按任务隔离。
 * `partial` 是**活引用**：扫描过程中不断 push，SSE/轮询读到的是同一个数组，
 * 因此能实时看到结果增长（p1-p2-stream 测试依赖这个语义）。
 */
const _progress = { running: false, stage: "", done: 0, total: 0, scanned: 0, candidates: 0, error: "", partial: [] };

/** 返回进度快照的浅拷贝；partial 仍是同一个数组引用（有意为之）。 */
export function screenerProgress() {
	return { ..._progress };
}

function resetProgress() {
	_progress.stage = "";
	_progress.done = 0;
	_progress.total = 0;
	_progress.scanned = 0;
	_progress.candidates = 0;
	_progress.error = "";
	_progress.partial = [];
}

//#endregion

//#region helpers

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 转有限数字，失败返回 null（行情字段可能是 "-" 或空串）。 */
function num(v) {
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

//#endregion

//#region 股票池快照

const universeCache = { key: "", at: 0, rows: null };

/**
 * 抓取股票池快照：按成交额降序翻页，页面乱序返回后按页序拼接，
 * 使 limit 始终表示"成交额前 N"。
 *
 * 注意：本函数的**函数名、签名与函数体形状**被 verify-fixes.mjs 按源码字符串
 * 抽取执行（A1–A6），改动签名或整体重写会直接让那组用例失效。
 */
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

/**
 * 取股票池快照，命中 1 分钟内的缓存则直接复用。
 * 缓存键含 limit：不同样本范围各自缓存，避免"先全市场再前 300"时互相污染。
 */
async function getUniverse(node, limit) {
	const cacheKey = `${node}:${limit}`;
	if (universeCache.key === cacheKey && Date.now() - universeCache.at < UNIVERSE_TTL) {
		return universeCache.rows;
	}
	const rows = await buildUniverse(node, limit);
	universeCache.key = cacheKey;
	universeCache.at = Date.now();
	universeCache.rows = rows;
	return rows;
}

//#endregion

//#region 日K取数

/** 腾讯整体不可用时的静默期；期内跳过腾讯，避免整批扫描每个票白打两次请求。 */
let tencentDownUntil = 0;

/** 解析腾讯 fqkline 响应为统一 K 线数组；形状不对返回 null。 */
function parseTencentKlines(payload, code) {
	const rows = payload?.data?.[code]?.qfqday ?? payload?.data?.[code]?.day;
	if (!Array.isArray(rows) || rows.length < 10) return null;
	return rows.map((r) => ({
		date: r[0],
		open: Number(r[1]),
		close: Number(r[2]),
		high: Number(r[3]),
		low: Number(r[4]),
		volume: Number(r[5]),
	}));
}

/**
 * 取一只票的日K：先查缓存，再走腾讯多主机，最后退回东财日K。
 * 两个源都拿不到时返回 null（调用方跳过该票，不算失败）。
 */
async function fetchDailyKline(code) {
	let klines = null;
	if (Date.now() >= tencentDownUntil) {
		try {
			const { payload } = await fetchJsonAcrossHosts(TENCENT_FQKLINE_HOSTS, (host) =>
				`${host}/appstock/app/fqkline/get?param=${encodeURIComponent(`${code},day,,,${KLINE_BARS},qfq`)}`
			);
			klines = parseTencentKlines(payload, code);
		} catch {
			tencentDownUntil = Date.now() + TENCENT_COOLDOWN_MS;
		}
	}
	if (klines === null) {
		// 腾讯被墙/该票没有数据 —— 换东财这条独立链路。
		const em = await fetchEmDailyKline(code);
		if (Array.isArray(em) && em.length >= 10) klines = em;
	}
	return klines;
}

/** 带缓存的日K读取。 */
async function getKline(code) {
	const cached = getCachedKline(code);
	if (cached !== null) return cached;
	const klines = await fetchDailyKline(code);
	if (klines === null) return null;
	setCachedKline(code, klines);
	return klines;
}

/**
 * 并发抓取一批票的日K，每拿到一只就立刻回调（用于流式产出中间结果）。
 *
 * 单只票失败（限流、镜像抖动）只跳过该票并短暂退避；只有连续失败累积到
 * 60 次才判定"源整体挂了"并熔断整个扫描。
 */
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

//#region 过滤与打分

/** 基础条件过滤：价格/换手/涨幅区间 + 排除 ST。缺字段的票直接淘汰。 */
function applyBasicFilters(rows, p) {
	return rows.filter((r) => {
		const price = num(r.trade);
		if (price === null) return false;
		if (p.excludeST && /ST/i.test(r.name ?? "")) return false;
		const change = num(r.changepercent);
		const turnover = num(r.turnoverratio);
		if (p.priceMin != null && price < p.priceMin) return false;
		if (p.priceMax != null && price > p.priceMax) return false;
		if (p.turnoverMin != null && (turnover === null || turnover < p.turnoverMin)) return false;
		if (p.turnoverMax != null && (turnover === null || turnover > p.turnoverMax)) return false;
		if (p.changeMin != null && (change === null || change < p.changeMin)) return false;
		if (p.changeMax != null && (change === null || change > p.changeMax)) return false;
		return true;
	});
}

/**
 * 把"行情行 + 日K"折算成一条结果行；不满足入选条件时返回 null。
 * standard 模式的闸门是必选信号 + 最低评分；multi 模式的闸门是命中策略数，
 * 评分仍保留作为排序上下文。
 */
function buildResultRow(quote, klines, p) {
	if (!klines || klines.length < MIN_BARS) return null;
	const sig = computeSignals(klines, p.lookback);
	const code = (quote.symbol ?? "").toLowerCase();
	const base = {
		code: quote.code,
		name: quote.name,
		symbol: code,
		price: num(quote.trade),
		changePct: num(quote.changepercent),
		change: num(quote.pricechange),
		open: num(quote.open),
		high: num(quote.high),
		low: num(quote.low),
		volume: num(quote.volume),
		amount: num(quote.amount),
		turnoverRate: num(quote.turnoverratio),
		volumeRatio: sig.volumeRatio,
		// 命中信号的展示名，按 SIGNAL_META 的定义顺序输出（保持原有顺序语义）。
		signals: SIGNAL_KEYS.filter((k) => sig[k]).map((k) => SIGNAL_META[k].label),
	};
	if (p.mode === "multi") {
		if (p.strategies.length === 0) return null;
		const hits = strategyHits(sig, p.strategies);
		if (hits.length < p.minStrategyHits) return null;
		return { ...base, score: scoreOf(sig), strategyCount: hits.length, strategies: hits.map((x) => x.label) };
	}
	for (const req of p.require) if (!sig[req]) return null;
	const score = scoreOf(sig);
	if (p.minScore > score) return null;
	return { ...base, score };
}

//#endregion

//#region 主入口

/**
 * 运行技术选股扫描。
 * @param {object} rawParams 见 ./screener-validate.js normalizeScreenerParams
 * @returns {Promise<{rows:object[], scanned:number, candidates:number, computed:number, matched:number, elapsed:string|number, mode?:string, strategies?:object[]}>}
 * @throws {ScreenerError} ERR_ALREADY_RUNNING（已有扫描在跑）/ ERR_INVALID_PARAMS（参数非法）
 */
export async function runScreener(rawParams) {
	// 前端按 code 判断"已经有任务在跑"(要提示等待,不是报错),别靠匹配文案。
	if (_progress.running) {
		throw new ScreenerError("选股任务正在运行中，请等当前任务跑完再试", ERR_ALREADY_RUNNING);
	}
	// 先归一化再查缓存：未知信号等参数错误必须**在任何网络请求之前**抛出，
	// 否则旧行为会先把整个股票池爬一遍，再返回一个"什么都没匹配到"的空结果。
	const params = normalizeScreenerParams(rawParams);

	const resultKey = computeResultCacheKey(params);
	const cached = getCachedResult(resultKey);
	if (cached) {
		return { ...cached, elapsed: `Cached result (${cached.matched} stocks)`, cacheHit: true };
	}

	const t0 = Date.now();
	resetProgress();
	_progress.running = true;
	try {
		_progress.stage = "universe";
		const snapshot = await getUniverse(params.node, params.universe);
		_progress.scanned = snapshot.length;

		_progress.stage = "filter";
		const candidates = applyBasicFilters(snapshot, params);
		_progress.candidates = candidates.length;
		if (candidates.length === 0) {
			_progress.stage = "done";
			return { scanned: snapshot.length, candidates: 0, computed: 0, matched: 0, elapsed: Date.now() - t0, rows: [] };
		}

		_progress.stage = "kline";
		_progress.total = candidates.length;
		_progress.done = 0;
		const codes = candidates.map((r) => (r.symbol ?? "").toLowerCase());
		// 按小写 symbol 建索引，让取数回调能找回刚拉到 K 线的那只票的行情行。
		const byCode = new Map();
		for (const r of candidates) byCode.set((r.symbol ?? "").toLowerCase(), r);

		const rows = [];
		_progress.partial = rows; // 活引用：SSE 读到的是这个不断增长的数组
		const klinesMap = await fetchKlinesConcurrent(codes, (code, klines) => {
			const quote = byCode.get(code);
			if (!quote) return;
			const row = buildResultRow(quote, klines, params);
			if (row) rows.push(row);
		});

		// multi 模式先比命中策略数（更能代表"强势"），再比综合评分。
		if (params.mode === "multi") {
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
			mode: params.mode,
			strategies: params.strategies.map((k) => ({ key: k, label: STRATEGY_META[k].label })),
		};
		setCachedResult(resultKey, resultData);
		return resultData;
	} catch (error) {
		// 把失败原因写进共享进度：SSE 流与轮询客户端才能看到扫描是"为什么停的"，
		// 而不是只看到 running 变 false。异常原样抛出，由路由映射状态码。
		_progress.error = error instanceof Error ? error.message : String(error);
		_progress.stage = "error";
		throw error;
	} finally {
		_progress.running = false;
		// 延迟清空进度，让客户端还能读到最终状态。
		setTimeout(() => { if (!_progress.running) resetProgress(); }, 5000);
	}
}

//#endregion
