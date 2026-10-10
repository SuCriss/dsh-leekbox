// 韭菜盒子 LeekBox — 客户端 bundle 源码：自选页（持仓 + 预警 + 导入导出）
// 由 build.mjs 打包进 lib/client.js（npm run build）；不要手改产物。
import { createRoot, h, useCallback, useEffect, useRef, useState } from "./react.js";
import { API, api, describeError, fmt, fmtAmount, fmtPct, fmtSign, lkbConfirm, notifyFailure, onToast, openOnRow, pushToast, ToastStack, trend, useTradingInterval } from "./core.js";
import { StarButton } from "./star.js";

/** Trigger a browser download for an in-memory blob. */
function downloadBlob(name, blob) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = name;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** 自选股持仓单元格:点击进入内联编辑,Enter/失焦保存,Esc 取消。
 *  保存走 POST /watchlist/add 的更新路径(服务端校验 qty/cost);
 *  清空输入 = 清除该字段(qty: null / cost: null)。 */
function PositionCell({ value, placeholder, onSave }) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState("");
	const start = (e) => {
		e.stopPropagation();
		setDraft(value === null || value === void 0 ? "" : String(value));
		setEditing(true);
	};
	const commit = () => {
		const raw = draft.trim();
		if (raw === "") {
			setEditing(false);
			onSave(null);
			return;
		}
		const num = Number(raw);
		if (!Number.isFinite(num)) {
			setEditing(false);
			return;
		}
		setEditing(false);
		onSave(num);
	};
	if (!editing) {
		const empty = value === null || value === void 0 || value === "";
		return h(
			"span",
			{ className: "lkb-posCell" + (empty ? " lkb-posEmpty" : ""), title: "点击设置", onClick: start },
			empty ? placeholder : String(value)
		);
	}
	return h("input", {
		className: "lkb-input",
		style: { width: 78, padding: "3px 6px", fontSize: 11 },
		value: draft,
		autoFocus: true,
		placeholder,
		onClick: (e) => e.stopPropagation(),
		onChange: (e) => setDraft(e.target.value),
		onKeyDown: (e) => {
			e.stopPropagation();
			if (e.key === "Enter") commit();
			else if (e.key === "Escape") setEditing(false);
		},
		onBlur: commit,
	});
}

/** 服务端 ALERT_KINDS 的客户端镜像(见 lib/index.js)。 */
const ALERT_KIND_LABELS = { above: "价格涨到", below: "价格跌破", pctUp: "涨幅达到", pctDown: "跌幅达到" };

function alertLabel(a) {
	if (a.kind === "above") return `价格涨到 ${fmt(a.price)}`;
	if (a.kind === "below") return `价格跌破 ${fmt(a.price)}`;
	if (a.kind === "pctUp") return `涨幅达到 ${fmt(a.pct)}%`;
	return `跌幅达到 ${fmt(a.pct)}%`;
}

/** Desktop notification; permission is requested lazily when the user adds
 *  the first alert (must happen inside a user gesture to not be blocked). */
function notifyDesktop(title, body) {
	try {
		if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
		new Notification(title, { body, tag: "leekbox-alert" });
	} catch {}
}

function requestNotifyPermission() {
	try {
		if (typeof Notification !== "undefined" && Notification.permission === "default") {
			Promise.resolve(Notification.requestPermission()).catch(() => {});
		}
	} catch {}
}

/** Short double-beep via WebAudio — no audio asset needed. */
function beep() {
	try {
		const Ctx = window.AudioContext ?? window.webkitAudioContext;
		if (Ctx === void 0) return;
		const ctx = new Ctx();
		const play = (at) => {
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.type = "sine";
			osc.frequency.value = 880;
			gain.gain.setValueAtTime(0.001, at);
			gain.gain.exponentialRampToValueAtTime(0.18, at + 0.02);
			gain.gain.exponentialRampToValueAtTime(0.001, at + 0.18);
			osc.connect(gain);
			gain.connect(ctx.destination);
			osc.start(at);
			osc.stop(at + 0.2);
		};
		const t0 = ctx.currentTime;
		play(t0);
		play(t0 + 0.25);
		setTimeout(() => ctx.close().catch(() => {}), 900);
	} catch {}
}

