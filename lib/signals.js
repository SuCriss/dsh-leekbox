// 选股信号与策略的**唯一定义处**。
//
// 服务端据此打分与筛选，客户端经 GET /api/leekbox/screener/meta 拉取同一份
// 元数据来渲染勾选面板——以前这份列表在 lib/client.js 里手抄了一遍，服务端
// 改权重/加信号时前端不会跟着变，两边悄悄漂移。
//
// 新增信号只需在这里加一条；权重、分组、文案、策略组成都在这一处维护。
import { macd, rsi, kdj, sma, boll, crossUp } from "./indicators.js";

/**
 * 信号定义表：key → { label, weight, group, desc }。
 * weight 参与 standard 模式的加权评分；group 仅用于前端分组展示。
 */
export const SIGNAL_META = {
	macdGold: { label: "MACD金叉", weight: 20, group: "trend", desc: "DIF 在近 N 日内上穿 DEA" },
	macdZero: { label: "MACD零轴上", weight: 5, group: "trend", desc: "DIF 与 DEA 均在零轴上方" },
	kdjGold: { label: "KDJ金叉", weight: 12, group: "osc", desc: "K 线在近 N 日内上穿 D 线" },
	jOversold: { label: "J值超卖", weight: 8, group: "osc", desc: "J 值低于 20" },
	rsiGold: { label: "RSI金叉", weight: 8, group: "osc", desc: "RSI6 在近 N 日内上穿 RSI12" },
	rsiOversold: { label: "RSI超卖", weight: 6, group: "osc", desc: "RSI6 低于 20" },
	maBullish: { label: "均线多头", weight: 15, group: "ma", desc: "MA5 > MA10 > MA20 多头排列" },
	aboveMa20: { label: "站上MA20", weight: 6, group: "ma", desc: "收盘价高于 20 日均线" },
	aboveMa60: { label: "站上MA60", weight: 6, group: "ma", desc: "收盘价高于 60 日均线" },
	bollBreak: { label: "突破布林上轨", weight: 10, group: "ma", desc: "收盘价突破布林带上轨" },
	volumeSurge: { label: "放量", weight: 10, group: "vol", desc: "成交量超过 5 日均量的 1.5 倍" },
	upStreak: { label: "连涨", weight: 8, group: "trend", desc: "连续 3 日及以上收涨" },
	newHigh60: { label: "创60日新高", weight: 12, group: "trend", desc: "收盘价创 60 日新高" },
};

/** 前端勾选面板的分组顺序与标题（服务端唯一来源）。 */
export const SIGNAL_GROUPS = [
	{ key: "trend", label: "趋势动能" },
	{ key: "osc", label: "超买超卖" },
	{ key: "ma", label: "均线 · 布林" },
	{ key: "vol", label: "量能异动" },
];

/**
 * 预设策略：每个策略列出必须**同时**成立的信号（AND）。
 * multi 模式下个股命中策略数 ≥ minStrategyHits 才入选。
 */
export const STRATEGY_META = {
	macdGold: { label: "MACD金叉", desc: "MACD金叉买入信号", signals: ["macdGold"] },
	maBullish: { label: "均线多头", desc: "5日>10日>20日均线多头排列", signals: ["maBullish"] },
	volBreak: { label: "放量突破", desc: "放量突破布林上轨", signals: ["bollBreak", "volumeSurge"] },
	oversold: { label: "超卖反弹", desc: "J值或RSI超卖", signals: ["jOversold", "rsiOversold"] },
	trendUp: { label: "趋势转强", desc: "MACD零轴上+站上MA20", signals: ["macdZero", "aboveMa20"] },
	newHigh: { label: "创60日新高", desc: "创60日新高+站上MA60", signals: ["newHigh60", "aboveMa60"] },
	strongRise: { label: "强势连涨", desc: "连涨且均线多头", signals: ["upStreak", "maBullish"] },
};

