// P0: Test incremental universe refresh API. This script verifies that getInstrumentIndexDelta()
// returns correct added/removed rows after seeding an index, simulating a real client scenario.
import { getInstrumentIndexDelta, seedIndexForTesting, resetIndexForTesting } from "./lib/search-index.js";
import assert from "node:assert/strict";

// Clear any previous state
resetIndexForTesting();

// Seed first snapshot (baseline) with 10 instruments
const baselineRows = [
	{ code: "sh600519", name: "贵州茅台", market: "SH", type: "stock", typeLabel: "股票" },
	{ code: "sz000001", name: "平安银行", market: "SZ", type: "stock", typeLabel: "股票" },
	{ code: "sh601318", name: "中国平安", market: "SH", type: "stock", typeLabel: "股票" },
	{ code: "sz300059", name: "东方财富", market: "SZ", type: "stock", typeLabel: "股票" },
	{ code: "sh510300", name: "沪深 300ETF", market: "SH", type: "etf", typeLabel: "ETF" },
];
const baselineAt = seedIndexForTesting(baselineRows, Date.now());
console.log(`Baseline builtAt=${baselineAt}, total=${baselineRows.length}`);

// Wait 1ms for unique timestamp
await new Promise((r) => setTimeout(r, 1));

// Seed second snapshot (updated) — remove one stock, add two new ones
const updatedRows = [
	...baselineRows.slice(0, 3), // keep first 3
	{ code: "sz000002", name: "万科 A", market: "SZ", type: "stock", typeLabel: "股票" },
	{ code: "sh600036", name: "招商银行", market: "SH", type: "stock", typeLabel: "股票" },
];
const updatedAt = seedIndexForTesting(updatedRows, Date.now());
console.log(`Updated builtAt=${updatedAt}, total=${updatedRows.length}`);

// Compute delta from baseline → updated
const delta = getInstrumentIndexDelta(baselineAt);
console.log(`Delta from ${baselineAt}:`);
console.log(`  added (${delta.added.length} codes): ${delta.added.map(r => r.code).join(", ")}`);
console.log(`  removed (${delta.removed.length} codes): ${delta.removed.join(", ")}`);
console.log(`  total now: ${delta.total}`);

// Assertions
assert.strictEqual(delta.added.length, 2, "should have 2 added");
assert.strictEqual(delta.removed.length, 2, "should have 2 removed");
assert.strictEqual(delta.total, updatedRows.length, "total should match current size");

// Verify added entries are full shapedRow objects with required fields
const addedCodes = delta.added.map((r) => r.code);
assert.ok(addedCodes.includes("sz000002"), "added should include new stock sz000002");
assert.ok(addedCodes.includes("sh600036"), "added should include new stock sh600036");

for (const row of delta.added) {
	assert.ok(row.code, "added entry must have 'code' field");
	assert.ok(typeof row.name !== "undefined", "added entry must have 'name' field");
	assert.ok(row.market, "added entry must have 'market' field");
}

const removedCodesList = delta.removed;
assert.ok(removedCodesList.includes("sz300059"), "removed should include sz300059 (was replaced by sz000002)");
assert.ok(removedCodesList.includes("sh510300"), "removed should include sh510300 ETF (not in updated set)");

console.log("\n✅ P0 TEST PASSED: Incremental refresh API works correctly");
process.exit(0);
