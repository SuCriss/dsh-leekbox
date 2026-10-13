// 韭菜盒子 LeekBox — 客户端 bundle 源码：选股页（评分 + 多策略交叉）
// 由 build.mjs 打包进 lib/client.js（npm run build）；不要手改产物。
import { h, useEffect, useRef, useState } from "./react.js";
import { API, api, describeError, fmt, fmtPct, isWatched, openOnRow, trend } from "./core.js";
import { StarButton } from "./star.js";

// 选股面板的信号/策略元数据以服务端为唯一来源（GET /screener/meta，定义见
// lib/signals.js），下面的常量只是**离线兜底**：服务端取不到时仍能渲染面板，
// 不至于把整个选股页变成空白。服务端新增信号会自动出现在界面上。
/** 展示文案微调：服务端 label 是数据口径名，这里补上阈值/周期提示。 */
const SIGNAL_HINT = {
	macdGold: "MACD金叉(近3日)",
	jOversold: "J值超卖(<20)",
	rsiOversold: "RSI超卖(<20)",
	volumeSurge: "放量(>1.5倍5日均量)",
	upStreak: "连涨≥3日",
};
const SCREEN_SIGNALS_FALLBACK = [
	{ key: "macdGold", label: "MACD金叉(近3日)" },
	{ key: "macdZero", label: "MACD零轴上" },
	{ key: "kdjGold", label: "KDJ金叉" },
	{ key: "jOversold", label: "J值超卖(<20)" },
	{ key: "rsiGold", label: "RSI金叉" },
	{ key: "rsiOversold", label: "RSI超卖(<20)" },
	{ key: "maBullish", label: "均线多头排列" },
	{ key: "aboveMa20", label: "站上MA20" },
	{ key: "aboveMa60", label: "站上MA60" },
	{ key: "bollBreak", label: "突破布林上轨" },
	{ key: "volumeSurge", label: "放量(>1.5倍5日均量)" },
	{ key: "upStreak", label: "连涨≥3日" },
	{ key: "newHigh60", label: "创60日新高" },
];
const SCREEN_GROUPS_FALLBACK = [
	{ key: "trend", label: "趋势动能", items: ["macdGold", "macdZero", "upStreak", "newHigh60"] },
	{ key: "osc", label: "超买超卖", items: ["kdjGold", "jOversold", "rsiGold", "rsiOversold"] },
	{ key: "ma", label: "均线 · 布林", items: ["maBullish", "aboveMa20", "aboveMa60", "bollBreak"] },
	{ key: "vol", label: "量能异动", items: ["volumeSurge"] },
];
/** 多策略交叉模式的预设策略（离线兜底副本）。 */
const SCREEN_STRATEGIES_FALLBACK = [
	{ key: "macdGold", label: "MACD金叉", desc: "MACD金叉买入信号" },
	{ key: "maBullish", label: "均线多头", desc: "5日>10日>20日均线多头排列" },
	{ key: "volBreak", label: "放量突破", desc: "放量突破布林上轨" },
	{ key: "oversold", label: "超卖反弹", desc: "J值或RSI超卖" },
	{ key: "trendUp", label: "趋势转强", desc: "MACD零轴上+站上MA20" },
	{ key: "newHigh", label: "创60日新高", desc: "创60日新高+站上MA60" },
	{ key: "strongRise", label: "强势连涨", desc: "连涨且均线多头" },
];
const SCREEN_FACTOR_GROUPS_FALLBACK = [
	{ key: "price", label: "价格位置", items: ["aboveMa5", "aboveMa10", "aboveMa20", "aboveMa60", "aboveMa120", "nearMa20"] },
	{ key: "momentum", label: "动量指标", items: ["rsiOversold30", "rsiOverbought70", "macdGoldenCross", "macdDeathCross", "kdjGoldenCross"] },
	{ key: "volatility", label: "波动率", items: ["atrHigh", "atrLow", "bollSqueeze"] },
	{ key: "volume", label: "成交量", items: ["volumeSpike", "volumeShrink", "volumeMaCross"] },
	{ key: "pattern", label: "形态识别", items: ["bullishEngulfing", "morningStar", "longUpperShadow", "longLowerShadow", "doji"] },
	{ key: "td", label: "TD序列", items: ["tdSetup9", "tdCountdown13"] },
	{ key: "vwap", label: "VWAP", items: ["aboveVwap", "belowVwap"] },
	{ key: "numeric", label: "数值因子", items: ["rsiValue", "macdHistValue", "volumeRatioValue", "atrValue", "atrPercent", "changePctValue", "turnoverRateValue", "priceAboveMa20Pct", "bollWidth"] },
];
const SCREEN_FACTOR_PRESETS_FALLBACK = [
	{ key: "trend_following", label: "趋势跟踪", factors: ["aboveMa20", "aboveMa60", "macdGoldenCross", "volumeSpike"] },
	{ key: "oversold_rebound", label: "超卖反弹", factors: ["rsiOversold30", "longLowerShadow", "morningStar"] },
	{ key: "breakout", label: "突破形态", factors: ["bollSqueeze", "volumeSpike", "aboveMa20"] },
	{ key: "mean_reversion", label: "均值回归", factors: ["nearMa20", "atrLow", "volumeShrink"] },
	{ key: "momentum_strong", label: "强势动量", factors: ["rsiOverbought70", "volumeSpike", "aboveMa5", "aboveMa10", "aboveMa20"] },
];
/**
 * 把服务端元数据整理成面板要用的形状。
 * @param {object|null} meta GET /screener/meta 的响应；为 null 时用本地兜底
 */