/**
 * 事件驱动策略：以"具体事件"（而非指标状态）为驱动因子的短线选股。
 * 与 STRATEGY_META 的"指标交集"不同，这里每条事件描述的是"今天发生了什么"——
 * 涨停、跌停、连板、一字板、地天板、跳空、放量突破、缩量回踩、冲高回落等，
 * 更贴近短线交易的触发逻辑。事件由 computeEvents(klines, code, name) 从日K
 * （OHLCV）实时算出；涨停/跌停幅度按板块（主板10% / 创业板·科创板20% /
 * 北交所30% / ST 5%）区分。
 */
export const EVENT_META = {
	limitUp: { label: "涨停", desc: "收盘触及涨停（按板块区分幅度）" },
	limitDown: { label: "跌停", desc: "收盘触及跌停（按板块区分幅度）" },
	limitUpStreak: { label: "连板", desc: "连续2日及以上涨停（连板梯队）" },
	oneWord: { label: "一字板", desc: "开盘即涨停且全天一字（开=高=低=收）" },
	groundToSky: { label: "地天板", desc: "当日从跌停拉到涨停（天地板）" },
	gapUp: { label: "跳空高开", desc: "开盘价高于昨收2%以上（缺口）" },
	breakoutNewHigh: { label: "放量突破", desc: "放量突破20日新高" },
	newHigh20: { label: "创20日新高", desc: "收盘价创20日新高" },
	pullback: { label: "缩量回踩", desc: "回踩20日线不破且缩量" },
	upperShadow: { label: "冲高回落", desc: "长上影线且收跌（疑似炸板/冲高回落）" },
};

/** 事件 key 列表，按定义顺序。 */
const EVENT_KEYS = Object.keys(EVENT_META);

/** 信号 key 列表，按定义顺序（screener.js 与 screenerMeta 共用，保证顺序一致）。 */
export const SIGNAL_KEYS = Object.keys(SIGNAL_META);
/** 策略 key 列表，按定义顺序。 */
const STRATEGY_KEYS = Object.keys(STRATEGY_META);

/** 单次扫描最少需要的 K 线根数：MA60/BOLL20 都要够窗口才有意义。 */
export const MIN_BARS = 30;

/**
 * 计算一只票的全部技术信号。
 * @param {Array<{open:number,close:number,high:number,low:number,volume:number}>} klines 日K（前复权，时间升序）
 * @param {number} lookback 金叉回看窗口（根），默认 3
 * @returns {Record<string, any>} 信号映射；数据不足时只返回 { volumeRatio: null }
 */
export function computeSignals(klines, lookback = 3) {
	const L = klines.length;
	if (L < MIN_BARS) return { volumeRatio: null };
	const last = L - 1;
	const closes = klines.map((k) => k.close);
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
	// 量能
	if (vol5[last] !== null && vol5[last] > 0) {
		sig.volumeRatio = Number((v / vol5[last]).toFixed(2));
		if (v > vol5[last] * 1.5) sig.volumeSurge = true;
	}
	// 连涨
	let streak = 0;
	for (let i = last; i > 0 && klines[i].close >= klines[i - 1].close; i--) streak++;
	if (streak >= 3) sig.upStreak = true;
	// 创 60 日新高（对比前 59 根，不含当根）
	const windowCloses = closes.slice(Math.max(0, L - 60), L - 1);
	if (windowCloses.length > 0 && c >= Math.max(...windowCloses)) sig.newHigh60 = true;
	return sig;
}

/** 按 SIGNAL_META 的权重把命中的信号累加成综合评分。 */
export function scoreOf(sig) {
	let s = 0;
	for (const key of SIGNAL_KEYS) if (sig[key]) s += SIGNAL_META[key].weight;
	return s;
}

/**
 * 根据代码判断所属板块，用于区分涨跌停幅度。
 * @param {string} code 裸代码（如 "300750"）或带市场前缀的 symbol（如 "sz300750"）
 * @returns {"main"|"cyb"|"kcb"|"bj"} 板块标识
 */
