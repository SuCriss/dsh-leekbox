// 韭菜盒子 LeekBox — 客户端 bundle 源码：个股详情弹窗（K线/分时/资金流/F10）
// 由 build.mjs 打包进 lib/client.js（npm run build）；不要手改产物。
import { h, useEffect, useRef, useState } from "./react.js";
import { API, api, cnMarket, describeError, fmt, fmtAmount, fmtPct, fmtSign, fmtTime, fmtVol, fmtYi, trend, useTradingInterval } from "./core.js";

const UP_COLOR = "#e03131";
const DOWN_COLOR = "#0f9d6e";
const MA_DEFS = [
	{ n: 5, color: "#e8590c" },
	{ n: 10, color: "#4263eb" },
	{ n: 20, color: "#9c36b5" },
];

function maSeries(closes, n) {
	const out = new Array(closes.length).fill(null);
	let sum = 0;
	for (let i = 0; i < closes.length; i++) {
		sum += closes[i];
		if (i >= n) sum -= closes[i - n];
		if (i >= n - 1) out[i] = sum / n;
	}
	return out;
}

// 压力位/支撑位(逐日滚动):每日只用截至当日的最近 60 根K线,检测摆动高低点(左右各2根确认),不使用未来数据。
// 压力位 = 收盘价上方最近的摆动高点,支撑位 = 下方最近的摆动低点(均为真实价格水平);
// 无摆动点时回退经典枢轴点,区间极值兜底,恒保证 压力位 >= 收盘 >= 支撑位。仅用于悬停浮窗展示。
function srLevels(klines, idx) {
	const L = 2;
	const win = klines.slice(Math.max(0, idx - 59), idx + 1);
	const m = win.length;
	const cur = klines[idx];
	let res = null;
	let sup = null;
	for (let i = L; i < m - L; i++) {
		let isH = true;
		let isL = true;
		for (let j = i - L; j <= i + L; j++) {
			if (j === i) continue;
			if (win[j].high >= win[i].high) isH = false;
			if (win[j].low <= win[i].low) isL = false;
		}
		if (isH && win[i].high > cur.close && (res === null || win[i].high < res)) res = win[i].high;
		if (isL && win[i].low < cur.close && (sup === null || win[i].low > sup)) sup = win[i].low;
	}
	if (m >= 2) {
		// 回退:经典枢轴点(前一根K线 P=(H+L+C)/3, R1=2P-L, S1=2P-H)
		const p = win[m - 2];
		const pp = (p.high + p.low + p.close) / 3;
		if (res === null) res = 2 * pp - p.low;
		if (sup === null) sup = 2 * pp - p.high;
	}
	// 最终兜底:区间极值
	if (res === null || res <= cur.close) res = Math.max(...win.map((b) => b.high));
	if (sup === null || sup >= cur.close) sup = Math.min(...win.map((b) => b.low));
	return { res, sup };
}

function shortDate(d) {
	const s = String(d ?? "");
	if (s.includes("-")) return s.slice(5); // 2025-01-06 -> 01-06
	if (/^\d{12}$/.test(s)) return `${s.slice(4, 6)}-${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}`;
	return s;
}

