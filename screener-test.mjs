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
console.log("elapsed:", result.elapsed, "ms", Date.now() - t0);
console.log("scanned:", result.scanned, "candidates:", result.candidates, "computed:", result.computed, "matched:", result.matched);
for (const row of result.rows.slice(0, 10)) {
	console.log(
		`score=${String(row.score).padStart(3)} ${row.code} ${row.name.padEnd(6)} 价=${row.price} 涨=${row.changePct}% 换手=${row.turnoverRate} 量比=${row.volumeRatio} [${(row.signals ?? []).join(",")}]`
	);
}
