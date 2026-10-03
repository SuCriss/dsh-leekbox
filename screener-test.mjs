// Quick validation of the screener engine with a small universe.
import { runScreener } from "./lib/screener.js";

const t0 = Date.now();
let passCount = 0, failCount = 0;

const check = (name, ok, details) => {
	if (ok) {
		passCount++;
		console.log(`PASS ${name}`);
	} else {
		failCount++;
		console.error(`FAIL ${name}: ${details}`);
		process.exitCode = 1;
	}
};

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
check("scanned count covers universe + buffer", result.scanned >= 120 && result.scanned <= 200, `scanned=${result.scanned}`);
check("candidates filtered below score", result.candidates >= 0 && result.candidates <= result.scanned, `candidates=${result.candidates}, scanned=${result.scanned}`);
check("computed non-negative subset of candidates", result.computed >= 0 && result.computed <= result.candidates, `computed=${result.computed}, candidates=${result.candidates}`);
check("matched is non-negative subset", result.matched >= 0 && result.matched <= result.computed, `matched=${result.matched}, computed=${result.computed}`);
check("standard scan completed within wall-clock budget", Date.now() - t0 < 60_000, `wall=${Date.now() - t0}ms, reported=${result.elapsed}`);
console.log("--- standard mode ---");
console.log("elapsed:", result.elapsed, "ms", Date.now() - t0);
console.log("scanned:", result.scanned, "candidates:", result.candidates, "computed:", result.computed, "matched:", result.matched);
for (const row of result.rows.slice(0, 10)) {
	console.log(
		`score=${String(row.score).padStart(3)} ${row.code} ${row.name.padEnd(6)} 价=${row.price} 涨=${row.changePct}% 换手=${row.turnoverRate} 量比=${row.volumeRatio} [${(row.signals ?? []).join(",")}]`
	);
	check(`standard row has required fields`, row.code && row.name && typeof row.score === 'number', `missing fields or score type`);
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
	check(`multi row has strategyCount`, typeof row.strategyCount === 'number', `strategyCount=${row.strategyCount}`);
}

check("total checks passed", passCount + failCount >= 10, `pass=${passCount}, fail=${failCount}`);
process.exitCode = failCount > 0 ? 1 : 0;
