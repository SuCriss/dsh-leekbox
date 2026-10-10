// 构建产物冒烟测试（无网络、无真 React/DOM）。
//
// lib/client.js 是 build.mjs 从 src/client/* 打出来的 DSH 客户端插件 bundle。
// 这个测试卡住它的**对外契约**，防止构建链改动悄悄把产物打坏：
//   1. 文件以 window.__ModuleLoader__.load() 包装，id 是 "dsh-leekbox"；
//   2. react / react-dom/client 保持 external——产物里只允许各出现一次
//      require("...")（宿主自带 React，打进产物就是双 React 事故）；
//   3. factory(require) 用桩 React 跑完模块顶层代码（顶层不碰 DOM，
//      样式注入有 document 守卫），返回 { apply, inject }。
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./lib/client.js", import.meta.url), "utf8");

let fail = 0;
const check = (name, ok, note = "") => {
	if (!ok) fail++;
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${note === "" ? "" : `  — ${note}`}`);
};

// 1) 包装形态
check("生成声明头（GENERATED FILE）", src.includes("GENERATED FILE"));
check("ModuleLoader 包装", src.includes("window.__ModuleLoader__.load({"));
check("插件 id", src.includes('id: "dsh-leekbox"'));

// 2) React 不进 bundle
const reactRequires = src.match(/require\("react"\)/g) ?? [];
const domRequires = src.match(/require\("react-dom\/client"\)/g) ?? [];
check('require("react") 恰好 1 处（external）', reactRequires.length === 1, `实测 ${reactRequires.length}`);
check('require("react-dom/client") 恰好 1 处（external）', domRequires.length === 1, `实测 ${domRequires.length}`);
check(
	"产物未内联 React 源码",
	!src.includes("react.production.min") && !src.includes("react.development") && !src.includes("object-assign")
);

// 3) 桩上跑 factory
let registered = null;
globalThis.window = {
	__ModuleLoader__: {
		load: (def) => {
			registered = def;
		},
	},
};
const reactStub = {
	createElement: () => ({}),
	useState: (v) => [v, () => {}],
	useEffect: () => {},
	useRef: (v) => ({ current: v }),
	useCallback: (fn) => fn,
};
const requireStub = (name) => {
	if (name === "react") return reactStub;
	if (name === "react-dom/client") return { createRoot: () => ({ render() {}, unmount() {} }) };
	throw new Error(`意外的 require: ${name}（只允许 react / react-dom/client）`);
};

new Function(src)();
check("执行后调用了 ModuleLoader.load", registered !== null);
check("registered.id === dsh-leekbox", registered?.id === "dsh-leekbox");
check("registered.factory 是函数", typeof registered?.factory === "function");

const exp = registered.factory(requireStub);
check("导出 apply(ctx)", typeof exp?.apply === "function");
check("导出 inject 数组", Array.isArray(exp?.inject));
check("inject 为空（样式走 styles.js 自注入）", exp.inject.length === 0);

// 4) apply() 在最小 DOM 桩上必须能挂起来
//
// 预警看护与交易日历时钟都挪到了 entry.js（随插件而不是随面板存活），所以
// apply() 现在会真的碰 document —— 用桩跑一遍，确认 mount 链路不抛。
{
	const stubEl = () => ({
		dataset: {},
		style: {},
		setAttribute() {},
		appendChild() {},
		remove() {},
		addEventListener() {},
		removeEventListener() {},
	});
	globalThis.document = {
		visibilityState: "visible",
		body: stubEl(),
		head: stubEl(),
		createElement: () => stubEl(),
		addEventListener() {},
		removeEventListener() {},
		querySelector: () => null,
	};
	let applyError = null;
	const ctx = { effect: () => {} };
	const origFetch = globalThis.fetch;
	const origObserver = globalThis.MutationObserver;
	// 侧边栏入口用 MutationObserver 盯宿主 DOM；桩一个空实现，免得 mount 抛错。
	globalThis.MutationObserver = class {
		observe() {}
		disconnect() {}
		takeRecords() {
			return [];
		}
	};
	// 日历拉取是后台异步的；这里给一个永不 resolve 的 fetch，避免测试退出前
	// 冒出未处理的 reject（真实环境走浏览器 fetch）。
	globalThis.fetch = () => new Promise(() => {});
	try {
		exp.apply(ctx);
	} catch (error) {
		applyError = error;
	} finally {
		globalThis.fetch = origFetch;
		globalThis.MutationObserver = origObserver;
	}
	check("apply() 在最小 DOM 桩上不抛", applyError === null, applyError === null ? "" : String(applyError));
}

// 5) 常驻件不能被塞回面板里
//
// 价格预警看护（AlertWatcher）与交易日历时钟必须随**插件**存活：面板关闭走
// root.unmount()，挂在面板里的看护会一起卸载 —— README 承诺的"交易时段自动
// 盯盘"就会静默失效。这两条断言把"它们由 entry.js 挂载"钉死，防止以后被
// 重构回 panel.js。panel.js 自己**不该**再渲染 AlertWatcher。
{
	const applyBody = src.slice(src.indexOf("function apply(ctx)"));
	const applyFn = applyBody.slice(0, applyBody.indexOf("\n}") + 2);
	check("apply 里挂载了预警看护", /\bmountAlertWatcher\s*\(/.test(applyFn), applyFn.split("\n").filter((l) => /mount|dispose/.test(l)).join(" | "));
	check("apply 里启动了交易日历时钟", /\bstartSessionClock\s*\(/.test(applyFn));
	check("apply 里把预警宿主挂进了 disposers", /alertWatcher\.dispose\s*\(/.test(applyFn));
	check("面板不再自己渲染 AlertWatcher", !/function LeekBoxPanel[\s\S]*?h\(AlertWatcher\b/.test(src), (src.match(/h\(AlertWatcher\b/g) ?? []).length + " 处渲染（应仅常驻宿主 1 处）");
	check("AlertWatcher 只在常驻宿主里渲染一次", (src.match(/h\(AlertWatcher\b/g) ?? []).length === 1);
	// 预警宿主自带 toast 栈：面板没开时也得弹得出来
	check("产物的 toast 走订阅式广播（core 的 pushToast/onToast）", src.includes("toastListeners") && src.includes("function pushToast("));
	check("写接口调用带 application/json（服务端写锁要求）", src.includes('"content-type": "application/json"'));
	// 轮询门控：页面不可见 / 非交易时段都不发请求
	check("轮询带可见性门控", src.includes("visibilitychange") && src.includes("shouldPoll"));
	check("交易日历来自服务端 /calendar", src.includes("/api/leekbox/calendar"));
}

// 6) 源码模块之间的导入/导出必须对得上
//
// 存在的理由（一次真实的踩坑）：build 失败时 esbuild 不会覆盖 lib/client.js，
// 于是"重新构建后产物哈希不变"会被误读成"构建成功且幂等"。当时 detail.js 被
// 重建后漏掉了 StockDetailWindow 的 export，panel.js 的 import 就成了悬空引用；
// 构建一直在报错，但产物是上一次成功的旧文件，看起来"稳定"。
// 所以必须直接检查配对，而不是只看产物哈希。
{
	const { readdirSync } = await import("node:fs");
	const dir = new URL("./src/client/", import.meta.url);
	const files = readdirSync(dir).filter((f) => f.endsWith(".js"));
	const exportsOf = new Map();
	for (const f of files) {
		const s = readFileSync(new URL(f, dir), "utf8");
		const names = new Set();
		for (const m of s.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
		for (const m of s.matchAll(/^export\s*\{([^}]*)\}/gm)) {
			for (const part of m[1].split(",")) {
				const t = part.trim();
				if (t !== "") names.add((t.split(/\s+as\s+/).pop() ?? t).trim());
			}
		}
		exportsOf.set(f, names);
	}
	const missing = [];
	for (const f of files) {
		const s = readFileSync(new URL(f, dir), "utf8");
		for (const m of s.matchAll(/^import\s*\{([^}]*)\}\s*from\s*"\.\/([\w.-]+)";/gm)) {
			const target = m[2];
			if (!exportsOf.has(target)) {
				missing.push(`${f} → ./${target}（模块不存在）`);
				continue;
			}
			for (const part of m[1].split(",")) {
				const t = part.trim();
				if (t === "") continue;
				const name = (t.split(/\s+as\s+/)[0] ?? t).trim();
				if (!exportsOf.get(target).has(name)) missing.push(`${f} → ./${target} 未导出 ${name}`);
			}
		}
	}
	check(
		`${files.length} 个客户端模块的导入/导出配对`,
		missing.length === 0,
		missing.length === 0 ? "" : missing.slice(0, 4).join("; ")
	);
}

console.log(fail === 0 ? "\n✅ bundle 契约完好" : `\n❌ ${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
