// 行情页取数回归测试：主源（东财 clist）被限流时，备用源（新浪）能否顶上，
// 且单位换算是否与主源一致。
//
// 单位基准用东财 stock/get —— 它和 clist 同主机但不同路由，clist 被限流时它照常
// 返回，所以可以拿它当"真值"校验回退数据的 price/volume/amount/mktcap/nmc。
//
// 运行：node rank-fallback-test.mjs

import { fetchEmRankPage, fetchEmSectorPage, fetchEmBreadth } from "./lib/emrank.js";
import { fetchJson } from "./lib/fetch-utils.js";

let pass = 0;
let fail = 0;
function check(label, ok, detail = "") {
	if (ok) {
		pass++;
		console.log("  ✓ " + label + (detail ? "  " + detail : ""));
	} else {
		fail++;
		console.log("  ✗ " + label + (detail ? "  " + detail : ""));
	}
}

/** 东财单只快照（单位：价格元 / 成交量手 / 成交额元 / 市值元）。 */
async function emBaseline(symbol) {
	const market = symbol.startsWith("sh") ? "1" : "0";
	const code = symbol.slice(2);
	const url = `https://push2.eastmoney.com/api/qt/stock/get?fltt=2&invt=2&secid=${market}.${code}&fields=f43,f47,f48,f116,f117`;
	const payload = await fetchJson(url, { headers: { referer: "https://quote.eastmoney.com/" }, timeoutMs: 8000 });
	return payload?.data ?? null;
}

const near = (a, b, rel = 0.01) => Number.isFinite(a) && Number.isFinite(b) && b !== 0 && Math.abs(a - b) / Math.abs(b) <= rel;

// ── 1. 各池子能出数、字段齐全 ────────────────────────────────────────────
// 这里测的是适配器层（fetchEmRankPage），字段名是 legacy Sina 形状；
// 路由层会再映射成 price/changePct 等，见 index.js 的 ROUTES.rank。
console.log("\n[1] 行情页各池子（回退后仍应可用）");
const SUPPORTED = ["hs_a", "sh_a", "sz_a", "cyb", "kcb", "etf"];
const REQUIRED = ["symbol", "code", "name", "trade", "changepercent", "volume", "amount", "mktcap", "nmc"];
for (const node of SUPPORTED) {
	try {
		const page = await fetchEmRankPage({ node, sort: "changepercent", order: "desc", page: 1, size: 20 });
		const rows = page.rows ?? [];
		const missing = rows.length ? REQUIRED.filter((k) => rows[0][k] === void 0) : ["<no rows>"];
		check(
			`node=${node}`,
			rows.length > 0 && missing.length === 0,
			`${rows.length} 行 / total=${page.total} / 首行 ${rows[0]?.code ?? "-"} ${rows[0]?.name ?? ""}${missing.length ? " 缺字段:" + missing.join(",") : ""}`,
		);
	} catch (error) {
		check(`node=${node}`, false, error.message.slice(0, 120));
	}
}

// ── 2. 单位换算与东财基准一致 ────────────────────────────────────────────
console.log("\n[2] 单位校验（对比东财 stock/get 真值）");
try {
	const page = await fetchEmRankPage({ node: "hs_a", sort: "amount", order: "desc", page: 1, size: 3 });
	for (const row of page.rows) {
		const base = await emBaseline(row.symbol);
		if (base === null) {
			check(`${row.code} 基准可取`, false, "stock/get 无数据，跳过");
			continue;
		}
		const emMktcapWan = base.f116 / 1e4; // 元 → 万元
		const emNmcWan = base.f117 / 1e4;
		check(
			`${row.code} ${row.name}`,
			near(row.trade, base.f43) && near(row.volume, base.f47, 0.02) && near(row.amount, base.f48 / 1e4, 0.02) && near(row.mktcap, emMktcapWan) && near(row.nmc, emNmcWan),
			`price ${row.trade}/${base.f43}  volume ${row.volume}/${base.f47}手  amount ${row.amount}/${(base.f48 / 1e4).toFixed(0)}万  mktcap ${row.mktcap}/${emMktcapWan.toFixed(0)}万`,
		);
	}
} catch (error) {
	check("单位校验", false, error.message.slice(0, 140));
}

// ── 3. 备用源覆盖不到的请求要明确报错，不能返回错数据 ────────────────────
console.log("\n[3] 覆盖不到的池子/榜单应明确报错");
for (const [node, sort] of [["cb", "changepercent"], ["lof", "changepercent"], ["main", "changepercent"], ["hs_a", "netflow"]]) {
	try {
		const page = await fetchEmRankPage({ node, sort, order: "desc", page: 1, size: 5 });
		// 主源恢复时 netflow/主板 本来就应该成功，这不算失败
		check(`node=${node} sort=${sort}`, page.rows.length > 0, `主源可用，正常返回 ${page.rows.length} 行`);
	} catch (error) {
		const msg = error.message;
		check(`node=${node} sort=${sort} 报错可诊断`, /no fallback|sina:/.test(msg), msg.slice(0, 130));
	}
}

// ── 4. 涨跌家数 ──────────────────────────────────────────────────────────
console.log("\n[4] 全市场涨跌家数");
try {
	const b = await fetchEmBreadth();
	const total = b.up + b.down + b.flat;
	check(
		"breadth",
		total > 3000 && total < 8000 && b.up >= 0 && b.down >= 0,
		`上涨 ${b.up} / 下跌 ${b.down} / 平 ${b.flat} / 合计 ${total}`,
	);
} catch (error) {
	check("breadth", false, error.message.slice(0, 120));
}

// ── 5. 板块榜 ────────────────────────────────────────────────────────────
console.log("\n[5] 板块榜");
for (const type of ["industry", "concept"]) {
	try {
		const page = await fetchEmSectorPage({ type, sort: "f3", order: "desc", page: 1, size: 10 });
		const rows = page.rows ?? [];
		check(
			`type=${type}`,
			rows.length > 0 && rows[0].name !== "" && Number.isFinite(rows[0].changePct),
			`${rows.length} 个板块 / total=${page.total} / 首位 ${rows[0]?.name} ${rows[0]?.changePct}%`,
		);
	} catch (error) {
		check(`type=${type}`, false, error.message.slice(0, 120));
	}
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
