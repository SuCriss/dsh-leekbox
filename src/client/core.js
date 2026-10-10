// 韭菜盒子 LeekBox — 客户端 bundle 源码：API 通道 + 格式化 + 通用 hooks
// 由 build.mjs 打包进 lib/client.js（npm run build）；不要手改产物。
import { h, useCallback, useEffect, useRef } from "./react.js";

export const API = {
	indices: "/api/leekbox/indices",
	quote: "/api/leekbox/quote",
	kline: "/api/leekbox/kline",
	search: "/api/leekbox/search",
	calendar: "/api/leekbox/calendar",
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
		// 后台标签页 / 最小化窗口不再空转：拉取型页签回到前台会自动补一次。
		const run = () => {
			if (hidden()) return;
			try {
				ref.current();
			} catch {}
		};
		const timer = setInterval(run, ms);
		document.addEventListener("visibilitychange", run);
		return () => {
			clearInterval(timer);
			document.removeEventListener("visibilitychange", run);
		};
	}, [ms, ...deps]);
}

//#region 交易时段（服务端交易日历 + 本地时钟）

/**
 * 服务端 `/api/leekbox/calendar` 下发的日级信息。
 *
 * 交易日只能从上游真实日 K 推导（节假日没有 K 线），本地算不出来，所以这里
 * 存服务端给的 `tradingDays`；拿不到时 `tradingDay: null` 表示"未知"，此时
 * 退回"周一~周五"的启发式，绝不假装知道。
 */
let tradingCalendar = { tradingDays: null, lastTradingDay: "", nextTradingDay: "", ready: false };
let lastCalendarAt = 0;
const sessionListeners = new Set();
/** 拿到真日历后的刷新间隔；没拿到则按 20s 节流重试（服务端首次构建是后台跑的）。 */
const CALENDAR_TTL_MS = 30 * 60 * 1000;
const CALENDAR_RETRY_MS = 20 * 1000;

/** 本地时钟的东八区墙上时间（用户在 UTC 机器上时，"现在几点"仍按北京时间算）。 */
function cnParts(now = new Date()) {
	const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000);
	return {
		weekday: shifted.getUTCDay(),
		minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
	};
}
function cnToday(now = new Date()) {
	const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000);
	const p = (n) => String(n).padStart(2, "0");
	return `${shifted.getUTCFullYear()}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())}`;
}
const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

/** 当前交易时段。标签与 core.js 的服务端 calendar.js 保持同一套口径。 */
export function marketSession(now = new Date()) {
	const { weekday, minutes } = cnParts(now);
	const calendarSaysTrading = tradingCalendar.tradingDays === null ? null : tradingCalendar.tradingDays.includes(cnToday(now));
	return classifySession(weekday, minutes, calendarSaysTrading);
}

/**
 * 时段判定的**纯函数**部分（不读模块状态），与服务端 `lib/calendar.js` 的
 * `sessionState()` 是同一套口径。抽出来是为了能被逐点对照测试——客户端与服务端
 * 分处两个 bundle，口径漂移了没人会发现（这正是 P0#2 那类 bug 的成因）。
 *
 * @param {number} weekday 0=周日
 * @param {number} minutes 东八区墙上时间的当天分钟数
 * @param {boolean|null} tradingDay null = 未知（无日历 → 退回"周一~周五"）
 */
export function classifySession(weekday, minutes, tradingDay = null) {
	const isTradingDay = tradingDay === null ? weekday >= 1 && weekday <= 5 : tradingDay;
	let session;
	if (!isTradingDay) {
		session = tradingDay === null && (weekday === 0 || weekday === 6) ? "weekend" : "holiday";
	} else if (minutes >= 9 * 60 + 15 && minutes < 9 * 60 + 25) session = "auction";
	else if (minutes < 9 * 60 + 30) session = "preOpen";
	else if (minutes < 11 * 60 + 30) session = "open";
	else if (minutes < 13 * 60) session = "lunch";
	else if (minutes < 15 * 60) session = "open";
	else session = "closed";
	const label = { preOpen: "盘前", auction: "集合竞价", open: "交易中", lunch: "午间休市", closed: "已收盘", holiday: "休市" }[session];
	return { session, label, open: isTradingDay && session === "open", tradingDay: isTradingDay, calendarReady: tradingDay !== null };
}

