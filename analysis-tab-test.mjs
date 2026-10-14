// AI 分析页（analysis-tab.js）行为测试 —— 无网络、无真 DOM。
//
// 覆盖本次改造的四项：
//   1. AbortController：换股/重新生成/卸载会 abort 上一路流，不并发追加；
//   2. localStorage 缓存：按 code 存取、命中选择直接回显、淘汰与 TTL；
//   3. 复制带上下文头（股票/价位/模型/时间戳）；
//   4. 重新生成二次确认（lkbConfirm）+ 同步重入锁。
//
// 做法：从产物抽 AnalysisTab / 工具函数的源码求值（产物是 cjs 包装、无法直接
// import），配一个最小的 React 桩把 hook 状态真跑起来。测试锚点写成与
// const/var 无关的形式 —— 见 build.mjs 关于 cjs 会把顶层 const 改写成 var 的说明。
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./lib/client.js", import.meta.url), "utf8");

/** 组件里的搜索去抖常量（与 src/client/analysis-tab.js 保持一致）。 */
const SEARCH_DEBOUNCE_MS = 350;

let fail = 0;
const check = (name, ok, note = "") => {
	if (!ok) fail++;
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${note === "" ? "" : `  — ${note}`}`);
};

// ---- 抽取模块源码 ------------------------------------------------------------
// esbuild 的 cjs 输出里模块顶层 const 会变成 var，且注释被剥离；因此锚点
// 一律用「与声明关键字无关」的特征串。
function sliceFrom(marker, endMarker) {
	const i = src.indexOf(marker);
	if (i < 0) throw new Error(`锚点未找到: ${marker}`);
	const j = src.indexOf(endMarker, i);
	if (j < 0) throw new Error(`结束锚点未找到: ${endMarker}`);
	return src.slice(i, j + endMarker.length);
}

// 缓存工具 + 文案工具：从 CACHE_PREFIX 到 agoText 之前；再用精确切点接上
// agoText / stampText。注释被 esbuild 剥离，全部按声明串定位。
const cacheIdx = src.indexOf("var CACHE_PREFIX");
const agoIdx = src.indexOf("function agoText(at) {");
const stampIdx = src.indexOf("function stampText(at) {");
const tabIdx = src.indexOf("function AnalysisTab({");
if (cacheIdx < 0 || agoIdx < 0 || stampIdx < 0 || tabIdx < 0) throw new Error("工具块锚点未找到");
const cacheBlock = src.slice(cacheIdx, agoIdx);
const agoBlock = src.slice(agoIdx, stampIdx);
const stampBlock = src.slice(stampIdx, tabIdx);

// ---- localStorage 桩 ---------------------------------------------------------
class MemStorage {
	constructor() {
		this.map = new Map();
	}
	get length() {
		return this.map.size;
	}
	key(i) {
		return [...this.map.keys()][i] ?? null;
	}
	getItem(k) {
		return this.map.has(k) ? this.map.get(k) : null;
	}
	setItem(k, v) {
		this.map.set(String(k), String(v));
	}
	removeItem(k) {
		this.map.delete(k);
	}
	clear() {
		this.map.clear();
	}
}

globalThis.window = { localStorage: new MemStorage() };
// 组件里「点搜索框外收起下拉」的 effect 会碰 document；给个最小桩。
globalThis.document = { addEventListener() {}, removeEventListener() {} };
globalThis.Date = Date;

// 求值工具块，导出需要的函数。
const tools = new Function(
	`${cacheBlock}
	${agoBlock}
	${stampBlock}
	return { readCache, writeCache, pruneCache, agoText, stampText, CACHE_PREFIX, CACHE_MAX, CACHE_TTL_MS };`
)();

// ---- 1. 缓存读写 -------------------------------------------------------------
{
	const { readCache, writeCache, CACHE_PREFIX } = tools;
	check("空缓存读出 null", readCache("sh600519") === null);

	// 新结构：缓存存的是完整对话轮次数组（首轮 + 追问）。
	writeCache("sh600519", {
		turns: [
			{ role: "assistant", text: "首轮分析正文" },
			{ role: "user", text: "负债率高吗" },
			{ role: "assistant", text: "追问回答" },
		],
		name: "贵州茅台", model: "deepseek-chat", at: Date.now(), price: 1680.5, changePct: 1.23,
		data: { quote: true, kline: true, f10: false, fflow: true, news: false, sectors: true },
		klineWindow: 120,
	});
	const got = readCache("sh600519");
	check("写入后可读回", got !== null && got.turns.length === 3);
	check("首轮正文保留", got?.turns[0].text === "首轮分析正文");
	check("追问轮次保留", got?.turns[1].role === "user" && got.turns[1].text === "负债率高吗");
	check("字段完整保留", got?.name === "贵州茅台" && got?.model === "deepseek-chat" && got?.price === 1680.5);
	check("data 标记保留", got?.data?.f10 === false);
	check("klineWindow 保留", got?.klineWindow === 120);
	check("键名带前缀", window.localStorage.getItem(CACHE_PREFIX + "sh600519") !== null);

	// 旧版本存的是 text 字符串 —— 不做迁移，视为无缓存（不留半截旧数据）。
	window.localStorage.setItem(CACHE_PREFIX + "legacy", JSON.stringify({ text: "旧版单轮", name: "x", at: Date.now() }));
	check("旧版 text 结构视为无缓存", readCache("legacy") === null);

	// 损坏数据不该炸，也不该当成有效缓存。
	window.localStorage.setItem(CACHE_PREFIX + "bad1", "{{不是 JSON");
	check("损坏 JSON 读出 null（不抛）", readCache("bad1") === null);
	window.localStorage.setItem(CACHE_PREFIX + "bad2", JSON.stringify({ turns: [] }));
	check("空 turns 不算缓存", readCache("bad2") === null);
	window.localStorage.setItem(CACHE_PREFIX + "bad3", JSON.stringify({ nope: 1 }));
	check("缺 turns 字段不算缓存", readCache("bad3") === null);
	// 轮次里的脏元素要被过滤掉，不能让它污染渲染。
	window.localStorage.setItem(CACHE_PREFIX + "bad4", JSON.stringify({
		turns: [null, { role: "assistant" }, { role: "assistant", text: "" }, { role: "bogus", text: "ok" }],
	}));
	const cleaned = readCache("bad4");
	check("轮次里的脏元素被过滤", cleaned !== null && cleaned.turns.length === 1 && cleaned.turns[0].role === "assistant",
		JSON.stringify(cleaned?.turns));
	check("非法 role 归为 assistant", cleaned?.turns[0].text === "ok");
}

// ---- 2. 淘汰策略 -------------------------------------------------------------
{
	const { writeCache, readCache, CACHE_MAX, CACHE_TTL_MS } = tools;
	const mk = (i, at) => ({ turns: [{ role: "assistant", text: `t${i}` }], name: `n${i}`, model: "m", at, price: null, changePct: null, data: null, klineWindow: 60 });
	window.localStorage.clear();
	// 写满 CACHE_MAX 条互不相同的股票。
	for (let i = 0; i < CACHE_MAX; i++) {
		writeCache(`sh00000${i}`, mk(i, Date.now() - i * 1000));
	}
	const count = () => {
		let n = 0;
		for (let i = 0; i < window.localStorage.length; i++) if (window.localStorage.key(i).startsWith("leekbox-analysis:")) n++;
		return n;
	};
	check(`写满后条数不超过上限(${CACHE_MAX})`, count() <= CACHE_MAX, `实测 ${count()}`);

	// 再写一条新的：最旧的一条应被淘汰，新的必须在。
	writeCache("sz999999", mk("new", Date.now()));
	check("超出上限后新条目保留", readCache("sz999999") !== null);
	check("淘汰后条数仍在上限内", count() <= CACHE_MAX, `实测 ${count()}`);

	// TTL：注入一条 40 天前的，再写一次触发 prune，过期条目应被清掉。
	window.localStorage.clear();
	const stale = Date.now() - (CACHE_TTL_MS + 86400000);
	window.localStorage.setItem("leekbox-analysis:sh111111", JSON.stringify(mk("old", stale)));
	writeCache("sh222222", mk("fresh", Date.now()));
	check("过期条目被 TTL 清掉", window.localStorage.getItem("leekbox-analysis:sh111111") === null);
	check("未过期条目保留", readCache("sh222222") !== null);
}

// ---- 3. 时间文案 -------------------------------------------------------------
{
	const { agoText, stampText } = tools;
	const now = Date.now();
	check("刚刚", agoText(now - 10_000) === "刚刚");
	check("分钟前", agoText(now - 5 * 60_000) === "5 分钟前");
	check("小时前", agoText(now - 3 * 3_600_000) === "3 小时前");
	check("天前", agoText(now - 2 * 86_400_000) === "2 天前");
	check("非法 at 返回空", agoText(NaN) === "" && agoText(0) === "");
	const s = stampText(new Date(2025, 0, 15, 9, 5).getTime());
	check("时间戳格式 YYYY-MM-DD HH:mm", s === "2025-01-15 09:05", s);
}

// 二次确认闸门：默认立即放行；需要撑开 await 窗口时置 pending，测试放行。
// 必须在组件求值之前定义（core 桩的 lkbConfirm 引用它）。
let confirmGate = { pending: false, release: null };
const gatedConfirm = () => {
	if (!confirmGate.pending) return Promise.resolve(true);
	return new Promise((resolve) => {
		confirmGate.release = resolve;
	});
};

// ---- 4. 组件渲染 + 并发/中止行为 --------------------------------------------
//
// 用最小 React 桩真正跑 hook：useState 落数组、useRef 落对象、useEffect 收集。
// 这样能捕获 TDZ（run 引用后声明的 streamInto）这类只在运行时才炸的问题。
function makeReactStub() {
	let cursor = 0;
	let states = [];
	let effects = [];
	return {
		/** 新的一轮渲染：重置 hook 游标，但**保留** states（state 跨渲染存活）。 */
		render() {
			cursor = 0;
			effects = [];
		},
		/** 完全重置（换一个组件实例时用）。 */
		reset() {
			cursor = 0;
			states = [];
			effects = [];
		},
		get effects() {
			return effects;
		},
		h: (type, props, ...kids) => ({ type, props: props ?? {}, kids }),
		useState: (init) => {
			const i = cursor++;
			if (!(i in states)) states[i] = typeof init === "function" ? init() : init;
			return [states[i], (v) => { states[i] = typeof v === "function" ? v(states[i]) : v; }];
		},
		useRef: (init) => {
			const i = cursor++;
			if (!(i in states)) states[i] = { current: init };
			return states[i];
		},
		useEffect: (fn) => { cursor++; effects.push(fn); },
		useCallback: (fn) => { cursor++; return fn; },
	};
}

// 抽取 AnalysisTab 组件源码：从 function AnalysisTab({ 到模块末尾之前。
// 产物里 AnalysisTab 是同级最后一个大函数，后面紧跟着别的东西；
// 用一个 balanced-brace 扫描拿到完整函数体。
function sliceComponent() {
	const start = src.indexOf("function AnalysisTab({");
	if (start < 0) throw new Error("未找到 AnalysisTab");
	// 先跳到函数体的第一个 '{'
	let i = src.indexOf("{", src.indexOf(")", start));
	if (i < 0) throw new Error("未找到 AnalysisTab 函数体");
	let depth = 0;
	for (; i < src.length; i++) {
		const ch = src[i];
		if (ch === '"' || ch === "'" || ch === "`") {
			// 跳过字符串/模板串，避免里面的花括号影响计数
			const quote = ch;
			i++;
			while (i < src.length && src[i] !== quote) {
				if (src[i] === "\\") i++;
				i++;
			}
			continue;
		}
		if (ch === "{") depth++;
		else if (ch === "}") {
			depth--;
			if (depth === 0) return src.slice(start, i + 1);
		}
	}
	throw new Error("AnalysisTab 函数体未闭合");
}

