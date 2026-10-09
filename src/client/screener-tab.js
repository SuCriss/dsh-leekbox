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
	return { signals, labelOf, groups, strategies };
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
	const [mode, setMode] = useState("standard"); // standard | multi
	const [node, setNode] = useState("hs_a");
	const [universe, setUniverse] = useState(800);
	const [f, setF] = useState({ minPrice: "", maxPrice: "", minTurnover: "", maxTurnover: "", minChange: "", maxChange: "" });
	const [excludeST, setExcludeST] = useState(true);
	const [require, setRequire] = useState({});
	const [strategies, setStrategies] = useState({});
	const [minHits, setMinHits] = useState(2);
	const [minScore, setMinScore] = useState("0");
	const [rows, setRows] = useState([]);
	const [running, setRunning] = useState(false);
	const [progress, setProgress] = useState(null);
	const [error, setError] = useState("");
	const [ran, setRan] = useState(false);
	const [meta, setMeta] = useState(() => buildScreenMeta(null));
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
	const selCount = mode === "multi" ? Object.values(strategies).filter(Boolean).length : Object.values(require).filter(Boolean).length;
	const resetAll = () => {
		setMode("standard");
		setNode("hs_a");
		setUniverse(800);
		setF({ minPrice: "", maxPrice: "", minTurnover: "", maxTurnover: "", minChange: "", maxChange: "" });
		setExcludeST(true);
		setRequire({});
		setStrategies({});
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
						: "股票池 · 基础条件 · 技术信号 —— 实时日K计算指标，综合评分排序"
				)
			),
			h(
				"div",
				{ className: "lkb-seg", style: { marginLeft: 0 } },
				h("button", { type: "button", className: "lkb-segBtn", "data-active": mode === "standard" ? "true" : "false", onClick: () => setMode("standard") }, "评分选股"),
				h("button", { type: "button", className: "lkb-segBtn", "data-active": mode === "multi" ? "true" : "false", onClick: () => setMode("multi") }, "多策略交叉")
			),
			selCount > 0 ? h("span", { className: "lkb-sigCount", style: { fontSize: 11.5, padding: "3px 12px" }, "data-n": "true" }, mode === "multi" ? `已选 ${selCount} 个策略` : `已选 ${selCount} 个信号`) : null
		),
		h(
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
				h("button", { className: "lkb-runBtn", disabled: running, onClick: run }, running ? "扫描中…" : "开始选股 ▸"),
				h("span", { className: "lkb-status", style: { marginLeft: "auto" } }, mode === "multi" ? "基于日K实时命中 MACD / 均线 / 布林 / 量能 / 超卖等多策略" : "基于日K实时计算 MACD / KDJ / RSI / 均线 / 布林")
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
						h("span", null, mode === "multi" ? `共 ${rows.length} 只匹配 · 按命中策略数排序` : `共 ${rows.length} 只匹配 · 按综合评分排序`),
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
								mode === "multi" ? h("th", null, "命中") : h("th", null, "评分"),
								h("th", null, "现价"),
								h("th", null, "涨跌幅"),
								h("th", null, "换手"),
								h("th", null, "量比"),
								h("th", null, mode === "multi" ? "命中的策略" : "信号"),
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
											(mode === "multi" ? r.strategies ?? [] : r.signals ?? []).slice(0, 3).map((t) => h("span", { className: "lkb-signalTag", key: t }, t)),
											(mode === "multi" ? r.strategies ?? [] : r.signals ?? []).length > 3 ? h("span", { className: "lkb-signalMore", key: "__more" }, `+${(mode === "multi" ? r.strategies ?? [] : r.signals ?? []).length - 3}`) : null
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