/** 兼容旧调用点：只关心"交易中 / 已收盘 / 休市"三态的地方继续可用。 */
export function marketOpenLabel(now = new Date()) {
	const s = marketSession(now);
	return { open: s.open, label: s.label, session: s.session, calendarReady: s.calendarReady };
}

/** 是否应该轮询：交易时段内 + 页面可见。 */
export function shouldPoll() {
	if (hidden()) return false;
	if (!marketSession().open) return false;
	return true;
}

function notifySession() {
	sessionListeners.forEach((fn) => {
		try {
			fn(false);
		} catch {}
	});
}

/** 提醒所有订阅者"面板重新可见了"，让它们立刻补一次数据。 */
function markVisible() {
	if (hidden()) return;
	sessionListeners.forEach((fn) => {
		try {
			fn(true);
		} catch {}
	});
}

/**
 * 拉一次服务端交易日历。失败保持原状态（可能是启发式），下次再试。
 *
 * 拿到真日历后 30 分钟才刷（交易日列表一天只变一次，时段判定用本地时钟）；
 * 没拿到时按 20s 节流重试，因为服务端首次构建是后台跑的，头两次可能还是兜底。
 * @param {boolean} force 忽略节流强制刷新（回到前台 / 显式刷新时用）
 */
export function refreshCalendar(force = false) {
	const now = Date.now();
	const wait = tradingCalendar.ready ? CALENDAR_TTL_MS : CALENDAR_RETRY_MS;
	if (!force && now - lastCalendarAt < wait) return Promise.resolve();
	lastCalendarAt = now;
	return api(API.calendar)
		.then((d) => {
			const days = Array.isArray(d?.tradingDays) ? d.tradingDays : null;
			tradingCalendar = {
				tradingDays: days !== null && days.length > 0 ? days : null,
				lastTradingDay: d?.lastTradingDay ?? "",
				nextTradingDay: d?.nextTradingDay ?? "",
				ready: days !== null && days.length > 0,
			};
			notifySession();
		})
		.catch(() => {});
}

/** 面板挂载时调一次：拉日历 + 订阅"回到前台补拉"。 */
export function startSessionClock() {
	if (typeof document === "undefined") return () => {};
	const onVisible = () => {
		if (!hidden()) markVisible();
	};
	document.addEventListener("visibilitychange", onVisible);
	document.addEventListener("focus", onVisible);
	refreshCalendar(true);
	// 兜底重试：真日历没拿到就每分钟再试（refreshCalendar 内部另有 20s 节流）；
	// 拿到后只在 30 分钟节流到期时才真的发请求。
	const poll = setInterval(() => refreshCalendar(false), 60 * 1000);
	return () => {
		document.removeEventListener("visibilitychange", onVisible);
		document.removeEventListener("focus", onVisible);
		clearInterval(poll);
		sessionListeners.clear();
	};
}

/**
 * 组件订阅"时段变化 / 回到前台"。
 * @param {(visible: boolean) => void} fn 回到前台时以 visible=true 调用
 */
export function useSessionClock(fn) {
	const ref = useRef(fn);
	ref.current = fn;
	useEffect(() => {
		const wrapped = (visible) => ref.current(visible === true);
		sessionListeners.add(wrapped);
		return () => sessionListeners.delete(wrapped);
	}, []);
}

