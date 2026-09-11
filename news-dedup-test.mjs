// One-off validation of the multi-source news dedup (跨源快讯去重).
// Extracts the exact shipped source from lib/index.js (no hand copies).
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./lib/index.js", import.meta.url), "utf8");
const start = src.indexOf("const NEWS_IMPORTANT_KW");
const end = src.indexOf("//#endregion", start);
if (start < 0 || end < 0 || end <= start) throw new Error("markers not found");
const snippet = src.slice(start, end);
// fetch* helpers are server imports, only referenced inside uncalled closures.
const { mergeNews, newsNormalizedText } = new Function(
	`${snippet}\nreturn { mergeNews, newsNormalizedText };`
)();

const T = new Date(2026, 0, 15, 10, 0, 0).getTime();
const MIN = 60 * 1000;
const mk = (source, id, text, ts, important = false) => ({
	source,
	id,
	text,
	ts,
	time: "",
	tags: [],
	stocks: [],
	url: "",
	anchor: "",
	important,
});

const cases = [];
const check = (name, ok, detail) => cases.push([name, ok, detail]);

// 1. Cross-source, reworded headline for the same event → one item (sina's copy).
{
	const out = mergeNews([
		[mk("sina", "s1", "央行开展4500亿元MLF操作", T)],
		[mk("em", "e1", "中国央行进行4500亿元MLF操作", T + 2 * MIN)],
		[mk("jin10", "j1", "央行进行4500亿元MLF操作，利率维持不变", T + 3 * MIN)],
	]);
	check("reworded cross-source trio collapses to one", out.length === 1, `len=${out.length}`);
	check("first (richest) copy kept", out[0]?.source === "sina", out[0]?.source);
}

// 2. Importance inherited from a dropped duplicate (jin10 star flag).
{
	const out = mergeNews([
		[mk("sina", "s1", "美联储宣布降息25个基点", T)],
		[mk("jin10", "j1", "美联储宣布降息25个基点，符合预期", T + 1 * MIN, true)],
	]);
	check("importance inherited from dup", out.length === 1 && out[0].important === true, JSON.stringify(out[0]));
}

// 3. Exact same headline from two sources → one item.
{
	const out = mergeNews([
		[mk("sina", "s1", "证监会：优化融券制度安排", T)],
		[mk("em", "e1", "证监会：优化融券制度安排", T + 30 * 1000)],
	]);
	check("exact cross-source headline collapses", out.length === 1, `len=${out.length}`);
}

// 4. Truncated vs extended headline (prefix containment) → one item.
{
	const out = mergeNews([
		[mk("sina", "s1", "央行开展5000亿元买断式逆回购操作", T)],
		[mk("em", "e1", "央行开展5000亿元买断式逆回购操作和1500亿元MLF操作", T + 1 * MIN)],
	]);
	check("truncated/extended headline collapses", out.length === 1, `len=${out.length}`);
}

// 5. Same source, same text re-pushed under a different id → dropped.
{
	const out = mergeNews([
		[mk("sina", "s1", "沪深两市成交额突破1.5万亿元", T), mk("sina", "s2", "沪深两市成交额突破1.5万亿元", T + 5 * MIN)],
	]);
	check("same-source re-push drops", out.length === 1, `len=${out.length}`);
}

// 6. Genuinely different events in-window stay distinct (opposing moves).
{
	const out = mergeNews([
		[mk("sina", "s1", "两市融资余额增加52.3亿元", T)],
		[mk("em", "e1", "两市融资余额减少35.2亿元", T + 4 * MIN)],
	]);
	check("opposing in-window flashes stay", out.length === 2, `len=${out.length}`);
}

// 7. Near-identical texts far apart in time stay distinct (time window).
{
	const out = mergeNews([
		[mk("sina", "s1", "沪指涨1.0%站上3400点", T)],
		[mk("em", "e1", "沪指涨1%站上3400点附近", T + 120 * MIN)],
	]);
	check("similar texts outside window stay", out.length === 2, `len=${out.length}`);
}

// 8. Same source:id duplicate dropped.
{
	const out = mergeNews([[mk("sina", "s1", "A股三大指数集体高开", T)], [mk("sina", "s1", "A股三大指数集体高开", T)]]);
	check("source:id duplicate drops", out.length === 1, `len=${out.length}`);
}

// 9. Keyword fallback still flags importance.
{
	const out = mergeNews([[mk("em", "e1", "某地突发地震，暂无人员伤亡报告", T)]]);
	check("keyword fallback flags important", out[0]?.important === true, String(out[0]?.important));
}

// 10. Newest first sort preserved.
{
	const out = mergeNews([
		[mk("sina", "s1", "上午发布的一条快讯", T)],
		[mk("em", "e1", "中午发布的另一条快讯", T + 120 * MIN)],
	]);
	check("newest first", out[0]?.source === "em", out[0]?.source);
}

// 11. Non-list and rejected-source inputs tolerated.
{
	const out = mergeNews([null, undefined, [], [mk("sina", "s1", "正常快讯", T)]]);
	check("malformed lists tolerated", out.length === 1, `len=${out.length}`);
}

let fail = 0;
for (const [name, ok, detail] of cases) {
	if (!ok) fail++;
	console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(42)} ${detail}`);
}
console.log(`\nnormalized "央行开展4500亿元MLF操作！" → "${newsNormalizedText("央行开展4500亿元MLF操作！")}"`);
process.exit(fail === 0 ? 0 : 1);
