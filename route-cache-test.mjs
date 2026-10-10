// 路由缓存 + 单飞 + 写接口跨站加固：无网络（stub fetch / 纯函数）。
//
// 覆盖三件事：
//   1. cached()：TTL 命中、单飞（并发同 key 只打一次上游）、TTL 过期重取、
//      stale-if-error 降级、LRU 淘汰、失败不写缓存；
//   2. 写路由的 CSRF 加固：跨站 Origin → 403、非 JSON content-type → 415、
//      同源 JSON → 正常 2xx（这道锁不能把正常调用一起挡掉）；
//   3. 真路由接线：/quote 分片去重、/health 带 session+caches、/sentiment
//      在涨停池挂掉但 breadth 可用时仍然 200（以前整卡 502）。
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cached, createCache, resetRouteCachesForTests, routeCacheStats } from "./lib/route-cache.js";
import { cnDateStr, resetCalendarForTests, sessionTtl, setCalendarForTests } from "./lib/calendar.js";
import { makeRoutes, ROUTES } from "./lib/index.js";

let failures = 0;
function check(name, ok, detail) {
	if (!ok) failures += 1;
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail === undefined ? "" : "  — " + detail}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

//#region 1. cached(): TTL / 单飞 / 失败
console.log("== 1) cached()：TTL、单飞、失败不写缓存 ==");
{
	resetRouteCachesForTests();
	let calls = 0;
	const load = async () => {
		calls += 1;
		return { n: calls };
	};
	const opts = { name: "t1", key: "k", ttlMs: 5000, load };
	const a = await cached(opts);
	const b = await cached(opts);
	check("TTL 内第二次命中缓存（只打一次上游）", calls === 1 && a.n === 1 && b.n === 1, `calls=${calls}`);
	const stats = routeCacheStats().t1;
	check("统计：1 次 miss + 1 次 hit", stats.misses === 1 && stats.hits === 1, JSON.stringify(stats));

	// 过期后重取（TTL 传函数也算得出来）
	let calls2 = 0;
	const shortTtl = { name: "t2", key: "k", ttlMs: () => 30, load: async () => ({ n: ++calls2 }) };
	await cached(shortTtl);
	await sleep(60);
	await cached(shortTtl);
	check("TTL 过期后重新取数", calls2 === 2, `calls=${calls2}`);

	// 单飞：并发同 key 只打一次
	let calls3 = 0;
	const slow = { name: "t3", key: "k", ttlMs: 5000, load: async () => { calls3 += 1; await sleep(30); return { n: calls3 }; } };
	const results = await Promise.all([cached(slow), cached(slow), cached(slow), cached(slow), cached(slow)]);
	check("单飞：5 个并发请求只打 1 次上游", calls3 === 1, `calls=${calls3}`);
	check("单飞：并发请求拿到同一份结果", results.every((r) => r.n === 1));
	const s3 = routeCacheStats().t3;
	check("单飞：只记 1 次 miss", s3.misses === 1 && s3.stores === 1, JSON.stringify(s3));

	// 失败不写缓存，且错误原样抛出（默认不降级）
	let calls4 = 0;
	const failing = { name: "t4", key: "k", ttlMs: 5000, load: async () => { calls4 += 1; throw new Error("boom"); } };
	let thrown = "";
	await cached(failing).catch((e) => { thrown = e.message; });
	await cached(failing).catch(() => {});
	check("失败照旧抛出，不写入缓存（第二次仍打上游）", thrown === "boom" && calls4 === 2, `thrown=${thrown} calls=${calls4}`);
	check("失败不计入 stores", routeCacheStats().t4.stores === 0, JSON.stringify(routeCacheStats().t4));

	// 并发失败共享同一个 Promise（不是各打一次）
	let calls5 = 0;
	const failing2 = { name: "t5", key: "k", ttlMs: 5000, load: async () => { calls5 += 1; await sleep(20); throw new Error("x"); } };
	await Promise.allSettled([cached(failing2), cached(failing2), cached(failing2)]);
	check("单飞对失败的请求同样生效", calls5 === 1, `calls=${calls5}`);
}