/** 按函数名抽一个同级函数声明的完整源码（balanced brace）。 */
function sliceFn(name) {
	const start = src.indexOf(`function ${name}(`);
	if (start < 0) throw new Error(`未找到函数 ${name}`);
	let i = src.indexOf("{", start);
	let depth = 0;
	for (; i < src.length; i++) {
		const ch = src[i];
		if (ch === '"' || ch === "'" || ch === "`") {
			const q = ch;
			i++;
			while (i < src.length && src[i] !== q) {
				if (src[i] === "\\") i++;
				i++;
			}
			continue;
		}
		if (ch === "{") depth++;
		else if (ch === "}") {
			depth--;
			if (depth === 0) return src.slice(start, i + 1);
		}
	}
	throw new Error(`函数 ${name} 未闭合`);
}

/**
 * 组件依赖的同级声明。产物里 dataBadges / DATA_LABELS 位于 AnalysisTab **之后**，
 * 靠函数声明提升在真实模块里可用；但测试是把源码切片后 new Function，
 * 切片外的符号拿不到，必须显式带上。
 */
function siblingHelpers() {
	const parts = [];
	const dl = src.indexOf("var DATA_LABELS = [");
	if (dl >= 0) {
		const end = src.indexOf("];", dl);
		if (end > dl) parts.push(src.slice(dl, end + 2));
	}
	parts.push(sliceFn("dataBadges"));
	return parts.join("\n");
}

