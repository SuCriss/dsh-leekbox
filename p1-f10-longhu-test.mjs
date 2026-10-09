// P1: F10 财务摘要 + 龙虎榜数据契约测试. Stubs the upstream datacenter feeds
// and drives the REAL fetchEmF10Main (lib/emrank.js) and the registered
// f10/longhu route handlers, asserting:
//   1. the F10 parser field mapping stays aligned with the live API shape
//      (verified against datacenter.eastmoney.com 2026-10);
//   2. /f10 caches per code (second call must not re-fetch);
//   3. /longhu maps the billboard row shape and finds today's data first try.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { makeRoutes, ROUTES } from "./lib/index.js";
import { fetchEmF10Main } from "./lib/emrank.js";

let f10Calls = 0;
let f10Url = "";
globalThis.fetch = async (url) => {
	const u = String(url);
	const jsonHeaders = { status: 200, headers: { "content-type": "application/json" } };
	if (u.includes("RPT_F10_FINANCE_MAINFINADATA")) {
		f10Calls += 1;
		f10Url = u;
		return new Response(
			JSON.stringify({
				result: {
					data: [
						{
							REPORT_DATE_NAME: "2026中报", REPORT_TYPE: "中报", NOTICE_DATE: "2026-08-15 00:00:00",
							EPSJB: 35.57, TOTALOPERATEREVE: 92278072083.21, TOTALOPERATEREVETZ: 1.30,
							PARENTNETPROFIT: 44516880421.86, PARENTNETPROFITTZ: -1.95, KCFJCXSYJLR: 44464207646.01,
							ROEJQ: 16.75, XSMLL: 89.55, XSJLL: 50.75, ZCFZL: 15.19,
						},
						{
							REPORT_DATE_NAME: "2026一季报", REPORT_TYPE: "一季报", NOTICE_DATE: "2026-04-25 00:00:00",
							EPSJB: 21.76, TOTALOPERATEREVE: 54702912385.23, TOTALOPERATEREVETZ: 6.34,
							PARENTNETPROFIT: 27242512886.45, PARENTNETPROFITTZ: 1.47, KCFJCXSYJLR: 27239985194.41,
							ROEJQ: 10.57, XSMLL: 89.76, XSJLL: 52.22, ZCFZL: 12.12,
						},
					],
				},
			}),
			jsonHeaders
		);
	}
	if (u.includes("RPT_DAILYBILLBOARD_DETAILSNEW")) {
		return new Response(
			JSON.stringify({
				result: {
					count: 1,
					data: [
						{
							SECURITY_CODE: "600519", SECURITY_NAME_ABBR: "贵州茅台", CHANGE_RATE: 2.5,
							CLOSE_PRICE: 1500, BILLBOARD_NET_AMT: 100000000, BILLBOARD_BUY_AMT: 300000000,
							BILLBOARD_SELL_AMT: 200000000, EXPLANATION: "日涨幅偏离值达7%的证券", MARKET: "SH",
						},
					],
				},
			}),
			jsonHeaders
		);
	}
	throw new Error(`unexpected URL in stub: ${u}`);
};

console.log("== 1) fetchEmF10Main maps the live API shape ==");
const reports = await fetchEmF10Main("sh600519");
assert.ok(f10Url.includes("SECUCODE%3D%22600519.SH%22"), "f10 query must filter by SECUCODE (sh600519 -> 600519.SH)");
assert.strictEqual(reports.length, 2, "one entry per report row");
const r0 = reports[0];
assert.strictEqual(r0.period, "2026中报");
assert.strictEqual(r0.reportType, "中报");
assert.strictEqual(r0.noticeDate, "2026-08-15", "notice date truncated to YYYY-MM-DD");
assert.strictEqual(r0.eps, 35.57);
assert.strictEqual(r0.revenue, 92278072083.21, "revenue in yuan");
assert.strictEqual(r0.revenueYoy, 1.30);
assert.strictEqual(r0.profit, 44516880421.86);
assert.strictEqual(r0.profitYoy, -1.95, "negative yoy keeps its sign");
assert.strictEqual(r0.deduct, 44464207646.01);
assert.strictEqual(r0.roe, 16.75);
assert.strictEqual(r0.grossMargin, 89.55);
assert.strictEqual(r0.netMargin, 50.75);
assert.strictEqual(r0.debtRatio, 15.19);

// BJ codes map to .BJ SECUCODE; unrecognized codes throw a Chinese error
const bjReports = await fetchEmF10Main("bj899050");
assert.ok(bjReports.length === 2, "bj code resolves through the same feed");
await assert.rejects(
	() => fetchEmF10Main("nope"),
	(e) => /[\u4e00-\u9fa5]/.test(e.message),
	"unrecognized code must throw a Chinese error"
);

console.log("== 2) /f10 route caches per code ==");
const routes = makeRoutes({}, { dshHome: "/tmp", logger: { warn() {} } });
const f10Route = routes.find((r) => r.path === ROUTES.f10);
const longhuRoute = routes.find((r) => r.path === ROUTES.longhu);
assert.ok(f10Route, "f10 route must be registered");
assert.ok(longhuRoute, "longhu route must be registered");

function makeGet(url) {
	const req = new EventEmitter();
	req.method = "GET";
	req.url = url;
	req.socket = { remoteAddress: "127.0.0.1" };
	req.headers = { host: "localhost" };
	return req;
}
function makeRes() {
	const res = new EventEmitter();
	res.headersSent = false;
	res.body = null;
	res.statusCode = 0;
	res.writeHead = (code) => {
		res.statusCode = code;
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

let res = makeRes();
await f10Route.handler(makeGet(`${ROUTES.f10}?code=sh600519`), res);
assert.strictEqual(res.statusCode, 200);
const first = json(res);
assert.strictEqual(first.code, "sh600519");
assert.strictEqual(first.reports.length, 2);
const callsAfterFirst = f10Calls;

res = makeRes();
await f10Route.handler(makeGet(`${ROUTES.f10}?code=sh600519`), res);
assert.strictEqual(res.statusCode, 200);
assert.strictEqual(json(res).reports.length, 2);
assert.strictEqual(f10Calls, callsAfterFirst, "second call must be a cache hit (no re-fetch)");

res = makeRes();
await f10Route.handler(makeGet(ROUTES.f10), res);
assert.strictEqual(res.statusCode, 400);
assert.match(json(res).error, /缺少参数 code/);

console.log("== 3) /longhu maps the billboard row shape ==");
const now = new Date();
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
res = makeRes();
await longhuRoute.handler(makeGet(`${ROUTES.longhu}?date=${today}`), res);
assert.strictEqual(res.statusCode, 200);
const lh = json(res);
assert.strictEqual(lh.date, today, "today's data found on the first walk-back try");
assert.strictEqual(lh.total, 1);
const row = lh.rows[0];
assert.strictEqual(row.code, "600519");
assert.strictEqual(row.name, "贵州茅台");
assert.strictEqual(row.changePct, 2.5);
assert.strictEqual(row.close, 1500);
assert.strictEqual(row.netAmt, 100000000, "net amount in yuan");
assert.strictEqual(row.buyAmt, 300000000);
assert.strictEqual(row.sellAmt, 200000000);
assert.strictEqual(row.reason, "日涨幅偏离值达7%的证券");

console.log("\n✅ P1 TEST PASSED: F10 + longhu parsers stay aligned with the live datacenter shapes");
process.exit(0);
