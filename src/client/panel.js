// 韭菜盒子 LeekBox — 客户端 bundle 源码：主面板（标签页 + 弹窗管理 + 拖拽 + 预警 toast）
// 由 build.mjs 打包进 lib/client.js（npm run build）；不要手改产物。
import { createRoot, h, useCallback, useEffect, useRef, useState } from "./react.js";
import { API, api, closeConfirm, ConfirmDialog, confirmListeners, marketOpenLabel, normCode, onToast, ToastStack } from "./core.js";
import { IndicesTab } from "./indices-tab.js";
import { MarketTab } from "./market-tab.js";
import { WatchlistTab } from "./watchlist-tab.js";
import { ScreenerTab } from "./screener-tab.js";
import { NewsTab } from "./news-tab.js";
import { StockDetailWindow } from "./detail.js";

const TABS = [
	{ key: "indices", label: "大盘" },
	{ key: "market", label: "行情" },
	{ key: "watchlist", label: "自选" },
	{ key: "screener", label: "选股" },
	{ key: "news", label: "快讯" },
];

/** 标签图标：手写 24×24 描边路径（Lucide 风格）。
 *
 * 不用 emoji：字体缺字时会出现豆腐块、各平台画风也不一致，而且 emoji 无法跟随
 * currentColor 变主题色。统一描边 1.8、颜色继承文字，选中态由 CSS 换成主色。
 */
const TAB_ICONS = {
	// 大盘：柱状图（指数概览）
	indices: [
		["path", { d: "M3 3v16.5A1.5 1.5 0 0 0 4.5 21H21" }],
		["path", { d: "M17.5 18V10" }],
		["path", { d: "M12.5 18V6" }],
		["path", { d: "M7.5 18v-5" }],
	],
	// 行情：K 线（报价板）
	market: [
		["path", { d: "M8 3v2.5" }],
		["rect", { x: 5.75, y: 5.5, width: 4.5, height: 8, rx: 1 }],
		["path", { d: "M8 13.5V17" }],
		["path", { d: "M16 6v2" }],
		["rect", { x: 13.75, y: 8, width: 4.5, height: 9, rx: 1 }],
		["path", { d: "M16 17v3" }],
	],
	// 自选：五角星
	star: [["path", { d: "M12 3.6l2.6 5.27 5.82.85-4.21 4.1.99 5.78L12 16.87l-5.2 2.73.99-5.78-4.21-4.1 5.82-.85z" }]],
	// 选股：漏斗筛选
	screener: [
		["path", { d: "M3.5 5.5h17" }],
		["path", { d: "M6.5 12h11" }],
		["path", { d: "M10 18.5h4" }],
	],
	// 快讯：报纸
	news: [
		["path", { d: "M4 5.5A1.5 1.5 0 0 1 5.5 4h9A1.5 1.5 0 0 1 16 5.5V19H5.5A1.5 1.5 0 0 1 4 17.5z" }],
		["path", { d: "M16 9h2.5A1.5 1.5 0 0 1 20 10.5v6a2.5 2.5 0 0 1-2.5 2.5" }],
		["path", { d: "M7 8.5h6" }],
		["path", { d: "M7 12.5h6" }],
	],
};

/** 把 TAB_ICONS 的路径描述渲染成 <svg>。 */
function tabIcon(key) {
	const paths = TAB_ICONS[key] ?? [];
	return h(
		"svg",
		{
			viewBox: "0 0 24 24",
			fill: "none",
			stroke: "currentColor",
			strokeWidth: 1.8,
			strokeLinecap: "round",
			strokeLinejoin: "round",
			focusable: "false",
		},
		paths.map(([tag, attrs], i) => h(tag, { key: i, ...attrs }))
	);
}

/** 关"当前置顶"的那扇窗 —— 不是"最后打开"的那扇。
 *
 * wins 数组是插入顺序，而每扇窗的 z 由 focusWin/openStock 递增分配；用户点过
 * 别的窗口后，数组末位就不再是视觉上在最前面的那个。以前用 slice(0,-1) 关的
 * 是数组末位，于是 ESC/点遮罩会关掉一扇被压在下面的窗，而"看起来在最上面"
 * 的那扇纹丝不动。
 *
 * 放在模块作用域：它是纯函数，且要作为 useEffect 依赖 —— 每次渲染新建一个
 * 函数会让 ESC 的监听器每渲染重挂一次。导出以便逐场景对照测试。
 */
export function topWindow(list) {
	let top = null;
	for (const w of list) if (top === null || (w.z ?? 0) >= (top.z ?? 0)) top = w;
	return top;
}