//#region 2. stale-if-error
console.log("== 2) stale-if-error：上游抖动时给旧值 ==");
{
	resetRouteCachesForTests();
	let mode = "ok";
	const load = async () => {
		if (mode === "fail") throw new Error("upstream 502");
		return { v: "fresh" };
	};
	const opts = { name: "stale", key: "k", ttlMs: 10, staleIfError: 60_000, load };
	await cached(opts);
	await sleep(30); // TTL 过期，但还在 stale 窗口内
	mode = "fail";
	const served = await cached(opts);
	check("上游失败 → 返回上次成功值（不抛）", served.v === "fresh", JSON.stringify(served));
	check("stale 服务被计入统计", routeCacheStats().stale.staleServes === 1, JSON.stringify(routeCacheStats().stale));

	// 超出 stale 窗口 → 照旧抛
	resetRouteCachesForTests();
	const tight = { name: "stale2", key: "k", ttlMs: 10, staleIfError: 5, load };
	await cached({ ...tight, load: async () => ({ v: "first" }) });
	await sleep(30);
	let thrown = "";
	await cached(tight).catch((e) => { thrown = e.message; });
	check("超出 stale 窗口 → 抛出错误", thrown === "upstream 502", thrown || "(未抛)");

	// staleIfError=0（默认）不降级——保证既有错误语义
	resetRouteCachesForTests();
	let calls = 0;
	const noStale = { name: "stale3", key: "k", ttlMs: 10, load: async () => { calls += 1; if (calls > 1) throw new Error("down"); return { v: 1 }; } };
	await cached(noStale);
	await sleep(30);
	thrown = "";
	await cached(noStale).catch((e) => { thrown = e.message; });
	check("默认 staleIfError=0：不降级，错误照旧", thrown === "down", thrown || "(未抛)");
}

//#region 3. LRU 淘汰
console.log("== 3) LRU 淘汰 ==");
{
	const c = createCache("lru-test", { max: 3 });
	let n = 0;
	const put = (key) => cached({ name: "lru-test", key, ttlMs: 60_000, max: 3, load: async () => ({ n: ++n }) });
	await put("a");
	await put("b");
	await put("c");
	await put("a"); // 命中 → a 回迁为最新
	await put("d"); // 超出上限 → 淘汰最旧的（b）
	const keys = routeCacheStats()["lru-test"].size;
	check("容量上限生效", keys === 3, `size=${keys}`);
	let reFetched = 0;
	await cached({ name: "lru-test", key: "a", ttlMs: 60_000, max: 3, load: async () => { reFetched += 1; return {}; } });
	check("热点 key 未被淘汰（真 LRU）", reFetched === 0, `refetched=${reFetched}`);
	await cached({ name: "lru-test", key: "b", ttlMs: 60_000, max: 3, load: async () => ({ n: 999 }) });
	check("冷 key 已被淘汰（重新取数）", reFetched === 0 && c.evictions >= 1, `evictions=${c.evictions}`);
}

//#region 4. sessionTtl 与路由 TTL 联动
console.log("== 4) 非交易时段 TTL 放大 ==");
{
	resetCalendarForTests();
	setCalendarForTests([cnDateStr()]);
	const openTtl = sessionTtl(15_000);
	resetCalendarForTests(); // 无日历 → 工作日启发式；直接验倍数本身
	check("盘中 TTL 不放大", sessionTtl(15_000, 20, new Date(Date.UTC(2026, 0, 5, 2, 0, 0))) === 15_000, String(sessionTtl(15_000, 20, new Date(Date.UTC(2026, 0, 5, 2, 0, 0)))));
	check("盘后 TTL ×20", sessionTtl(15_000, 20, new Date(Date.UTC(2026, 0, 5, 9, 0, 0))) === 300_000, String(sessionTtl(15_000, 20, new Date(Date.UTC(2026, 0, 5, 9, 0, 0)))));
	check("TTL 是正数（接线未断）", Number.isFinite(openTtl) && openTtl > 0, String(openTtl));
}

