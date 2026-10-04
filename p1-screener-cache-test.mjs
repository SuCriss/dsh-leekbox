// P1: Test screener result caching with stubbed fetch.
import assert from "node:assert/strict";
import { runScreener, screenerCacheStats } from "./lib/screener.js";

let fetchCalls = 0;
globalThis.fetch = async (url) => {
	fetchCalls++;
	const u = String(url);
	if (u.includes("push2") || u.includes("ulist") || u.includes("clist")) {
		return new Response(JSON.stringify({ 
			data: { total: 3, diff: [
				{ f12: "600519", f13: 1, f14: "贵州茅台", f2: 1500, f3: 2.5, f8: 3.0, f10: 1.5, f6: "100000000", f5: "9000000" },
				{ f12: "000001", f13: 1, f14: "平安银行", f2: 14, f3: 1.2, f8: 2.0, f10: 1.0, f6: "50000000", f5: "4000000" },
				{ f12: "300059", f13: 1, f14: "东方财富", f2: 12, f3: 3.0, f8: 4.0, f10: 2.0, f6: "80000000", f5: "7000000" },
			] }
		}), { status: 200, headers: { "content-type": "application/json" } });
	}
	if (u.includes("fqkline") || u.includes("ifzq.gtimg.cn")) {
		const data = {};
		for (const code of ["sh600519", "sh000001"]) {
			const rows = [];
			for (let i = 0; i < 130; i++) {
				const base = code === "sh600519" ? 10 : 5;
				rows.push([`2020-01-${String((i%28)+1).padStart(2,"0")}`, 
					String(base + i*0.05), String(base + i*0.05 + 0.1), 
					String(base + i*0.05 + 0.2), String(base + i*0.05 - 0.1), 
					String(100000 + i*100)]);
			}
			data[code] = { qfqday: rows };
		}
		return new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });
	}
	throw new Error(`unexpected URL: ${u}`);
};

const params = { node: "hs_a", universe: 3, priceMin: 1, excludeST: true, require: [], minScore: 0 };

console.log("Step 1: First run hits network");
const r1 = await runScreener(params);
const s1 = screenerCacheStats();
console.log(`  Fetches: ${fetchCalls}, Matched: ${r1.matched}`);
console.log(`  Cache: misses=${s1.misses}, hits=${s1.hits}`);
assert.ok(fetchCalls >= 1, "first run must hit network");
assert.strictEqual(s1.misses, 1, "first is miss");

console.log("\nStep 2: Second run returns cache");
const startT2 = Date.now();
const r2 = await runScreener(params);
const elapsed = Date.now() - startT2;
const s2 = screenerCacheStats();
console.log(`  Fetches: ${fetchCalls} (unchanged)`);
console.log(`  Elapsed: ${elapsed}ms, CacheHit: ${r2.cacheHit}`);
console.log(`  Cache: misses=${s2.misses}, hits=${s2.hits}`);
assert.ok(elapsed < 100, "cache should be instant");
assert.strictEqual(r2.cacheHit, true, "should report cacheHit");
assert.strictEqual(s2.hits, 1, "second is hit");
assert.deepStrictEqual(r2.rows, r1.rows, "results identical");

console.log("\n✅ P1 TEST PASSED");
process.exit(0);