{
	const react = makeReactStub();
	const compSrc = sliceComponent();
	// 组件依赖的外部符号：用桩提供。
	const core = {
		API: { analysisStream: "/api/leekbox/analysis/analyze/stream", search: "/api/leekbox/search" },
		// 搜索桩：返回一条命中，让交互路径能选中股票。
		api: () => Promise.resolve({ hits: [{ code: "sh600519", name: "贵州茅台", price: 1680.5, changePct: 1.23 }] }),
		describeError: (e) => String(e?.message ?? e),
		fmt: (n) => (Number.isFinite(n) ? n.toFixed(2) : "—"),
		fmtPct: (n) => (Number.isFinite(n) ? `${n.toFixed(2)}%` : "—"),
		// 组件里用 normCode 过滤命中，必须是有效 A 股代码。
		normCode: (c) => String(c ?? ""),
		trend: () => "",
		lkbConfirm: gatedConfirm,
	};
	const factory = new Function(
		"h", "useState", "useEffect", "useRef", "useCallback",
		"useState2", "useEffect2", "useRef2", "useCallback2",
		"API", "api", "describeError", "fmt", "fmtPct", "lkbConfirm", "normCode", "trend",
		"SEARCH_DEBOUNCE_MS",
		`${cacheBlock}
		${agoBlock}
		${stampBlock}
		${siblingHelpers()}
		${compSrc}
		return AnalysisTab;`
	);

	let Comp = null;
	let renderError = null;
	try {
		// esbuild 把 import 进来的 hook 重命名成 useState2 / useRef2 …（避开
		// 组件内同名的局部变量），两套名字都喂进去。SEARCH_DEBOUNCE_MS 是
		// 模块级常量，也一并注入。
		Comp = factory(
			react.h, react.useState, react.useEffect, react.useRef, react.useCallback,
			react.useState, react.useEffect, react.useRef, react.useCallback,
			core.API, core.api, core.describeError, core.fmt, core.fmtPct, core.lkbConfirm, core.normCode, core.trend,
			SEARCH_DEBOUNCE_MS
		);
	} catch (e) {
		renderError = e;
	}
	check("组件源码可求值（无 TDZ/语法错）", renderError === null, renderError === null ? "" : String(renderError));

	if (Comp !== null) {
		// 第一次渲染：picked === null，应渲染空提示。
		react.reset();
		let tree = null;
		let err = null;
		try {
			tree = Comp({ onOpen: () => {}, configured: true, onOpenSettings: () => {} });
		} catch (e) {
			err = e;
		}
		check("首次渲染不抛（hook 顺序正确）", err === null, err === null ? "" : String(err));

		// 递归找文本，确认渲染出了预期提示。
		const texts = [];
		const walk = (n) => {
			if (n === null || n === void 0) return;
			if (typeof n === "string") { texts.push(n); return; }
			if (Array.isArray(n)) { n.forEach(walk); return; }
			if (n.kids) n.kids.forEach(walk);
		};
		walk(tree);
		check("未选股时提示先选股", texts.some((t) => t.includes("先在搜索框里选一只股票")), texts.slice(0, 8).join("|"));

		// 卸载副作用：应收集到至少 2 个（点外收起 + 卸载中止）。
		check("注册了 effect（含卸载中止）", react.effects.length >= 2, `实测 ${react.effects.length}`);
		const cleanups = [];
		for (const fn of react.effects) {
			try {
				const c = fn();
				if (typeof c === "function") cleanups.push(c);
			} catch {}
		}
		let unErr = null;
		try {
			cleanups.forEach((c) => c());
		} catch (e) {
			unErr = e;
		}
		check("卸载清理函数不抛（abort 路径安全）", unErr === null, unErr === null ? "" : String(unErr));

		// ---- 并发 / 中止：真跑一遍事件流 --------------------------------------
		//
		// 走组件自己的交互路径：在搜索框触发 onInput → 等去抖 → 命中项 onClick
		// 选中 → 点「开始分析」。用可控的假 SSE 流观察 abort 与重入。
		const SEARCH_DEBOUNCE_MS_GUARD = 500; // 组件去抖是 350ms，留出余量
		// 渲染一轮并跑 effect（组件用 useEffect 起去抖定时器；effect 顺序与
		// 真实 React 一致，点外收起那个会碰 document，已给桩）。
		const renderOnce = () => {
			react.render();
			const tree = Comp({ onOpen: () => {}, configured: true, onOpenSettings: () => {} });
			for (const fn of react.effects) {
				try {
					fn();
				} catch {}
			}
			return tree;
		};
		const pickStock = async (name) => {
			const tree = renderOnce();
			const input = findInput(tree);
			if (!input) throw new Error("未找到搜索框");
			input.props.onInput({ target: { value: name } });
			// 关键：再渲染一轮跑 effect，去抖定时器才会挂上。
			renderOnce();
			// 等去抖(350ms) + 搜索 promise 落地。
			await new Promise((r) => setTimeout(r, SEARCH_DEBOUNCE_MS_GUARD));
			const tree2 = renderOnce();
			const hit = findHit(tree2);
			if (!hit) throw new Error("未找到命中项");
			hit.props.onClick();
			return renderOnce();
		};

		const findInput = (n) => {
			if (!n || typeof n === "string") return null;
			if (Array.isArray(n)) { for (const c of n) { const r = findInput(c); if (r) return r; } return null; }
			if (n.type === "input") return n;
			for (const c of n.kids ?? []) { const r = findInput(c); if (r) return r; }
			return null;
		};
		const findHit = (n) => {
			if (!n || typeof n === "string") return null;
			if (Array.isArray(n)) { for (const c of n) { const r = findHit(c); if (r) return r; } return null; }
			if (n.props?.className === "lkb-anHit") return n;
			for (const c of n.kids ?? []) { const r = findHit(c); if (r) return r; }
			return null;
		};
		const findBtn = (n, label) => {
			if (!n || typeof n === "string") return null;
			if (Array.isArray(n)) { for (const c of n) { const r = findBtn(c, label); if (r) return r; } return null; }
			if (n.type === "button" && (n.kids ?? []).some((k) => k === label)) return n;
			for (const c of n.kids ?? []) { const r = findBtn(c, label); if (r) return r; }
			return null;
		};

		// 假 fetch：每次调用返回一条可控 SSE 流，记录是否被 abort 与请求体。
		const opened = [];
		const origFetch = globalThis.fetch;
		globalThis.fetch = (url, init) => {
			let ctrlRef = null;
			const body = new ReadableStream({ start(c) { ctrlRef = c; } });
			let parsed = null;
			try { parsed = JSON.parse(init?.body ?? "{}"); } catch {}
			const rec = {
				aborted: false,
				body: parsed,
				push: (s) => { try { ctrlRef.enqueue(new TextEncoder().encode(s)); } catch {} },
			};
			if (init?.signal) init.signal.addEventListener("abort", () => { rec.aborted = true; });
			opened.push(rec);
			return Promise.resolve({ ok: true, status: 200, body });
		};

		try {
			const tree3 = await pickStock("贵州茅台");
			check("选中股票后出现「开始分析」", findBtn(tree3, "开始分析") !== null);

			// 第一次分析：流保持挂起（不 push done），请求应停在 open 状态。
			const btn1 = findBtn(tree3, "开始分析");
			btn1.props.onClick();
			await new Promise((r) => setTimeout(r, 30));
			check("点击后发出了请求", opened.length === 1, `实测 ${opened.length}`);

			// 推一段 delta，确认正文被追加。
			opened[0].push("event: meta\ndata: {\"name\":\"贵州茅台\",\"model\":\"m1\",\"klineWindow\":60,\"data\":{\"quote\":true,\"kline\":true}}\n\n");
			opened[0].push("event: delta\ndata: {\"text\":\"第一段\"}\n\n");
			await new Promise((r) => setTimeout(r, 30));
			const mid = renderOnce();
			const result = findResult(mid);
			check("流式正文已渲染", result !== null && result.includes("第一段"), String(result).slice(0, 40));
			check("分析中显示「停止生成」", findBtn(mid, "停止生成") !== null);

			// 方案 A：分析中点「停止生成」——应 abort 且**不**发新请求（真 UX：
			// 分析中不存在「重新生成」按钮，所以这里点的是停止）。
			const stopBtn = findBtn(mid, "停止生成");
			check("分析中存在「停止生成」按钮", stopBtn !== null);
			stopBtn.props.onClick();
			await new Promise((r) => setTimeout(r, 30));
			check("停止后旧流被 abort", opened[0].aborted === true);
			check("停止不会发起新请求", opened.length === 1, `实测 ${opened.length}`);
			check("停止后不报错（AbortError 静默）", findError(renderOnce()) === null);

			// 方案 B：重新生成。停稳后按钮回到「重新生成」，点它应开新流。
			const after = renderOnce();
			const regen = findBtn(after, "重新生成");
			check("停止后按钮回到「重新生成」", regen !== null);
			if (regen !== null) {
				regen.props.onClick();
				await new Promise((r) => setTimeout(r, 60));
			}
			check("重新生成发起第二个请求", opened.length === 2, `实测 ${opened.length}`);
			check("新流未被 abort", opened[1] !== void 0 && opened[1].aborted === false);

			// 收尾：关掉第二条流。
			if (opened[1] !== void 0) {
				opened[1].push("event: done\ndata: {}\n\n");
				await new Promise((r) => setTimeout(r, 30));
			}

			// ---- 重入锁：lkbConfirm 挂起期间连点两下 ------------------------
			//
			// 这是本次改造最核心的防御。run 是 async，二次确认是 await ——
			// 弹窗挂着时 analyzing 还是 false，「开始分析」和结果栏的
			// 「重新生成」又是两个入口，连点两下会排进两个 run。runningRef
			// 在 await 之前同步置位把第二个挡掉。这里用一个手动 resolve 的
			// confirm 把窗口撑开，量三次点击只产生一个请求。
			//
			// 前置：确保有正文（确认弹窗只在 analysis 非空时才弹），且流已停，
			// 这样结果栏才是「重新生成」——正是用户误触的真实场景。
			const live = opened[opened.length - 1];
			if (live !== void 0) {
				live.push("event: delta\ndata: {\"text\":\"锁测试正文\"}\n\n");
				await new Promise((r) => setTimeout(r, 30));
			}
			const tree5 = renderOnce();
			// 先停下当前流：停稳后结果栏才回到「重新生成」。
			const stopNow = findBtn(tree5, "停止");
			if (stopNow !== null) {
				stopNow.props.onClick();
				await new Promise((r) => setTimeout(r, 30));
			}
			const before = opened.length;
			confirmGate = { pending: true, release: null };
			const tree6 = renderOnce();
			const btn6 = findBtn(tree6, "重新生成");

			if (btn6 !== null) {
				btn6.props.onClick(); // 第一次：进入 await lkbConfirm（被闸门挂住）
				btn6.props.onClick(); // 第二次：应被 runningRef 挡掉
				btn6.props.onClick(); // 第三次：同上
				if (confirmGate.release !== null) confirmGate.release(true);
				confirmGate = { pending: false, release: null };
				await new Promise((r) => setTimeout(r, 80));
				const delta = opened.length - before;
				check("连点 3 次只产生 1 个请求（重入锁生效）", delta === 1, `实测 ${delta}`);
			} else {
				check("（跳过重入锁：未找到按钮）", false);
			}

			// ---- #6 K 线窗口选择器 ------------------------------------------
			{
				// 前面重入锁测试开的那条流还没喂 meta，这里先给它一个
				// klineWindow=60，制造"结果基于 60、现在选了 120"的不一致。
				const liveW = opened[opened.length - 1];
				if (liveW !== void 0 && !liveW.aborted) {
					liveW.push("event: meta\ndata: {\"name\":\"贵州茅台\",\"model\":\"m1\",\"klineWindow\":60,\"data\":{\"quote\":true}}\n\n");
					await new Promise((r) => setTimeout(r, 20));
				}
				const t = renderOnce();
				const seg = findSeg(t, "半年");
				check("存在 K 线窗口「半年」选项", seg !== null);
				if (seg !== null) {
					seg.props.onClick(); // setKlineWindow(120)
					await new Promise((r) => setTimeout(r, 10));
					const t2 = renderOnce();
					check("选中态切到「半年」", findSeg(t2, "半年")?.props?.["data-active"] === "true");
					check("窗口与结果不一致时提示重新生成", findText(t2, (s) => s.includes("需重新生成")) !== null,
						JSON.stringify(findText(t2, (s) => s.includes("需重新生成"))));
				}
			}

			// ---- #11 追问对话 ----------------------------------------------
			{
				// 前面的重入锁测试触发过「重新生成」，对话已被重置成一条空回复。
				// 这里先喂一段正文，模拟"已有一轮完整分析"的真实前置状态。
				const live0 = opened[opened.length - 1];
				if (live0 !== void 0 && !live0.aborted) {
					live0.push("event: meta\ndata: {\"name\":\"贵州茅台\",\"model\":\"m1\",\"klineWindow\":60,\"data\":{\"quote\":true,\"kline\":true}}\n\n");
					live0.push("event: delta\ndata: {\"text\":\"这是首轮分析正文。\"}\n\n");
					await new Promise((r) => setTimeout(r, 30));
				}
				// 再让当前流停下：生成中追问按钮会变成「停止」，那是另一条路径。
				let t = renderOnce();
				const stopNow = findBtn(t, "停止");
				if (stopNow !== null) {
					stopNow.props.onClick();
					await new Promise((r) => setTimeout(r, 30));
					t = renderOnce();
				}
				const askInput = findAskInput(t);
				check("已有分析后出现追问输入框", askInput !== null);
				if (askInput !== null) {
					const beforeAsk = opened.length;
					askInput.props.onInput({ target: { value: "它的负债率在行业里算高吗？" } });
					await new Promise((r) => setTimeout(r, 10));
					const t2 = renderOnce();
					const sendBtn = findBtn(t2, "追问");
					check("有内容后「追问」按钮可用", sendBtn !== null && sendBtn.props.disabled !== true);
					sendBtn.props.onClick();
					await new Promise((r) => setTimeout(r, 40));
					check("追问发出了请求", opened.length === beforeAsk + 1, `实测 ${opened.length - beforeAsk}`);

					const sent = opened[opened.length - 1].body;
					check("请求带 question 字段", sent?.question === "它的负债率在行业里算高吗？", JSON.stringify(sent?.question));
					check("请求带 turns 历史", Array.isArray(sent?.turns) && sent.turns.length > 0, JSON.stringify(sent?.turns?.length));
					check("历史里含首轮分析（assistant）", sent?.turns?.some((x) => x.role === "assistant"), JSON.stringify(sent?.turns?.map((x) => x.role)));
					check("请求带 klineWindow", sent?.klineWindow === 120, String(sent?.klineWindow));

					// 追问的流式回答应长在对话里，且问句以用户气泡呈现。
					opened[opened.length - 1].push("event: delta\ndata: {\"text\":\"负债率 20%，低于行业均值\"}\n\n");
					await new Promise((r) => setTimeout(r, 30));
					const t3 = renderOnce();
					check("追问问句渲染为用户气泡", findAsks(t3).includes("它的负债率在行业里算高吗？"), JSON.stringify(findAsks(t3)));
					check("追问回答渲染进对话", (findResult(t3) ?? "").includes("负债率 20%"), String(findResult(t3)).slice(-60));
					check("首轮分析仍在（未被追问清掉）", (findResult(t3) ?? "").includes("这是首轮分析正文"), String(findResult(t3)).slice(0, 40));

					// 追问同样受重入锁保护：生成中不能重复提交。
					const t4 = renderOnce();
					const liveAsk = findBtn(t4, "停止");
					if (liveAsk !== null) {
						const n = opened.length;
						liveAsk.props.onClick(); // 停止
						await new Promise((r) => setTimeout(r, 20));
						check("追问生成中可停止且不重发", opened.length === n, `实测 ${opened.length - n}`);
					}
				}
			}
		} finally {
			globalThis.fetch = origFetch;
		}
	} else {
		check("（跳过交互路径：组件未能构造）", false);
	}
}

