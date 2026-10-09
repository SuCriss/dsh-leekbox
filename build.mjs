// 韭菜盒子 LeekBox — client bundle build (esbuild).
//
//   npm run build   一次性构建 → lib/client.js
//   npm run dev     watch 模式，改 src/client/* 自动重建
//
// 产物是 DSH web 客户端插件：外层用 window.__ModuleLoader__.load() 包装，
// react / react-dom/client 标为 external，由 factory(require) 在运行时注入——
// 宿主 GUI 自带 React，打包进去会出双 React 事故。
import { build, context } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const OUTFILE = "lib/client.js";

const banner = `// 韭菜盒子 LeekBox — browser half. v${pkg.version}
//
// GENERATED FILE — 由 build.mjs 从 src/client/* 打包生成，请勿手改。
// 改代码去 src/client/，然后 npm run build。
window.__ModuleLoader__.load({
	id: "dsh-leekbox",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
`;

const footer = `		return module.exports;
	},
});
`;

// esbuild 0.28.2 的跨平台差异：把 ESM 打成 CJS 时，win32 原生二进制会在生成代码
// 开头补一行 "use strict";，linux 不补（输入、options、metafile 里的 input format
// 两边完全一致，实测差 14 字节）。产物是要提交进仓库的，CI 会用「重建后 git diff
// 是否为空」判断产物有没有过期，这行差异会让 ubuntu 上的检查永远红。
//
// 剥掉它在语义上是安全的：这行落在 banner 的 var module / var exports 之后，
// 已经不在函数体的指令序言位置，只是个没有作用的字符串表达式；拆分前手写的
// lib/client.js 里同样没有它。统一不带 → 任何平台构建都逐字节一致。
const INERT_USE_STRICT = /^"use strict";\r?\n/;

/** esbuild 只负责生成代码，banner/footer 由这里合成后落盘（write:false）。 */
const emitPlugin = {
	name: "leekbox-emit",
	setup(b) {
		b.onEnd((result) => {
			if (result.errors.length > 0) return;
			const out = result.outputFiles?.[0];
			if (out === undefined) return;
			const text = banner + out.text.replace(INERT_USE_STRICT, "") + footer;
			writeFileSync(OUTFILE, text);
			console.log(`[leekbox] ${OUTFILE} ${(Buffer.byteLength(text) / 1024).toFixed(1)}kb`);
		});
	},
};

/** @type {import("esbuild").BuildOptions} */
const options = {
	entryPoints: ["src/client/entry.js"],
	bundle: true,
	format: "cjs",
	platform: "browser",
	external: ["react", "react-dom/client"],
	outfile: OUTFILE,
	write: false,
	plugins: [emitPlugin],
	logLevel: "info",
	// 产物要进仓库 + 被测试按标记抽源码跑断言，保持可读、不压缩。
	minify: false,
	// utf8：中文按原样输出（默认 ascii 会转义成 \uXXXX，测试的文案断言会瞎）。
	// esnext：不做语法降级（默认会按 esnext 以下目标改写，产物没必要变胖）。
	charset: "utf8",
	target: "esnext",
	// 注意：cjs 格式下模块顶层的 const/let 一律输出为 var（live-binding 需要），
	// 且非 legal 注释会被剥离。抽产物源码的测试锚点必须写成与 const/var 无关、
	// 与注释无关的形式（见 *-test.mjs 里的 "bundle 锚点" 注释）。
};

if (process.argv.includes("--watch")) {
	const ctx = await context(options);
	await ctx.watch();
	console.log("[leekbox] watching src/client/* → lib/client.js");
} else {
	await build(options);
}
