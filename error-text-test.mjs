// 报错文案必须是中文 —— 回归测试（静态扫描 + 行为断言，无网络）。
//
// 背景：客户端把响应体里的 error 字段原样渲染到红色错误条上（见 lib/client.js
// 的 api()），所以任何英文文案都会直接糊到用户脸上。约定见 lib/fetch-utils.js
// 的 feedError / userMessage：message 是给用户看的中文，detail 是只进日志的技术细节。
//
// 这个测试从两端卡住这条约定：
//   1. 静态扫描服务端所有 4xx/5xx 响应的 error 字段，必须是中文（或走了 userMessage 兜底）；
//   2. 抽取客户端真实的 describeError 源码（不是手抄副本）跑行为断言，含"输出里不许有纯英文"。
import { readFileSync } from "node:fs";
import { userMessage, feedError, errorDetail } from "./lib/fetch-utils.js";

const read = (p) => readFileSync(new URL(`./${p}`, import.meta.url), "utf8");
const CJK = /[\u4e00-\u9fa5]/;

let fail = 0;
const check = (name, ok, note = "") => {
	if (!ok) fail++;
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${note === "" ? "" : `  — ${note}`}`);
};

//#region 1. 服务端：4xx/5xx 响应的 error 字段
console.log("\n— 服务端 error 字段 —");
const serverFiles = ["index.js", "emrank.js", "screener.js", "search-index.js", "sinarank.js", "fetch-utils.js"];
let scanned = 0;
for (const file of serverFiles) {
	const src = read(`lib/${file}`);
	// 只取 writeJson(res, 4xx|5xx, { ... }) 的对象体（可能跨行）。
	const re = /writeJson\(res,\s*([45]\d\d),\s*\{([\s\S]{0,400}?)\}\s*\)/g;
	let m;
	while ((m = re.exec(src)) !== null) {
		scanned++;
		const line = src.slice(0, m.index).split("\n").length;
		const body = m[2];
		const at = body.indexOf("error:");
		if (at < 0) {
			check(`lib/${file}:${line} error 字段是中文`, false, "对象里没有 error 字段");
			continue;
		}
		const value = body.slice(at + "error:".length).trim();
		// 动态拼接的（userMessage(...)）由它自己的兜底保证中文，这里跳过。
		if (value.startsWith("userMessage(")) continue;
		check(`lib/${file}:${line} error 字段是中文`, CJK.test(value), value.slice(0, 48));
	}
}
check(`扫到 4xx/5xx error 字段（${scanned} 处）`, scanned >= 15, `scanned=${scanned}`);

// 浏览器出口必须过 userMessage —— 漏翻的英文在这里被换成通用中文。
const indexSrc = read("lib/index.js");
check("fail() 出口过 userMessage", /error:\s*userMessage\(error\)/.test(indexSrc));
check("fail() 把技术细节留在 reason", /reason:\s*errorDetail\(error\)/.test(indexSrc));
check("/rank 出口过 userMessage", /error:\s*userMessage\(error\),\s*reason:/.test(indexSrc));

//#endregion

//#region 2. 服务端：能透到浏览器的 throw 必须是中文
console.log("\n— 服务端 throw 文案 —");
// sinarank.js 的英文异常是**内部诊断**：emrank 的 fetchEmRankPage/fetchEmSectorPage
// 会把它们塞进 detail（只进日志），不会成为 error 字段，所以不在扫描范围。
const throwFiles = ["index.js", "emrank.js", "screener.js", "search-index.js"];
for (const file of throwFiles) {
	const src = read(`lib/${file}`);
	const bad = [];
	const re = /new Error\(\s*(["'`])([^"'`]*)\1/g;
	let m;
	while ((m = re.exec(src)) !== null) {
		if (!CJK.test(m[2])) bad.push(m[2].slice(0, 40));
	}
	check(`lib/${file} 无英文 throw`, bad.length === 0, bad.join(" | "));
}

//#endregion

//#region 3. 客户端：describeError 行为
console.log("\n— 客户端 describeError —");
const clientSrc = read("lib/client.js");
const start = clientSrc.indexOf("const ERR_FALLBACK");
const end = clientSrc.indexOf("async function api(", start);
if (start < 0 || end <= start) throw new Error("client.js markers not found");
// 跑的是文件里真实的那份源码，不是手抄副本。
const { describeError } = new Function(`${clientSrc.slice(start, end)}\nreturn { describeError };`)();

const clientCases = [
	// [说明, 输入, 期望输出]
	["服务端中文原样透出", new Error("榜单数据暂时取不到（主源与备用源都不可用，请稍后重试）"), "榜单数据暂时取不到（主源与备用源都不可用，请稍后重试）"],
	["断网 Failed to fetch", new TypeError("Failed to fetch"), "网络连接失败，请检查网络后重试"],
	["Firefox 网络错误", new Error("NetworkError when attempting to fetch resource."), "网络连接失败，请检查网络后重试"],
	["Safari Load failed", new TypeError("Load failed"), "网络连接失败，请检查网络后重试"],
	["Node fetch failed", new TypeError("fetch failed"), "网络连接失败，请检查网络后重试"],
	["超时中止", new Error("The operation was aborted."), "请求超时，请稍后重试"],
	["AbortError", new Error("signal is aborted without reason"), "请求超时，请稍后重试"],
	["裸 HTTP 状态码", new Error("HTTP 502"), "服务返回异常（HTTP 502）"],
	["HTTP 404", new Error("HTTP 404"), "服务返回异常（HTTP 404）"],
	["空 message", new Error(""), "数据获取失败，请稍后重试"],
	["非 Error 入参", "boom", "数据获取失败，请稍后重试"],
	["undefined 入参", undefined, "数据获取失败，请稍后重试"],
	["自定义兜底文案", new Error("weird upstream text"), "网络连接失败，请检查网络后重试"],
	["漏翻的英文 → 通用中文", new Error("TypeError: x is not a function"), "数据获取失败，请稍后重试"],
];
for (const [name, input, want] of clientCases) {
	const got = name === "自定义兜底文案"
		? describeError(input, "网络连接失败，请检查网络后重试")
		: describeError(input);
	check(`describeError: ${name}`, got === want, got);
}

// 最硬的一条：任何输出都不许是纯英文。
const englishPool = [
	"Failed to fetch",
	"NetworkError when attempting to fetch resource.",
	"The operation was aborted.",
	"HTTP 500",
	"TypeError: Cannot read properties of undefined",
	"ECONNRESET",
	"Internal Server Error",
	"",
];
for (const raw of englishPool) {
	const out = describeError(new Error(raw));
	check(`输出无纯英文: "${raw.slice(0, 34)}"`, CJK.test(out), out);
}

// 展示点必须都过 describeError —— 漏一个就会把英文透到界面上。
const leaks = [];
const leakRe = /set(Error|KError)\(e\.message\)/g;
let lm;
while ((lm = leakRe.exec(clientSrc)) !== null) leaks.push(lm[0]);
check("无 setError(e.message) 直通", leaks.length === 0, leaks.join(", "));
const describeUses = (clientSrc.match(/describeError\(/g) ?? []).length;
check(`describeError 调用点 ≥ 10（实测 ${describeUses}）`, describeUses >= 10);
check("api() 兜住 fetch 自身失败", /catch \(e\) \{[\s\S]{0,200}?describeError\(e, "网络连接失败/.test(clientSrc));

//#endregion

//#region 4. 服务端 userMessage / feedError 行为
console.log("\n— 服务端 userMessage —");
check("中文原样透出", userMessage(new Error("行情接口正在限流冷却，请稍后重试")) === "行情接口正在限流冷却，请稍后重试");
check("英文换兜底", userMessage(new Error("rank feed unavailable")) === "数据获取失败，请稍后重试");
check("自定义兜底", userMessage(new Error("boom"), "稍后再试") === "稍后再试");
check("非 Error 入参", userMessage(undefined) === "数据获取失败，请稍后重试");
check("字符串入参", userMessage("上游挂了") === "上游挂了");

const wrapped = feedError("K线数据暂时取不到（东财接口不可用）", "em daily kline: every host failed");
check("feedError: message 是中文", CJK.test(wrapped.message));
check("feedError: detail 保留技术细节", errorDetail(wrapped) === "em daily kline: every host failed");
check("feedError: 无 detail 时为空串", errorDetail(feedError("取不到")) === "");
check("errorDetail: 非 feedError 返回空串", errorDetail(new Error("x")) === "");

//#endregion

//#region 5. 端到端：上游整体挂掉时，路由返回的 error 必须是中文
console.log("\n— 端到端：/api/leekbox/* 上游全挂 —");
{
	const os = await import("node:os");
	const idx = await import("./lib/index.js");
	const routes = idx.makeRoutes({}, { dshHome: os.tmpdir(), logger: { warn() { } } });
	const origFetch = globalThis.fetch;
	// 所有上游一律 502：把每条路由逼到失败分支上。
	globalThis.fetch = async () => new Response("bad gateway", { status: 502 });
	const drive = async (path, url, method = "GET", body) => {
		const route = routes.find((r) => r.path === path);
		if (route === undefined) return { code: null, parsed: null, missing: true };
		const res = { code: null, body: null, writeHead(c) { this.code = c; }, end(b) { this.body = b; } };
		const req = {
			method,
			url,
			headers: { host: "127.0.0.1:1" },
			socket: { remoteAddress: "127.0.0.1" },
			async *[Symbol.asyncIterator]() {
				if (body !== undefined) yield Buffer.from(JSON.stringify(body));
			},
		};
		await route.handler(req, res);
		let parsed = null;
		try {
			parsed = JSON.parse(res.body);
		} catch {
			parsed = null;
		}
		return { code: res.code, parsed };
	};
	const cases = [
		["/quote", "/api/leekbox/quote", "GET"],
		["/indices", "/api/leekbox/indices", "GET"],
		["/kline", "/api/leekbox/kline?code=sh600519&period=day", "GET"],
		["/kline (bad code)", "/api/leekbox/kline?code=zzz", "GET"],
		["/minute", "/api/leekbox/minute?code=sh600519", "GET"],
		["/rank", "/api/leekbox/rank?node=hs_a&sort=changepercent", "GET"],
		["/rank (cb pool)", "/api/leekbox/rank?node=cb", "GET"],
		["/sector", "/api/leekbox/sector?type=industry", "GET"],
		["/longhu", "/api/leekbox/longhu", "GET"],
		["/news", "/api/leekbox/news", "GET"],
		["/watchlist/add (bad code)", "/api/leekbox/watchlist/add", "POST", { code: "zzz" }],
		["/watchlist/add (no body)", "/api/leekbox/watchlist/add", "POST", {}],
		["/watchlist/remove (no body)", "/api/leekbox/watchlist/remove", "POST", {}],
		["/watchlist/import (no body)", "/api/leekbox/watchlist/import", "POST", {}],
		["/screener (bad params)", "/api/leekbox/screener", "POST", { require: ["nope"] }],
	];
	try {
		let checked = 0;
		const skipped = [];
		for (const [name, url, method, body] of cases) {
			const path = url.split("?")[0];
			const { code, parsed, missing } = await drive(path, url, method, body);
			if (missing) {
				check(`${name} 路由存在`, false, "makeRoutes 里找不到该路径");
				continue;
			}
			const err = parsed?.error;
			if (typeof err !== "string") {
				// 没有 error 字段 = 走了"静默降级"（200 + 空数据）。这不在本次
				// 修复范围内（属于"不报错"而不是"报英文错"），单独列出来备查。
				console.log(`NOTE  ${name} 静默降级：HTTP ${code}，响应里没有 error 字段`);
				skipped.push(name);
				continue;
			}
			checked++;
			// 中文 + 没有英文报错措辞。参数名（codes/code/kw/content）是拉丁字母，
			// 不能一刀切禁掉，所以按"英文报错词"黑名单判。
			const english = /\b(unavailable|failed|failure|error|invalid|expected|malformed|timeout|forbidden|refused|denied|not found|unsupported|unknown)\b/i.test(err);
			check(`${name} 报错是中文`, CJK.test(err) && !english, `HTTP ${code} "${err}"`);
		}
		check(`至少覆盖 10 条路由的失败分支（实测 ${checked}）`, checked >= 10, `checked=${checked}`);
		if (skipped.length > 0) console.log(`     静默降级的路由：${skipped.join(", ")}`);
	} finally {
		globalThis.fetch = origFetch;
	}
}

//#endregion

console.log(`\n${fail === 0 ? "全部通过" : `${fail} 项失败`}`);
process.exit(fail === 0 ? 0 : 1);