/** 从渲染树里取错误提示文本（无错误返回 null）。 */
function findError(n) {
	if (!n || typeof n === "string") return null;
	if (Array.isArray(n)) { for (const c of n) { const r = findError(c); if (r !== null) return r; } return null; }
	if (n.props?.className === "lkb-error") {
		return (n.kids ?? []).filter((k) => typeof k === "string").join("");
	}
	for (const c of n.kids ?? []) { const r = findError(c); if (r !== null) return r; }
	return null;
}

/** 从渲染树里取全部回答气泡文本（按顺序拼接）。 */
function findResult(n) {
	const texts = [];
	const walk = (x) => {
		if (!x || typeof x === "string") return;
		if (Array.isArray(x)) { x.forEach(walk); return; }
		if (x.props?.className === "lkb-anReply") {
			texts.push((x.kids ?? []).filter((k) => typeof k === "string").join(""));
			return;
		}
		(x.kids ?? []).forEach(walk);
	};
	walk(n);
	return texts.length === 0 ? null : texts.join("\n---\n");
}

/** 从渲染树里取全部追问气泡文本。 */
function findAsks(n) {
	const texts = [];
	const walk = (x) => {
		if (!x || typeof x === "string") return;
		if (Array.isArray(x)) { x.forEach(walk); return; }
		if (x.props?.className === "lkb-anAsk") {
			texts.push((x.kids ?? []).filter((k) => typeof k === "string").join(""));
			return;
		}
		(x.kids ?? []).forEach(walk);
	};
	walk(n);
	return texts;
}

