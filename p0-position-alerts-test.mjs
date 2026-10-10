// P0: 持仓成本与盈亏 + 价格预警. Drives the REAL registered handlers
// (lib/index.js makeRoutes) with mock loopback req/res and a real temp
// dshHome, asserting:
//   1. watchlist add stores / updates / clears qty & cost, 400 on invalid;
//   2. export CSV carries qty/cost columns, import parses them back;
//   3. alerts add / dedupe / remove with full validation (kind/price/pct/code/index);
//   4. health reports both counters; non-loopback POSTs are rejected 403.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeRoutes, ROUTES } from "./lib/index.js";

// ---- real temp home (watchlist/alerts use real file I/O) ----
const home = mkdtempSync(join(tmpdir(), "leekbox-p0-"));

const routes = makeRoutes({}, { dshHome: home, logger: { warn() {} } });
const watchAdd = routes.find((r) => r.path === ROUTES.watchlist + "/add");
const watchExport = routes.find((r) => r.path === ROUTES.watchlist + "/export");
const watchImport = routes.find((r) => r.path === ROUTES.watchlist + "/import");
const alertsList = routes.find((r) => r.path === ROUTES.alerts);
const alertsAdd = routes.find((r) => r.path === ROUTES.alerts + "/add");
const alertsRemove = routes.find((r) => r.path === ROUTES.alerts + "/remove");
const health = routes.find((r) => r.path === ROUTES.health);
for (const [name, route] of Object.entries({ watchAdd, watchExport, watchImport, alertsList, alertsAdd, alertsRemove, health })) {
	assert.ok(route, `${name} route must be registered`);
}

