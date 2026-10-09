// P0: 当日分时图 + 资金流向图的数据契约测试. Stubs the upstream feeds and
// drives the REAL registered minute/fflow handlers, asserting the exact
// response shapes the new client charts (MinuteChart / FflowChart) consume:
//   - /minute  -> { code, date, points:[{time,price,volume,amount}], qt }
//   - /fflow   -> { code, count, rows:[{date,main,xl,big,middle,small}] }
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { makeRoutes, ROUTES } from "./lib/index.js";

// ---- stub network: Tencent minute/query + EM fflow kline ----
const MINUTE_LINES = [
	"0930 10.00 100 100000",
	"0931 10.05 120 120600",
	"0932 9.98 80 79840",
	"0933 10.10 200 202000",
	"1500 10.62 150 159300",
];
globalThis.fetch = async (url) => {
	const u = String(url);
	const jsonHeaders = { status: 200, headers: { "content-type": "application/json" } };
	if (u.includes("minute/query")) {
		const code = /code=([a-z0-9]+)/.exec(u)?.[1] ?? "sh600519";
		return new Response(
			JSON.stringify({ data: { [code]: { data: { date: "2026-01-06", data: MINUTE_LINES }, qt: { time: "20260106150000" } } } }),
			jsonHeaders
		);
	}
	if (u.includes("fflow/kline")) {
		return new Response(
			JSON.stringify({
				data: {
					klines: [
						"2026-01-02,1000000.00,800000.00,200000.00,-300000.00,-1700000.00",
						"2026-01-05,-450000.50,-600000.00,150000.00,900000.00,-450000.00",
						"2026-01-06,2200000.75,1800000.00,400000.00,-500000.00,-1700000.00",
					],
				},
			}),
			jsonHeaders
		);
	}
	throw new Error(`unexpected URL in stub: ${u}`);
};

const routes = makeRoutes({}, { dshHome: "/tmp", logger: { warn() {} } });
const minuteRoute = routes.find((r) => r.path === ROUTES.minute);
const fflowRoute = routes.find((r) => r.path === ROUTES.fflow);
assert.ok(minuteRoute, "minute route must be registered");
assert.ok(fflowRoute, "fflow route must be registered");

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

console.log("== 1) /minute returns the points shape MinuteChart consumes ==");
let res = makeRes();
await minuteRoute.handler(makeGet(`${ROUTES.minute}?code=sh600519`), res);
assert.strictEqual(res.statusCode, 200, `minute must be 200, got ${res.statusCode}: ${res.body}`);
const minute = json(res);
assert.strictEqual(minute.code, "sh600519");
assert.strictEqual(minute.date, "2026-01-06", "date must pass through for the tooltip label");
assert.ok(Array.isArray(minute.points) && minute.points.length === MINUTE_LINES.length, "points must be parsed line by line");
assert.deepStrictEqual(
	minute.points[0],
	{ time: "0930", price: 10, volume: 100, amount: 100000 },
	"each point must be {time, price, volume, amount}"
);
assert.strictEqual(minute.points[minute.points.length - 1].price, 10.62, "last point must parse its price");
assert.ok(minute.qt !== null && minute.qt.time === "20260106150000", "qt must pass through untouched");

// missing code -> 400 with the Chinese usage hint
res = makeRes();
await minuteRoute.handler(makeGet(ROUTES.minute), res);
assert.strictEqual(res.statusCode, 400);
assert.match(json(res).error, /缺少参数 code/);

console.log("== 2) /fflow returns the rows shape FflowChart consumes ==");
res = makeRes();
await fflowRoute.handler(makeGet(`${ROUTES.fflow}?code=sh600519&count=30`), res);
assert.strictEqual(res.statusCode, 200, `fflow must be 200, got ${res.statusCode}: ${res.body}`);
const fflow = json(res);
assert.strictEqual(fflow.code, "sh600519");
assert.ok(Array.isArray(fflow.rows) && fflow.rows.length === 3, "rows must map one entry per kline");
assert.deepStrictEqual(
	fflow.rows[2],
	{ date: "2026-01-06", main: 2200000.75, xl: 1800000, big: 400000, middle: -500000, small: -1700000 },
	"each row must be {date, main, xl, big, middle, small} in yuan"
);
assert.ok(fflow.rows[1].main < 0, "negative (outflow) days must keep their sign for the red/green bars");

console.log("\n✅ P0 TEST PASSED: minute + fflow routes feed the new charts the exact expected shapes");
process.exit(0);