/** 按文案找 K 线窗口的分段按钮。 */
function findSeg(n, label) {
	if (!n || typeof n === "string") return null;
	if (Array.isArray(n)) { for (const c of n) { const r = findSeg(c, label); if (r) return r; } return null; }
	if (n.type === "button" && n.props?.className === "lkb-segBtn" && (n.kids ?? []).includes(label)) return n;
	for (const c of n.kids ?? []) { const r = findSeg(c, label); if (r) return r; }
	return null;
}

/** 找追问输入框（class 为 lkb-input 且带 maxLength 的那个）。 */
function findAskInput(n) {
	if (!n || typeof n === "string") return null;
	if (Array.isArray(n)) { for (const c of n) { const r = findAskInput(c); if (r) return r; } return null; }
	if (n.type === "input" && n.props?.maxLength !== void 0) return n;
	for (const c of n.kids ?? []) { const r = findAskInput(c); if (r) return r; }
	return null;
}

/** 按谓词找第一个文本节点。 */
function findText(n, pred) {
	if (typeof n === "string") return pred(n) ? n : null;
	if (!n || typeof n !== "object") return null;
	if (Array.isArray(n)) {
		for (const c of n) {
			const r = findText(c, pred);
			if (r !== null) return r;
		}
		return null;
	}
	for (const c of n.kids ?? []) {
		const r = findText(c, pred);
		if (r !== null) return r;
	}
	return null;
}

