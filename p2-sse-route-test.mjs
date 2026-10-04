// P2: End-to-end test of the SSE route. Drives the REAL registered handler
// (lib/index.js ROUTES.screenerStream) with a mock req/res while a stubbed scan
// runs, asserting the stream emits progress frames with a live-growing `partial`
// and a terminal `done` frame, then closes.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { makeRoutes, ROUTES } from "./lib/index.js";
import { runScreener } from "./lib/screener.js";

// ---- stub network (same shape as the streaming test) ----
const CODES = Array.from({ length: 24 }, (_, i) => String(600000 + i));
globalThis.fetch = async (url) => {
	const u = String(url);
	const jsonHeaders = { status: 200, headers: { "content-type": "application/json" } };
	if (u.includes("ulist") || u.includes("clist") || u.includes("push2")) {
		return new Response(JSON.stringify({ data: { total: CODES.length, diff: CODES.map((code, i) => ({
			f12: code, f13: 1, f14: "股票" + i, f2: 10 + i, f3: 1 + (i % 5) * 0.5, f8: 2 + (i % 3), f10: 1.5, f5: 9000000, f6: 100000000,
		})) } }), jsonHeaders);
	}
	const m = u.match(/param=([a-z0-9]+)/);
	if (u.includes("fqkline") && m) {
		await new Promise((r) => setTimeout(r, 25)); // pace so several SSE ticks land mid-scan
		const sym = m[1];
		const seed = Number(sym.slice(2)) % 10;
		const rows = [];
		for (let i = 0; i < 120; i++) {
			const price = 10 + Math.sin(i / 6 + seed) * (1 + seed * 0.3) + i * 0.02;
			rows.push([`d${i}`, price.toFixed(3), (price * 1.01).toFixed(3), (price * 1.02).toFixed(3), (price * 0.99).toFixed(3), String(100000 + i * 100)]);
		}
		return new Response(JSON.stringify({ data: { [sym]: { day: rows } } }), jsonHeaders);
	}
	throw new Error(`unexpected URL in stub: ${u}`);
};

// ---- grab the real stream handler from the registered routes ----
const routes = makeRoutes({}, { dshHome: "/tmp", logger: { warn() {} } });
const streamRoute = routes.find((r) => r.path === ROUTES.screenerStream);
assert.ok(streamRoute, "screenerStream route must be registered");

// ---- mock req/res ----
function makeReq() {
	const req = new EventEmitter();
	req.method = "GET";
	req.url = ROUTES.screenerStream;
	req.socket = { remoteAddress: "127.0.0.1" };
	req.headers = { host: "localhost" };
	return req;
}
function makeRes(onEnd) {
	const res = new EventEmitter();
	res.headersSent = false;
	res.chunks = "";
	res.statusCode = 0;
	res.writeHead = (code, headers) => { res.statusCode = code; res.headers = headers; res.headersSent = true; };
	res.write = (s) => { res.chunks += s; return true; };
	res.end = (s) => { if (s) res.chunks += s; onEnd(); };
	return res;
}

// start the scan (synchronous part flips _progress.running true), then open the stream
const scanPromise = runScreener({ node: "hs_a", universe: 24, excludeST: true, require: [], minScore: 0, lookback: 3 }).catch((e) => ({ failed: true, error: e.message }));

const req = makeReq();
let ended = false;
const res = makeRes(() => { ended = true; });
await streamRoute.handler(req, res);

// wait for the terminal close (the handler ends the stream once the scan stops)
await new Promise((resolve) => {
	const iv = setInterval(() => { if (ended) { clearInterval(iv); resolve(); } }, 30);
	setTimeout(() => { clearInterval(iv); resolve(); }, 10000);
});

const final = await scanPromise;
assert.ok(!final.failed, `scan unexpectedly failed: ${final.error}`);

// ---- parse SSE frames ----
const frames = res.chunks.split("\n\n").filter(Boolean);
const events = frames.map((f) => {
	const ev = /event: (\w+)/.exec(f)?.[1];
	const dataStr = /data: (.*)/.exec(f)?.[1];
	return { ev, data: dataStr ? JSON.parse(dataStr) : null };
});

const progressEvents = events.filter((e) => e.ev === "progress" && e.data);
const doneEvents = events.filter((e) => e.ev === "done");

console.log(`Total SSE frames: ${frames.length}, progress events: ${progressEvents.length}, done events: ${doneEvents.length}`);
console.log(`Partial trace via SSE: ${progressEvents.map((e) => e.data.partial.length).join(",")}`);

// 1) proper SSE content-type + a terminal end
assert.strictEqual(res.statusCode, 200);
assert.match(res.headers["content-type"], /^text\/event-stream/);
assert.ok(ended, "stream must close after the scan finishes");

// 2) at least one terminal done, and it carried the final match count
assert.strictEqual(doneEvents.length, 1, "exactly one terminal done event");
assert.strictEqual(doneEvents[0].data.matched ?? doneEvents[0].data.partial.length, final.matched, "done event reflects final count");

// 3) progress frames streamed a live-growing partial (monotonic, and observed >1 distinct size)
let prev = 0;
for (const e of progressEvents) {
	assert.ok(e.data.partial.length >= prev, "partial must not shrink across SSE frames");
	prev = e.data.partial.length;
}
assert.ok(progressEvents.length >= 2, "expected several progress frames");
assert.ok(new Set(progressEvents.map((e) => e.data.partial.length)).size >= 2, "partial should change across SSE frames");

// 4) guard enforced: a non-loopback request is rejected before streaming
let rejectedStatus = 0;
const badReq = makeReq();
badReq.socket = { remoteAddress: "8.8.8.8" };
const badRes = {
	writeHead: (c) => { rejectedStatus = c; },
	write() {},
	end() {},
	on() {},
};
await streamRoute.handler(badReq, badRes);
assert.strictEqual(rejectedStatus, 403, "non-loopback stream request must be rejected (403)");

console.log("\n✅ P2 TEST PASSED: SSE route streams progress + live partial and closes on done");
process.exit(0);