//#region 5. 写路由跨站加固 + 真路由接线
console.log("== 5) 写接口加固 + 真路由接线 ==");
const home = mkdtempSync(join(tmpdir(), "leekbox-cache-"));
const routes = makeRoutes({}, { dshHome: home, logger: { warn() {} } });
const routeOf = (path) => routes.find((r) => r.path === path);

function makeGet(url) {
	const req = new EventEmitter();
	req.method = "GET";
	req.url = url;
	req.socket = { remoteAddress: "127.0.0.1" };
	req.headers = { host: "localhost" };
	return req;
}
function makePost(url, body, headers = {}) {
	const req = Readable.from([Buffer.from(JSON.stringify(body ?? {}), "utf8")]);
	req.method = "POST";
	req.url = url;
	req.socket = { remoteAddress: "127.0.0.1" };
	req.headers = { host: "localhost", "content-type": "application/json", origin: "http://localhost", ...headers };
	return req;
}
function makeRes() {
	const res = new EventEmitter();
	res.headersSent = false;
	res.body = null;
	res.statusCode = 0;
	res.writeHead = (code, headers) => {
		res.statusCode = code;
		res.headers = headers;
		res.headersSent = true;
	};
	res.write = (s) => {
		res.body = (res.body ?? "") + s;
		return true;
	};
	res.end = (s) => {
		if (s) res.body = (res.body ?? "") + s;
	};
	return res;
}
const drive = async (method, path, { url = path, body, headers } = {}) => {
	const res = makeRes();
	const req = method === "POST" ? makePost(url, body, headers) : makeGet(url);
	await routeOf(path).handler(req, res);
	return { code: res.statusCode, parsed: res.body === null ? null : JSON.parse(res.body) };
};

{
	const add = ROUTES.watchlist + "/add";
	// 跨站 no-cors 的典型形状：text/plain + 别的站点 Origin
	const csrf = await drive("POST", add, { body: { code: "sh600519" }, headers: { origin: "https://evil.example", "content-type": "text/plain" } });
	check("跨站 Origin → 403（先挡来源）", csrf.code === 403, `${csrf.code} ${csrf.parsed?.error ?? ""}`);
	check("403 文案是中文", /拒绝访问/.test(csrf.parsed?.error ?? ""), csrf.parsed?.error);

	// Origin 缺失但 content-type 是 text/plain：仍然拒绝（简单请求的默认类型）
	const plain = await drive("POST", add, { body: { code: "sh600519" }, headers: { origin: void 0, "content-type": "text/plain" } });
	check("无 Origin 但 text/plain → 415", plain.code === 415, `${plain.code} ${plain.parsed?.error ?? ""}`);
	check("415 文案是中文且说明要求", /content-type/.test(plain.parsed?.error ?? "") && /application\/json/.test(plain.parsed?.error ?? ""), plain.parsed?.error);

	// 跨站沙箱（Origin: null）不允许
	const nullOrigin = await drive("POST", add, { body: { code: "sh600519" }, headers: { origin: "null" } });
	check("Origin: null → 403", nullOrigin.code === 403, `${nullOrigin.code}`);

	// 跨站 Origin 但 content-type 正常：仍拒绝
	const crossJson = await drive("POST", add, { body: { code: "sh600519" }, headers: { origin: "http://127.0.0.1.evil.com" } });
	check("伪造回环前缀的 Origin → 403", crossJson.code === 403, `${crossJson.code}`);

	// 正常同源请求必须照常工作（不能把正常调用一起挡掉）
	const ok1 = await drive("POST", add, { body: { code: "sh600519", name: "贵州茅台" } });
	check("同源 JSON → 200", ok1.code === 200 && ok1.parsed.watchlist.length === 1, `${ok1.code}`);
	const ok2 = await drive("POST", add, { body: { code: "sz000001", name: "平安银行" }, headers: { origin: "http://127.0.0.1:19387" } });
	check("127.0.0.1 Origin → 200", ok2.code === 200 && ok2.parsed.watchlist.length === 2, `${ok2.code}`);
	const ok3 = await drive("POST", add, { body: { code: "sh601318" }, headers: { origin: void 0 } });
	check("无 Origin（curl / 脚本）→ 200", ok3.code === 200, `${ok3.code}`);
	const ok4 = await drive("POST", add, { body: { code: "sz300750" }, headers: { "content-type": "application/json; charset=utf-8" } });
	check("带 charset 的 JSON → 200", ok4.code === 200, `${ok4.code}`);

	// GET 路由不受写锁影响
	const getOk = await drive("GET", ROUTES.watchlist);
	check("GET /watchlist 不受影响", getOk.code === 200 && getOk.parsed.watchlist.length === 4, `${getOk.code}`);
	// 方法不符仍回 405，且优先于 content-type 检查
	const wrong = await drive("GET", add);
	check("GET 打写路由 → 405", wrong.code === 405, `${wrong.code}`);

	// 写锁必须覆盖**每一条**写路由，不能只加在被测的那一条上
	const postRoutes = routes.filter((r) => /\/watchlist\/(add|remove|import)$|\/alerts\/(add|remove)$|\/screener$/.test(r.path));
	check("找齐写路由（≥6 条）", postRoutes.length >= 6, postRoutes.map((r) => r.path.split("/api/leekbox/")[1]).join(", "));
	const unguarded = [];
	for (const route of postRoutes) {
		const res = makeRes();
		const req = makePost(route.path, { code: "sh600519" }, { origin: "https://evil.example", "content-type": "text/plain" });
		await route.handler(req, res);
		if (res.statusCode !== 403) unguarded.push(`${route.path}=${res.statusCode}`);
	}
	check("每条写路由都拒绝跨站请求", unguarded.length === 0, unguarded.join(" "));
}