export function LeekBoxPanel({ onClose }) {
	const [tab, setTab] = useState("indices");
	const [wins, setWins] = useState([]);
	const [watchCodes, setWatchCodes] = useState([]);
	const [watchBump, setWatchBump] = useState(0);
	const [pos, setPos] = useState(null);
	const cardRef = useRef(null);
	const winsRef = useRef([]);
	winsRef.current = wins;
	// 详情弹窗的 z 必须高于主面板卡片(.lkb_card 的 z-index:10000)，否则 K线详情窗
	// 会落在面板之下被挡住。这里从 10000 起算，openStock/focusWin 内会先 +1，所以
	// 详情窗首帧即为 10001，永远浮在卡片之上；同时仍低于确认遮罩(2147483646)与
	// toast(2147483647)，不破坏它们的置顶层级。
	const zSeq = useRef(10000);
	const onHeadPointerDown = (e) => {
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
	const resetPos = () => setPos(null);
	// z 上限：必须低于确认遮罩(2147483646)与 toast(2147483647)的置顶层，给它们
	// 各留一档余量，避免长期开大量窗口后 z 溢出到这两层之上。
	const Z_MAX = 2147483644;
	const bumpZ = () => {
		if (zSeq.current < Z_MAX) zSeq.current += 1;
		return zSeq.current;
	};
	const openStock = useCallback((rawCode, rawName) => {
		const code = normCode(rawCode ?? "");
		if (!/^(sh|sz|bj)\d{6}$/.test(code)) return;
		const name = rawName ?? rawCode;
		// Index codes (上证/深证系列、北证指数) open a quote window too — but
		// they are not tradable: no 加自选 and no 涨停/跌停 display.
		const isIndex = /^(sh000|sz399|sh899|bj899)/.test(code);
		setWins((prev) => {
			const exist = prev.find((w) => w.code === code);
			const z = bumpZ();
			if (exist) return prev.map((w) => (w.id === exist.id ? { ...w, z: zSeq.current } : w));
			const k = prev.length % 6;
			const wx = Math.max(8, Math.round((window.innerWidth - 760) / 2)) + k * 28;
			const wy = Math.max(8, Math.round((window.innerHeight - 620) / 2)) + k * 26;
			return [
				...prev,
				{
					id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
					code,
					name,
					isIndex,
					x: wx,
					y: wy,
					z: z,
				},
			];
		});
	}, []);
	const focusWin = (id) =>
		setWins((prev) => {
			const zz = bumpZ();
			return prev.map((w) => (w.id === id ? { ...w, z: zz } : w));
		});
	const closeWin = (id) => setWins((prev) => prev.filter((w) => w.id !== id));
	const closeTopWin = () => setWins((prev) => {
		const top = topWindow(prev);
		return top === null ? prev : prev.filter((w) => w.id !== top.id);
	});
	const bumpWatch = () => setWatchBump((v) => v + 1);
	// In-panel confirm dialog host (replaces native window.confirm).
	const [confirmReq, setConfirmReq] = useState(null);
	// 预警 toast：AlertWatcher 常驻在 entry.js（随插件而不是随面板存活），
	// 触发时经 core 的 pushToast 广播过来，面板只负责渲染。
	const [toasts, setToasts] = useState([]);
	const dismissToast = useCallback((id) => {
		setToasts((prev) => prev.filter((t) => t.id !== id));
	}, []);
	useEffect(() => {
		return onToast((toast) => {
			setToasts((prev) => [...prev.slice(-3), toast]);
			setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== toast.id)), 10000);
		});
	}, []);
	useEffect(() => {
		const fn = (req) => setConfirmReq(req);
		confirmListeners.add(fn);
		return () => confirmListeners.delete(fn);
	}, []);
	useEffect(() => {
		return () => {
			// Unmounting with a pending confirm would otherwise leave the
			// promise forever unresolved: the panel is gone, so nothing can
			// call closeConfirm, confirmState stays set and every later
			// lkbConfirm silently resolves false — stars stop working until
			// the page reloads.
			closeConfirm(false);
		};
	}, []);
	// ESC 关当前置顶的那扇详情窗（按 z 最大，不是数组末位），都关完了才关面板。
	useEffect(() => {
		const onKey = (e) => {
			if (e.key !== "Escape") return;
			const t = e.target;
			if (t !== null && t !== void 0 && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
			if (winsRef.current.length > 0) {
				const top = topWindow(winsRef.current);
				if (top === null) return;
				setWins((prev) => prev.filter((w) => w.id !== top.id));
			} else onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);
	useEffect(() => {
		let alive = true;
		const refresh = () =>
			api(API.watchlist)
				.then((d) => {
					if (alive) setWatchCodes((d.watchlist ?? []).map((e) => normCode(e.code)));
				})
				.catch(() => {});
		refresh();
		const timer = setInterval(refresh, 20000);
		// StarButton broadcasts this so ★ state updates without waiting for
		// the next 20s poll.
		window.addEventListener("leekbox:watchlist-changed", refresh);
		return () => {
			alive = false;
			clearInterval(timer);
			window.removeEventListener("leekbox:watchlist-changed", refresh);
		};
	}, []);
	// 标签栏的键盘导航：←/→ 循环、Home/End 跳首尾。roving tabindex —— 只有选中项
	// tabIndex=0，所以 Tab 键进得来、出去得走，不会在 5 个标签里转圈。
	const onTabKeyDown = (e) => {
		const { key } = e;
		if (key !== "ArrowLeft" && key !== "ArrowRight" && key !== "Home" && key !== "End") return;
		e.preventDefault();
		const from = TABS.findIndex((t) => t.key === tab);
		const to =
			key === "Home"
				? 0
				: key === "End"
					? TABS.length - 1
					: key === "ArrowLeft"
						? (from - 1 + TABS.length) % TABS.length
						: (from + 1) % TABS.length;
		setTab(TABS[to].key);
		const nodes = e.currentTarget.querySelectorAll("button.lkb_tab");
		if (nodes[to] !== void 0) nodes[to].focus();
	};
	// 自选数量做成标签徽标：用户不用切过去就知道自选里有几只。
	const tabBadge = (key) => (key === "watchlist" && watchCodes.length > 0 ? watchCodes.length : null);
	const mkt = marketOpenLabel();
	const body =
		tab === "indices"
			? h(IndicesTab, { onOpen: openStock })
			: tab === "market"
				? h(MarketTab, { onOpen: openStock, watchCodes })
				: tab === "watchlist"
					? h(WatchlistTab, { onOpen: openStock, bump: watchBump })
					: tab === "screener"
						? h(ScreenerTab, { onOpen: openStock, watchCodes })
						: h(NewsTab, { onOpen: openStock });
	return h(
		"div",
		{
			className: "lkb_overlay",
			onClick: (e) => {
				if (e.target !== e.currentTarget) return;
				if (winsRef.current.length > 0) closeTopWin();
				else onClose();
			},
		},
		h(
			"div",
			{
				ref: cardRef,
				className: "lkb_card",
				style: pos === null ? { left: "50%", top: "50%", transform: "translate(-50%,-50%)" } : { left: pos.x, top: pos.y },
			},
			h(
				"div",
				{ className: "lkb_head", title: "拖动移动窗口 · 双击复位", onPointerDown: onHeadPointerDown, onDoubleClick: resetPos },
				h("span", { className: "lkb-headTitle" }, h("span", { className: "lkb-logo" }, "🥬"), "韭菜盒子"),
				h(
					"div",
					{ className: "lkb_headRight" },
					h("span", { className: "lkb_mktStatus", "data-open": mkt.open ? "true" : "false" }, mkt.label),
					h("button", { className: "lkb_close", title: "关闭", onClick: onClose }, "✕")
				)
			),
			h(
				"div",
				{ className: "lkb_tabBar", role: "tablist", "aria-label": "韭菜盒子面板", onKeyDown: onTabKeyDown },
				h(
					"div",
					{ className: "lkb_tabTrack" },
					TABS.map((t) => {
						const active = tab === t.key;
						const badge = tabBadge(t.key);
						return h(
							"button",
							{
								key: t.key,
								type: "button",
								className: "lkb_tab",
								id: `lkb-tab-${t.key}`,
								role: "tab",
								title: t.label,
								"aria-selected": active ? "true" : "false",
								"aria-controls": "lkb-tabpanel",
								tabIndex: active ? 0 : -1,
								"data-active": active ? "true" : "false",
								onClick: () => setTab(t.key),
							},
							h("span", { className: "lkb_tabIcon", "aria-hidden": "true" }, tabIcon(t.key)),
							h("span", { className: "lkb_tabLabel" }, t.label),
							badge === null ? null : h("span", { className: "lkb_tabBadge" }, String(badge))
						);
					})
				)
			),
			h(
			"div",
			{ className: "lkb_body", id: "lkb-tabpanel", role: "tabpanel", "aria-labelledby": `lkb-tab-${tab}` },
			h("div", { key: tab, className: "lkb_tabPanelIn" }, body)
		),
			h(
				"div",
				{ className: "lkb_foot" },
				h("span", null, "数据来源：腾讯财经 / 新浪财经 / 东方财富 / 金十数据"),
				h("span", null, "仅供研究参考，不构成投资建议。股市有风险，入市需谨慎。")
			)
		),
		wins.map((w) =>
			h(StockDetailWindow, {
				key: w.id,
				code: w.code,
				name: w.name,
				isIndex: w.isIndex,
				x: w.x,
				y: w.y,
				z: w.z,
				onFocus: () => focusWin(w.id),
				onClose: () => closeWin(w.id),
				onWatched: bumpWatch,
			})
		),
		confirmReq === null ? null : h(ConfirmDialog, { text: confirmReq.text }),
		h(ToastStack, { toasts, onDismiss: dismissToast })
	);
}

export function mountPanel() {
	let root;
	let container;
	const close = () => {
		if (root === void 0) return;
		root.unmount();
		root = void 0;
		container?.remove();
		container = void 0;
	};
	const open = () => {
		if (root !== void 0) return;
		container = document.createElement("div");
		container.dataset.dshLeekboxView = "";
		container.dataset.dshPlugin = "leekbox";
		document.body.appendChild(container);
		root = createRoot(container);
		root.render(h(LeekBoxPanel, { onClose: close }));
	};
	const toggle = () => {
		if (root !== void 0) close();
		else open();
	};
	return { toggle, open, close, dispose: close };
}
