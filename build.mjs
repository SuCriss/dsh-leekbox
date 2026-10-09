// 韭菜盒子 LeekBox — client bundle build (esbuild).
//
//   npm run build   一次性构建 → lib/client.js
//   npm run dev     watch 模式，改 src/client/* 自动重建
//
// 产物是 DSH web 客户端插件：外层用 window.__ModuleLoader__.load() 包装，
// react / react-dom/client 标为 external，由 factory(require) 在运行时注入——
// 宿主 GUI 自带 React，打包进去会出双 React 事故。
import { build, context } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

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

/** @type {import("esbuild").BuildOptions} */
const options = {
	entryPoints: ["src/client/entry.js"],
	bundle: true,
	format: "cjs",
	platform: "browser",
	external: ["react", "react-dom/client"],
	banner: { js: banner },
	footer: { js: footer },
	outfile: "lib/client.js",
	logLevel: "info",
	// 产物要进仓库 + 被测试按标记抽源码跑断言，保持可读、不压缩。
	minify: false,
	// utf8：中文按原样输出（默认 ascii 会转义成 \uXXXX，测试的文案断言会瞎）。
	// esnext：保留 const/let（默认会降级成 var，抽源码的标记锚点会漂）。
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
