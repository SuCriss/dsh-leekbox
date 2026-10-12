// 选股模块的两级缓存：扫描结果缓存 + 日K缓存（含自适应 TTL）。
//
// 这里只做"存取与淘汰"，不碰网络——取数逻辑留在 lib/screener.js。
// 两个缓存都是模块级单例：选股是全局串行的（同一时刻只允许一个扫描在跑），
// 所以不需要按会话隔离。

//#region 结果缓存

/** 结果缓存条目上限。 */
export const RESULT_CACHE_MAX = 500;
/** 结果缓存存活时间。 */
export const RESULT_CACHE_TTL = 15 * 60 * 1000;

/** key → { data, at }；Map 的插入顺序即 LRU 顺序（命中时先删后插）。 */
const resultCache = new Map();
let resultHits = 0;
let resultStores = 0;
let resultEvictions = 0;

/**
 * 由**已归一化**的参数算出稳定缓存键。
 * 数组先排序，避免客户端换个勾选顺序就穿透缓存。
 */
export function computeResultCacheKey(params) {
	return JSON.stringify({
		node: params.node,
		universe: params.universe,
		priceMin: params.priceMin,
		priceMax: params.priceMax,
		turnoverMin: params.turnoverMin,
		turnoverMax: params.turnoverMax,
		changeMin: params.changeMin,
		changeMax: params.changeMax,
		excludeST: params.excludeST,
		require: [...params.require].sort(),
		minScore: params.minScore,
		lookback: params.lookback,
		mode: params.mode,
		strategies: [...params.strategies].sort(),
		minStrategyHits: params.minStrategyHits,
	});
}

/** 取缓存；命中返回 data，未命中或已过期返回 null。 */
export function getCachedResult(key) {
	const entry = resultCache.get(key);
	if (entry === undefined) return null;
	if (Date.now() - entry.at >= RESULT_CACHE_TTL) {
		// 过期即摘除，别让它继续占着 LRU 名额。
		resultCache.delete(key);
		return null;
	}
	resultCache.delete(key);
	resultCache.set(key, entry); // 重新插入 = 标记为最近使用
	resultHits++;
	return entry.data;
}

/** 写入缓存，超容量时淘汰最久未使用的条目。 */
export function setCachedResult(key, data) {
	if (resultCache.has(key)) resultCache.delete(key);
	resultCache.set(key, { data, at: Date.now() });
	resultStores++;
	while (resultCache.size > RESULT_CACHE_MAX) {
		const oldest = resultCache.keys().next().value;
		resultCache.delete(oldest);
		resultEvictions++;
	}
}

/**
 * 结果缓存统计（供 /meta 监控）。
 * `misses` 沿用历史字段名，语义是"写入次数"——旧的实现是在写入时累加
 * misses 的，改语义会破坏已有监控面板，所以只把它算清楚。
 */
export function screenerCacheStats() {
	const now = Date.now();
	let active = 0;
	for (const entry of resultCache.values()) {
		if (now - entry.at < RESULT_CACHE_TTL) active++;
	}
	const total = resultHits + resultStores;
	return {
		total: active,
		hits: resultHits,
		misses: resultStores,
		evictions: resultEvictions,
		hitRate: total > 0 ? Number(((resultHits / total) * 100).toFixed(1)) : 0,
	};
}

//#endregion

//#region 日K缓存（自适应 TTL）

/** 日K缓存条目上限。 */
export const KLINE_CACHE_MAX = 4000;
/** TTL 下界：再短就失去了缓存意义。 */
export const MIN_KLINE_TTL = 5 * 60 * 1000;
/** TTL 上界：再长盘中数据就明显发陈。 */
export const MAX_KLINE_TTL = 30 * 60 * 1000;
/** 每积累这么多次查找就重新评估一次 TTL。 */
export const TTL_BATCH_SIZE = 200;
/** 批次复用率低于此值视为"冷批次"，不作为缩短 TTL 的依据。 */
export const MIN_BATCH_REUSES = 0.3;

/** code → { at, klines }。 */
const klineCache = new Map();
let ttlHits = 0;
let ttlMisses = 0;
// 盘中 K 线在两次扫描之间会变，TTL 越长越省请求、越不新鲜。按实测复用率调：
// 一个批次里大多命中，说明两次扫描挨得很近，可以放心拉长；几乎没命中说明
// 缓存没起效。冷启动批次（复用率极低）**不允许**缩短 TTL —— 否则首次扫描
// 必然全 miss，一缩短就更难命中，形成自我强化的雪崩。
let currentKlineTTL = 10 * 60 * 1000; // 从区间中段起步
// 复用率的指数滑动平均：抹平单次扫描的尖峰，也是 klineCacheStats 暴露的监控值。
let reuseEma = 0;

/**
 * 记一次缓存命中/未命中，并在凑满一批后重新评估 TTL。
 * @param {boolean} hit
 */
export function recordKlineLookup(hit) {
	if (hit) ttlHits++;
	else ttlMisses++;
	if (ttlHits + ttlMisses >= TTL_BATCH_SIZE) adjustKlineTTL();
}

/** 重新评估自适应 TTL（凑满一批时自动调用，测试可直接调用）。 */
export function adjustKlineTTL() {
	const total = ttlHits + ttlMisses;
	// 不足一批时**不要**清零：计数要跨批次继续累积，否则低并发下永远攒不满一批。
	if (total < TTL_BATCH_SIZE) return;
	const reuse = ttlHits / total;
	reuseEma = reuseEma === 0 ? reuse : reuseEma * 0.7 + reuse * 0.3;
	if (reuse > 0.6 && currentKlineTTL < MAX_KLINE_TTL) {
		currentKlineTTL = Math.min(MAX_KLINE_TTL, currentKlineTTL * 1.25);
	} else if (reuse < 0.2 && reuseEma >= MIN_BATCH_REUSES && currentKlineTTL > MIN_KLINE_TTL) {
		// 只有见过真实复用之后才允许缩短 —— 这是打断死亡螺旋的那道闸。
		currentKlineTTL = Math.max(MIN_KLINE_TTL, currentKlineTTL * 0.8);
	}
	ttlHits = 0;
	ttlMisses = 0;
}

/**
 * 读缓存。未命中/已过期返回 null，同时把这次查找计入自适应统计。
 * 注意：即使返回 null 也算一次 lookup —— 后续抓取失败的 miss 仍是 miss。
 */
export function getCachedKline(code) {
	const entry = klineCache.get(code);
	if (entry !== undefined && Date.now() - entry.at < currentKlineTTL) {
		recordKlineLookup(true);
		return entry.klines;
	}
	recordKlineLookup(false);
	return null;
}

/** 写入日K缓存，超容量时按插入顺序淘汰最老的一条。 */
export function setCachedKline(code, klines) {
	if (klineCache.has(code)) klineCache.delete(code);
	klineCache.set(code, { at: Date.now(), klines });
	while (klineCache.size > KLINE_CACHE_MAX) {
		const oldest = klineCache.keys().next().value;
		klineCache.delete(oldest);
	}
}

/** 日K缓存统计与当前自适应 TTL（供监控/排查）。 */
export function klineCacheStats() {
	const total = ttlHits + ttlMisses;
	return {
		cacheSize: klineCache.size,
		currentKlineTTL,
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