/** 内联预警表单:类型 + 数值,提交到 POST /alerts/add;成功后广播
 *  alerts-changed 让预警卡片与看护器立即刷新。错误在表单内显示。 */
function AlertForm({ code, name, onDone }) {
	const [kind, setKind] = useState("above");
	const [val, setVal] = useState("");
	const [err, setErr] = useState("");
	const isPrice = kind === "above" || kind === "below";
	const submit = () => {
		const num = Number(val.trim());
		if (val.trim() === "" || !Number.isFinite(num) || num <= 0) {
			setErr(isPrice ? "请输入大于 0 的目标价" : "请输入大于 0 的涨跌幅（%）");
			return;
		}
		const body = { code, name, kind };
		if (isPrice) body.price = num;
		else body.pct = num;
		api(API.alerts + "/add", { method: "POST", body })
			.then(() => {
				window.dispatchEvent(new Event("leekbox:alerts-changed"));
				onDone();
			})
			.catch((e) => setErr(describeError(e)));
	};
	return h(
		"div",
		{ className: "lkb-alertForm" },
		h("span", { className: "lkb-name" }, name ?? code),
		h("span", { className: "lkb-code" }, code),
		h(
			"select",
			{
				className: "lkb-input",
				style: { width: 96, padding: "3px 6px", fontSize: 11 },
				value: kind,
				onClick: (e) => e.stopPropagation(),
				onChange: (e) => {
					setKind(e.target.value);
					setErr("");
				},
			},
			Object.entries(ALERT_KIND_LABELS).map(([k, label]) => h("option", { key: k, value: k }, label))
		),
		h("input", {
			className: "lkb-input",
			style: { width: 90, padding: "3px 6px", fontSize: 11 },
			value: val,
			autoFocus: true,
			placeholder: isPrice ? "目标价" : "涨跌幅%",
			onClick: (e) => e.stopPropagation(),
			onChange: (e) => {
				setVal(e.target.value);
				setErr("");
			},
			onKeyDown: (e) => {
				e.stopPropagation();
				if (e.key === "Enter") submit();
			},
		}),
		h("button", { className: "lkb-btnGhost", onClick: submit }, "确定"),
		h("button", { className: "lkb-btnGhost", onClick: onDone }, "取消"),
		err === "" ? null : h("span", { className: "lkb-status" }, err)
	);
}

/** 预警看护:与行情同一时钟轮询(仅交易时段),触发后 toast + 系统通知 +
 *  蜂鸣,并把该条预警从服务端移除(一次性)。判定在客户端做——服务端只
 *  负责存取,不常驻计时器、不引入推送通道。
 *
 *  它**必须随插件常驻**（由 entry.js 的 mountAlertWatcher 挂载），不能挂在
 *  面板里：面板关闭走 root.unmount()，挂在里面的看护会一起卸载，于是"交易
 *  时段自动盯盘"在面板关掉后静默失效（README 承诺过这个行为）。 */
