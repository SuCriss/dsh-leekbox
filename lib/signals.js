// 选股信号与策略的**唯一定义处**。
//
// 服务端据此打分与筛选，客户端经 GET /api/leekbox/screener/meta 拉取同一份
// 元数据来渲染勾选面板——以前这份列表在 lib/client.js 里手抄了一遍，服务端
// 改权重/加信号时前端不会跟着变，两边悄悄漂移。
//
// 新增信号只需在这里加一条；权重、分组、文案、策略组成都在这一处维护。
import { macd, rsi, kdj, sma, boll, crossUp, ema, atr, tdSequence, candlePatterns, vwap } from "./indicators.js";

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
		factors: FACTOR_KEYS.map((key) => ({ key, ...FACTOR_META[key] })),
		factorGroups: FACTOR_GROUPS.map((g) => ({
			...g,
			items: FACTOR_KEYS.filter((k) => FACTOR_META[k].group === g.key),
		})),
		factorPresets: FACTOR_PRESETS.map((p) => ({ ...p })),
	};
}

//#region 量化因子系统

/**
 * 量化因子定义表：key → { label, group, desc, compute }。
 * compute(klines, last) 返回该因子的当前值（number 或 boolean）。
 */
export const FACTOR_META = {
	// 价格位置
	aboveMa5: { label: "站上MA5", group: "price", desc: "收盘价高于5日均线", compute: (k, i) => k[i].close > sma(k.map(x => x.close), 5)[i] },
	aboveMa10: { label: "站上MA10", group: "price", desc: "收盘价高于10日均线", compute: (k, i) => k[i].close > sma(k.map(x => x.close), 10)[i] },
	aboveMa20: { label: "站上MA20", group: "price", desc: "收盘价高于20日均线", compute: (k, i) => k[i].close > sma(k.map(x => x.close), 20)[i] },
	aboveMa60: { label: "站上MA60", group: "price", desc: "收盘价高于60日均线", compute: (k, i) => k[i].close > sma(k.map(x => x.close), 60)[i] },
	aboveMa120: { label: "站上MA120", group: "price", desc: "收盘价高于120日均线", compute: (k, i) => k[i].close > sma(k.map(x => x.close), 120)[i] },
	nearMa20: { label: "贴近MA20", group: "price", desc: "收盘价在MA20上下2%以内", compute: (k, i) => { const m = sma(k.map(x => x.close), 20)[i]; return m && Math.abs(k[i].close - m) / m < 0.02; } },
	
	// 动量指标
	rsiOversold30: { label: "RSI超卖(<30)", group: "momentum", desc: "RSI(14)低于30", compute: (k, i) => rsi(k.map(x => x.close), 14)[i] < 30 },
	rsiOverbought70: { label: "RSI超买(>70)", group: "momentum", desc: "RSI(14)高于70", compute: (k, i) => rsi(k.map(x => x.close), 14)[i] > 70 },
	macdGoldenCross: { label: "MACD金叉", group: "momentum", desc: "DIF上穿DEA", compute: (k, i) => { const m = macd(k.map(x => x.close)); return i > 0 && m.dif[i] > m.dea[i] && m.dif[i-1] <= m.dea[i-1]; } },
	macdDeathCross: { label: "MACD死叉", group: "momentum", desc: "DIF下穿DEA", compute: (k, i) => { const m = macd(k.map(x => x.close)); return i > 0 && m.dif[i] < m.dea[i] && m.dif[i-1] >= m.dea[i-1]; } },
	kdjGoldenCross: { label: "KDJ金叉", group: "momentum", desc: "K上穿D", compute: (k, i) => { const kd = kdj(k); return i > 0 && kd.k[i] > kd.d[i] && kd.k[i-1] <= kd.d[i-1]; } },
	
	// 波动率
	atrHigh: { label: "ATR偏高", group: "volatility", desc: "ATR(14)高于20日均值1.5倍", compute: (k, i) => { const a = atr(k, 14); const avg = sma(a, 20)[i]; return a[i] && avg && a[i] > avg * 1.5; } },
	atrLow: { label: "ATR偏低", group: "volatility", desc: "ATR(14)低于20日均值0.7倍", compute: (k, i) => { const a = atr(k, 14); const avg = sma(a, 20)[i]; return a[i] && avg && a[i] < avg * 0.7; } },
	bollSqueeze: { label: "布林收口", group: "volatility", desc: "布林带宽低于20日均值", compute: (k, i) => { const b = boll(k.map(x => x.close), 20); const bw = (b.upper[i] - b.lower[i]) / b.mid[i]; const avgBw = sma(b.upper.map((u, j) => (u - b.lower[j]) / b.mid[j]), 20)[i]; return bw && avgBw && bw < avgBw; } },
	
	// 成交量
	volumeSpike: { label: "放量(>2倍)", group: "volume", desc: "成交量超过5日均量2倍", compute: (k, i) => { const v = sma(k.map(x => x.volume), 5)[i]; return v && k[i].volume > v * 2; } },
	volumeShrink: { label: "缩量(<0.5倍)", group: "volume", desc: "成交量低于5日均量一半", compute: (k, i) => { const v = sma(k.map(x => x.volume), 5)[i]; return v && k[i].volume < v * 0.5; } },
	volumeMaCross: { label: "量能金叉", group: "volume", desc: "5日均量上穿20日均量", compute: (k, i) => { const v5 = sma(k.map(x => x.volume), 5); const v20 = sma(k.map(x => x.volume), 20); return i > 0 && v5[i] > v20[i] && v5[i-1] <= v20[i-1]; } },
	
	// 形态识别
	bullishEngulfing: { label: "看涨吞没", group: "pattern", desc: "出现看涨吞没形态", compute: (k, i) => { const p = candlePatterns(k); return p[i] && p[i].includes("看涨吞没"); } },
	morningStar: { label: "早晨之星", group: "pattern", desc: "出现早晨之星形态", compute: (k, i) => { const p = candlePatterns(k); return p[i] && p[i].includes("早晨之星"); } },
	longUpperShadow: { label: "长上影线", group: "pattern", desc: "出现长上影线", compute: (k, i) => { const p = candlePatterns(k); return p[i] && p[i].includes("长上影"); } },
	longLowerShadow: { label: "长下影线", group: "pattern", desc: "出现长下影线", compute: (k, i) => { const p = candlePatterns(k); return p[i] && p[i].includes("长下影"); } },
	doji: { label: "十字星", group: "pattern", desc: "出现十字星", compute: (k, i) => { const p = candlePatterns(k); return p[i] && p[i].includes("十字星"); } },
	
	// TD序列
	tdSetup9: { label: "TD计数9", group: "td", desc: "TD序列计数达到9", compute: (k, i) => { const td = tdSequence(k.map(x => x.close)); return Math.abs(td.setup[i]) === 9; } },
	tdCountdown13: { label: "TD计数13", group: "td", desc: "TD倒计时计数达到13", compute: (k, i) => { const td = tdSequence(k.map(x => x.close)); return Math.abs(td.countdown[i]) === 13; } },
	
	// VWAP
	aboveVwap: { label: "站上VWAP", group: "vwap", desc: "收盘价高于20日VWAP", compute: (k, i) => { const v = vwap(k, 20); return v[i] && k[i].close > v[i]; } },
	belowVwap: { label: "跌破VWAP", group: "vwap", desc: "收盘价低于20日VWAP", compute: (k, i) => { const v = vwap(k, 20); return v[i] && k[i].close < v[i]; } },
	
	// 数值因子（用于条件 DSL）
	rsiValue: { label: "RSI值", group: "numeric", desc: "RSI(14) 当前值", type: "number", compute: (k, i) => rsi(k.map(x => x.close), 14)[i] ?? null },
	macdHistValue: { label: "MACD柱", group: "numeric", desc: "MACD 柱状图值", type: "number", compute: (k, i) => { const m = macd(k.map(x => x.close)); return m.hist[i]; } },
	volumeRatioValue: { label: "量比值", group: "numeric", desc: "当前成交量 / 5日均量", type: "number", compute: (k, i) => { const v = sma(k.map(x => x.volume), 5)[i]; return v ? k[i].volume / v : null; } },
	atrValue: { label: "ATR值", group: "numeric", desc: "ATR(14) 当前值", type: "number", compute: (k, i) => atr(k, 14)[i] },
	atrPercent: { label: "ATR%", group: "numeric", desc: "ATR(14) / 收盘价 * 100", type: "number", compute: (k, i) => { const a = atr(k, 14)[i]; return a ? (a / k[i].close) * 100 : null; } },
	changePctValue: { label: "涨跌幅%", group: "numeric", desc: "当日涨跌幅百分比", type: "number", compute: (k, i) => i > 0 ? ((k[i].close - k[i-1].close) / k[i-1].close) * 100 : 0 },
	turnoverRateValue: { label: "换手率%", group: "numeric", desc: "成交量 / 流通股本 * 100（估算）", type: "number", compute: (k, i) => { const avgVol = sma(k.map(x => x.volume), 20)[i]; return avgVol ? (k[i].volume / avgVol) * 5 : null; } },
	priceAboveMa20Pct: { label: "偏离MA20%", group: "numeric", desc: "收盘价偏离MA20的百分比", type: "number", compute: (k, i) => { const m = sma(k.map(x => x.close), 20)[i]; return m ? ((k[i].close - m) / m) * 100 : null; } },
	bollWidth: { label: "布林带宽%", group: "numeric", desc: "(上轨-下轨)/中轨*100", type: "number", compute: (k, i) => { const b = boll(k.map(x => x.close), 20); return b.mid[i] ? ((b.upper[i] - b.lower[i]) / b.mid[i]) * 100 : null; } },
};