// ---- mock req/res (loopback trust fence satisfied) ----
function makeGet(url) {
	const req = new EventEmitter();
	req.method = "GET";
	req.url = url;
	req.socket = { remoteAddress: "127.0.0.1" };
	req.headers = { host: "localhost" };
	return req;
}
function makePost(url, body) {
	const req = Readable.from([Buffer.from(JSON.stringify(body ?? {}), "utf8")]);
	req.method = "POST";
	req.url = url;
	req.socket = { remoteAddress: "127.0.0.1" };
	// 写路由要求 application/json + 同源 Origin（见 lib/index.js 的 guard）。
	req.headers = { host: "localhost", "content-type": "application/json", origin: "http://localhost" };
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
const json = (res) => JSON.parse(res.body);

console.log("== 1) watchlist qty/cost: store / update / clear / validate ==");
let res = makeRes();
await watchAdd.handler(makePost(ROUTES.watchlist + "/add", { code: "sh600519", name: "贵州茅台", qty: 1000, cost: 1234.56 }), res);
assert.strictEqual(res.statusCode, 200, "add with position must be 200");
let entry = json(res).watchlist.find((e) => e.code === "sh600519");
assert.strictEqual(entry.qty, 1000, "qty must be stored");
assert.strictEqual(entry.cost, 1234.56, "cost must be stored");

res = makeRes();
await watchAdd.handler(makePost(ROUTES.watchlist + "/add", { code: "sh600519", qty: 1500 }), res);
entry = json(res).watchlist.find((e) => e.code === "sh600519");
assert.strictEqual(entry.qty, 1500, "existing qty must update");
assert.strictEqual(entry.cost, 1234.56, "existing cost must be kept when omitted");

res = makeRes();
await watchAdd.handler(makePost(ROUTES.watchlist + "/add", { code: "sh600519", qty: "abc" }), res);
assert.strictEqual(res.statusCode, 400, "non-numeric qty must be 400");
assert.match(json(res).error, /持仓数量无效/, "invalid qty message must be Chinese");

res = makeRes();
await watchAdd.handler(makePost(ROUTES.watchlist + "/add", { code: "sh600519", cost: -1 }), res);
assert.strictEqual(res.statusCode, 400, "negative cost must be 400");
assert.match(json(res).error, /成本价无效/, "invalid cost message must be Chinese");

res = makeRes();
await watchAdd.handler(makePost(ROUTES.watchlist + "/add", { code: "sh600519", qty: null }), res);
entry = json(res).watchlist.find((e) => e.code === "sh600519");
assert.strictEqual(entry.qty, undefined, "qty: null must clear the stored qty");
assert.strictEqual(entry.cost, 1234.56, "cost must survive a qty clear");

console.log("== 2) export CSV carries qty/cost; import parses them back ==");
res = makeRes();
await watchAdd.handler(makePost(ROUTES.watchlist + "/add", { code: "sh600519", qty: 800, cost: 1500 }), res);

res = makeRes();
await watchExport.handler(makeGet(ROUTES.watchlist + "/export?format=csv"), res);
assert.strictEqual(res.statusCode, 200);
assert.ok(res.body.includes("code,name,group,qty,cost,addedAt"), "CSV header must include qty/cost");
assert.ok(res.body.includes('"sh600519","贵州茅台","默认","800","1500"'), "CSV row must carry qty/cost");

res = makeRes();
await watchImport.handler(makePost(ROUTES.watchlist + "/import", { content: "code,name,group,qty,cost\nsz000001,平安银行,长线,500,10.5" }), res);
assert.strictEqual(res.statusCode, 200);
let imp = json(res);
assert.strictEqual(imp.added, 1, "CSV import must add 1");
entry = imp.watchlist.find((e) => e.code === "sz000001");
assert.strictEqual(entry.qty, 500, "imported qty must parse");
assert.strictEqual(entry.cost, 10.5, "imported cost must parse");

res = makeRes();
await watchImport.handler(
	makePost(ROUTES.watchlist + "/import", { content: JSON.stringify([{ code: "600036", name: "招商银行", qty: 2000, cost: 33.3 }]) }),
	res
);
imp = json(res);
entry = imp.watchlist.find((e) => e.code === "sh600036");
assert.strictEqual(entry.qty, 2000, "JSON-imported qty must parse (and code normalize)");
assert.strictEqual(entry.cost, 33.3, "JSON-imported cost must parse");

res = makeRes();
await watchImport.handler(makePost(ROUTES.watchlist + "/import", { content: "sh601318,中国平安,观察,abc,9.9" }), res);
imp = json(res);
entry = imp.watchlist.find((e) => e.code === "sh601318");
assert.ok(entry, "a bad qty must not reject the whole stock");
assert.strictEqual(entry.qty, undefined, "bad qty must be dropped");
assert.strictEqual(entry.cost, 9.9, "good cost must still parse");

console.log("== 3) alerts: add / dedupe / validate / remove ==");
res = makeRes();
await alertsList.handler(makeGet(ROUTES.alerts), res);
assert.strictEqual(res.statusCode, 200);
assert.deepStrictEqual(json(res).alerts, [], "alerts must start empty");

res = makeRes();
await alertsAdd.handler(makePost(ROUTES.alerts + "/add", { code: "sh600519", name: "贵州茅台", kind: "above", price: 1800 }), res);
assert.strictEqual(res.statusCode, 200, "price alert add must be 200");
let alert = json(res).alerts[0];
assert.strictEqual(alert.kind, "above");
assert.strictEqual(alert.price, 1800);
assert.ok(alert.id, "alert must carry an id");
assert.strictEqual(alert.name, "贵州茅台");

res = makeRes();
await alertsAdd.handler(makePost(ROUTES.alerts + "/add", { code: "sh600519", kind: "above", price: 1800 }), res);
assert.strictEqual(res.statusCode, 400, "duplicate alert must be 400");
assert.match(json(res).error, /相同的预警已存在/);

res = makeRes();
await alertsAdd.handler(makePost(ROUTES.alerts + "/add", { code: "sh600519", kind: "nope", price: 1 }), res);
assert.strictEqual(res.statusCode, 400, "unknown kind must be 400");
assert.match(json(res).error, /预警类型无效/);

res = makeRes();
await alertsAdd.handler(makePost(ROUTES.alerts + "/add", { code: "xyz", kind: "above", price: 1 }), res);
assert.strictEqual(res.statusCode, 400, "unrecognized code must be 400");
assert.match(json(res).error, /股票代码无法识别/);

res = makeRes();
await alertsAdd.handler(makePost(ROUTES.alerts + "/add", { code: "sh000001", kind: "above", price: 1 }), res);
assert.strictEqual(res.statusCode, 400, "index code must be rejected");
assert.match(json(res).error, /指数不支持预警/);

res = makeRes();
await alertsAdd.handler(makePost(ROUTES.alerts + "/add", { code: "sh600519", kind: "above" }), res);
assert.strictEqual(res.statusCode, 400, "above without price must be 400");
assert.match(json(res).error, /目标价无效/);

res = makeRes();
await alertsAdd.handler(makePost(ROUTES.alerts + "/add", { code: "sh600519", kind: "pctUp" }), res);
assert.strictEqual(res.statusCode, 400, "pctUp without pct must be 400");
assert.match(json(res).error, /涨跌幅阈值无效/);

res = makeRes();
await alertsAdd.handler(makePost(ROUTES.alerts + "/add", { code: "sh600519", kind: "pctUp", pct: 99 }), res);
assert.strictEqual(res.statusCode, 400, "pct beyond 30 must be 400");

res = makeRes();
await alertsAdd.handler(makePost(ROUTES.alerts + "/add", { code: "sz000001", name: "平安银行", kind: "pctDown", pct: 5 }), res);
assert.strictEqual(res.statusCode, 200, "pctDown with positive magnitude must be 200");
alert = json(res).alerts.find((a) => a.kind === "pctDown");
assert.strictEqual(alert.pct, 5);

res = makeRes();
await alertsRemove.handler(makePost(ROUTES.alerts + "/remove", { id: alert.id }), res);
assert.strictEqual(res.statusCode, 200);
assert.strictEqual(json(res).alerts.length, 1, "remove must drop exactly the one alert");

res = makeRes();
await alertsRemove.handler(makePost(ROUTES.alerts + "/remove", { id: "gone" }), res);
assert.strictEqual(res.statusCode, 200, "removing an unknown id is a no-op 200");

console.log("== 4) health reports both counters ==");
res = makeRes();
await health.handler(makeGet(ROUTES.health), res);
const h = json(res);
assert.strictEqual(h.ok, true);
assert.strictEqual(h.alerts, 1, "health must report the alert count");
assert.ok(h.watchlist >= 4, "health must report the watchlist count");

console.log("== 5) guard: non-loopback POSTs rejected 403 ==");
const badReq = makePost(ROUTES.alerts + "/add", { code: "sh600519", kind: "above", price: 1 });
badReq.socket = { remoteAddress: "8.8.8.8" };
const badRes = makeRes();
await alertsAdd.handler(badReq, badRes);
assert.strictEqual(badRes.statusCode, 403, "non-loopback alert add must be 403");

console.log("== 6) write lock: concurrent adds all land ==");
// 20 个并发 add(不同代码):写锁串行化读-改-写,断言 20 条全部落盘且每个
// 响应都反映自己的新增——若将来有人在 mutation 里引入 await 又没走锁,
// 这里的不变量会先红。
const concurrent = Array.from({ length: 20 }, (_, i) => {
	const res2 = makeRes();
	return watchAdd
		.handler(makePost(ROUTES.watchlist + "/add", { code: `sz0001${String(i).padStart(2, "0")}`.slice(0, 8), name: `并发${i}` }), res2)
		.then(() => ({ status: res2.statusCode, body: json(res2) }));
});
const results = await Promise.all(concurrent);
assert.ok(results.every((r) => r.status === 200), `every concurrent add must be 200: ${results.map((r) => r.status).join(",")}`);
const finalList = results[results.length - 1].body.watchlist;
const concurrentCodes = results.map((r) => r.body.watchlist.find((e) => e.name.startsWith("并发"))?.code);
assert.strictEqual(finalList.length, 4 + 20, "final list must contain every concurrent addition (4 earlier + 20 new)");
for (const code of concurrentCodes) {
	assert.ok(code !== undefined && finalList.some((e) => e.code === code), `concurrent addition ${code} must survive in the final list`);
}

rmSync(home, { recursive: true, force: true });
console.log("\n✅ P0 TEST PASSED: position fields + alerts routes work end to end");
process.exit(0);