export function AlertWatcher({ push }) {
	const alertsRef = useRef([]);
	const notify = push ?? pushToast;
	const load = useCallback(() => {
		api(API.alerts)
			.then((d) => {
				alertsRef.current = d.alerts ?? [];
			})
			.catch(() => {});
	}, []);
	useEffect(() => {
		load();
		window.addEventListener("leekbox:alerts-changed", load);
		return () => window.removeEventListener("leekbox:alerts-changed", load);
	}, [load]);
	useTradingInterval(
		() => {
			const list = alertsRef.current;
			if (list.length === 0) return;
			const codes = Array.from(new Set(list.map((a) => a.code)));
			const chunks = [];
			for (let i = 0; i < codes.length; i += 50) chunks.push(codes.slice(i, i + 50).join(","));
			Promise.all(chunks.map((c) => api(API.quote + `?codes=${c}`)))
				.then((parts) => {
					const byCode = new Map(parts.flatMap((p) => p.quotes ?? []).map((q) => [q.code, q]));
					const fired = [];
					for (const a of list) {
						const qt = byCode.get(a.code);
						if (qt === void 0) continue;
						const px = qt.price;
						const pct = qt.changePct;
						const hit =
							a.kind === "above"
								? px !== null && px !== void 0 && px >= a.price
								: a.kind === "below"
									? px !== null && px !== void 0 && px <= a.price
									: a.kind === "pctUp"
										? pct !== null && pct !== void 0 && pct >= a.pct
										: pct !== null && pct !== void 0 && pct <= -a.pct;
						if (hit) fired.push({ alert: a, quote: qt });
					}
					if (fired.length === 0) return;
					for (const { alert, quote } of fired) {
						// 一次性预警：取消失败就下轮再试（不提示——用户并没有
						// 主动删它，重复弹一条"删除失败"只会干扰；预警本身已经
						// 通知过了）。
						api(API.alerts + "/remove", { method: "POST", body: { id: alert.id } }).catch(() => {});
						notify(`🔔 ${alertLabel(alert)} —— ${alert.name}(${alert.code}) 现价 ${fmt(quote.price)} / ${fmtPct(quote.changePct)}`);
						notifyDesktop(`价格预警：${alert.name}`, `${alertLabel(alert)} · 现价 ${fmt(quote.price)}`);
					}
					beep();
					alertsRef.current = alertsRef.current.filter((a) => !fired.some((f) => f.alert.id === a.id));
					window.dispatchEvent(new Event("leekbox:alerts-changed"));
				})
				.catch(() => {});
		},
		15000,
		[]
	);
	return null;
}

/**
 * 把预警看护挂成随插件常驻的宿主：自己开一个 detached 容器（不依赖面板的
 * 挂载点，面板关闭也不影响它），并自带一份 toast 栈——面板没开时就由这里
 * 把预警弹出来，面板开着时两边都渲染（同一个 toast 流，两份 DOM 不重叠）。
 *
 * 返回 `{ dispose }`，由 entry.js 在插件卸载时调用。
 */
export function mountAlertWatcher() {
	let root;
	let container;
	let unsubscribe = null;
	let toasts = [];
	const render = () => root?.render(h(ToastStack, { toasts, onDismiss: (id) => { toasts = toasts.filter((t) => t.id !== id); render(); } }));
	container = document.createElement("div");
	container.dataset.dshLeekboxAlerts = "";
	container.dataset.dshPlugin = "leekbox";
	document.body.appendChild(container);
	root = createRoot(container);
	// 宿主自己那份 toast 渲染（与面板共用 core 的订阅式提示流）。
	unsubscribe = onToast((toast) => {
		toasts = [...toasts.slice(-3), toast];
		render();
		setTimeout(() => {
			toasts = toasts.filter((t) => t.id !== toast.id);
			render();
		}, 10000);
	});
	root.render(h(AlertWatcher, { push: pushToast }));
	return {
		dispose() {
			unsubscribe?.();
			unsubscribe = null;
			root?.unmount();
			root = void 0;
			container?.remove();
			container = void 0;
		},
	};
}

