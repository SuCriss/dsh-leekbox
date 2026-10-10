// 韭菜盒子 LeekBox — 客户端 bundle 源码：行情页（搜索 + 榜单 + 板块 + 龙虎榜）
// 由 build.mjs 打包进 lib/client.js（npm run build）；不要手改产物。
import { h, useCallback, useEffect, useRef, useState } from "./react.js";
import { API, api, cnMarket, describeError, fmt, fmtAmount, fmtPct, fmtSign, fmtYi, isWatched, openOnRow, trend, useTradingInterval } from "./core.js";
import { StarButton } from "./star.js";

/** 本机时区的今天（YYYY-MM-DD）。
 *
 * 用作日期选择框的 max：不能用 toISOString()，它按 UTC 取日期 —— 北京时间
 * 早上 8 点前 UTC 还停在前一天，会让"今天"这个选项消失。
 */
export function todayDateStr(now = new Date()) {
	const p = (v) => String(v).padStart(2, "0");
	return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

const RANK_CHOICES = [
	{ key: "changepercent", label: "涨幅榜", order: "desc" },
	{ key: "changepercent", label: "跌幅榜", order: "asc" },
	{ key: "amount", label: "成交额榜", order: "desc" },
	{ key: "turnoverratio", label: "换手率榜", order: "desc" },
	{ key: "netflow", label: "主力净流入", order: "desc" },
];
const BOARD_MODES = [
	{ key: "stocks", label: "📈 股票榜" },
	{ key: "sector", label: "🗂 板块榜" },
	{ key: "longhu", label: "🐉 龙虎榜" },
];
const POOL_CHOICES = [	{ key: "hs_a", label: "沪深A股" },
	{ key: "main", label: "主板" },
	{ key: "non_main", label: "非主板" },
	{ key: "etf", label: "ETF/场内基金" },
	{ key: "cb", label: "可转债" },
	{ key: "lof", label: "LOF" },
];

const SEARCH_TYPE_META = {
	stock: { label: "股票", cls: "t-stock" },
	etf: { label: "ETF", cls: "t-etf" },
	cb: { label: "转债", cls: "t-cb" },
	lof: { label: "LOF", cls: "t-lof" },
	fund: { label: "基金", cls: "t-lof" },
};

/**
 * Redesigned search results: a dropdown under the search box with type
 * badges, live quote chips (price + change %) and star actions — instead
 * of the old plain name/code rows.
 */
function SearchResultsCard({ hits, loading, error, source, kw, watchSet, onOpen, onClear }) {
	return h(
		"div",
		{
			className: "lkb-srCard",
			// Keep focus in the input on mousedown: if focus left now, the
			// onBlur-close would unmount the card before the click lands.
			onMouseDown: (e) => e.preventDefault(),
		},
		h(
			"div",
			{ className: "lkb-srMeta" },
			h("span", { className: "lkb-srQuery" }, "“", kw, "”"),
			loading
				? h("span", { className: "lkb-srNote" }, h("span", { className: "lkb-spinner" }), " 搜索中…")
				: hits.length > 0
					? h("span", { className: "lkb-srNote" }, `${hits.length} 个结果`, source === "smartbox" ? " · 拼音匹配" : "")
					: h("span", { className: "lkb-srNote" }, error ? "搜索失败，请重试" : "无匹配结果"),
			hits.length > 0 && !loading
				? h("span", { style: { marginLeft: "auto" } }, h("button", { className: "lkb-srClear", onClick: onClear }, "清空"))
				: null
		),
		loading && hits.length === 0
			? h("div", { className: "lkb-srSkeletons" }, Array.from({ length: 5 }, (_, i) => h("div", { key: i, className: "lkb-srSkeleton" })))
			: null,
		!loading && error
			? h("div", { className: "lkb-srEmpty" }, "⚠ 搜索服务暂时不可用，稍后再试")
			: null,
		!loading && !error && hits.length === 0
			? h("div", { className: "lkb-srEmpty" }, "没有找到匹配的股票 / ETF / 可转债。试试代码、名称关键字或拼音首字母（如 gzmt）")
			: null,
		hits.length > 0
			? h(
					"div",
					{ className: "lkb-srList" },
					hits.map((s) => {
						const tm = SEARCH_TYPE_META[s.type] ?? SEARCH_TYPE_META.fund;
						const up = s.changePct !== null && s.changePct !== void 0 && Number.isFinite(Number(s.changePct)) ? trend(Number(s.changePct)) : "";
						return h(
							"div",
							{
								key: s.quoteId || s.code,
								className: "lkb-srItem",
								onClick: (e) => openOnRow(e, onOpen, s.code, s.name),
							},
							h("span", { className: "lkb-srBadge " + tm.cls }, tm.label),
							h(
								"span",
								{ className: "lkb-srId" },
								h("span", { className: "lkb-name" }, s.name),
								h("span", { className: "lkb-code" }, cnMarket(s.market) + " " + s.code)
							),
							h(
								"span",
								{ className: "lkb-srQuote " + up },
								// No quote data (server cold-start / feed miss): show
								// nothing rather than "— —" placeholder dashes.
								s.price === null || s.price === void 0
									? null
									: h("span", { className: "lkb-srPrice" }, fmt(s.price)),
								s.changePct === null || s.changePct === void 0 || !Number.isFinite(Number(s.changePct))
									? null
									: h("span", { className: "lkb-srPct" }, fmtPct(s.changePct))
							),
							h("span", { className: "lkb-srStar" }, h(StarButton, { code: s.code, name: s.name, on: isWatched(watchSet, s.code), confirmText: `确定将 ${s.name}（${s.code}）移出自选吗？` }))
						);
					})
				)
			: null
	);
}

export function MarketTab({ onOpen, watchCodes }) {
	const [kw, setKw] = useState("");
	const [hits, setHits] = useState([]);
	const [searchOpen, setSearchOpen] = useState(false);
	const [searchLoading, setSearchLoading] = useState(false);
	const [searchSource, setSearchSource] = useState("");
	const [searchError, setSearchError] = useState(false);
	const [rankKey, setRankKey] = useState(0);
	const [page, setPage] = useState(1);
	const [pageSize, setPageSize] = useState(30);
	const [total, setTotal] = useState(0);
	const [rows, setRows] = useState([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const [mode, setMode] = useState("stocks"); // stocks | sector | longhu
	const [pool, setPool] = useState("hs_a"); // hs_a | etf | cb | lof
	const [showZt, setShowZt] = useState(false);
	const [ztBoard, setZtBoard] = useState(null); // null=全部 | 板数=只看该连板
	const [sectorType, setSectorType] = useState("industry"); // industry | concept
	const [sectorSort, setSectorSort] = useState("f3"); // f3 涨跌幅 | f62 主力净流入
	const [sectorPage, setSectorPage] = useState(1);
	const [sectorPageSize, setSectorPageSize] = useState(30);
	const [sectorRows, setSectorRows] = useState([]);
	const [sectorTotal, setSectorTotal] = useState(0);
	const [sectorLoading, setSectorLoading] = useState(false);
	const [lhRows, setLhRows] = useState([]);
	const [lhTotal, setLhTotal] = useState(0);
	const [lhDate, setLhDate] = useState("");
	// 用户显式选择的查询日期（""=最近已发布的交易日）。服务端会把还没出榜的
	// 日期往前回溯，所以 lhDate 是"实际显示的那天"，可能与 lhQuery 不同。
	const [lhQuery, setLhQuery] = useState("");
	const [lhLoading, setLhLoading] = useState(false);
	const [sentiment, setSentiment] = useState(null);
	const debounceRef = useRef(null);
	const searchSeq = useRef(0);
	// 榜单 / 板块 / 龙虎榜各有独立的请求序号。此前三个 loader 共用一个 loadSeq，
	// 于是 60s 轮询里的 loadRank() 会把在飞的板块请求判成过期，`.finally` 里的
	// setSectorLoading(false) 被跳过 —— 表格永久停在"板块数据加载中…"。
	const rankSeq = useRef(0);
	const sectorSeq = useRef(0);
	const longhuSeq = useRef(0);
	const watchSet = new Set(watchCodes ?? []);
	useEffect(() => {
		clearTimeout(debounceRef.current);
		const k = kw.trim();
		if (k === "") {
			setHits([]);
			setSearchLoading(false);
			setSearchError(false);
			return;
		}
		const seq = ++searchSeq.current;
		setSearchLoading(true);
		setSearchError(false);
		debounceRef.current = setTimeout(() => {
			api(API.search + `?kw=${encodeURIComponent(k)}&count=20`)
				.then((data) => {
					if (seq !== searchSeq.current) return;
					setHits(data.hits ?? []);
					setSearchSource(data.source ?? "");
				})
				.catch(() => {
					if (seq !== searchSeq.current) return;
					setHits([]);
					setSearchError(true);
				})
				.finally(() => {
					if (seq !== searchSeq.current) return;
					setSearchLoading(false);
				});
		}, 120);
		return () => clearTimeout(debounceRef.current);
	}, [kw]);
	const loadRank = useCallback(() => {
		const seq = ++rankSeq.current;
		const choice = RANK_CHOICES[rankKey];
		setLoading(true);
		api(API.rank + `?sort=${choice.key}&order=${choice.order}&page=${page}&size=${pageSize}&node=${pool}`)
			.then((data) => {
				if (seq !== rankSeq.current) return; // stale response
				setRows(data.rows ?? []);
				setTotal(data.total ?? 0);
				setError("");
			})
			.catch((e) => {
				if (seq !== rankSeq.current) return;
				setError(describeError(e));
			})
			.finally(() => {
				if (seq !== rankSeq.current) return;
				setLoading(false);
			});
	}, [rankKey, page, pageSize, pool]);
	useEffect(() => {
		loadRank();
	}, [loadRank]);
	const loadSector = useCallback(() => {
		const seq = ++sectorSeq.current;
		setSectorLoading(true);
		api(API.sector + `?type=${sectorType}&sort=${sectorSort}&order=desc&page=${sectorPage}&size=${sectorPageSize}`)
			.then((data) => {
				if (seq !== sectorSeq.current) return; // stale response
				setSectorRows(data.rows ?? []);
				setSectorTotal(data.total ?? 0);
			})
			.catch((e) => {
				if (seq !== sectorSeq.current) return;
				setError(describeError(e));
			})
			.finally(() => {
				if (seq !== sectorSeq.current) return;
				setSectorLoading(false);
			});
	}, [sectorType, sectorSort, sectorPage, sectorPageSize]);
	useEffect(() => {
		if (mode === "sector") loadSector();
	}, [mode, loadSector]);
	const loadLonghu = useCallback(() => {
		const seq = ++longhuSeq.current;
		setLhLoading(true);
		api(API.longhu + `?date=${encodeURIComponent(lhQuery)}&page=1&size=30`)
			.then((data) => {
				if (seq !== longhuSeq.current) return; // stale response
				setLhRows(data.rows ?? []);
				setLhTotal(data.total ?? 0);
				setLhDate(data.date ?? "");
			})
			.catch((e) => {
				if (seq !== longhuSeq.current) return;
				setError(describeError(e));
				// 请求失败时不要把上一次的日期/行留在屏幕上冒充这一次的结果
				setLhRows([]);
				setLhTotal(0);
				setLhDate("");
			})
			.finally(() => {
				if (seq !== longhuSeq.current) return;
				setLhLoading(false);
			});
	}, [lhQuery]);
	useEffect(() => {
		if (mode === "longhu") loadLonghu();
	}, [mode, loadLonghu]);
	const loadSentiment = useCallback(() => {
		api(API.sentiment)
			.then((d) => {
				setSentiment(d);
				try {
					localStorage.setItem("leekbox.sentiment", JSON.stringify(d));
				} catch {}
			})
			.catch(() => {});
	}, []);
	useEffect(() => {
		// 即写即显:情绪数据上游冷启动可能要几秒,先用上次会话的缓存渲染,
		// 再立即后台刷新覆盖,避免长时间空转显示 "—"
		try {
			const raw = localStorage.getItem("leekbox.sentiment");
			if (raw !== null) {
				const cached = JSON.parse(raw);
				if (cached && typeof cached === "object") setSentiment(cached);
			}
		} catch {}
		loadSentiment();
	}, [loadSentiment]);
	// 60s 自动刷新只刷当前页签看得到的那个域：以前无条件调 loadRank()，在板块 /
	// 龙虎榜页签下等于每 60s 白打一次被东财限流的 clist，还会把在飞的板块请求判成
	// 过期（见 loadSector 的 stale 守卫）。
	useTradingInterval(() => {
		if (mode === "sector") loadSector();
		else if (mode === "longhu") loadLonghu();
		else loadRank();
		loadSentiment();
	}, 60000);
	return h(
		"div",
		null,
		h(
			"div",
			{ className: "lkb-stickyTop" },
			h(
				"div",
				{ className: "lkb-searchWrap" },
				h("div", { className: "lkb-searchRow" },
					h("span", { className: "lkb-searchGlass" }, "🔍"),
					h("input", { className: "lkb-input lkb-searchInput", placeholder: "搜索股票/ETF/转债：代码、名称或拼音首字母，如 600519、茅台、gzmt、510300", value: kw, onChange: (e) => { setKw(e.target.value); setSearchOpen(true); }, onFocus: () => { if (kw.trim() !== "") setSearchOpen(true); }, onKeyDown: (e) => { if (e.key === "Escape") { e.stopPropagation(); if (kw !== "") { setKw(""); } else { setSearchOpen(false); e.target.blur(); } } else if (e.key === "Enter" && !e.nativeEvent.isComposing && hits.length > 0) { setSearchOpen(false); onOpen(hits[0].code, hits[0].name); } }, onBlur: (e) => { const wrap = e.currentTarget.closest(".lkb-searchWrap"); if (wrap === null || !wrap.contains(e.relatedTarget)) setSearchOpen(false); } }),
					kw !== "" ? h("button", { className: "lkb-searchClear", title: "清空", onClick: () => setKw("") }, "✕") : null
				),
				searchOpen && kw.trim() !== ""
					? h(SearchResultsCard, {
							hits,
							loading: searchLoading,
							error: searchError,
							source: searchSource,
							kw: kw.trim(),
							watchSet,
							onOpen: (code, name) => {
								setSearchOpen(false);
								onOpen(code, name);
							},
							onClear: () => setKw(""),
						})
					: null
			),
		h(
			"div",
			{ className: "lkb-headRow" },
			h(
				"div",
				{ className: "lkb-seg" },
				BOARD_MODES.map((m) => h("button", { key: m.key, className: "lkb-segBtn", "data-active": mode === m.key ? "true" : "false", onClick: () => setMode(m.key) }, m.label))
			)
		),
		sentiment !== null && sentiment.maxBoard > 0
			? h(
					"div",
					{ className: "lkb-chipRow", style: { marginTop: 6 } },
					h("span", { className: "lkb-chipLabel" }, "连板梯队"),
					(sentiment.ladder ?? []).map((l) =>
						h(
							"button",
							{
								key: l.board,
								className: "lkb-chip",
								"data-active": showZt && ztBoard === l.board ? "true" : "false",
								title: `点击查看 ${l.board} 连板的 ${l.count} 只个股`,
								onClick: () => {
									if (showZt && ztBoard === l.board) {
										setShowZt(false);
										setZtBoard(null);
									} else {
										setZtBoard(l.board);
										setShowZt(true);
									}
								},
							},
							l.board + "板",
							h("b", { className: "lkb-up", style: { marginLeft: 3 } }, l.count)
						)
					),
					h("button", { className: "lkb-chip", "data-active": showZt && ztBoard === null ? "true" : "false", onClick: () => { setZtBoard(null); setShowZt(!showZt); } }, showZt ? "收起涨停池 ▲" : "全部涨停池 ▼")
				)
			: null,
		showZt && (sentiment?.ztList ?? []).length > 0
			? h(
					"div",
					{ className: "lkb-chartBox", style: { padding: 6, marginTop: 6, maxHeight: 240, overflowY: "auto" } },
					h(
						"div",
						{ className: "lkb-status", style: { padding: "2px 8px 6px" } },
						ztBoard === null
							? `全部涨停（${sentiment.ztList.length} 只）`
							: `${ztBoard} 连板（${(sentiment.ztList ?? []).filter((s) => s.board === ztBoard).length} 只）`
					),
					(sentiment.ztList ?? [])
						.filter((s) => ztBoard === null || s.board === ztBoard)
						.map((s) =>
						h(
							"div",
							{
								key: s.code,
								style: { display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderRadius: 8, cursor: "pointer" },
								onClick: (e) => openOnRow(e, onOpen, s.code, s.name),
							},
							h("span", { className: "lkb-name" }, s.name),
							h("span", { className: "lkb-code" }, s.code),
							h("span", { className: "lkb-pill", style: { padding: "1px 8px", fontSize: 10 } }, s.board + "板"),
							h("span", { className: "lkb-code", style: { marginLeft: "auto" } }, s.industry ?? "")
						)
					)
				)
			: null,
		mode === "stocks"
			? h(
					"div",
					null,
					h(
						"div",
						{ className: "lkb-chipRow" },
						h("span", { className: "lkb-chipLabel" }, "市场"),
						POOL_CHOICES.map((p) => h("button", { key: p.key, className: "lkb-chip", "data-active": pool === p.key ? "true" : "false", onClick: () => { setPool(p.key); setPage(1); } }, p.label))
					),
					h("div", { className: "lkb-chipRow" }, h("span", { className: "lkb-chipLabel" }, "榜单"), RANK_CHOICES.map((c, i) => h("button", { key: c.label, className: "lkb-chip", "data-active": rankKey === i ? "true" : "false", onClick: () => { setRankKey(i); setPage(1); } }, c.label)))
				)
			: mode === "sector"
				? h(
						"div",
						{ className: "lkb-chipRow" },
						h("span", { className: "lkb-chipLabel" }, "板块"),
						h("button", { className: "lkb-chip", "data-active": sectorType === "industry" ? "true" : "false", onClick: () => { setSectorType("industry"); setSectorPage(1); } }, "行业"),
						h("button", { className: "lkb-chip", "data-active": sectorType === "concept" ? "true" : "false", onClick: () => { setSectorType("concept"); setSectorPage(1); } }, "概念"),
						h("span", { className: "lkb-chipLabel", style: { marginLeft: 8 } }, "排序"),
						h("button", { className: "lkb-chip", "data-active": sectorSort === "f3" ? "true" : "false", onClick: () => { setSectorSort("f3"); setSectorPage(1); } }, "涨幅"),
						h("button", { className: "lkb-chip", "data-active": sectorSort === "f62" ? "true" : "false", onClick: () => { setSectorSort("f62"); setSectorPage(1); } }, "主力净流入")
					)
				: null,
		mode === "longhu"
			? h(
					"div",
					{ className: "lkb-chipRow" },
					h("span", { className: "lkb-chipLabel" }, "查日期"),
					h("input", {
						type: "date",
						className: "lkb-input",
						style: { width: 138, padding: "3px 6px", fontSize: 11 },
						value: lhQuery,
						max: todayDateStr(),
						title: "选择要查看的龙虎榜日期（留空 = 最近已发布）",
						onChange: (e) => setLhQuery(e.target.value),
					}),
					lhQuery === ""
						? null
						: h("button", { className: "lkb-chip", onClick: () => setLhQuery("") }, "回到最近"),
					lhDate === "" ? null : h("span", { className: "lkb-chipLabel", style: { marginLeft: 4 } }, `显示 ${lhDate}`)
				)
			: null,
		mode === "longhu" && lhDate !== ""
			? h(
					"div",
					{ className: "lkb-banner" },
					"📅 龙虎榜数据日期 ",
					h("b", null, lhDate),
					// 请求的那天可能还没出榜（要盘后晚间才发布），服务端会往前找最近的
					// 已发布交易日 —— 这时必须说明"你要的那天没有，下面是 X 日"，否则
					// 用户会以为这就是他要的那天。
					lhQuery !== "" && lhQuery !== lhDate ? `（${lhQuery} 尚未发布，已回溯到最近交易日）` : "",
					" · 上榜 ",
					h("b", null, lhTotal),
					" 只（收盘后晚间更新）"
				)
			: null,
		loading
			? h(
					"div",
					{ className: "lkb-status" },
					h("span", { className: "lkb-spinner" }),
					h("span", null, RANK_CHOICES[rankKey].label + " 请求中，请稍候…")
				)
			: null,
		loading ? h("div", { className: "lkb-loadbar" }) : null,
		error === "" ? null : h("div", { className: "lkb-error" }, error),
		),
		mode === "stocks"
			? h(
					"table",
					null,
					h(
						"thead",
						null,
						h(
							"tr",
							null,
							h("th", { style: { width: 34, textAlign: "left" } }, "#"),
							h("th", null, "名称"),
							h("th", null, "现价"),
							h("th", null, "涨跌幅"),
							h("th", null, "涨跌额"),
							h("th", null, "成交额"),
							h("th", null, "主力净流入"),
							h("th", null, "换手"),
							h("th", null, "市盈率"),
							h("th", null, "")
						)
					),
					h(
						"tbody",
						null,
						rows.map((r, i) =>
							h(
								"tr",
								{ key: r.symbol, style: { animationDelay: Math.min(i * 12, 240) + "ms" }, onClick: (e) => openOnRow(e, onOpen, r.code, r.name) },
								h("td", null, h("span", { className: "lkb-rankNum", "data-medal": i < 3 ? String(i + 1) : void 0 }, String((page - 1) * pageSize + i + 1))),
								h("td", null, h("span", { className: "lkb-name" }, r.name), h("span", { className: "lkb-code" }, r.code)),
								h("td", null, fmt(r.price)),
								h("td", null, h("span", { className: "lkb-pct " + trend(r.changePct) }, fmtPct(r.changePct))),
								h("td", { className: trend(r.change) }, fmtSign(r.change)),
								h("td", null, fmtAmount(r.amount === null || r.amount === void 0 ? null : r.amount * 10000)),
								h("td", { className: trend(r.netflow) }, fmtYi(r.netflow)),
								h("td", null, r.turnoverRate === null ? "—" : fmt(r.turnoverRate) + "%"),
								h("td", null, r.pe === null ? "—" : fmt(r.pe)),
								h("td", null, h(StarButton, { code: r.code, name: r.name, on: isWatched(watchSet, r.code), confirmText: `确定将 ${r.name}（${r.code}）移出自选吗？` }))
							)
						)
					)
				)
			: mode === "sector"
				? h(
						"table",
						null,
						h(
							"thead",
							null,
							h(
								"tr",
								null,
								h("th", null, "板块"),
								h("th", null, "涨跌幅"),
								h("th", null, "主力净流入"),
								h("th", null, "上涨/下跌"),
								h("th", null, "领涨股")
							)
						),
						h(
							"tbody",
							null,
							sectorLoading
								? h("tr", null, h("td", { colSpan: 5 }, "板块数据加载中…"))
								: sectorRows.map((r, i) =>
										h(
											"tr",
											{ key: r.code, style: { animationDelay: Math.min(i * 12, 240) + "ms" } },
											h("td", null, h("span", { className: "lkb-name" }, r.name), h("span", { className: "lkb-code" }, r.code)),
											h("td", null, h("span", { className: "lkb-pct " + trend(r.changePct) }, fmtPct(r.changePct))),
											h("td", { className: trend(r.netInflow) }, fmtYi(r.netInflow)),
											h("td", null, h("span", { className: "lkb-up" }, r.upCount ?? "—"), " / ", h("span", { className: "lkb-down" }, r.downCount ?? "—")),
											h("td", null, r.leader === "" ? "—" : h("span", { className: "lkb-name" }, r.leader), r.leaderChangePct === null || r.leader === "" ? null : h("span", { className: "lkb-code" }, fmtPct(r.leaderChangePct)))
										)
									)
						)
					)
				: mode === "longhu"
					? h(
							"table",
							null,
							h(
								"thead",
								null,
								h(
									"tr",
									null,
									h("th", null, "名称"),
									h("th", null, "现价"),
									h("th", null, "涨跌幅"),
									h("th", null, "龙虎榜净买额"),
									h("th", null, "上榜原因")
								)
							),
							h(
								"tbody",
								null,
								lhLoading
									? h("tr", null, h("td", { colSpan: 5 }, "龙虎榜加载中…"))
									: lhRows.map((r, i) =>
											h(
												"tr",
												{ key: r.code + r.reason, style: { animationDelay: Math.min(i * 12, 240) + "ms" }, onClick: (e) => openOnRow(e, onOpen, r.code, r.name) },
												h("td", null, h("span", { className: "lkb-name" }, r.name), h("span", { className: "lkb-code" }, r.code)),
												h("td", null, fmt(r.close)),
												h("td", null, h("span", { className: "lkb-pct " + trend(r.changePct) }, fmtPct(r.changePct))),
												h("td", { className: trend(r.netAmt) }, fmtYi(r.netAmt)),
												h("td", { className: "lkb-code" }, r.reason)
											)
										)
							)
						)
					: null,
		mode === "stocks" && total > 0
			? h(
					"div",
					{ className: "lkb-pager", style: { flexWrap: "wrap" } },
					h("button", { className: "lkb-btnGhost", disabled: page <= 1 || loading, onClick: () => setPage(1) }, "« 首页"),
					h("button", { className: "lkb-btnGhost", disabled: page <= 1 || loading, onClick: () => setPage(page - 1) }, "‹ 上一页"),
					h("span", { className: "lkb-status", style: { alignSelf: "center" } }, `第 ${page} / ${Math.max(1, Math.ceil(total / pageSize))} 页 · 共 ${total} 只`),
					h("button", { className: "lkb-btnGhost", disabled: loading || page >= Math.ceil(total / pageSize), onClick: () => setPage(page + 1) }, "下一页 ›"),
					h("button", { className: "lkb-btnGhost", disabled: loading || page >= Math.ceil(total / pageSize), onClick: () => setPage(Math.max(1, Math.ceil(total / pageSize))) }, "末页 »"),
					h(
						"select",
						{ className: "lkb-input", style: { width: 92, padding: "5px 8px", fontSize: 12 }, value: String(pageSize), onChange: (e) => { setPageSize(Number(e.target.value)); setPage(1); } },
						h("option", { value: "30" }, "30 条/页"),
						h("option", { value: "50" }, "50 条/页"),
						h("option", { value: "100" }, "100 条/页")
					)
				)
			: mode === "sector" && sectorTotal > 0
				? h(
					"div",
					{ className: "lkb-pager", style: { flexWrap: "wrap" } },
					h("button", { className: "lkb-btnGhost", disabled: sectorPage <= 1 || sectorLoading, onClick: () => setSectorPage(1) }, "« 首页"),
					h("button", { className: "lkb-btnGhost", disabled: sectorPage <= 1 || sectorLoading, onClick: () => setSectorPage(sectorPage - 1) }, "‹ 上一页"),
					h("span", { className: "lkb-status", style: { alignSelf: "center" } }, `第 ${sectorPage} / ${Math.max(1, Math.ceil(sectorTotal / sectorPageSize))} 页 · 共 ${sectorTotal} 个（按 ${sectorSort === "f62" ? "主力净流入" : "涨跌幅"} 排序）`),
					h("button", { className: "lkb-btnGhost", disabled: sectorLoading || sectorPage >= Math.ceil(sectorTotal / sectorPageSize), onClick: () => setSectorPage(sectorPage + 1) }, "下一页 ›"),
					h("button", { className: "lkb-btnGhost", disabled: sectorLoading || sectorPage >= Math.ceil(sectorTotal / sectorPageSize), onClick: () => setSectorPage(Math.max(1, Math.ceil(sectorTotal / sectorPageSize))) }, "末页 »"),
					h(
						"select",
						{ className: "lkb-input", style: { width: 92, padding: "5px 8px", fontSize: 12 }, value: String(sectorPageSize), onChange: (e) => { setSectorPageSize(Number(e.target.value)); setSectorPage(1); } },
						h("option", { value: "30" }, "30 条/页"),
						h("option", { value: "50" }, "50 条/页"),
						h("option", { value: "100" }, "100 条/页")
					)
				)
				: null
	);
}