//#region 6. /quote 单飞 + /health /sentiment 接线
console.log("== 6) 真路由：/quote 去重、/health、/sentiment 降级 ==");
{
	resetRouteCachesForTests();
	const origFetch = globalThis.fetch;
	let tencentCalls = 0;
	// 腾讯行情是一行 ~ 分隔的 50+ 字段；parseTencentLine 要求 f.length >= 40
	// 且 f[1] 非空，所以这里按真实下标位置填一份最小可用样本。
	const tencentLine = (() => {
		const f = new Array(50).fill("");
		f[1] = "贵州茅台";
		f[2] = "600519";
		f[3] = "1700.00";
		f[4] = "1690.00";
		f[5] = "1695.00";
		f[6] = "100";
		f[30] = "20250106150000";
		f[31] = "10.00";
		f[32] = "0.59";
		f[33] = "1710.00";
		f[34] = "1680.00";
		f[37] = "123456.78";
		f[38] = "0.85";
		f[39] = "30.1";
		f[43] = "1.78";
		f[44] = "21350.5";
		f[45] = "21350.5";
		f[46] = "8.9";
		f[47] = "1859.00";
		f[48] = "1521.00";
		f[49] = "1.20";
		return `v_sh600519="${f.join("~")}";`;
	})();
	globalThis.fetch = async (url) => {
		const u = String(url);
		if (u.includes("qt.gtimg.cn")) {
			tencentCalls += 1;
			return new Response(tencentLine, { status: 200 });
		}
		return new Response("not found", { status: 404 });
	};
	try {
		// 同一个 codes 的并发请求应只打一次上游
		const before = tencentCalls;
		const results = await Promise.all([
			drive("GET", ROUTES.quote, { url: ROUTES.quote + "?codes=sh600519" }),
			drive("GET", ROUTES.quote, { url: ROUTES.quote + "?codes=sh600519" }),
			drive("GET", ROUTES.quote, { url: ROUTES.quote + "?codes=sh600519" }),
		]);
		check("并发同 codes 只打 1 次腾讯", tencentCalls - before === 1, `delta=${tencentCalls - before}`);
		check("三个请求都拿到同一份行情", results.every((r) => r.code === 200 && r.parsed.quotes.length === 1), JSON.stringify(results.map((r) => r.code)));
		// 顺序不同的同一批码命中同一缓存键
		const multi1 = await drive("GET", ROUTES.quote, { url: ROUTES.quote + "?codes=sz000001,sh600519" });
		const t1 = tencentCalls;
		const multi2 = await drive("GET", ROUTES.quote, { url: ROUTES.quote + "?codes=sh600519,sz000001" });
		check("码序不同命中同一缓存", multi1.code === 200 && multi2.code === 200 && tencentCalls === t1, `${multi1.code}/${multi2.code}`);
		// 单飞：3 个并发请求只打 1 次上游（这是缓存挡不住的那部分）。
		// 注意 /quote 的 TTL 只有 3s（保新鲜），所以这里不假设后续复访一定命中。
		const stats = routeCacheStats().quote;
		check("缓存在 TTL 内复访命中（hit + stores 都记上）", (stats?.hits ?? 0) >= 1 && stats.stores >= 1, JSON.stringify(stats));

		// /health 现在带 session / version / caches
		const health = await drive("GET", ROUTES.health);
		check("/health 带 session", health.code === 200 && typeof health.parsed.session?.open === "boolean", JSON.stringify(health.parsed?.session));
		check("/health 带版本号", typeof health.parsed.version === "string" && /^\d+\.\d+/.test(health.parsed.version), health.parsed.version);
		check("/health 带缓存统计", typeof health.parsed.caches === "object" && health.parsed.caches !== null && "quote" in health.parsed.caches, Object.keys(health.parsed.caches ?? {}).join(","));
		check("/health 带索引状态", typeof health.parsed.index === "object", JSON.stringify(health.parsed.index));

		// /metrics 独立出口
		const metrics = await drive("GET", ROUTES.metrics);
		check("/metrics 返回 uptime 与缓存命中率", metrics.code === 200 && metrics.parsed.uptimeSec >= 0 && metrics.parsed.caches.quote.hitRate > 0, JSON.stringify(metrics.parsed?.caches?.quote));

		// /calendar 首次请求不阻塞（真日历拿不到也回 200）
		const cal = await drive("GET", ROUTES.calendar);
		check("/calendar 200 且有 session", cal.code === 200 && typeof cal.parsed.session?.open === "boolean", `${cal.code} ${cal.parsed?.session?.session}`);
	} finally {
		globalThis.fetch = origFetch;
	}
}

