// Fallback adapter for Sina's Market_Center feed.
//
// Why this exists
// ---------------
// Eastmoney's clist gateway intermittently blocks a whole egress IP: the route
// answers nginx 502, and a direct connection gets a TCP reset, while the *same
// host's* other endpoints (ulist.np / stock/get / push2ex) keep returning 200.
// Measured 2026-09-22 from this machine — clist 502 for 20+ minutes across
// push2/push2delay and every numbered mirror, while the identical URL fetched
// through a third-party relay returned 200 with full data. So it is an IP-level
// throttle on that one route, not an upstream outage and not a bad request.
//
// When it happens every clist-backed route goes dark at once (rank, sector,
// screener universe, breadth). Sina's Market_Center feed serves the same
// legacy-shaped rows, so it backs the Eastmoney adapter up.
//
// Units — measured against Eastmoney stock/get for 688825 on 2026-09-22:
//   trade / changepercent / open / high / low / per / pb / turnoverratio  1:1
//   volume   Sina 股  → 手   (÷100)
//   amount   Sina 元  → 万元 (÷1e4)
//   mktcap / nmc  Sina 万元 → 万元 (1:1 — already the unit the EM adapter emits)
//   prevClose ← settlement
//
// What Sina does NOT have: 主力净流入 (netflow), 涨跌家数 per board, and the
// 地域 board list. Those come back null / are refused rather than faked.

import { fetchJson, fetchText, decodeGbk } from "./fetch-utils.js";

const BASE = "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/";
const HEADERS = { referer: "https://finance.sina.com.cn/" };

/** node → Sina node. Absent on purpose (verified empty for ~20 candidate
 *  names): main, non_main, cb, lof — Sina exposes no such pool. */
const NODE_MAP = {
	hs_a: "hs_a",
	sh_a: "sh_a",
	sz_a: "sz_a",
	cyb: "cyb",
	kcb: "kcb",
	etf: "etf_hq_fund",
};

/** sort key → Sina sort field. netflow is absent: Sina has no such column. */
const SORT_MAP = {
	changepercent: "changepercent",
	price: "trade",
	amount: "amount",
	turnoverratio: "turnoverratio",
	volume: "volume",
};

function num(v) {
	const x = Number(v);
	return Number.isFinite(x) ? x : null;
}

/** Sina reports volume in 股 and amount in 元; the rest of the host wants 手 / 万元. */
function scaled(v, divisor) {
	const x = Number(v);
	return Number.isFinite(x) ? x / divisor : null;
}

/** Whether this adapter can serve the given rank request at all. */
export function sinaRankSupports(node, sort) {
	return NODE_MAP[node] !== undefined && SORT_MAP[sort] !== undefined;
}

/**
 * One page of the Sina rank feed, normalized to the row shape the Eastmoney
 * adapter returns (so callers cannot tell the two apart).
 * @returns {Promise<{rows: Array<object>, total: number}>}
 */
export async function fetchSinaRankPage({ node = "hs_a", sort = "changepercent", order = "desc", page = 1, size = 30 }) {
	const sinaNode = NODE_MAP[node];
	if (sinaNode === undefined) throw new Error(`sina rank: node "${node}" has no Sina pool`);
	const sinaSort = SORT_MAP[sort];
	if (sinaSort === undefined) throw new Error(`sina rank: sort "${sort}" has no Sina column`);
	const pz = Math.min(Math.max(Number(size) || 30, 1), 100); // Sina caps num at 100
	const pn = Math.max(Number(page) || 1, 1);
	const asc = order === "asc" ? 1 : 0;
	const query = `page=${pn}&num=${pz}&sort=${sinaSort}&asc=${asc}&node=${sinaNode}&symbol=`;
	const [payload, count] = await Promise.all([
		fetchJson(`${BASE}Market_Center.getHQNodeData?${query}`, { headers: HEADERS, timeoutMs: 8000 }),
		fetchJson(`${BASE}Market_Center.getHQNodeStockCount?node=${sinaNode}`, { headers: HEADERS, timeoutMs: 8000 }),
	]);
	if (!Array.isArray(payload)) throw new Error("sina rank: feed unavailable");
	const rows = payload.map((r) => ({
		symbol: String(r.symbol ?? ""),
		code: String(r.code ?? ""),
		name: String(r.name ?? ""),
		trade: num(r.trade),
		pricechange: num(r.pricechange),
		changepercent: num(r.changepercent),
		open: num(r.open),
		high: num(r.high),
		low: num(r.low),
		prevClose: num(r.settlement),
		volume: scaled(r.volume, 100),
		amount: scaled(r.amount, 1e4),
		turnoverratio: num(r.turnoverratio),
		per: num(r.per),
		pb: num(r.pb),
		mktcap: num(r.mktcap),
		nmc: num(r.nmc),
		volumeRatio: null, // Sina carries no 量比
		netflow: null, // nor 主力净流入
	}));
	const n = Number(count);
	return { rows, total: Number.isFinite(n) && n > 0 ? Math.max(n, rows.length) : rows.length };
}

/** Board list URIs. Sina has no 地域 board feed (newSinaHy ignores ?page=). */
const SECTOR_URI = {
	industry: "https://vip.stock.finance.sina.com.cn/q/view/newSinaHy.php",
	concept: "https://vip.stock.finance.sina.com.cn/q/view/newFLJK.php?param=class",
};

export function sinaSectorSupports(type, sort) {
	// sort=f62 is 主力净流入, which Sina does not publish — refuse it rather
	// than return rows in an order that contradicts the column label.
	return SECTOR_URI[type] !== undefined && sort !== "f62";
}

/**
 * Sina board rows, normalized to the sector row shape.
 * Payload is a GBK JS assignment; each board is one comma-joined line:
 *   code,名称,成分股数,均价,涨跌额,涨跌幅,成交量,成交额,
 *   领涨股代码,领涨股涨跌幅,领涨股价格,领涨股涨跌额,领涨股名称
 */
export async function fetchSinaSectorPage({ type = "industry", sort = "f3", order = "desc", page = 1, size = 30 } = {}) {
	const uri = SECTOR_URI[type];
	if (uri === undefined) throw new Error(`sina sector: type "${type}" has no Sina board feed`);
	if (sort === "f62") throw new Error("sina sector: 主力净流入 is not published by Sina");
	const buffer = await fetchText(uri, { headers: HEADERS, timeoutMs: 9000 });
	if (buffer === null) throw new Error("sina sector: feed unavailable");
	const text = decodeGbk(buffer);
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start < 0 || end <= start) throw new Error("sina sector: unexpected payload shape");
	let raw;
	try {
		raw = JSON.parse(text.slice(start, end + 1));
	} catch {
		throw new Error("sina sector: payload is not parseable JSON");
	}
	const all = Object.values(raw).map((line) => {
		const f = String(line).split(",");
		return {
			code: f[0] ?? "",
			name: f[1] ?? "",
			index: null, // Sina reports 板块均价, not the board index level — don't pass it off as one
			changePct: num(f[5]),
			netInflow: null, // no 主力净流入 column
			netInflowPct: null,
			upCount: null, // no per-board 涨跌家数
			downCount: null,
			leader: f[12] ?? "",
			leaderChangePct: num(f[9]),
		};
	});
	all.sort((a, b) => {
		const d = (Number(b.changePct) || 0) - (Number(a.changePct) || 0);
		return order === "asc" ? -d : d;
	});
	const pz = Math.min(Math.max(Number(size) || 30, 1), 100);
	const pn = Math.max(Number(page) || 1, 1);
	const from = (pn - 1) * pz;
	return { rows: all.slice(from, from + pz), total: all.length };
}