export function WatchlistTab({ onOpen, bump }) {
	const [items, setItems] = useState([]);
	const [quotes, setQuotes] = useState([]);
	const [group, setGroup] = useState("全部");
	const [error, setError] = useState("");
	const [ioMsg, setIoMsg] = useState("");
	const [alerts, setAlerts] = useState([]);
	const [alertForm, setAlertForm] = useState(null);
	const fileRef = useRef(null);
	const importMode = useRef("merge");
	const load = useCallback(() => {
		api(API.watchlist)
			.then(async (data) => {
				const list = data.watchlist ?? [];
				setItems(list);
				if (list.length === 0) return;
				// /quote caps each request at 50 codes server-side (upstream guard);
				// the watchlist has no limit, so chunk the codes and merge the quotes.
				const codes = list.map((e) => e.code);
				const chunks = [];
				for (let i = 0; i < codes.length; i += 50) chunks.push(codes.slice(i, i + 50).join(","));
				const parts = await Promise.all(chunks.map((c) => api(API.quote + `?codes=${c}`)));
				setQuotes(parts.flatMap((q) => q.quotes ?? []));
				setError("");
			})
			.catch((e) => setError(describeError(e)));
	}, []);
	useEffect(() => {
		load();
	}, [load, bump]);
	useTradingInterval(load, 15000);
	// Auto-clear the import/export status line.
	useEffect(() => {
		if (ioMsg === "") return;
		const timer = setTimeout(() => setIoMsg(""), 8000);
		return () => clearTimeout(timer);
	}, [ioMsg]);
	// 预警列表:挂载拉一次,AlertWatcher 触发/本地增删后经 alerts-changed 刷新。
	const loadAlerts = useCallback(() => {
		api(API.alerts)
			.then((d) => setAlerts(d.alerts ?? []))
			.catch(() => {});
	}, []);
	useEffect(() => {
		loadAlerts();
		window.addEventListener("leekbox:alerts-changed", loadAlerts);
		return () => window.removeEventListener("leekbox:alerts-changed", loadAlerts);
	}, [loadAlerts]);
	const removeAlert = (id) => {
		api(API.alerts + "/remove", { method: "POST", body: { id } })
			.then(() => window.dispatchEvent(new Event("leekbox:alerts-changed")))
			.catch(notifyFailure("删除预警"));
	};
	const dateStamp = () => {
		const d = new Date();
		return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
	};
	const doExport = (format) => {
		fetch(`${API.watchlist}/export?format=${format}`)
			.then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
			.then((blob) => {
				downloadBlob(`leekbox-watchlist-${dateStamp()}.${format}`, blob);
				setIoMsg(`已导出 ${items.length} 只（${format.toUpperCase()}）`);
			})
			.catch((e) => setIoMsg(`导出失败：${describeError(e)}`));
	};
	const pickFile = (mode) => {
		const proceed =
			mode === "replace" && items.length > 0
				? lkbConfirm(`覆盖导入将清空现有 ${items.length} 只自选股，改用文件中的列表。确定继续吗？`)
				: Promise.resolve(true);
		proceed.then((ok) => {
			if (!ok) return;
			importMode.current = mode;
			fileRef.current?.click();
		});
	};
	const onImportFile = (e) => {
		const file = e.target.files?.[0];
		e.target.value = ""; // allow re-picking the same file later
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => {
			api(`${API.watchlist}/import`, {
				method: "POST",
				body: { content: String(reader.result ?? ""), mode: importMode.current },
			})
				.then((d) => {
					const bad = (d.invalid ?? []).length;
					const base =
						d.mode === "replace"
							? `覆盖导入完成：${d.replaced ?? 0} 只`
							: `导入完成：新增 ${d.added ?? 0}，跳过重复 ${d.skipped ?? 0}`;
					setIoMsg(bad > 0 ? `${base}，无效 ${bad}` : base);
					load();
				})
				.catch((err) => setIoMsg(`导入失败：${err.message}`));
		};
		reader.onerror = () => setIoMsg("导入失败：文件读取失败");
		reader.readAsText(file, "utf8");
	};
	const groups = ["全部", ...Array.from(new Set(items.map((e) => e.group || "默认")))];
	const shown = group === "全部" ? items : items.filter((e) => (e.group || "默认") === group);
	const byCode = new Map(quotes.map((q) => [q.code, q]));
	/** Persist qty/cost through the add route's update path (server validates). */
	const savePosition = (it, patch) => {
		api(API.watchlist + "/add", { method: "POST", body: { code: it.code, ...patch } })
			.then((d) => {
				const entry = (d.watchlist ?? []).find((e) => e.code === it.code);
				setItems((prev) => prev.map((x) => (x.code === it.code ? { ...x, qty: entry?.qty, cost: entry?.cost } : x)));
			})
			.catch((e) => setIoMsg(describeError(e)));
	};
	// 持仓汇总:仅统计设置了完整持仓(股数+成本)且拿到现价的行。
	const posRows = shown.filter((it) => Number(it.qty) > 0 && Number(it.cost) > 0);
	let posSummary = null;
	if (posRows.length > 0) {
		let mv = 0;
		let costSum = 0;
		for (const it of posRows) {
			const px = byCode.get(it.code)?.price;
			if (px === null || px === void 0 || !Number.isFinite(px)) continue;
			mv += px * Number(it.qty);
			costSum += Number(it.cost) * Number(it.qty);
		}
		const plSum = mv - costSum;
		const pctSum = costSum > 0 ? (plSum / costSum) * 100 : null;
		posSummary = h(
			"div",
			{ className: "lkb-posSummary" },
			h("span", { className: "lkb-posTag" }, `持仓 ${posRows.length} 只`),
			h("span", null, "市值 ", h("b", null, fmtAmount(mv))),
			h("span", null, "成本 ", h("b", null, fmtAmount(costSum))),
			h("span", null, "浮动盈亏 ", h("b", { className: trend(plSum) }, fmtSign(plSum))),
			pctSum !== null ? h("span", null, "收益率 ", h("b", { className: trend(pctSum) }, fmtPct(pctSum))) : null
		);
	}
	// 预警卡片:已有预警或正在新建时显示。
	const alertsCard =
		alerts.length === 0 && alertForm === null
			? null
			: h(
				"div",
				{ className: "lkb-alertCard" },
				h(
					"div",
					{ className: "lkb-alertHead" },
					h("span", { className: "lkb-alertTitle" }, "🔔 价格预警"),
					h("span", { className: "lkb-code" }, `交易时段自动盯盘 · 触发后弹窗提醒并移除 · ${alerts.length} 条`)
				),
				alertForm === null ? null : h(AlertForm, { code: alertForm.code, name: alertForm.name, onDone: () => setAlertForm(null) }),
				alerts.length === 0
					? h("div", { className: "lkb-alertEmpty" }, "暂无预警。点击表格行内 🔔 为自选股设置目标价或涨跌幅提醒。")
					: h(
						"div",
						{ className: "lkb-alertList" },
						alerts.map((a) =>
							h(
								"div",
								{ key: a.id, className: "lkb-alertItem" },
								h("span", { className: "lkb-name" }, a.name),
								h("span", { className: "lkb-code" }, a.code),
								h("span", { className: "lkb-alertCond" }, alertLabel(a)),
								h("button", { className: "lkb-star", title: "删除该预警", onClick: () => removeAlert(a.id) }, "✕")
							)
						)
					)
			);
	const ioRow = h(
		"div",
		{ className: "lkb-chipRow", style: { justifyContent: "space-between", alignItems: "center" } },
		h(
			"div",
			{ style: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" } },
			h("button", { className: "lkb-chip", title: "从 JSON / CSV / TXT 导入，与现有自选合并（跳过重复）", onClick: () => pickFile("merge") }, "📥 导入"),
			h("button", { className: "lkb-chip", title: "用文件中的列表替换现有自选（会先确认）", onClick: () => pickFile("replace") }, "覆盖导入"),
			h("button", { className: "lkb-chip", title: "导出为 JSON 备份（含分组，可再次导入）", onClick: () => doExport("json") }, "导出 JSON"),
			h("button", { className: "lkb-chip", title: "导出为 CSV（Excel / WPS 可直接打开）", onClick: () => doExport("csv") }, "导出 CSV")
		),
		ioMsg === "" ? null : h("span", { className: "lkb-status" }, ioMsg)
	);
	const fileInput = h("input", {
		ref: fileRef,
		type: "file",
		accept: ".json,.csv,.txt,application/json,text/csv,text/plain",
		style: { display: "none" },
		onChange: onImportFile,
	});
	if (error !== "") return h("div", { className: "lkb-error" }, error);
	if (items.length === 0)
		return h(
			"div",
			null,
			ioRow,
			fileInput,
			// 预警独立于自选存储:自选清空后残留的预警仍会触发,这里也要可见可删。
			alertsCard,
			h("div", { className: "lkb-empty" }, "自选股为空。去「行情」搜索或从榜单点击 ☆ 添加，也可以直接点击「导入」从文件恢复。")
		);
	return h(
		"div",
		null,
		ioRow,
		fileInput,
		h(
			"div",
			{ className: "lkb-chipRow" },
			groups.map((g) => h("button", { key: g, className: "lkb-chip", "data-active": group === g ? "true" : "false", onClick: () => setGroup(g) }, g, h("span", { className: "lkb-code", style: { marginLeft: 4 } }, g === "全部" ? items.length : items.filter((e) => (e.group || "默认") === g).length)))
		),
		posSummary,
		alertsCard,
		h(
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
					h("th", { title: "点击单元格设置持仓数量（股）" }, "持仓"),
					h("th", { title: "点击单元格设置成本价" }, "成本"),
					h("th", { title: "浮动盈亏（按现价与成本实时计算）" }, "盈亏"),
					h("th", null, "今开"),
					h("th", null, "最高/最低"),
					h("th", null, "成交额"),
					h("th", null, "换手"),
					h("th", null, "")
				)
			),
			h(
				"tbody",
				null,
				shown.map((it) => {
					const q = byCode.get(it.code);
					const hasPos = Number(it.qty) > 0 && Number(it.cost) > 0;
					const px = q?.price;
					const pl = hasPos && px !== null && px !== void 0 && Number.isFinite(px) ? (px - Number(it.cost)) * Number(it.qty) : null;
					const plPct = hasPos && pl !== null ? (pl / (Number(it.cost) * Number(it.qty))) * 100 : null;
					return h(
						"tr",
						{ key: it.code, onClick: (e) => openOnRow(e, onOpen, it.code, it.name) },
						h("td", null, h("span", { className: "lkb-name" }, q?.name || it.name), h("span", { className: "lkb-code" }, it.code)),
						h("td", { className: trend(q?.change) }, fmt(q?.price)),
						h("td", { className: trend(q?.change) }, fmtPct(q?.changePct)),
						h(
							"td",
							{ onClick: (e) => e.stopPropagation() },
							h(PositionCell, { value: it.qty, placeholder: "+股数", onSave: (v) => savePosition(it, { qty: v }) })
						),
						h(
							"td",
							{ onClick: (e) => e.stopPropagation() },
							h(PositionCell, { value: it.cost, placeholder: "+成本", onSave: (v) => savePosition(it, { cost: v }) })
						),
						h(
							"td",
							{ className: trend(pl) },
							pl === null
								? "—"
								: h("span", null, fmtSign(pl), " ", h("span", { className: "lkb-code" }, fmtPct(plPct)))
						),
						h("td", null, fmt(q?.open)),
						h("td", null, fmt(q?.high), " / ", fmt(q?.low)),
						h("td", null, q?.amount === null || q?.amount === void 0 ? "—" : fmtAmount((q.amount ?? 0) * 10000)),
						h("td", null, q?.turnoverRate === null || q?.turnoverRate === void 0 ? "—" : fmt(q?.turnoverRate) + "%"),
						h(
							"td",
							null,
							h(
								"select",
								{
									className: "lkb-input",
									style: { width: 76, padding: "3px 6px", fontSize: 11 },
									value: it.group || "默认",
									// Stop the click here so the row's open-detail handler never sees it.
									onClick: (e) => e.stopPropagation(),
									onChange: (e) => {
										const g = e.target.value;
										api(API.watchlist + "/add", { method: "POST", body: { code: it.code, group: g } })
											.then(() => {
												setItems((prev) => prev.map((x) => (x.code === it.code ? { ...x, group: g } : x)));
											})
											// 分组是用户选的：失败要说，否则下拉框弹回旧值
											// 却没人解释为什么。
											.catch(notifyFailure("修改分组"));
									},
								},
								["默认", "短线", "长线", "观察"].map((g) => h("option", { key: g, value: g }, g))
							),
							h("button", {
								className: "lkb-star",
								title: "设置价格预警",
								onClick: (e) => {
									e.stopPropagation();
									requestNotifyPermission();
									setAlertForm({ code: it.code, name: q?.name || it.name });
								},
							}, "🔔"),
							h(StarButton, { code: it.code, name: it.name, on: true, confirmText: `确定将 ${it.name}（${it.code}）移出自选吗？` })
						)
					);
				})
			)
		)
	);
}