/** 量化因子分组定义 */
export const FACTOR_GROUPS = [
	{ key: "price", label: "价格位置" },
	{ key: "momentum", label: "动量指标" },
	{ key: "volatility", label: "波动率" },
	{ key: "volume", label: "成交量" },
	{ key: "pattern", label: "形态识别" },
	{ key: "td", label: "TD序列" },
	{ key: "vwap", label: "VWAP" },
];

/** 量化因子预设模板 */
export const FACTOR_PRESETS = [
	{ key: "trend_following", label: "趋势跟踪", factors: ["aboveMa20", "aboveMa60", "macdGoldenCross", "volumeSpike"] },
	{ key: "oversold_rebound", label: "超卖反弹", factors: ["rsiOversold30", "longLowerShadow", "morningStar"] },
	{ key: "breakout", label: "突破形态", factors: ["bollSqueeze", "volumeSpike", "aboveMa20"] },
	{ key: "mean_reversion", label: "均值回归", factors: ["nearMa20", "atrLow", "volumeShrink"] },
	{ key: "momentum_strong", label: "强势动量", factors: ["rsiOverbought70", "volumeSpike", "aboveMa5", "aboveMa10", "aboveMa20"] },
];

/** 量化因子 key 列表 */
export const FACTOR_KEYS = Object.keys(FACTOR_META);
/** 布尔型因子 key（排除数值因子）——只有它们参与"命中计数"与勾选面板。 */
export const FACTOR_BOOL_KEYS = FACTOR_KEYS.filter((k) => FACTOR_META[k].type !== "number");

