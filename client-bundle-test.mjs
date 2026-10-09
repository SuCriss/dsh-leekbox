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

console.log(fail === 0 ? "\n✅ bundle 契约完好" : `\n❌ ${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