export function boardOf(code) {
	const c = String(code ?? "").toLowerCase().replace(/^(sh|sz|bj)/, "");
	if (/^688/.test(c)) return "kcb"; // 科创板
	if (/^(300|301)/.test(c)) return "cyb"; // 创业板
	if (/^(4|8|92)/.test(c)) return "bj"; // 北交所
	return "main"; // 沪主板 60x / 深主板 00x / 其他
}

/**
 * 涨跌停幅度（小数，如 0.10）。按板块区分：
 * 主板 10%、创业板/科创板 20%、北交所 30%；ST（风险警示）主板 5%。
 * 注意：创业板/科创板/北交所的 ST 仍维持各自板块幅度，只有主板 ST 降到 5%。
 * @param {string} code 裸代码或 symbol
 * @param {string} [name] 股票名（用于识别 ST）
 * @returns {number} 涨跌停比例（正数）
 */
export function limitPctFor(code, name) {
	const board = boardOf(code);
	if (board === "cyb" || board === "kcb") return 0.20;
	if (board === "bj") return 0.30;
	// 主板：ST 5%，否则 10%
	return /ST/i.test(name ?? "") ? 0.05 : 0.10;
}

/**
 * 计算一只票的"事件"（事件驱动策略的判定因子）。
 * 涨停/跌停按板块区分幅度；一字板、地天板、连板在此之上衍生。
 * @param {Array<{open:number,close:number,high:number,low:number,volume:number}>} klines 日K（时间升序）
 * @param {string} [code] 裸代码或 symbol（用于判断板块涨跌停幅度）
 * @param {string} [name] 股票名（用于识别 ST）
 * @returns {Record<string, boolean>} 事件映射；数据不足时返回空对象
 */
export function computeEvents(klines, code, name) {
	const L = klines?.length ?? 0;
	if (L < 2) return {};
	const last = L - 1;
	const cur = klines[last];
	const prev = klines[last - 1];
	const c = cur.close;
	const o = cur.open;
	const h = cur.high;
	const l = cur.low;
	const v = cur.volume;
	const prevC = prev.close;
	const out = {};
	if (!Number.isFinite(prevC) || prevC <= 0) return out;
	const pct = (c - prevC) / prevC;
	const lim = limitPctFor(code, name); // 板块涨跌停幅度
	// 涨停价/跌停价（用昨收 × (1±幅度)，四舍五入到 0.01 元，与交易所口径一致）
	const round2 = (x) => Math.round(x * 100) / 100;
	const limitUpPrice = round2(prevC * (1 + lim));
	const limitDownPrice = round2(prevC * (1 - lim));
	// 涨停：收盘触及涨停价（容差 ±0.5 分钱，处理四舍五入与浮点）
	const atUp = c >= limitUpPrice - 0.005;
	const atDown = c <= limitDownPrice + 0.005;
	if (atUp) out.limitUp = true;
	if (atDown) out.limitDown = true;
	// 一字板：开盘即涨停且全天一字（开=高=低=收，全部在涨停价）
	if (atUp && Math.abs(o - limitUpPrice) <= 0.005 && Math.abs(h - limitUpPrice) <= 0.005 && Math.abs(l - limitUpPrice) <= 0.005) {
		out.oneWord = true;
	}
	// 地天板：当日盘中触及跌停、收盘拉到涨停
	if (atUp && l <= limitDownPrice + 0.005) out.groundToSky = true;
	// 连板：当根涨停且前一根也涨停（按各自的板块幅度判定，用昨收→前收涨幅近似）
	if (out.limitUp && L >= 3) {
		const prevPrevC = klines[last - 2].close;
		if (Number.isFinite(prevPrevC) && prevPrevC > 0) {
			const prevPct = (prevC - prevPrevC) / prevPrevC;
			if (prevPct >= lim - 0.005) out.limitUpStreak = true;
		}
	}
	// 跳空高开：开盘价高于昨收 2% 以上
	if (o >= prevC * 1.02) out.gapUp = true;
	// 创 20 日新高：收盘价 ≥ 前 20 根（不含当根）的最高收盘
	const wStart = Math.max(0, L - 21);
	let maxC = -Infinity;
	for (let i = wStart; i < last; i++) if (klines[i].close > maxC) maxC = klines[i].close;
	if (maxC > -Infinity && c >= maxC) out.newHigh20 = true;
	// 放量突破：20 日新高 + 放量（量 > 5 日均量 × 1.5）
	if (out.newHigh20) {
		const vStart = Math.max(0, L - 5);
		let vSum = 0;
		for (let i = vStart; i < last; i++) vSum += klines[i].volume;
		const avgV = vSum / Math.max(1, last - vStart);
		if (avgV > 0 && v > avgV * 1.5) out.breakoutNewHigh = true;
	}
	// 缩量回踩：收盘站上 MA20、盘中下探不破 MA20、且缩量（量 < 5 日均量）
	const ma20Start = Math.max(0, L - 20);
	if (L - ma20Start >= 20) {
		let cSum = 0;
		for (let i = ma20Start; i <= last; i++) cSum += klines[i].close;
		const ma20 = cSum / (last - ma20Start + 1);
		const vStart = Math.max(0, L - 5);
		let vSum = 0;
		for (let i = vStart; i < last; i++) vSum += klines[i].volume;
		const avgV = vSum / Math.max(1, last - vStart);
		if (c > ma20 && l <= ma20 * 1.02 && avgV > 0 && v < avgV) out.pullback = true;
	}
	// 冲高回落：长上影（上影占振幅 60% 以上）且收跌
	const body = Math.max(o, c);
	const range = h - l;
	if (range > 0 && (h - body) / range > 0.6 && c < o) out.upperShadow = true;
	return out;
}