/**
 * 计算一只票的全部量化因子。
 * @param {Array} klines 日K数据
 * @returns {Object} 因子值映射 { factorKey: value }
 */
export function computeQuantFactors(klines) {
	const result = {};
	if (!klines || klines.length < 20) return result;
	const last = klines.length - 1;
	for (const key of FACTOR_KEYS) {
		try {
			result[key] = FACTOR_META[key].compute(klines, last);
		} catch {
			result[key] = false;
		}
	}
	return result;
}

/**
 * 命中因子数：只数布尔型因子，数值因子不计（否则任何正数都会算作"命中"）。
 * @param {Object} factors computeQuantFactors 的结果
 * @returns {number}
 */
export function countFactorHits(factors) {
	let n = 0;
	for (const key of FACTOR_BOOL_KEYS) if (factors[key] === true) n++;
	return n;
}

/**
 * 命中的布尔因子 key 列表，按定义顺序。
 * @param {Object} factors computeQuantFactors 的结果
 * @returns {string[]}
 */
export function hitFactorKeys(factors) {
	return FACTOR_BOOL_KEYS.filter((k) => factors[k] === true);
}

/**
 * 评估量化因子条件。
 * @param {Object} factors computeQuantFactors 的结果
 * @param {Object} condition 条件 { factor, operator, value }
 * @returns {boolean} 是否满足条件
 */
export function evaluateFactorCondition(factors, condition) {
	const { factor, operator, value } = condition;
	const actual = factors[factor];
	if (actual === undefined || actual === null) return false;
	
	switch (operator) {
		case "eq": return actual === value;
		case "ne": return actual !== value;
		case "gt": return actual > value;
		case "lt": return actual < value;
		case "gte": return actual >= value;
		case "lte": return actual <= value;
		default: return false;
	}
}

/**
 * 检查因子集合是否满足预设策略。
 * @param {Object} factors computeQuantFactors 的结果
 * @param {string} presetKey 预设策略 key
 * @returns {boolean} 是否满足该预设
 */
export function matchesFactorPreset(factors, presetKey) {
	const preset = FACTOR_PRESETS.find(p => p.key === presetKey);
	if (!preset) return false;
	return preset.factors.every(f => factors[f] === true);
}

//#endregion
