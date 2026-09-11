// Regression test for the pinyin-initial search index (run: node pinyin-test.mjs).
// Ground truth = the pinyin reading actually used in each instrument's name.
// Covers: xi-syllable chars below the old x boundary, boundary-char equality,
// single-reading polyphones (行/长/厦/藏), and the two-reading 重 (重庆 chóng vs
// 重工 zhòng) matched through the abbr2 variant.
import { pinyinAbbr, pinyinInitial, searchInstruments } from "./lib/search-index.js";

const CASES = [
	// 银行股（行 háng — the collator's primary reading is xíng）
	["招商银行", "zsyh"], ["工商银行", "gsyh"], ["建设银行", "jsyh"], ["农业银行", "nyyh"],
	["中国银行", "zgyh"], ["浦发银行", "pfyh"], ["民生银行", "msyh"], ["兴业银行", "xyyh"],
	// 含“西”（xi 音字曾整体掉进 w 桶）
	["陕西煤业", "sxmy"], ["山西汾酒", "sxfj"], ["西部矿业", "xbky"], ["江西铜业", "jxty"],
	["德赛西威", "dsxw"], ["西藏矿业", "xzky"], ["西藏天路", "xztl"], ["西昌电力", "xcdl"],
	// 多音字（单一读音覆盖：长 cháng / 厦 xià / 藏 zàng）
	["长江电力", "cjdl"], ["长城汽车", "ccqc"], ["长安汽车", "caqc"], ["厦门国贸", "xmgm"],
	["厦门钨业", "xmwy"], ["藏格矿业", "zgky"],
	// 重 的主读音 = collator primary zhòng（重工系）；chóng 变体走 abbr2，见下面的匹配测试
	["三一重工", "syzg"], ["中信重工", "zxzg"], ["重药控股", "zykg"], ["重庆啤酒", "zqpj"],
	// 普通名称
	["贵州茅台", "gzmt"], ["宁德时代", "ndsd"], ["比亚迪", "byd"], ["万科A", "wka"],
	["五粮液", "wly"], ["紫金矿业", "zjky"], ["三一重机", "syzj"], ["中信证券", "zxzq"],
	["TCL科技", "tclkj"], ["京东方A", "jdfa"], ["隆基绿能", "ljln"], ["海康威视", "hkws"],
	// ETF 名称
	["沪深300ETF", "hs300etf"], ["科创50ETF", "kc50etf"], ["国防ETF", "gfetf"],
];

// 拼音字母边界字自身必须归入自己的字母（闭区间语义）。
const BOUNDS = ["阿", "八", "嚓", "搭", "蛾", "发", "噶", "哈", "击", "喀", "垃", "妈", "拿", "哦", "啪", "期", "然", "撒", "塌", "挖", "夕", "压", "匝"];
const LETTERS = "abcdefghjklmnopqrstwxyz".split("");

let fails = 0;
function fail(msg) { fails++; console.log("FAIL  " + msg); }

for (const [name, want] of CASES) {
	const got = pinyinAbbr(name);
	if (got !== want) fail(`${name}  got=${got}  want=${want}`);
}
for (let i = 0; i < BOUNDS.length; i++) {
	const got = pinyinInitial(BOUNDS[i]);
	if (got !== LETTERS[i]) fail(`boundary ${BOUNDS[i]}  got=${got}  want=${LETTERS[i]}`);
}

// —— 匹配层：双读音（abbr2）必须让两种拼法都能命中 ——
function row(code, name, type) {
	return { code, name, market: code.startsWith("6") ? "SH" : "SZ", type: type ?? "stock",
		quoteId: (code.startsWith("6") ? "1." : "0.") + code, lower: name.toLowerCase(),
		abbr: pinyinAbbr(name), abbr2: /[重]/.test(name) ? pinyinAbbr(name, { 重: "c" }) : void 0 };
}
const UNIVERSE = [
	row("600031", "三一重工"), row("000950", "重药控股"), row("600132", "重庆啤酒"),
row("600036", "招商银行"), row("601398", "工商银行"),
	row("600519", "贵州茅台"), row("601398", "工商银行"), row("600900", "长江电力"),
	row("002415", "海康威视"), row("510300", "沪深300ETF", "etf"),
];
function find(kw, code) {
	const hits = searchInstruments(UNIVERSE, kw, 20);
	if (!hits.some((r) => r.code === code)) fail(`search "${kw}" did not return ${code} (got: ${hits.map((r) => r.code + r.name).join(", ") || "none"})`);
}
find("cqpj", "600132");     // 重庆啤酒 — chóng 变读音（abbr2）
find("cq", "600132");       // 同上，前缀
find("zqpj", "600132");     // zhòng 主读音（abbr）
find("syzg", "600031");     // 三一重工 — zhòng 主读音
find("zykg", "000950");     // 重药控股 — zhòng 主读音
find("cykg", "000950");     // 重药控股 — chóng 变读音（abbr2）
find("gsyh", "601398");     // 工商银行 — 行 háng
find("zsyh", "600036");     // 招商银行 — 行 háng
find("cjdl", "600900");     // 长江电力 — 长 cháng
find("gzmt", "600519");     // 贵州茅台 — 全拼首字母精确
find("600519", "600519");   // 代码
find("510", "510300");      // ETF 5 位代码前缀

console.log(fails === 0 ? `PASS  ${CASES.length} name/boundary cases + 11 matching cases` : `FAIL  ${fails} case(s)`);
process.exit(fails === 0 ? 0 : 1);
