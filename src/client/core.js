// 韭菜盒子 LeekBox — 客户端 bundle 源码：API 通道 + 格式化 + 通用 hooks
// 由 build.mjs 打包进 lib/client.js（npm run build）；不要手改产物。
import { h, useEffect, useRef } from "./react.js";

export const API = {
	indices: "/api/leekbox/indices",
	quote: "/api/leekbox/quote",
	kline: "/api/leekbox/kline",
	search: "/api/leekbox/search",
	rank: "/api/leekbox/rank",
	sector: "/api/leekbox/sector",
	sentiment: "/api/leekbox/sentiment",
	fflow: "/api/leekbox/fflow",
	f10: "/api/leekbox/f10",
	longhu: "/api/leekbox/longhu",
	news: "/api/leekbox/news",
	watchlist: "/api/leekbox/watchlist",
	minute: "/api/leekbox/minute",
	alerts: "/api/leekbox/alerts",
	screener: "/api/leekbox/screener",
	screenerMeta: "/api/leekbox/screener/meta",
};

const ERR_FALLBACK = "数据获取失败，请稍后重试";

/** 把任何错误转成能直接显示给用户的中文。
 *
 * 服务端已经按约定把 error 字段写成中文（见 lib/fetch-utils.js 的
 * feedError/userMessage），所以大部分情况这里是"原样透出"。它真正要兜的是
 * **浏览器自己的报错**——fetch 断网抛 `TypeError: Failed to fetch`、超时中止
 * 抛 `The operation was aborted`，这些英文以前会原封不动出现在红色错误条上。
 * 被替换掉的原文写进 console.warn，排查时去控制台看。 */
export function describeError(e, fallback = ERR_FALLBACK) {
	const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "";
	if (raw === "") return fallback;
	if (/[\u4e00-\u9fa5]/.test(raw)) return raw; // 服务端文案已是中文，原样透出
	if (/failed to fetch|networkerror|load failed|network request failed|fetch failed|err_/i.test(raw)) {
		return "网络连接失败，请检查网络后重试";
	}
	if (/abort|timeout|timed out/i.test(raw)) return "请求超时，请稍后重试";
	const http = /^HTTP (\d{3})$/.exec(raw);
	if (http !== null) return `服务返回异常（HTTP ${http[1]}）`;
	console.warn("[leekbox] 未翻译的错误文案:", raw);
	return fallback;
}

export async function api(path, opts = {}) {
	let response;
	try {
		response = await fetch(path, {
			method: opts.method ?? "GET",
			headers: opts.body === void 0 ? void 0 : { "content-type": "application/json" },
			body: opts.body === void 0 ? void 0 : JSON.stringify(opts.body),
		});
	} catch (e) {
		// fetch 自身失败（断网 / 请求被拦 / 超时中止）：浏览器给的是英文 TypeError
		throw new Error(describeError(e, "网络连接失败，请检查网络后重试"));
	}
	let data;
	try {
		data = await response.json();
	} catch {
		data = void 0;
	}
	if (!response.ok) {
		// 服务端正常时这里已经是中文；万一漏翻（老版本宿主、上游直接透传的
		// 英文），describeError 会换成中文并带上状态码——界面是最后一道闸。
		const fromServer =
			typeof data === "object" && data !== null && typeof data.error === "string"
				? data.error
				: "";
		const fallback = `服务返回异常（HTTP ${response.status}）`;
		throw new Error(fromServer === "" ? fallback : describeError(fromServer, fallback));
	}
	return data;
}

export function fmt(n, digits = 2) {
	return n === null || n === void 0 || !Number.isFinite(n) ? "—" : Number(n).toFixed(digits);
}
export function fmtPct(n) {
	if (n === null || n === void 0 || !Number.isFinite(n)) return "—";
	return (n > 0 ? "+" : "") + Number(n).toFixed(2) + "%";
}
export function fmtSign(n, digits = 2) {
	if (n === null || n === void 0 || !Number.isFinite(n)) return "—";
	return (n > 0 ? "+" : "") + Number(n).toFixed(digits);
}
/** Format an amount given in YUAN into 亿/万 shorthand. */
export function fmtAmount(n) {
	if (n === null || n === void 0 || !Number.isFinite(n)) return "—";
	const abs = Math.abs(n);
	if (abs >= 1e8) return (n / 1e8).toFixed(2) + "亿";
	if (abs >= 1e4) return (n / 1e4).toFixed(2) + "万";
	return String(Math.round(n));
}

/** 元 → 亿字符串（资金流向展示用）。 */
export const fmtYi = (v) => {
	if (v === null || v === void 0 || !Number.isFinite(v)) return "—";
	const yi = v / 1e8;
	const sign = yi > 0 ? "+" : "";
	return sign + yi.toFixed(yi >= 100 ? 0 : yi >= 10 ? 1 : 2) + "亿";
};
export function trend(n) {
	return n > 0 ? "lkb-up" : n < 0 ? "lkb-down" : "";
}
export function cnMarket(market) {
	if (market === "SH") return "沪";
	if (market === "SZ") return "深";
	if (market === "BJ") return "北";
	return market ?? "";
}
/** Client-side mirror of the server's normalizeCode (dedupe popup windows by one canonical code). */
export function normCode(raw) {
	let c = String(raw ?? "").trim().toLowerCase();
	if (/^(sh|sz|bj)\d{5,6}$/.test(c)) return c;
	const d = c.replace(/\D/g, "");
	if (!/^\d{5,6}$/.test(d)) return c;
	if (d.startsWith("11")) return "sh" + d;
	// 92xxxx → 北交所（须在 9 规则前判断，避免被并入沪市）
	if (/^92/.test(d)) return "bj" + d;
	if (/^[569]/.test(d)) return "sh" + d;
	if (/^[48]/.test(d)) return "bj" + d;
	return "sz" + d;
}
/**
 * Watchlist membership probe. The watchlist stores normalized codes
 * ("sh603626") while UI rows often carry bare codes ("603626") — compare
 * through normCode on both sides or stars never light up.
 */
