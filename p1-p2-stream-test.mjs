// P1/P2: Verify LIVE partial results stream while a scan runs.
// runScreener scores each K-line the instant it arrives (fetchKlinesConcurrent onEach),
// pushing matches into _progress.partial. We poll screenerProgress() mid-flight and
// assert the partial array grows monotonically and converges to the final result.
import assert from "node:assert/strict";
import { runScreener, screenerProgress } from "./lib/screener.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Build a universe stub + a slow-per-code kline stub so the scan takes long enough
// to observe partial growing across several polls.
const CODES = Array.from({ length: 30 }, (_, i) => String(600000 + i)); // sh600000..600029
let fetchCalls = 0;

function diffRows() {
	return CODES.map((code, i) => ({
		f12: code, f13: 1, f14: "股票" + i,
		f2: 10 + i, f3: 1 + (i % 5) * 0.5, f8: 2 + (i % 3), f10: 1.5,
		f5: 9000000 + i, f6: 100000000 + i,
	}));
}

function klineSeries(seed) {
	const rows = [];
	for (let i = 0; i < 120; i++) {
		const price = 10 + Math.sin(i / 6 + seed) * (1 + seed * 0.3) + i * 0.02; // trending up → signals
		rows.push([`d${i}`, String(price.toFixed(3)), String((price * 1.01).toFixed(3)), String((price * 1.02).toFixed(3)), String((price * 0.99).toFixed(3)), String(100000 + i * 100 + seed * 5000)]);
	}
	return rows;
}

globalThis.fetch = async (url) => {
	fetchCalls++;
	const u = String(url);
	const jsonHeaders = { status: 200, headers: { "content-type": "application/json" } };
	if (u.includes("ulist") || u.includes("clist") || u.includes("push2")) {
		return new Response(JSON.stringify({ data: { total: CODES.length, diff: diffRows() } }), jsonHeaders);
	}
	const m = u.match(/param=([a-z0-9]+)/);
	if (u.includes("fqkline") && m) {
		// Artificial per-code latency so concurrent workers drain over time.
		await sleep(15);
		const sym = m[1];
		const seed = Number(sym.slice(2)) % 10;
		return new Response(JSON.stringify({ data: { [sym]: { day: klineSeries(seed) } } }), jsonHeaders);
	}
	throw new Error(`unexpected URL in stub: ${u}`);
};

const params = { node: "hs_a", universe: 30, excludeST: true, require: [], minScore: 0, lookback: 3 };

// Kick off the scan (runs to first await synchronously, so running is already true).
const promise = runScreener(params);

const samples = [];
let pollGuard = 0;
while (pollGuard++ < 500) {
	await sleep(8);
	const p = screenerProgress();
	samples.push({ stage: p.stage, done: p.done, partial: p.partial.length, running: p.running });
	if (!p.running) break;
}

const result = await promise;
const finalPartialLen = samples[samples.length - 1].partial;

console.log(`Polls sampled: ${samples.length}, final matched: ${result.matched}`);
console.log(`Partial growth trace: ${samples.map((s) => s.partial).join(",")}`);

// 1) partial never shrinks during the run (rows are only appended, then sorted in place).
let prev = 0;
for (const s of samples) {
	assert.ok(s.partial >= prev, `partial shrank from ${prev} to ${s.partial} at stage ${s.stage}`);
	prev = s.partial;
}

// 2) streaming actually observed: we sampled at least 3 distinct partial sizes during a run.
const distinctSizes = new Set(samples.map((s) => s.partial));
assert.ok(distinctSizes.size >= 3, `expected partial to change across polls, saw sizes: ${[...distinctSizes].join(",")}`);

// 3) it grew beyond a single value (i.e. not just 0 then final), proving incremental delivery.
//    (done counts codes *claimed* by workers, so it races ahead of scoring; judge mid-stream
//     by a partial count strictly between 0 and the final match count while still running.)
const sawMidway = samples.some((s) => s.running && s.partial > 0 && s.partial < result.matched);
assert.ok(sawMidway || result.matched === 0, "never observed partial results before scan completion");

// 4) converges: the live handle ends up equal to the final match count.
assert.strictEqual(finalPartialLen, result.matched, `final partial ${finalPartialLen} != matched ${result.matched}`);

// 5) the returned rows are the same objects streamed (sorted, full set).
assert.strictEqual(result.rows.length, result.matched);

console.log("\n✅ P1/P2 TEST PASSED: partial results stream live during the scan");
process.exit(0);