function KlineChart({ klines }) {
	const [hover, setHover] = useState(null);
	const kwrapRef = useRef(null);
	const W = 900;
	const PRICE_H = 188;
	const GAP = 10;
	const VOL_H = 52;
	const H = PRICE_H + GAP + VOL_H;
	if (!Array.isArray(klines) || klines.length < 2) return h("div", { className: "lkb-empty" }, "暂无K线数据");
	const n = klines.length;
	const step = W / n;
	const xc = (i) => i * step + step / 2;
	const closes = klines.map((k) => k.close);
	const mas = MA_DEFS.map((d) => maSeries(closes, d.n));
	let min = Math.min(...klines.map((k) => k.low));
	let max = Math.max(...klines.map((k) => k.high));
	for (const series of mas) {
		for (const v of series) {
			if (v !== null) {
				if (v < min) min = v;
				if (v > max) max = v;
			}
		}
	}
	if (!(max > min)) {
		min -= 1;
		max += 1;
	}
	const pad = (max - min) * 0.06;
	min -= pad;
	max += pad;
	const py = (v) => 4 + (1 - (v - min) / (max - min)) * (PRICE_H - 8);
	const maxVol = Math.max(...klines.map((k) => k.volume)) || 1;
	const volBase = PRICE_H + GAP + VOL_H - 2;
	const vh = (v) => Math.max(1, (v / maxVol) * (VOL_H - 6));
	const bodyW = Math.max(1.5, Math.min(step * 0.64, 12));
	const barColor = (i) => (klines[i].close >= klines[i].open ? UP_COLOR : DOWN_COLOR);
	const hi = hover === null ? n - 1 : Math.min(Math.max(hover.i, 0), n - 1);
	const hb = klines[hi];
	const hPrev = hi > 0 ? klines[hi - 1].close : hb.open;
	const hPct = hPrev ? ((hb.close - hPrev) / hPrev) * 100 : null;
	const sr = srLevels(klines, hi);
	const onMove = (e) => {
		const rect = e.currentTarget.getBoundingClientRect();
		if (rect.width <= 0) return;
		const i = Math.min(Math.max(Math.floor(((e.clientX - rect.left) / rect.width) * n), 0), n - 1);
		setHover({ i, x: e.clientX - rect.left, y: e.clientY - rect.top });
	};
	const gridYs = [0, 1 / 3, 2 / 3, 1].map((f) => 4 + f * (PRICE_H - 8));
	const ticks = [...new Set(Array.from({ length: 6 }, (_, k) => Math.round((k * (n - 1)) / 5)))];
	const tipW = 168;
	const tipH = 196;
	const wrapW = kwrapRef.current !== null && kwrapRef.current.clientWidth > 0 ? kwrapRef.current.clientWidth : W;
	const tipLeft = hover === null ? 0 : hover.x + 14 + tipW > wrapW ? Math.max(0, hover.x - 14 - tipW) : hover.x + 14;
	const tipTop = hover === null ? 0 : hover.y + 14 + tipH > H ? Math.max(0, hover.y - 14 - tipH) : hover.y + 14;
	return h(
		"div",
		null,
		h(
			"div",
			{ className: "lkb-kwrap", ref: kwrapRef, onMouseMove: onMove, onMouseLeave: () => setHover(null) },
			h(
				"svg",
				{ viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", style: { width: "100%", height: H, display: "block" } },
				gridYs.map((y, gi) =>
					h("line", { key: "g" + gi, x1: 0, x2: W, y1: y, y2: y, stroke: "var(--dsw-alias-border-l1,#eceef1)", strokeWidth: 0.6, vectorEffect: "non-scaling-stroke" })
				),
				klines.map((_, i) => {
					const b = klines[i];
					const color = barColor(i);
					const x = xc(i);
					const yO = py(b.open);
					const yC = py(b.close);
					const top = Math.min(yO, yC);
					const bh = Math.max(1, Math.abs(yO - yC));
					return h(
						"g",
						{ key: i },
						h("line", { x1: x, x2: x, y1: py(b.high), y2: py(b.low), stroke: color, strokeWidth: 1, vectorEffect: "non-scaling-stroke" }),
						h("rect", { x: x - bodyW / 2, y: top, width: bodyW, height: bh, fill: color })
					);
				}),
				mas.map((series, mi) => {
					const pts = [];
					for (let i = 0; i < n; i++) if (series[i] !== null) pts.push(`${xc(i).toFixed(1)},${py(series[i]).toFixed(1)}`);
					return pts.length > 1
						? h("polyline", { key: "ma" + mi, points: pts.join(" "), fill: "none", stroke: MA_DEFS[mi].color, strokeWidth: 1.1, vectorEffect: "non-scaling-stroke", opacity: 0.95 })
						: null;
				}),
				h("line", {
					x1: 0,
					x2: W,
					y1: py(klines[n - 1].close),
					y2: py(klines[n - 1].close),
					stroke: barColor(n - 1),
					strokeDasharray: "5 4",
					strokeWidth: 0.8,
					vectorEffect: "non-scaling-stroke",
					opacity: 0.8,
				}),
				h("line", { x1: 0, x2: W, y1: PRICE_H + GAP / 2, y2: PRICE_H + GAP / 2, stroke: "var(--dsw-alias-border-l1,#eceef1)", strokeWidth: 0.6, vectorEffect: "non-scaling-stroke" }),
				klines.map((k, i) =>
					h("rect", {
						key: "v" + i,
						x: xc(i) - bodyW / 2,
						y: volBase - vh(k.volume),
						width: bodyW,
						height: vh(k.volume),
						fill: barColor(i),
						opacity: 0.55,
					})
				),
				hover !== null && hover.i >= 0 && hover.i < n
					? h("line", { x1: xc(hover.i), x2: xc(hover.i), y1: 2, y2: volBase, stroke: "#868e96", strokeDasharray: "4 3", strokeWidth: 0.8, vectorEffect: "non-scaling-stroke" })
					: null
			),
			hover === null
				? null
				: h(
					"div",
					{ className: "lkb-kTip", style: { left: tipLeft, top: tipTop } },
					h("div", { className: "tipDate" }, shortDate(hb.date)),
					h("span", null, "开"), h("b", null, fmt(hb.open)),
					h("span", null, "高"), h("b", null, fmt(hb.high)),
					h("span", null, "低"), h("b", null, fmt(hb.low)),
					h("span", null, "收"), h("b", { className: trend(hPct) }, fmt(hb.close), " ", fmtPct(hPct)),
					h("span", null, "量"), h("b", null, fmtVol(hb.volume)),
					mas.flatMap((series, mi) => [
						h("span", { className: "ma" + MA_DEFS[mi].n, key: "m" + MA_DEFS[mi].n }, `MA${MA_DEFS[mi].n}`),
						h("b", { key: "v" + MA_DEFS[mi].n, className: "ma" + MA_DEFS[mi].n }, series[hi] === null ? "—" : fmt(series[hi]))
					]),
					h("span", { className: "srRes" }, "压力位"), h("b", { className: "srRes" }, fmt(sr.res)),
					h("span", { className: "srSup" }, "支撑位"), h("b", { className: "srSup" }, fmt(sr.sup))
				),
			h(
				"div",
				{ className: "lkb-kaxis" },
				ticks.map((ti) =>
					h("span", { key: ti, style: { left: `${Math.min(96, Math.max(4, (xc(ti) / W) * 100))}%` } }, shortDate(klines[ti]?.date))
				)
			)
		)
	);
}

// 当日分时图:价格线(蓝) + 均价线(黄) + 成交量,昨收虚线为基准,右侧标注
// 相对昨收的涨跌幅。均价线口径 Σ(价×量)/Σ(量) —— 与主流行情软件的黄色
// 均线一致,且不依赖 minute 数据里 amount 字段的单位约定(手/股差异会消掉)。
function MinuteChart({ points, prevClose, date }) {
	const [hover, setHover] = useState(null);
	const kwrapRef = useRef(null);
	const W = 900;
	const PRICE_H = 188;
	const GAP = 10;
	const VOL_H = 52;
	const H = PRICE_H + GAP + VOL_H;
	if (!Array.isArray(points) || points.length < 2) return h("div", { className: "lkb-empty" }, "暂无分时数据");
	const n = points.length;
	const step = W / n;
	const xc = (i) => i * step + step / 2;
	// 均价线:累计成交量加权均价
	const avg = new Array(n).fill(null);
	let sumPV = 0;
	let sumV = 0;
	for (let i = 0; i < n; i++) {
		const v = Number(points[i].volume) || 0;
		sumPV += (Number(points[i].price) || 0) * v;
		sumV += v;
		avg[i] = sumV > 0 ? sumPV / sumV : points[i].price;
	}
	const prices = points.map((p) => p.price);
	let min = Math.min(...prices, ...avg);
	let max = Math.max(...prices, ...avg);
	if (prevClose > 0) {
		if (prevClose < min) min = prevClose;
		if (prevClose > max) max = prevClose;
	}
	if (!(max > min)) {
		min -= 1;
		max += 1;
	}
	const pad = (max - min) * 0.08;
	min -= pad;
	max += pad;
	const py = (v) => 4 + (1 - (v - min) / (max - min)) * (PRICE_H - 8);
	const pctAt = (v) => (prevClose > 0 ? ((v - prevClose) / prevClose) * 100 : null);
	const maxVol = Math.max(...points.map((p) => p.volume)) || 1;
	const volBase = PRICE_H + GAP + VOL_H - 2;
	const vh = (v) => Math.max(1, ((Number(v) || 0) / maxVol) * (VOL_H - 6));
	// 成交量柱按相对前一刻的涨跌着色(首刻相对昨收)
	const volColor = (i) => (points[i].price >= (i > 0 ? points[i - 1].price : prevClose > 0 ? prevClose : points[0].price) ? UP_COLOR : DOWN_COLOR);
	const hi = hover === null ? n - 1 : Math.min(Math.max(hover.i, 0), n - 1);
	const hb = points[hi];
	const base = prevClose > 0 ? prevClose : points[0].price;
	const hPct = base > 0 ? ((hb.price - base) / base) * 100 : null;
	const onMove = (e) => {
		const rect = e.currentTarget.getBoundingClientRect();
		if (rect.width <= 0) return;
		const i = Math.min(Math.max(Math.floor(((e.clientX - rect.left) / rect.width) * n), 0), n - 1);
		setHover({ i, x: e.clientX - rect.left, y: e.clientY - rect.top });
	};
	const fmtT = (t) => (/^\d{4}$/.test(String(t ?? "")) ? `${String(t).slice(0, 2)}:${String(t).slice(2)}` : String(t ?? ""));
	const gridYs = [0, 1 / 3, 2 / 3, 1].map((f) => 4 + f * (PRICE_H - 8));
	const yTicks = [max, (min + max) / 2, min];
	const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * (n - 1)));
	const tipW = 150;
	const tipH = 110;
	const wrapW = kwrapRef.current !== null && kwrapRef.current.clientWidth > 0 ? kwrapRef.current.clientWidth : W;
	const tipLeft = hover === null ? 0 : hover.x + 14 + tipW > wrapW ? Math.max(0, hover.x - 14 - tipW) : hover.x + 14;
	const tipTop = hover === null ? 0 : hover.y + 14 + tipH > H ? Math.max(0, hover.y - 14 - tipH) : hover.y + 14;
	const pricePts = points.map((_, i) => `${xc(i).toFixed(1)},${py(points[i].price).toFixed(1)}`).join(" ");
	const avgPts = avg.map((v, i) => `${xc(i).toFixed(1)},${py(v).toFixed(1)}`).join(" ");
	return h(
		"div",
		null,
		h(
			"div",
			{ className: "lkb-kwrap", ref: kwrapRef, onMouseMove: onMove, onMouseLeave: () => setHover(null) },
			h(
				"svg",
				{ viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", style: { width: "100%", height: H, display: "block" } },
				gridYs.map((y, gi) =>
					h("line", { key: "g" + gi, x1: 0, x2: W, y1: y, y2: y, stroke: "var(--dsw-alias-border-l1,#eceef1)", strokeWidth: 0.6, vectorEffect: "non-scaling-stroke" })
				),
				prevClose > 0
					? h("line", { x1: 0, x2: W, y1: py(prevClose), y2: py(prevClose), stroke: "#868e96", strokeDasharray: "4 3", strokeWidth: 0.8, vectorEffect: "non-scaling-stroke", opacity: 0.8 })
					: null,
				points.map((_, i) =>
					h("rect", {
						key: "v" + i,
						x: xc(i) - Math.max(0.8, step * 0.3),
						y: volBase - vh(points[i].volume),
						width: Math.max(1.6, step * 0.6),
						height: vh(points[i].volume),
						fill: volColor(i),
						opacity: 0.55,
					})
				),
				h("polyline", { points: pricePts, fill: "none", stroke: "#4263eb", strokeWidth: 1.2, vectorEffect: "non-scaling-stroke" }),
				h("polyline", { points: avgPts, fill: "none", stroke: "#f08c00", strokeWidth: 1.1, vectorEffect: "non-scaling-stroke", opacity: 0.95 }),
				h("line", { x1: 0, x2: W, y1: PRICE_H + GAP / 2, y2: PRICE_H + GAP / 2, stroke: "var(--dsw-alias-border-l1,#eceef1)", strokeWidth: 0.6, vectorEffect: "non-scaling-stroke" }),
				hover !== null && hover.i >= 0 && hover.i < n
					? h("line", { x1: xc(hover.i), x2: xc(hover.i), y1: 2, y2: volBase, stroke: "#868e96", strokeDasharray: "4 3", strokeWidth: 0.8, vectorEffect: "non-scaling-stroke" })
					: null
			),
			h(
				"div",
				{ className: "lkb-maxis" },
				yTicks.map((t, ti) =>
					h("span", { key: "l" + ti, className: "lkb-maxL", style: { top: Math.max(10, Math.min(PRICE_H - 2, py(t))) } }, fmt(t))
				),
				prevClose > 0
					? yTicks.map((t, ti) =>
						h("span", { key: "r" + ti, className: "lkb-maxR " + trend(pctAt(t)), style: { top: Math.max(10, Math.min(PRICE_H - 2, py(t))) } }, fmtPct(pctAt(t)))
					)
					: null
			),
			hover === null
				? null
				: h(
					"div",
					{ className: "lkb-kTip", style: { left: tipLeft, top: tipTop } },
					h("div", { className: "tipDate" }, `${String(date ?? "").includes("-") ? String(date).slice(5) : String(date ?? "")} ${fmtT(hb.time)}`),
					h("span", null, "价"), h("b", { className: trend(hPct) }, fmt(hb.price)),
					h("span", null, "均"), h("b", { style: { color: "#f08c00" } }, fmt(avg[hi])),
					h("span", null, "幅"), h("b", { className: trend(hPct) }, fmtPct(hPct)),
					h("span", null, "量"), h("b", null, fmtVol(hb.volume))
				),
			h(
				"div",
				{ className: "lkb-kaxis" },
				ticks.map((ti, tk) =>
					h("span", { key: tk, style: { left: `${Math.min(96, Math.max(4, (xc(ti) / W) * 100))}%` } }, fmtT(points[ti]?.time))
				)
			)
		)
	);
}