function buildScreenMeta(meta) {
	const rawSignals = Array.isArray(meta?.signals) && meta.signals.length > 0
		? meta.signals
		: SCREEN_SIGNALS_FALLBACK;
	const signals = rawSignals.map((s) => ({ key: s.key, label: SIGNAL_HINT[s.key] ?? s.label }));
	const labelOf = Object.fromEntries(signals.map((s) => [s.key, s.label]));
	const rawGroups = Array.isArray(meta?.signalGroups) && meta.signalGroups.length > 0
		? meta.signalGroups
		: SCREEN_GROUPS_FALLBACK;
	// 丢掉服务端没给出文案的信号，避免渲染出 undefined 标签。
	const groups = rawGroups
		.map((g) => ({ key: g.key, label: g.label, items: (g.items ?? []).filter((k) => labelOf[k] !== void 0) }))
		.filter((g) => g.items.length > 0);
	const strategies = Array.isArray(meta?.strategies) && meta.strategies.length > 0
		? meta.strategies.map((s) => ({ key: s.key, label: s.label, desc: s.desc }))
		: SCREEN_STRATEGIES_FALLBACK;
	
	// 量化因子
	const rawFactors = Array.isArray(meta?.factors) ? meta.factors : [];
	const factorLabelOf = Object.fromEntries(rawFactors.map((f) => [f.key, f.label]));
	const rawFactorGroups = Array.isArray(meta?.factorGroups) && meta.factorGroups.length > 0
		? meta.factorGroups
		: SCREEN_FACTOR_GROUPS_FALLBACK;
	const factorGroups = rawFactorGroups.map((g) => ({ ...g }));
	// 离线兜底：服务端没给 factors 时，用本地副本的 label
	if (Object.keys(factorLabelOf).length === 0) {
		const FALLBACK_FACTOR_LABELS = {
			aboveMa5: "站上MA5", aboveMa10: "站上MA10", aboveMa20: "站上MA20", aboveMa60: "站上MA60", aboveMa120: "站上MA120",
			nearMa20: "贴近MA20", rsiOversold30: "RSI超卖(<30)", rsiOverbought70: "RSI超买(>70)",
			macdGoldenCross: "MACD金叉", macdDeathCross: "MACD死叉", kdjGoldenCross: "KDJ金叉",
			atrHigh: "ATR偏高", atrLow: "ATR偏低", bollSqueeze: "布林收口",
			volumeSpike: "放量(>2倍)", volumeShrink: "缩量(<0.5倍)", volumeMaCross: "量能金叉",
			bullishEngulfing: "看涨吞没", morningStar: "早晨之星", longUpperShadow: "长上影线", longLowerShadow: "长下影线", doji: "十字星",
			tdSetup9: "TD计数9", tdCountdown13: "TD计数13", aboveVwap: "站上VWAP", belowVwap: "跌破VWAP",
			rsiValue: "RSI值", macdHistValue: "MACD柱", volumeRatioValue: "量比值", atrValue: "ATR值",
			atrPercent: "ATR%", changePctValue: "涨跌幅%", turnoverRateValue: "换手率%",
			priceAboveMa20Pct: "偏离MA20%", bollWidth: "布林带宽%",
		};
		for (const [k, v] of Object.entries(FALLBACK_FACTOR_LABELS)) factorLabelOf[k] = v;
	}
	
	const rawFactorPresets = Array.isArray(meta?.factorPresets) && meta.factorPresets.length > 0
		? meta.factorPresets
		: SCREEN_FACTOR_PRESETS_FALLBACK;
	const factorPresets = rawFactorPresets.map((p) => ({ ...p }));
	
	return { signals, labelOf, groups, strategies, factorGroups, factorPresets, factorLabelOf };
}
const NODE_CHIPS = [
	{ v: "hs_a", label: "沪深A股" },
	{ v: "sh_a", label: "沪A" },
	{ v: "sz_a", label: "深A" },
	{ v: "cyb", label: "创业板" },
	{ v: "kcb", label: "科创板" },
];
const UNIVERSE_OPTS = [
	["300", "成交额前300"],
	["800", "成交额前800"],
	["1500", "成交额前1500"],
	["0", "全市场"],
];