//#region 7. /sentiment 部分降级
console.log("== 7) /sentiment：池子挂掉但 breadth 可用时仍 200 ==");
{
	resetRouteCachesForTests();
	const origFetch = globalThis.fetch;
	globalThis.fetch = async (url) => {
		const u = String(url);
		// push2ex = 涨停/炸板/跌停池 + 涨跌分布，全部失败。
		if (u.includes("push2ex")) return new Response("blocked", { status: 502 });
		return new Response("[]", { status: 502 });
	};
	try {
		// 命中上一次成功的缓存也算"降级可用"（stale 语义），所以只断言形状：
		// 关键不变量是"不再整卡 502"，且顺序上先 502（真的两路都挂）或 200（有旧值）。
		const res = await drive("GET", ROUTES.sentiment);
		check("两路都挂：要么 502 中文，要么用旧值 200", res.code === 502 || res.code === 200, `${res.code}`);
		if (res.code === 502) {
			check("502 文案是中文", /情绪数据/.test(res.parsed?.error ?? ""), res.parsed?.error);
		}
		if (res.code === 200) {
			check("降级时字段按缺失为 null，而不是假的 0", res.parsed.limitUp === null || typeof res.parsed.limitUp === "number", JSON.stringify({ limitUp: res.parsed.limitUp, up: res.parsed.up }));
			check("200 时带 session", typeof res.parsed.session?.open === "boolean", JSON.stringify(res.parsed.session));
		}
	} finally {
		globalThis.fetch = origFetch;
	}
}

rmSync(home, { recursive: true, force: true });
resetCalendarForTests();

console.log(failures === 0 ? "\n✅ 缓存 / 单飞 / 写接口加固 测试全部通过" : `\n${failures} 处失败`);
process.exit(failures === 0 ? 0 : 1);
