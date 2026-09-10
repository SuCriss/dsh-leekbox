// One-off validation of the 大盘页 sentiment thermometer scoring logic.
// Extracts the exact shipped source from lib/client.js (no hand copies).
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./lib/client.js", import.meta.url), "utf8");
const start = src.indexOf("const SENTI_TIERS");
const end = src.indexOf("/** 大盘页市场情绪卡");
if (start < 0 || end < 0 || end <= start) throw new Error("markers not found");
const snippet = src.slice(start, end);
const { sentiScore, sentiTier } = new Function(`${snippet}\nreturn { sentiScore, sentiTier };`)();

const cases = [
	["typical hot day", { up: 3800, down: 1200, limitUp: 150, broken: 38, maxBoard: 7 }, ["沸腾", "偏热"]],
	["neutral day", { up: 2400, down: 2300, limitUp: 55, broken: 30, maxBoard: 4 }, ["中性"]],
	["ice-cold day", { up: 800, down: 3800, limitUp: 5, broken: 8, maxBoard: 2 }, ["冰点", "低迷"]],
	["breadth feed failed (null up/down)", { limitUp: 120, broken: 15, maxBoard: 6 }, ["沸腾", "偏热"]],
	["all fields missing", {}, null],
	["garbage input", "oops", null],
	["null input", null, null],
	["empty-string fields", { up: "", down: "", limitUp: "", broken: "", maxBoard: "" }, null],
];

let fail = 0;
for (const [name, input, tiers] of cases) {
	const score = sentiScore(input);
	const tier = score === null ? "null" : sentiTier(score).label;
	const ok = tiers === null ? score === null : score !== null && tiers.includes(tier);
	if (!ok) fail++;
	console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(38)} score=${String(score).padEnd(4)} tier=${tier}`);
}

// Tier boundaries sanity
for (const s of [0, 19, 20, 39, 40, 59, 60, 79, 80, 100]) {
	console.log(`boundary score=${String(s).padStart(3)} → ${sentiTier(s).label}`);
}
process.exit(fail === 0 ? 0 : 1);