export function ScreenerTab({ onOpen, watchCodes }) {
	const [mode, setMode] = useState("standard"); // standard | multi | event
	const [node, setNode] = useState("hs_a");
	const [universe, setUniverse] = useState(800);
	const [f, setF] = useState({ minPrice: "", maxPrice: "", minTurnover: "", maxTurnover: "", minChange: "", maxChange: "" });
	const [excludeST, setExcludeST] = useState(true);
	const [require, setRequire] = useState({});
	const [strategies, setStrategies] = useState({});
	const [factorRequire, setFactorRequire] = useState({});
	const [factorPresets, setFactorPresets] = useState({});
	const [minFactorPresets, setMinFactorPresets] = useState(1);
	const [minFactorScore, setMinFactorScore] = useState("0");
	const [minHits, setMinHits] = useState(2);
	const [minScore, setMinScore] = useState("0");
	const [rows, setRows] = useState([]);
	const [running, setRunning] = useState(false);
	const [progress, setProgress] = useState(null);
	const [error, setError] = useState("");
	const [ran, setRan] = useState(false);
	const [meta, setMeta] = useState(() => buildScreenMeta(null));
	// 事件驱动（时事热点）模式的状态：热点列表 + 展开态 + 加载/错误
	const [hotEvents, setHotEvents] = useState([]);
	const [eventsLoading, setEventsLoading] = useState(false);
	const [eventsError, setEventsError] = useState("");
	const [expandedEvent, setExpandedEvent] = useState(null);
	const timerRef = useRef(null);
	const metaLoadedRef = useRef(false);
	useEffect(() => {
		// 信号/策略元数据只拉一次；失败就静默留在本地兜底副本上。
		if (metaLoadedRef.current) return;
		metaLoadedRef.current = true;
		let alive = true;
		api(API.screenerMeta)
			.then((data) => {
				if (alive) setMeta(buildScreenMeta(data));
			})
			.catch(() => {});
		return () => {
			alive = false;
		};
	}, []);
	useEffect(() => {
		// Unmounting mid-run (e.g. tab switch) would otherwise leave the
		// progress poll spinning against a detached component.
		return () => {
			if (timerRef.current) {
				clearInterval(timerRef.current);
				timerRef.current = null;
			}
		};
	}, []);
	const watchSet = new Set(watchCodes ?? []);
	const set = (k) => (e) => setF((prev) => ({ ...prev, [k]: e.target.value }));
	const toggleReq = (key) => () => setRequire((prev) => ({ ...prev, [key]: !prev[key] }));
	const toggleStrat = (key) => () => setStrategies((prev) => ({ ...prev, [key]: !prev[key] }));
	const toggleFactorReq = (key) => () => setFactorRequire((prev) => ({ ...prev, [key]: !prev[key] }));
	const toggleFactorPreset = (key) => () => setFactorPresets((prev) => ({ ...prev, [key]: !prev[key] }));
	const loadEvents = () => {
		if (eventsLoading) return;
		setEventsLoading(true);
		setEventsError("");
		api(API.screenerEvents)
			.then((data) => {
				setHotEvents(data.events ?? []);
			})
			.catch((e) => setEventsError(describeError(e)))
			.finally(() => setEventsLoading(false));
	};
	// 切到事件模式时自动拉一次热点
	useEffect(() => {
		if (mode === "event" && hotEvents.length === 0 && eventsError === "") loadEvents();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [mode]);
	const run = () => {
		if (running) return;
		setRunning(true);
		setRan(true);
		setError("");
		setRows([]);
		setProgress({ stage: "universe" });
		const params = {
			node,
			universe: Number(universe) || 0,
			excludeST,
			mode,
		};
		if (mode === "multi") {
			params.strategies = meta.strategies.filter((s) => strategies[s.key]).map((s) => s.key);
			params.minStrategyHits = Math.max(1, Number(minHits) || 2);
		} else if (mode === "factor") {
			params.factorPresets = meta.factorPresets.filter((p) => factorPresets[p.key]).map((p) => p.key);
			params.factorRequire = meta.factorGroups.flatMap((g) => g.items.filter((k) => factorRequire[k]));
			params.minFactorPresets = Math.max(1, Number(minFactorPresets) || 1);
			params.minFactorScore = Number(minFactorScore) || 0;
		} else {
			params.minScore = Number(minScore) || 0;
			params.require = meta.signals.filter((s) => require[s.key]).map((s) => s.key);
		}
		for (const [k, v] of Object.entries(f)) {
			if (v !== "") params[k] = Number(v);
		}
		const timer = setInterval(() => {
			api(API.screener + "/progress")
				.then((p) => setProgress(p))
				.catch(() => {});
		}, 600);
		timerRef.current = timer;
		api(API.screener, { method: "POST", body: params })
			.then((data) => {
				setRows(data.rows ?? []);
				setProgress({ stage: "done" });
			})
			.catch((e) => setError(describeError(e)))
			.finally(() => {
				clearInterval(timer);
				timerRef.current = null;
				setRunning(false);
			});
	};
	const stageText = (p) => {
		if (!p) return "";
		switch (p.stage) {
			case "universe":
				return `扫描股票池快照…（已获取 ${p.scanned ?? 0} 只）`;
			case "filter":
				return `基础条件过滤…（候选 ${p.candidates ?? 0} 只）`;
			case "kline":
				return `拉取K线计算指标 ${p.done ?? 0}/${p.total ?? 0}…`;
			case "indicators":
				return "计算技术指标评分…";
			case "done":
				return "完成";
			default:
				return "";
		}
	};
	const pct =
		progress && progress.total > 0
			? Math.min(100, Math.round(((progress.done ?? 0) / progress.total) * 100))
			: null;
	const selCount = mode === "multi"
		? Object.values(strategies).filter(Boolean).length
		: mode === "factor"
			? Object.values(factorRequire).filter(Boolean).length + Object.values(factorPresets).filter(Boolean).length
			: Object.values(require).filter(Boolean).length;
	const resetAll = () => {
		setMode("standard");
		setNode("hs_a");
		setUniverse(800);
		setF({ minPrice: "", maxPrice: "", minTurnover: "", maxTurnover: "", minChange: "", maxChange: "" });
		setExcludeST(true);
		setRequire({});
		setStrategies({});
		setFactorRequire({});
		setFactorPresets({});
		setMinFactorPresets(1);
		setMinFactorScore("0");
		setMinHits(2);
		setMinScore("0");
	};
	const rangeField = (label, lo, hi) =>
		h(
			"div",
			{ className: "lkb-condBlock" },
			h("div", { className: "lkb-scFieldLabel" }, label),
			h(
				"div",
				{ className: "lkb-rangeGroup" },
				h("input", { className: "lkb-input", value: f[lo], onChange: set(lo), placeholder: "最低" }),
				h("span", { className: "lkb-rangeTilde" }, "—"),
				h("input", { className: "lkb-input", value: f[hi], onChange: set(hi), placeholder: "最高" })
			)
		);
	const scoreTier = (s) => (s >= 85 ? "3" : s >= 70 ? "2" : s >= 50 ? "1" : "0");
	return h(
		"div",
		{ className: "lkb-sc" },
		h(
			"div",
			{ className: "lkb-scHead" },
			h(
				"div",
				null,
				h("div", { className: "lkb-scTitle" }, "🔍 智能选股"),
				h(
					"div",
					{ className: "lkb-scSub" },
					mode === "multi"
						? "多策略交叉选股 —— 同时满足多个预设策略（交集）才入选，策略数越高越强势"
						: mode === "event"
							? "事件驱动选股 —— 从 7×24 财经快讯中提取时事热点，按热点关联受益股，点热点展开关联股票"
							: mode === "factor"
								? "量化因子选股 —— 基于多维度技术指标因子，灵活组合筛选条件"
								: "股票池 · 基础条件 · 技术信号 —— 实时日K计算指标，综合评分排序"
				)
			),
			h(
				"div",
				{ className: "lkb-seg", style: { marginLeft: 0 } },
				h("button", { type: "button", className: "lkb-segBtn", "data-active": mode === "standard" ? "true" : "false", onClick: () => setMode("standard") }, "评分选股"),
				h("button", { type: "button", className: "lkb-segBtn", "data-active": mode === "multi" ? "true" : "false", onClick: () => setMode("multi") }, "多策略交叉"),
				h("button", { type: "button", className: "lkb-segBtn", "data-active": mode === "factor" ? "true" : "false", onClick: () => setMode("factor") }, "量化因子"),
				h("button", { type: "button", className: "lkb-segBtn", "data-active": mode === "event" ? "true" : "false", onClick: () => setMode("event") }, "事件驱动")
			),
			selCount > 0 && mode !== "event" ? h("span", { className: "lkb-sigCount", style: { fontSize: 11.5, padding: "3px 12px" }, "data-n": "true" }, mode === "multi" ? `已选 ${selCount} 个策略` : `已选 ${selCount} 个信号`) : null
		),
		mode === "event"
			? h(
					"div",
					{ className: "lkb-scCard" },
					h(
						"div",
						{ className: "lkb-eventBar" },
						h("span", { className: "lkb-status" }, eventsLoading ? h("span", { className: "lkb-spinner" }) : `共 ${hotEvents.length} 条热点`),
						h("button", { className: "lkb-btnGhost", onClick: loadEvents, disabled: eventsLoading }, eventsLoading ? "抓取中…" : "刷新热点")
					),
					eventsError !== ""
						? h("div", { className: "lkb-error" }, eventsError)
						: hotEvents.length === 0 && !eventsLoading
							? h("div", { className: "lkb-emptyState" }, h("div", { className: "lkb-emptyIcon" }, "📰"), "当前快讯里暂未抓到带关联股票的热点", h("div", { style: { marginTop: 4, fontSize: 11.5 } }, "稍后刷新试试，或快讯源暂时未标注关联个股"))
							: h(
									"div",
									{ className: "lkb-eventList" },
									hotEvents.map((ev) => {
										const open = expandedEvent === ev.id;
										return h(
											"div",
											{ className: "lkb-eventItem", key: ev.id },
											h(
												"div",
												{ className: "lkb-eventHead", onClick: () => setExpandedEvent(open ? null : ev.id) },
												h("span", { className: "lkb-eventDot", "data-hot": ev.important ? "true" : "false" }),
												h("span", { className: "lkb-eventText" }, ev.text),
												ev.board !== null && ev.board !== void 0 ? h("span", { className: "lkb-eventBoard" }, ev.board) : null,
												h("span", { className: "lkb-eventMeta" }, ev.source === "sina" ? "新浪" : ev.source === "em" ? "东财" : ev.source === "jin10" ? "金十" : ev.source, " · ", ev.stocks.length, " 只"),
												h("span", { className: "lkb-eventArrow", "data-open": open ? "true" : "false" }, "▾")
											),
											open
												? h(
														"div",
														{ className: "lkb-eventStocks" },
														ev.stocks.map((s) =>
															h(
																"div",
																{ className: "lkb-eventStock", key: s.code, onClick: (e) => openOnRow(e, onOpen, s.code, s.name) },
																h("span", { className: "lkb-name" }, s.name),
																h("span", { className: "lkb-code" }, s.code),
																h("span", { className: "lkb-eventPrice " + trend(s.changePct) }, s.price === null || s.price === void 0 ? "—" : fmt(s.price)),
																h("span", { className: "lkb-eventPct " + trend(s.changePct) }, s.changePct === null || s.changePct === void 0 ? "—" : fmtPct(s.changePct)),
																h(StarButton, { code: s.code, name: s.name, on: isWatched(watchSet, s.code), confirmText: `确定将 ${s.name}（${s.code}）移出自选吗？` })
															)
														)
													)
												: null
										);
									})
								)
				)
			: h(
					"div",
					{ className: "lkb-scCard" },
			h(
				"div",
				{ className: "lkb-scRow" },
				h(
					"div",
					{ className: "lkb-condBlock" },
					h("div", { className: "lkb-scFieldLabel" }, "市场板块"),
					h("div", { className: "lkb-seg" }, NODE_CHIPS.map((c) => h("button", { key: c.v, type: "button", className: "lkb-segBtn", "data-active": node === c.v ? "true" : "false", onClick: () => setNode(c.v) }, c.label)))
				),
				h(
					"div",
					{ className: "lkb-condBlock" },
					h("div", { className: "lkb-scFieldLabel" }, "样本范围"),
					h(
						"select",
						{ className: "lkb-input lkb-scSelect", value: String(universe), onChange: (e) => setUniverse(Number(e.target.value)) },
						UNIVERSE_OPTS.map(([v, l]) => h("option", { value: v, key: v }, l))
					)
				),
				h(
					"div",
					{ className: "lkb-condBlock", style: { marginLeft: "auto" } },
					h("div", { className: "lkb-scFieldLabel" }, "风险过滤"),
					h("label", { className: "lkb-switch", "data-on": excludeST ? "true" : "false", onClick: () => setExcludeST((v) => !v) }, h("span", { className: "lkb-switchTrack" }), "排除 ST")
				)
			),
			h("div", { className: "lkb-scDivider" }),
			h(
				"div",
				{ className: "lkb-scRow" },
				rangeField("价格 ¥", "minPrice", "maxPrice"),
				rangeField("换手率 %", "minTurnover", "maxTurnover"),
				rangeField("今日涨幅 %", "minChange", "maxChange")
			),
			h("div", { className: "lkb-scDivider" }),
			mode === "multi"
				? h(
						"div",
						{ className: "lkb-condBlock" },
						h("div", { className: "lkb-scFieldLabel" }, "预设策略（勾选参与交叉，个股需同时命中其中多个）"),
						h(
							"div",
							{ className: "lkb-sigGroups" },
							meta.strategies.map((s) => {
								const on = strategies[s.key] === true;
								return h(
									"button",
									{ key: s.key, type: "button", className: "lkb-chip2", "data-on": on ? "true" : "false", onClick: toggleStrat(s.key), title: s.desc, style: { flexDirection: "column", alignItems: "flex-start", gap: 2, padding: "7px 11px" } },
									h("span", { style: { display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 } }, h("span", { className: "lkb-chip2Dot" }), s.label),
									h("span", { style: { fontSize: 10.5, color: "#868e96", fontWeight: 400 } }, s.desc)
								);
							})
						),
						h(
							"div",
							{ className: "lkb-scRow", style: { gap: 12, alignItems: "center" } },
							h(
								"div",
								{ className: "lkb-condBlock" },
								h("div", { className: "lkb-scFieldLabel" }, "至少命中策略数"),
								h(
									"div",
									{ className: "lkb-rangeGroup" },
									h(
										"select",
										{ className: "lkb-input lkb-scSelect", value: String(minHits), onChange: (e) => setMinHits(Number(e.target.value)) },
										[1, 2, 3, 4, 5].map((n) => h("option", { value: String(n), key: n }, `${n} 个策略`))
									)
								)
							)
						)
					)
				: mode === "factor"
					? h(
							"div",
							null,
							h(
								"div",
								{ className: "lkb-condBlock" },
								h("div", { className: "lkb-scFieldLabel" }, "预设组合（勾选参与交叉，个股需命中其中若干个组合的全部因子）"),
								h(
									"div",
									{ className: "lkb-sigGroups" },
									meta.factorPresets.map((p) => {
										const on = factorPresets[p.key] === true;
										return h(
											"button",
											{ key: p.key, type: "button", className: "lkb-chip2", "data-on": on ? "true" : "false", onClick: toggleFactorPreset(p.key), title: p.factors.map((f) => meta.factorLabelOf[f] ?? f).join(" + "), style: { flexDirection: "column", alignItems: "flex-start", gap: 2, padding: "7px 11px" } },
											h("span", { style: { display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 } }, h("span", { className: "lkb-chip2Dot" }), p.label),
											h("span", { style: { fontSize: 10.5, color: "#868e96", fontWeight: 400 } }, p.factors.map((f) => meta.factorLabelOf[f] ?? f).join(" + "))
										);
									})
								),
								h(
									"div",
									{ className: "lkb-scRow", style: { gap: 12, alignItems: "center" } },
									h(
										"div",
										{ className: "lkb-condBlock" },
										h("div", { className: "lkb-scFieldLabel" }, "至少命中组合数"),
										h(
											"div",
											{ className: "lkb-rangeGroup" },
											h(
												"select",
												{ className: "lkb-input lkb-scSelect", value: String(minFactorPresets), onChange: (e) => setMinFactorPresets(Number(e.target.value)) },
												[1, 2, 3, 4, 5].map((n) => h("option", { value: String(n), key: n }, `${n} 个组合`))
											)
										)
									)
								)
							),
							h("div", { className: "lkb-scDivider" }),
							h(
								"div",
								{ className: "lkb-condBlock" },
								h("div", { className: "lkb-scFieldLabel" }, "量化因子（勾选 = 必须满足，全部命中因子参与评分）"),
								h(
									"div",
									{ className: "lkb-sigGroups" },
									meta.factorGroups.map((g) => {
										const n = g.items.filter((k) => factorRequire[k]).length;
										return h(
											"div",
											{ className: "lkb-sigGroup", key: g.key },
											h("div", { className: "lkb-sigGroupTitle" }, g.label, h("span", { className: "lkb-sigCount", "data-n": n > 0 ? "true" : "false" }, `${n}/${g.items.length}`)),
											h("div", { style: { display: "flex", flexWrap: "wrap", gap: 6 } }, g.items.map((k) => h("button", { key: k, type: "button", className: "lkb-chip2", "data-on": factorRequire[k] ? "true" : "false", onClick: toggleFactorReq(k) }, h("span", { className: "lkb-chip2Dot" }), meta.factorLabelOf[k] ?? k)))
										);
									})
								)
							)
						)
					: h(
						"div",
						{ className: "lkb-condBlock" },
						h("div", { className: "lkb-scFieldLabel" }, "技术信号（勾选 = 必须满足，全部参与加权评分）"),
						h(
							"div",
							{ className: "lkb-sigGroups" },
							meta.groups.map((g) => {
								const n = g.items.filter((k) => require[k]).length;
								return h(
									"div",
									{ className: "lkb-sigGroup", key: g.key },
									h("div", { className: "lkb-sigGroupTitle" }, g.label, h("span", { className: "lkb-sigCount", "data-n": n > 0 ? "true" : "false" }, `${n}/${g.items.length}`)),
									h("div", { style: { display: "flex", flexWrap: "wrap", gap: 6 } }, g.items.map((k) => h("button", { key: k, type: "button", className: "lkb-chip2", "data-on": require[k] ? "true" : "false", onClick: toggleReq(k) }, h("span", { className: "lkb-chip2Dot" }), meta.labelOf[k])))
								);
							})
						)
					),
			h("div", { className: "lkb-scDivider" }),
			h(
				"div",
				{ className: "lkb-scActions" },
				h("button", { className: "lkb-btnGhost", onClick: resetAll }, "重置"),
				mode === "standard"
					? h("div", { className: "lkb-rangeGroup" }, h("span", { className: "lkb-unit" }, "综合评分 ≥"), h("input", { className: "lkb-input lkb-scoreInput", value: minScore, onChange: (e) => setMinScore(e.target.value) }))
					: null,
				mode === "factor"
					? h("div", { className: "lkb-rangeGroup" }, h("span", { className: "lkb-unit" }, "因子得分 ≥"), h("input", { className: "lkb-input lkb-scoreInput", value: minFactorScore, onChange: (e) => setMinFactorScore(e.target.value) }))
					: null,
				h("button", { className: "lkb-runBtn", disabled: running, onClick: run }, running ? "扫描中…" : "开始选股 ▸"),
				h("span", { className: "lkb-status", style: { marginLeft: "auto" } }, mode === "multi"
					? "基于日K实时命中 MACD / 均线 / 布林 / 量能 / 超卖等多策略"
					: mode === "factor"
						? "基于日K实时计算 RSI / MACD / KDJ / ATR / VWAP / TD / 形态等因子"
						: "基于日K实时计算 MACD / KDJ / RSI / 均线 / 布林")
			),
			running && progress
				? h(
						"div",
						{ className: "lkb-progressWrap" },
						h("div", { className: "lkb-status" }, stageText(progress)),
						pct !== null ? h("div", { className: "lkb-progress" }, h("div", { className: "lkb-progressBar", style: { width: pct + "%" } })) : null
					)
				: null
		),
		error === "" ? null : h("div", { className: "lkb-error" }, error),
		ran && !running && error === "" && rows.length === 0
			? h(
					"div",
					{ className: "lkb-emptyState" },
					h("div", { className: "lkb-emptyIcon" }, "🫥"),
					"没有符合条件的股票",
					h("div", { style: { marginTop: 4, fontSize: 11.5 } }, mode === "multi" ? "试试勾选更多策略，或降低「至少命中策略数」门槛" : "试试放宽价格 / 换手区间，或减少必选信号")
				)
			: null,
		rows.length > 0
			? h(
					"div",
					{ className: "lkb-resCard" },
					h(
						"div",
						{ className: "lkb-resSummary" },
						h("span", null, mode === "multi" ? `共 ${rows.length} 只匹配 · 按命中策略数排序` : mode === "factor" ? `共 ${rows.length} 只匹配 · 按因子得分排序` : `共 ${rows.length} 只匹配 · 按综合评分排序`),
						h("span", { className: "lkb-status" }, "首批扫描较慢 · 结果有缓存")
					),
					h(
						"table",
						null,
						h(
							"thead",
							null,
							h(
								"tr",
								null,
								h("th", null, "#"),
								h("th", null, "名称"),
								mode === "multi" ? h("th", null, "命中") : mode === "factor" ? h("th", null, "因子") : h("th", null, "评分"),
								h("th", null, "现价"),
								h("th", null, "涨跌幅"),
								h("th", null, "换手"),
								h("th", null, "量比"),
								h("th", null, mode === "multi" ? "命中的策略" : mode === "factor" ? "命中的因子" : "信号"),
								h("th", null, "")
							)
						),
						h(
							"tbody",
							null,
							rows.map((r, i) =>
								h(
									"tr",
									{ key: r.symbol, onClick: (e) => openOnRow(e, onOpen, r.code, r.name) },
									h("td", null, h("span", { className: "lkb-rankNum", "data-medal": i < 3 ? String(i + 1) : void 0 }, i + 1)),
									h("td", null, h("span", { className: "lkb-name" }, r.name), h("span", { className: "lkb-code" }, r.code)),
									mode === "multi"
										? h("td", null, h("span", { className: "lkb-scorePill", "data-tier": (r.strategyCount ?? 0) >= 4 ? "3" : (r.strategyCount ?? 0) >= 3 ? "2" : "1" }, r.strategyCount ?? 0))
										: h("td", null, h("span", { className: "lkb-scorePill", "data-tier": scoreTier(r.score ?? 0) }, r.score)),
									h("td", { className: trend(r.change) }, fmt(r.price)),
									h("td", { className: trend(r.change) }, fmtPct(r.changePct)),
									h("td", null, r.turnoverRate === null ? "—" : fmt(r.turnoverRate) + "%"),
									h("td", null, r.volumeRatio === null ? "—" : fmt(r.volumeRatio)),
									h(
										"td",
										null,
										h(
											"span",
											{ className: "lkb-signalTags" },
											(mode === "multi" ? r.strategies ?? [] : mode === "factor" ? r.factors ?? [] : r.signals ?? []).slice(0, 3).map((t) => h("span", { className: "lkb-signalTag", key: t }, meta.factorLabelOf[t] || t)),
											(mode === "multi" ? r.strategies ?? [] : mode === "factor" ? r.factors ?? [] : r.signals ?? []).length > 3 ? h("span", { className: "lkb-signalMore", key: "__more" }, `+${(mode === "multi" ? r.strategies ?? [] : mode === "factor" ? r.factors ?? [] : r.signals ?? []).length - 3}`) : null
										)
									),
									h("td", null, h(StarButton, { code: r.code, name: r.name, on: isWatched(watchSet, r.code), confirmText: `确定将 ${r.name}（${r.code}）移出自选吗？` }))
								)
							)
						)
					)
				)
			: null
	);
}