/**
 * 行情数据专用轮询：只在 A 股连续交易时段（交易日 9:30–11:30 / 13:00–15:00，
 * 交易日历来自服务端真实日 K）按周期触发；其余时间上游行情不再变化，挂载时
 * 的首次拉取即为终值。定时器保持空转但不发请求，以便跨开盘边界使用时自动进入
 * 轮询；页面不可见时同样不发，回到前台立刻补一次。
 *
 * 这里有两条独立但一致的判据：**是否交易日**（服务端日历，节假日这条最关键）
 * 和**是否在盘中**（本地时钟，东八区）。旧实现只有"周一~周五"，国庆/春节期间
 * 会显示"交易中"并整天重复打上游。
 */
export function useTradingInterval(fn, ms, deps = []) {
	const ref = useRef(fn);
	ref.current = fn;
	const refresh = useCallback(() => {
		try {
			ref.current();
		} catch {}
	}, []);
	const onVisible = useCallback(
		(visible) => {
			if (visible && marketSession().open) refresh();
		},
		[refresh]
	);
	useSessionClock(onVisible);
	useEffect(() => {
		if (ms === null) return;
		const run = () => {
			if (!shouldPoll()) return;
			refresh();
		};
		const timer = setInterval(run, ms);
		document.addEventListener("visibilitychange", run);
		return () => {
			clearInterval(timer);
			document.removeEventListener("visibilitychange", run);
		};
	}, [ms, refresh, ...deps]);
}

//#endregion

export function nowTime() {
	const d = new Date();
	const p = (x) => String(x).padStart(2, "0");
	return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

//#region 常驻提示条（toast）
//
// 预警要能在**面板关闭时**弹出来，所以 toast 不能只属于面板组件。这里做一份
// 进程内的订阅式实现：谁在渲染谁订阅，没有订阅者（面板没开）就由常驻的预警
// 宿主自己渲染一份。文案与样式沿用面板里那套 `.lkb-toasts` / `.lkb-toast`。

const toastListeners = new Set();
let toastSeq = 0;
/** 触发一条提示；返回它的 id。 */
export function pushToast(message) {
	toastSeq += 1;
	const toast = { id: `t${toastSeq}`, msg: message };
	for (const fn of toastListeners) {
		try {
			fn(toast);
		} catch {}
	}
	return toast.id;
}
/** 订阅提示条；返回退订函数。 */
export function onToast(fn) {
	toastListeners.add(fn);
	return () => toastListeners.delete(fn);
}

/**
 * 把一次"用户明确点击触发的写操作"的失败摊开给用户看。
 *
 * 用法：`api(...).catch(notifyFailure("加入自选"))`。
 *
 * 背景：全仓有十几处 `.catch(() => {})`，其中不少盖的是用户**主动点击**的操作
 * （★ 加自选、改分组、删预警）。失败后界面什么都不说：图标不变、列表不变、
 * 用户以为成功了 —— 下次刷新才发现没生效，而且不知道是网络问题还是没权限。
 * 这里统一走与价格预警同一条 toast 通道，文案复用 describeError 的中文口径。
 *
 * 只用于用户可见、用户发起的操作。后台轮询、预热、可选增强信息（F10/资金流
 * 的首次拉取）失败可以继续保持安静，不要拿这个包一切。
 *
 * @param {string} what 动作名，如 "加入自选"；会拼成 "加入自选失败：..."
 * @param {(msg: string) => void} [sink] 自定义出口（默认 pushToast）
 */
export function notifyFailure(what, sink = pushToast) {
	return (error) => {
		const reason = describeError(error);
		try {
			sink(`${what}失败：${reason}`);
		} catch {}
		return void 0;
	};
}

/** 渲染提示条列表（面板与常驻宿主共用这一份 DOM 结构）。 */
export function ToastStack({ toasts, onDismiss }) {
	if (toasts.length === 0) return null;
	return h(
		"div",
		{ className: "lkb-toasts", role: "status", "aria-live": "polite" },
		toasts.map((t) =>
			h("div", { key: t.id, className: "lkb-toast", title: "点击关闭", onClick: () => onDismiss(t.id) }, t.msg)
		)
	);
}

//#endregion