// 资金流向柱状图:每日主力净流入,流入红/流出绿,零轴为基准,悬停高亮。
// 数据与下方明细表同源(GET /fflow 的 main 字段,单位:元)。
function FflowChart({ rows }) {
	const [hover, setHover] = useState(null);
	const W = 900;
	const H = 110;
	if (!Array.isArray(rows) || rows.length < 1) return null;
	const n = rows.length;
	const step = W / n;
	const xc = (i) => i * step + step / 2;
	const bw = Math.max(6, Math.min(step * 0.5, 42));
	const vals = rows.map((r) => Number(r.main) || 0);
	const maxAbs = Math.max(...vals.map(Math.abs)) || 1;
	const mid = H / 2;
	const bh = (v) => Math.max(2, (Math.abs(v) / maxAbs) * (mid - 8));
	const hi = hover === null ? -1 : hover.i;
	return h(
		"div",
		{ className: "lkb-ffwrap", onMouseLeave: () => setHover(null) },
		h(
			"svg",
			{ viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", style: { width: "100%", height: H, display: "block" } },
			h("line", { x1: 0, x2: W, y1: mid, y2: mid, stroke: "var(--dsw-alias-border-l1,#b7bcc7)", strokeWidth: 0.8, vectorEffect: "non-scaling-stroke" }),
			rows.map((r, i) => {
				const v = vals[i];
				const hgt = bh(v);
				const up = v >= 0;
				return h("rect", {
					key: i,
					x: xc(i) - bw / 2,
					y: up ? mid - hgt : mid,
					width: bw,
					height: hgt,
					fill: up ? UP_COLOR : DOWN_COLOR,
					opacity: hi === -1 || hi === i ? 0.85 : 0.35,
				});
			})
		),
		h("div", { className: "lkb-ffaxis" }, rows.map((r, i) => h("span", { key: i, style: { left: `${Math.min(96, Math.max(4, (xc(i) / W) * 100))}%` } }, String(r.date ?? "").slice(5)))),
		hi >= 0
			? h("div", { className: "lkb-ffval" }, `${String(rows[hi].date ?? "").slice(5)} 主力净流入 `, h("b", { className: trend(vals[hi]) }, fmtYi(vals[hi])))
			: null
	);
}

export function StockDetailWindow({ code, name, isIndex, x, y, z, onFocus, onClose, onWatched }) {
	const [q, setQ] = useState(null);
	const [klines, setKlines] = useState([]);
	const [minute, setMinute] = useState(null);
	const [period, setPeriod] = useState("day");
	const [watching, setWatching] = useState(false);
	const [fflow, setFflow] = useState(null);
	const [f10, setF10] = useState(null);
	const [error, setError] = useState("");
	const [kError, setKError] = useState("");
	const cardRef = useRef(null);
	const [pos, setPos] = useState({ x, y });
	useEffect(() => {
		let alive = true;
		setError("");
		api(API.quote + `?codes=${code}`)
			.then((d) => alive && setQ((d.quotes ?? [])[0] ?? null))
			.catch((e) => alive && setError(describeError(e)));
		api(API.watchlist)
			.then((d) => alive && setWatching((d.watchlist ?? []).some((e) => e.code === code)))
			.catch(() => {});
		return () => {
			alive = false;
		};
	}, [code]);
	useEffect(() => {
		let alive = true;
		setKError("");
		if (period === "m1") {
			// 分时:走专用 minute 路由(价格/成交量逐刻数据,前端画均价线),
			// 不走 mkline —— 后者只有 OHLC 柄,画不出标准分时形态。
			api(API.minute + `?code=${code}`)
				.then((d) => {
					if (alive) {
						setMinute(d ?? null);
						setKlines([]);
					}
				})
				.catch((e) => {
					if (alive) {
						setMinute(null);
						setKError(describeError(e));
					}
				});
			return () => {
				alive = false;
			};
		}
		setMinute(null);
		api(API.kline + `?code=${code}&period=${period}&count=120&fq=qfq`)
			.then((d) => {
				if (alive) setKlines(d.klines ?? []);
			})
			.catch((e) => {
				if (alive) {
					setKlines([]);
					setKError(describeError(e));
				}
			});
		return () => {
			alive = false;
		};
	}, [code, period]);
	useEffect(() => {
		let alive = true;
		api(API.fflow + `?code=${code}&count=30`)
			.then((d) => alive && setFflow(d.rows ?? []))
			.catch(() => alive && setFflow(null));
		return () => {
			alive = false;
		};
	}, [code]);
	// 财务摘要:挂载拉一次(F10 低频变化,服务端每 code 缓存 1 小时),
	// 失败静默——财务面是增强信息,不挡主行情。
	useEffect(() => {
		let alive = true;
		api(API.f10 + `?code=${code}`)
			.then((d) => alive && setF10(d.reports ?? []))
			.catch(() => alive && setF10(null));
		return () => {
			alive = false;
		};
	}, [code]);
	useTradingInterval(
		() => {
			api(API.quote + `?codes=${code}`)
				.then((d) => setQ((d.quotes ?? [])[0] ?? null))
				.catch(() => {});
		},
		10000,
		[code]
	);
	const toggleWatch = () => {
		api(API.watchlist + (watching ? "/remove" : "/add"), { method: "POST", body: { code, name } })
			.then(() => {
				setWatching(!watching);
				onWatched?.();
			})
			.catch(() => {});
	};
	const onHeadDown = (e) => {
		if (e.button !== 0) return;
		if (e.target.closest("button") !== null) return; // let buttons work normally
		e.preventDefault();
		const rect = cardRef.current !== null ? cardRef.current.getBoundingClientRect() : null;
		if (rect === null) return;
		const startX = e.clientX;
		const startY = e.clientY;
		const baseLeft = rect.left;
		const baseTop = rect.top;
		const clampX = (v) => Math.max(8 - rect.width + 80, Math.min(v, window.innerWidth - 80));
		const clampY = (v) => Math.max(8, Math.min(v, window.innerHeight - 40));
		const onMove = (ev) => setPos({ x: clampX(baseLeft + ev.clientX - startX), y: clampY(baseTop + ev.clientY - startY) });
		const onUp = () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			document.body.style.userSelect = "";
		};
		document.body.style.userSelect = "none";
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
	};
	const centerWindow = () => {
		const rect = cardRef.current !== null ? cardRef.current.getBoundingClientRect() : null;
		if (rect === null) return;
		setPos({
			x: Math.max(8, Math.round((window.innerWidth - rect.width) / 2)),
			y: Math.max(8, Math.round((window.innerHeight - rect.height) / 2)),
		});
	};
	const item = (label, value, cls) => h("div", { className: "lkb-qItem" }, h("div", { className: "lkb-qLabel" }, label), h("div", { className: "lkb-qValue " + (cls ?? "") }, value));
	const mkt = cnMarket(String(code ?? "").slice(0, 2).toUpperCase());
	return h(
		"div",
		{ className: "lkb-win", ref: cardRef, style: { left: pos.x, top: pos.y, zIndex: z }, onPointerDown: onFocus },
		h(
			"div",
			{ className: "lkb_head", title: "拖动移动窗口 · 双击居中", onPointerDown: onHeadDown, onDoubleClick: centerWindow },
			h("span", { className: "lkb-headTitle" }, h("span", { className: "lkb-logo" }, "📈"), name ?? code, h("span", { className: "lkb-code" }, code), mkt === "" ? null : h("span", { className: "lkb-mktTag" }, mkt)),
			h(
				"div",
				{ className: "lkb_headRight" },
				isIndex
					? h("span", { className: "lkb-mktTag", title: "指数不可交易" }, "指数")
					: h("button", { className: "lkb-btnGhost", onClick: toggleWatch }, watching ? "★ 已自选" : "☆ 加自选"),
				h("button", { className: "lkb_close", title: "关闭", onClick: onClose }, "✕")
			)
		),
		h(
			"div",
			{ className: "lkb_body" },
			error === "" ? null : h("div", { className: "lkb-error" }, error),
			h(
				"div",
				{ className: "lkb-hero" },
				h(
					"div",
					{ className: "lkb-heroMain" },
					h("div", { className: "lkb-heroPrice " + trend(q?.change) }, fmt(q?.price)),
					h(
						"div",
						{ className: "lkb-heroSub " + trend(q?.change) },
						h("span", null, fmtSign(q?.change)),
						h("span", null, fmtPct(q?.changePct))
					),
					q?.time ? h("div", { className: "lkb-heroMeta" }, "更新 ", fmtTime(q.time)) : null,
					isIndex ? null : h("div", { className: "lkb-heroMeta" }, `涨停 ${fmt(q?.limitUp)} · 跌停 ${fmt(q?.limitDown)}`)
				),
				h(
					"div",
					{ className: "lkb-heroGrid" },
					item("今开", fmt(q?.open)),
					item("昨收", fmt(q?.prevClose)),
					item("最高", fmt(q?.high), "lkb-up"),
					item("最低", fmt(q?.low), "lkb-down"),
					item("成交量", q?.volume === null || q?.volume === void 0 ? "—" : fmtVol(q.volume)),
					item("成交额", q?.amount === null || q?.amount === void 0 ? "—" : fmtAmount((q?.amount ?? 0) * 10000)),
					item("换手率", q?.turnoverRate === null || q?.turnoverRate === void 0 ? "—" : fmt(q?.turnoverRate) + "%"),
					item("量比", fmt(q?.volumeRatio)),
					item("振幅", q?.amplitude === null || q?.amplitude === void 0 ? "—" : fmt(q?.amplitude) + "%"),
					item("市盈率", fmt(q?.pe)),
					item("市净率", fmt(q?.pb)),
					item("总市值", q?.totalMv === null || q?.totalMv === void 0 ? "—" : fmt(q?.totalMv) + "亿"),
					item("流通市值", q?.floatMv === null || q?.floatMv === void 0 ? "—" : fmt(q?.floatMv) + "亿")
				)
			),
			h(
				"div",
				{ className: "lkb-chartBox" },
				h(
					"div",
					{ className: "lkb-chartTitle" },
					period === "m1" ? "当日分时（均价线为成交量加权）" : "K线（前复权）",
					h(
						"span",
						{ className: "lkb-periodRow" },
						["day", "week", "month", "m1", "m5", "m15", "m30", "m60"].map((p) =>
							h("button", { key: p, className: "lkb-period", "data-active": period === p ? "true" : "false", onClick: () => setPeriod(p) }, { day: "日K", week: "周K", month: "月K", m1: "分时", m5: "5分", m15: "15分", m30: "30分", m60: "60分" }[p])
						)
					)
				),
				kError === "" ? null : h("div", { className: "lkb-error" }, kError),
				period === "m1"
					? h(MinuteChart, { points: minute?.points, prevClose: q?.prevClose, date: minute?.date })
					: h(KlineChart, { klines })
			),
			fflow !== null && fflow.length > 0
				? h(
						"div",
						{ className: "lkb-chartBox" },
						h("div", { className: "lkb-chartTitle" }, "资金流向（主力净流入柱状图，单位：亿）"),
						h(FflowChart, { rows: fflow.slice(-15) })
					)
				: null,
			fflow !== null && fflow.length > 0
				? h(
						"div",
						{ className: "lkb-chartBox" },
						h("div", { className: "lkb-chartTitle" }, "资金流分明细（最近 8 日，单位：亿）"),
						h(
							"table",
							{ style: { fontSize: 11 } },
							h(
								"thead",
								null,
								h("tr", null, h("th", null, "日期"), h("th", null, "主力净流入"), h("th", null, "超大单"), h("th", null, "大单"), h("th", null, "中单"), h("th", null, "小单"))
							),
							h(
								"tbody",
								null,
								fflow.slice(-8).map((r) =>
									h(
										"tr",
										{ key: r.date },
										h("td", { className: "lkb-code" }, r.date.slice(5)),
										h("td", { className: trend(r.main) }, fmtYi(r.main)),
										h("td", { className: trend(r.xl) }, fmtYi(r.xl)),
										h("td", { className: trend(r.big) }, fmtYi(r.big)),
										h("td", { className: trend(r.middle) }, fmtYi(r.middle)),
										h("td", { className: trend(r.small) }, fmtYi(r.small))
									)
								)
							)
						)
					)
				: null,
			f10 !== null && f10.length > 0
				? h(
					"div",
					{ className: "lkb-chartBox" },
					h("div", { className: "lkb-chartTitle" }, "财务摘要（F10 · 最新报告期在前）"),
					h(
						"table",
						{ style: { fontSize: 11 } },
						h(
							"thead",
							null,
							h("tr", null, h("th", null, "报告期"), h("th", null, "营收(亿)"), h("th", null, "同比"), h("th", null, "归母净利(亿)"), h("th", null, "同比"), h("th", null, "ROE"), h("th", null, "毛利率"), h("th", null, "负债率"), h("th", null, "EPS(元)"))
						),
						h(
							"tbody",
							null,
							f10.map((r) =>
								h(
									"tr",
									{ key: r.period },
									h("td", { className: "lkb-code" }, r.period),
									h("td", null, fmtYi(r.revenue)),
									h("td", { className: trend(r.revenueYoy) }, fmtPct(r.revenueYoy)),
									h("td", null, fmtYi(r.profit)),
									h("td", { className: trend(r.profitYoy) }, fmtPct(r.profitYoy)),
									h("td", null, fmt(r.roe) + "%"),
									h("td", null, fmt(r.grossMargin) + "%"),
									h("td", null, fmt(r.debtRatio) + "%"),
									h("td", null, fmt(r.eps))
								)
							)
						)
					)
				)
				: null
		)
	);
}
