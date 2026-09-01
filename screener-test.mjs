// Quick validation of the screener engine with a small universe.
import { runScreener } from "./lib/screener.js";

const t0 = Date.now();
const result = await runScreener({
	node: "hs_a",
	universe: 120, // tiny pool for testing
	priceMin: 3,
	priceMax: 200,
	turnoverMin: 1,
	excludeST: true,
	require: [],
	minScore: 0,
	lookback: 3,
});
console.log("--- standard mode ---");
console.log("elapsed:", result.elapsed, "ms", Date.now() - t0);
console.log("scanned:", result.scanned, "candidates:", result.candidates, "computed:", result.computed, "matched:", result.matched);
for (const row of result.rows.slice(0, 10)) {
	console.log(
		`score=${String(row.score).padStart(3)} ${row.code} ${row.name.padEnd(6)} 价=${row.price} 涨=${row.changePct}% 换手=${row.turnoverRate} 量比=${row.volumeRatio} [${(row.signals ?? []).join(",")}]`
	);
}

const t1 = Date.now();
const multi = await runScreener({
	node: "hs_a",
	universe: 120,
	priceMin: 3,
	priceMax: 200,
	turnoverMin: 1,
	excludeST: true,
	mode: "multi",
	strategies: ["macdGold", "maBullish", "volBreak", "oversold", "trendUp", "newHigh", "strongRise"],
	minStrategyHits: 2,
});
console.log("--- multi-strategy intersection mode ---");
console.log("elapsed:", multi.elapsed, "ms", Date.now() - t1);
console.log("scanned:", multi.scanned, "candidates:", multi.candidates, "computed:", multi.computed, "matched:", multi.matched);
console.log("strategies:", (multi.strategies ?? []).map((s) => s.label).join(", "));
for (const row of multi.rows.slice(0, 10)) {
	console.log(
		`hits=${String(row.strategyCount).padStart(2)} ${row.code} ${row.name.padEnd(6)} 价=${row.price} 涨=${row.changePct}% 换手=${row.turnoverRate} 评分=${row.score} [${(row.strategies ?? []).join(",")}]`
	);
}