/**
 * 计算事件集合命中了哪些事件（等价于 strategyHits，但作用于事件域）。
 * @param {Record<string, boolean>} ev computeEvents 的结果
 * @param {string[]} eventKeys 要评估的事件 key
 * @returns {{ key: string, label: string }[]}
 */
export function eventHits(ev, eventKeys) {
	const hits = [];
	for (const ek of eventKeys) {
		const meta = EVENT_META[ek];
		if (!meta) continue;
		if (ev[ek]) hits.push({ key: ek, label: meta.label });
	}
	return hits;
}

/**
 * 计算信号集合命中了哪些预设策略（策略内信号全中才算命中）。
 * @param {Record<string, any>} sig computeSignals 的结果
 * @param {string[]} strategyKeys 要评估的策略 key
 * @returns {{ key: string, label: string }[]}
 */
export function strategyHits(sig, strategyKeys) {
	const hits = [];
	for (const sk of strategyKeys) {
		const meta = STRATEGY_META[sk];
		if (!meta) continue;
		if (meta.signals.every((s) => sig[s])) hits.push({ key: sk, label: meta.label });
	}
	return hits;
}

/**
 * 供 GET /api/leekbox/screener/meta 下发的元数据快照（客户端渲染勾选面板用）。
 * 返回的是结构化克隆，调用方改不动服务端的定义表。
 */
export function screenerMeta() {
	return {
		signals: SIGNAL_KEYS.map((key) => ({ key, ...SIGNAL_META[key] })),
		signalGroups: SIGNAL_GROUPS.map((g) => ({
			...g,
			items: SIGNAL_KEYS.filter((k) => SIGNAL_META[k].group === g.key),
		})),
		strategies: STRATEGY_KEYS.map((key) => ({ key, ...STRATEGY_META[key] })),
		events: EVENT_KEYS.map((key) => ({ key, ...EVENT_META[key] })),
	};
}