export function isWatched(watchSet, code) {
	return watchSet.has(normCode(code));
}
/**
 * In-panel confirm dialog service. `window.confirm` is a synchronous
 * native modal that steals window focus and (in this embedded webview)
 * can leave the renderer's mouse state stuck after dismissal — the
 * search input becomes unclickable until the window is minimized and
 * restored. `lkbConfirm` keeps the Promise<boolean> contract but
 * resolves through ConfirmDialog rendered by the panel: zero native
 * dialogs, no focus theft. A second confirm while one is open
 * auto-cancels (no dialog stacking).
 */
let confirmState = null;
export const confirmListeners = new Set();
export function lkbConfirm(text) {
	if (confirmState !== null) return Promise.resolve(false);
	return new Promise((resolve) => {
		confirmState = { text, resolve };
		confirmListeners.forEach((fn) => fn(confirmState));
	});
}
export function closeConfirm(ok) {
	if (confirmState === null) return;
	const current = confirmState;
	confirmState = null;
	confirmListeners.forEach((fn) => fn(null));
	current.resolve(ok);
}
export function ConfirmDialog({ text }) {
	// Capture-phase Escape: dismiss the dialog before the panel's own
	// Escape chain (popup → panel) can react; Enter confirms.
	useEffect(() => {
		const onKey = (e) => {
			if (e.key === "Escape") {
				e.stopPropagation();
				e.preventDefault();
				closeConfirm(false);
			} else if (e.key === "Enter") {
				e.stopPropagation();
				e.preventDefault();
				closeConfirm(true);
			}
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, []);
	return h(
		"div",
		{
			className: "lkb_confirmMask",
			onMouseDown: (e) => e.stopPropagation(),
			onClick: (e) => {
				if (e.target !== e.currentTarget) return;
				closeConfirm(false);
			},
		},
		h(
			"div",
			{ className: "lkb_confirmBox" },
			h("div", { className: "lkb_confirmText" }, text),
			h(
				"div",
				{ className: "lkb_confirmBtns" },
				h("button", { className: "lkb-btnGhost", onClick: () => closeConfirm(false) }, "取消"),
				h("button", { className: "lkb-btn", onClick: () => closeConfirm(true) }, "确定")
			)
		)
	);
}
/**
 * Row-level click guard: let interactive children (select / button /
 * input / anchor) handle their own clicks instead of bubbling into the
 * row's open-detail handler.
 */
export function openOnRow(e, onOpen, code, name) {
	if (e?.target?.closest?.("select,button,input,a")) return;
	onOpen(code, name);
}
/** Format a volume given in 手 (lots) into 万手/亿手 shorthand. */
export function fmtVol(lots) {
	if (lots === null || lots === void 0 || !Number.isFinite(lots)) return "—";
	const abs = Math.abs(lots);
	if (abs >= 1e8) return (lots / 1e8).toFixed(2) + "亿手";
	if (abs >= 1e4) return Number((lots / 1e4).toFixed(2)) + "万手";
	return String(Math.round(lots)) + "手";
}
/** "20250106143005" -> "01-06 14:30:05"; passes through anything else. */
export function fmtTime(s) {
	const t = String(s ?? "");
	return /^\d{14}$/.test(t) ? `${t.slice(4, 6)}-${t.slice(6, 8)} ${t.slice(8, 10)}:${t.slice(10, 12)}:${t.slice(12, 14)}` : t;
}
export function useInterval(fn, ms, deps = []) {
	const ref = useRef(fn);
	ref.current = fn;
	useEffect(() => {
		if (ms === null) return;
		const timer = setInterval(() => {
			try {
				ref.current();
			} catch {}
		}, ms);
		return () => clearInterval(timer);
	}, [ms, ...deps]);
}
/**
 * 行情数据专用轮询:只在 A 股连续交易时段(周一~周五 9:30–11:30 / 13:00–15:00)
 * 按周期触发;其余时间上游行情不再变化,挂载时的首次拉取即为终值,不再重复请求。
 * 定时器保持空转但不发请求,以便跨开盘边界使用时(如 09:15 打开面板)在 09:30 自动进入轮询。
 */
export function useTradingInterval(fn, ms, deps = []) {
	const ref = useRef(fn);
	ref.current = fn;
	useEffect(() => {
		if (ms === null) return;
		const timer = setInterval(() => {
			if (!marketOpenLabel().open) return;
			try {
				ref.current();
			} catch {}
		}, ms);
		return () => clearInterval(timer);
	}, [ms, ...deps]);
}
export function marketOpenLabel() {
	const now = new Date();
	const day = now.getDay();
	const minutes = now.getHours() * 60 + now.getMinutes();
	const trading =
		day >= 1 &&
		day <= 5 &&
		((minutes >= 9 * 60 + 30 && minutes <= 11 * 60 + 30) || (minutes >= 13 * 60 && minutes <= 15 * 60));
	return { open: trading, label: trading ? "交易中" : day >= 1 && day <= 5 ? "已收盘" : "休市" };
}
export function nowTime() {
	const d = new Date();
	const p = (x) => String(x).padStart(2, "0");
	return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
