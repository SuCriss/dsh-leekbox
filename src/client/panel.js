// 韭菜盒子 LeekBox — 客户端 bundle 源码：主面板（标签页 + 弹窗管理 + 拖拽）
// 由 build.mjs 打包进 lib/client.js（npm run build）；不要手改产物。
import { createRoot, h, useCallback, useEffect, useRef, useState } from "./react.js";
import { API, api, closeConfirm, ConfirmDialog, confirmListeners, marketOpenLabel, normCode } from "./core.js";
import { IndicesTab } from "./indices-tab.js";
import { MarketTab } from "./market-tab.js";
import { AlertWatcher, WatchlistTab } from "./watchlist-tab.js";
import { ScreenerTab } from "./screener-tab.js";
import { NewsTab } from "./news-tab.js";
import { StockDetailWindow } from "./detail.js";

const TABS = [
	{ key: "indices", label: "📊 大盘" },
	{ key: "market", label: "💹 行情" },
	{ key: "watchlist", label: "⭐ 自选" },
	{ key: "screener", label: "🔍 选股" },
	{ key: "news", label: "📰 快讯" },
];

function LeekBoxPanel({ onClose }) {
	const [tab, setTab] = useState("indices");
	const [wins, setWins] = useState([]); // open stock-detail popups: {id, code, name, x, y, z}
	const winsRef = useRef([]);
	winsRef.current = wins;
	const zSeq = useRef(10100);
	const [watchBump, setWatchBump] = useState(0);
	const [watchCodes, setWatchCodes] = useState([]);
	const [pos, setPos] = useState(() => {
		try {
			const raw = localStorage.getItem("leekbox.panel.pos");
			if (raw !== null) {
				const p = JSON.parse(raw);
				if (typeof p.x === "number" && typeof p.y === "number") return p;
			}
		} catch {}
		return null;
	});
	const cardRef = useRef(null);
	const savePos = (p) => {
		try {
			localStorage.setItem("leekbox.panel.pos", JSON.stringify(p));
		} catch {}
	};
	// Center on first open when no saved position exists.
	useEffect(() => {
		if (pos === null && cardRef.current !== null) {
			const rect = cardRef.current.getBoundingClientRect();
			setPos({
				x: Math.max(8, Math.round((window.innerWidth - rect.width) / 2)),
				y: Math.max(8, Math.round((window.innerHeight - rect.height) / 2)),
			});
		}
	}, [pos]);
	// Drag the window by its header.
	const onHeadPointerDown = (e) => {
		if (e.button !== 0) return;
		if (e.target.closest("button") !== null) return; // let buttons work normally
		e.preventDefault();
		const startX = e.clientX;
		const startY = e.clientY;
		const rect = cardRef.current !== null ? cardRef.current.getBoundingClientRect() : null;
		if (rect === null) return;
		const baseLeft = rect.left;
		const baseTop = rect.top;
		const clampX = (x) => Math.max(8 - rect.width + 60, Math.min(x, window.innerWidth - 60));
		const clampY = (y) => Math.max(8, Math.min(y, window.innerHeight - 40));
		const onMove = (ev) => {
			const p = { x: clampX(baseLeft + ev.clientX - startX), y: clampY(baseTop + ev.clientY - startY) };
			setPos(p);
		};
		const onUp = () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			document.body.style.userSelect = "";
			if (cardRef.current !== null) {
				const r = cardRef.current.getBoundingClientRect();
				savePos({ x: r.left, y: r.top });
			}
		};
		document.body.style.userSelect = "none";
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
	};
	const resetPos = () => {
		const rect = cardRef.current !== null ? cardRef.current.getBoundingClientRect() : null;
		if (rect === null) return;
		const p = {
			x: Math.max(8, Math.round((window.innerWidth - rect.width) / 2)),
			y: Math.max(8, Math.round((window.innerHeight - rect.height) / 2)),
		};
		setPos(p);
		savePos(p);
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
			zSeq.current += 1;
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
					z: zSeq.current,
				},
			];
		});
	}, []);
	const focusWin = (id) =>
		setWins((prev) => {
			zSeq.current += 1;
			const zz = zSeq.current;
			return prev.map((w) => (w.id === id ? { ...w, z: zz } : w));
		});
	const closeWin = (id) => setWins((prev) => prev.filter((w) => w.id !== id));
	const closeTopWin = () => setWins((prev) => prev.slice(0, -1));
	const bumpWatch = () => setWatchBump((v) => v + 1);
	// In-panel confirm dialog host (replaces native window.confirm).
	const [confirmReq, setConfirmReq] = useState(null);
	// 预警 toast:AlertWatcher 触发时经 pushToast 弹出,10s 自动消失,可点击关闭。
	const [toasts, setToasts] = useState([]);
	const pushToast = useCallback((msg) => {
		const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
		setToasts((prev) => [...prev.slice(-3), { id, msg }]);
		setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 10000);
	}, []);
	useEffect(() => {
		const listener = (req) => setConfirmReq(req);
		confirmListeners.add(listener);
		return () => {
			confirmListeners.delete(listener);
			// The panel is unmounting (✕ / overlay click with the dialog
			// open): resolve the pending confirm, otherwise the module-level
			// confirmState stays set and every later lkbConfirm silently
			// resolves false — stars stop working until the page reloads.
			closeConfirm(false);
		};
	}, []);
	// ESC closes the top-most detail popup first, then the panel itself.
	useEffect(() => {
		const onKey = (e) => {
			if (e.key !== "Escape") return;
			const t = e.target;
			if (t !== null && t !== void 0 && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
			if (winsRef.current.length > 0) setWins((prev) => prev.slice(0, -1));
			else onClose();
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
				{ className: "lkb_tabs" },
				TABS.map((t) => h("button", { key: t.key, className: "lkb_tab", "data-active": tab === t.key ? "true" : "false", onClick: () => setTab(t.key) }, t.label))
			),
			h("div", { className: "lkb_body" }, body),
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
				isIndex: w.isIndex === true,
				x: w.x,
				y: w.y,
				z: w.z,
				onFocus: () => focusWin(w.id),
				onClose: () => closeWin(w.id),
				onWatched: bumpWatch,
			})
		),
		confirmReq === null ? null : h(ConfirmDialog, { text: confirmReq.text }),
		h(AlertWatcher, { onToast: pushToast }),
		toasts.length > 0
			? h(
				"div",
				{ className: "lkb-toasts" },
				toasts.map((t) =>
					h("div", { key: t.id, className: "lkb-toast", title: "点击关闭", onClick: () => setToasts((prev) => prev.filter((x) => x.id !== t.id)) }, t.msg)
				)
			)
			: null
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