// ---- 5. 产物契约：关键实现特征必须在 ----------------------------------------
{
	check("产物含 AbortController", src.includes("new AbortController"));
	check("fetch 带 signal", src.includes("signal: aborter.signal"));
	check("主动中止不报错（AbortError 判定）", src.includes("AbortError"));
	check("缓存前缀存在", src.includes("leekbox-analysis:"));
	check("有淘汰函数", src.includes("pruneCache") || src.includes("removeItem"));
	check("复制带上下文（时间戳）", src.includes("stampText"));
	check("重新生成有二次确认文案", src.includes("重新生成会清空当前分析与追问记录"));
	check("有停止生成入口", src.includes("停止生成"));
	check("缓存时间标记样式类", src.includes("lkb-anAgo"));
	check("取数阶段有反馈（stage 事件）", src.includes("正在获取行情与资金数据"));
	check("数据齐备徽章存在", src.includes("lkb-anDataItem") && src.includes("function dataBadges("));
	check("徽章覆盖资金流/新闻/板块", src.includes('"fflow", "资金流"') && src.includes('"news", "新闻"') && src.includes('"sectors", "板块"'));
	// #6 K 线窗口
	check("K 线窗口三档可选", src.includes("3 月") && src.includes("半年") && src.includes("1 年"));
	check("窗口随请求下发 klineWindow", src.includes("klineWindow"));
	check("窗口与结果不一致时提示", src.includes("需重新生成"));
	// #11 追问
	check("有追问输入框", src.includes("lkb-anAskRow"));
	check("追问走 question/turns 字段", src.includes("payload.question") && src.includes("payload.turns"));
	check("历史读 turnsRef（避免闭包读到旧数组）", src.includes("turnsRef.current"));
	check("Enter 发送且避开输入法组合键", src.includes("isComposing"));
	check("对话区区分问/答样式", src.includes("lkb-anAsk") && src.includes("lkb-anReply"));
	check("追问有长度上限", src.includes("QUESTION_MAX"));
}

console.log(fail === 0 ? "\n✅ 分析页改造全部通过" : `\n❌ ${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
