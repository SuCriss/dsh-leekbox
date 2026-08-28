// Shared adapter for the Eastmoney push2 clist feed.
//
// The previous source (Sina Market_Center.getHQNodeData) became unreachable
// from many networks, so the rank routes and the screener universe both read
// Eastmoney now. Rows come back in the legacy Sina field naming so all
// downstream code keeps working unchanged:
//   symbol "sh600519", code "600519", trade price, pricechange, changepercent,
//   open/high/low, volume in 手, amount in 万元, turnoverratio %, per/pb,
//   mktcap/nmc in 万元.
import { fetchJson } from "./fetch-utils.js";

const EM_FIELDS = "f2,f3,f4,f5,f6,f8,f9,f10,f12,f13,f14,f15,f16,f17,f18,f20,f21,f23";

/** Hosts tried in order: main farm first, then mirrors (the main gateway
 * intermittently answers 502; the delay host is the stable fallback). */
const EM_HOSTS = [
	"https://push2.eastmoney.com",
	"http://48.push2.eastmoney.com",
	"https://push2delay.eastmoney.com",
];

/** Node id → Eastmoney fs universe selector. */
const NODE_FS = {
	hs_a: "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23",
	sh_a: "m:1+t:2,m:1+t:23",
	sz_a: "m:0+t:6,m:0+t:80",
	cyb: "m:0+t:80",
	kcb: "m:1+t:23",
};

/** Sort key → Eastmoney field id. */
const SORT_FID = {
	changepercent: "f3",
	price: "f2",
	amount: "f6",
	turnoverratio: "f8",
	volume: "f5",
	netflow: "f62", // 主力净流入
};

function n(v) {
	const x = Number(v);
	return Number.isFinite(x) ? x : null;
}

/** 元 → 万元 (aligns with the old Sina unit). */
function wan(v) {
	const x = Number(v);
	return Number.isFinite(x) ? x / 1e4 : null;
}

/**
 * Fetch one page of the A-share list, normalized to the legacy Sina shape.
 * @param {object} opts
 * @param {string} [opts.node] hs_a | sh_a | sz_a | cyb | kcb
 * @param {string} [opts.sort] changepercent | price | amount | turnoverratio | volume
 * @param {string} [opts.order] desc | asc
 * @param {number} [opts.page]
 * @param {number} [opts.size] 1..100
 * @returns {Promise<{rows: Array<object>, total: number}>} total = full list size on EM side
 */
export async function fetchEmRankPage({ node = "hs_a", sort = "changepercent", order = "desc", page = 1, size = 30 }) {
	const fs = NODE_FS[node] ?? NODE_FS.hs_a;
	const fid = SORT_FID[sort] ?? SORT_FID.changepercent;
	const po = order === "asc" ? 0 : 1;
	const pz = Math.min(Math.max(Number(size) || 30, 1), 100);
	const pn = Math.max(Number(page) || 1, 1);
	const query =
		`pn=${pn}&pz=${pz}&po=${po}&np=1&fltt=2&invt=2&fid=${fid}` +
		`&fs=${encodeURIComponent(fs)}&fields=${EM_FIELDS}`;
	let payload = null;
	let lastError = new Error("eastmoney clist unavailable");
	// The EM gateway flaps between healthy and 502 minute-to-minute, so sweep
	// the host list twice (with a short pause) before giving up.
	for (let round = 0; round < 2 && payload === null; round++) {
		if (round > 0) await new Promise((r) => setTimeout(r, 700));
		for (const host of EM_HOSTS) {
			try {
				payload = await fetchJson(`${host}/api/qt/clist/get?${query}`, {
					headers: { referer: "https://quote.eastmoney.com/" },
					timeoutMs: 8000,
				});
				if (Array.isArray(payload?.data?.diff)) break;
				payload = null;
			} catch (error) {
				lastError = error;
				payload = null;
			}
		}
	}
	const diff = payload?.data?.diff;
	if (!Array.isArray(diff)) throw lastError instanceof Error ? lastError : new Error("eastmoney clist unavailable");
	const rows = diff.map((r) => ({
		symbol: (r.f13 === 1 ? "sh" : r.f13 === 0 ? "sz" : "bj") + String(r.f12 ?? ""),
		code: String(r.f12 ?? ""),
		name: String(r.f14 ?? ""),
		trade: n(r.f2),
		pricechange: n(r.f4),
		changepercent: n(r.f3),
		open: n(r.f17),
		high: n(r.f15),
		low: n(r.f16),
		prevClose: n(r.f18),
		volume: n(r.f5), // 手
		amount: wan(r.f6), // 元 → 万元
		turnoverratio: n(r.f8),
		per: n(r.f9),
		pb: n(r.f23),
		mktcap: wan(r.f20), // 元 → 万元
		nmc: wan(r.f21), // 元 → 万元
		volumeRatio: n(r.f10),
	}));
	return { rows, total: Math.max(n(payload?.data?.total) ?? 0, rows.length) };
}

/** Convenience wrapper preserving the plain-array contract (screener universe). */
export async function fetchEmRankRows(opts = {}) {
	return (await fetchEmRankPage(opts)).rows;
}

/** Sector board field set: index, pct, net inflow (f62), up/down counts, leader. */
const SECTOR_FIELDS = "f2,f3,f12,f14,f62,f104,f105,f128,f136,f184";

/** Sector type → Eastmoney fs selector. */
const SECTOR_FS = { industry: "m:90+t:2", concept: "m:90+t:3", region: "m:90+t:1" };

/**
 * Fetch one page of sector boards (行业 / 概念 / 地域).
 * @param {object} opts
 * @param {string} [opts.type] industry | concept | region
 * @param {string} [opts.sort] f3 涨跌幅 | f62 主力净流入
 * @param {string} [opts.order] desc | asc
 * @param {number} [opts.page]
 * @param {number} [opts.size]
 */
export async function fetchEmSectorPage({ type = "industry", sort = "f3", order = "desc", page = 1, size = 30 } = {}) {
	const fs = SECTOR_FS[type] ?? SECTOR_FS.industry;
	const po = order === "asc" ? 0 : 1;
	const pz = Math.min(Math.max(Number(size) || 30, 1), 100);
	const pn = Math.max(Number(page) || 1, 1);
	const query =
		`pn=${pn}&pz=${pz}&po=${po}&np=1&fltt=2&invt=2&fid=${sort}` +
		`&fs=${encodeURIComponent(fs)}&fields=${SECTOR_FIELDS}`;
	let payload = null;
	let lastError = new Error("eastmoney sector unavailable");
	for (let round = 0; round < 2 && payload === null; round++) {
		if (round > 0) await new Promise((r) => setTimeout(r, 700));
		for (const host of EM_HOSTS) {
			try {
				payload = await fetchJson(`${host}/api/qt/clist/get?${query}`, {
					headers: { referer: "https://quote.eastmoney.com/" },
					timeoutMs: 8000,
				});
				if (Array.isArray(payload?.data?.diff)) break;
				payload = null;
			} catch (error) {
				lastError = error;
				payload = null;
			}
		}
	}
	const diff = payload?.data?.diff;
	if (!Array.isArray(diff)) throw lastError instanceof Error ? lastError : new Error("eastmoney sector unavailable");
	const rows = diff.map((r) => ({
		code: String(r.f12 ?? ""),
		name: String(r.f14 ?? ""),
		index: n(r.f2),
		changePct: n(r.f3),
		netInflow: n(r.f62), // 主力净流入(元)
		netInflowPct: n(r.f184), // 主力净占比 %
		upCount: n(r.f104),
		downCount: n(r.f105),
		leader: String(r.f128 ?? ""),
		leaderChangePct: n(r.f136),
	}));
	return { rows, total: Math.max(n(payload?.data?.total) ?? 0, rows.length) };
}

const breadthCache = { at: 0, val: null };
const BREADTH_TTL = 120 * 1000;

/** Market breadth (涨/跌/平 + approximate 涨停/跌停) across the whole A-share
 * market. clist caps pz at 100, so page through every page in parallel chunks
 * and cache the result; payloads are tiny (only f3 requested). */
export async function fetchEmBreadth() {
	if (breadthCache.val && Date.now() - breadthCache.at < BREADTH_TTL) return breadthCache.val;
	const fs = NODE_FS.hs_a;
	const base = `pn=%P&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${encodeURIComponent(fs)}&fields=f3`;
	// First pin down the market size from page 1 (also yields its 100 rows).
	let first = null;
	let lastError = new Error("eastmoney breadth unavailable");
	for (let round = 0; round < 2 && first === null; round++) {
		if (round > 0) await new Promise((r) => setTimeout(r, 700));
		for (const host of EM_HOSTS) {
			try {
				first = await fetchJson(`${host}/api/qt/clist/get?${base.replace("%P", "1")}`, {
					headers: { referer: "https://quote.eastmoney.com/" },
					timeoutMs: 8000,
				});
				if (Array.isArray(first?.data?.diff)) break;
				first = null;
			} catch (error) {
				lastError = error;
				first = null;
			}
		}
	}
	const total = Math.max(Number(first?.data?.total) || 0, 1);
	const pages = Math.ceil(total / 100);
	const pcts = [];
	for (const r of first?.data?.diff ?? []) pcts.push(Number(r.f3));
	// Fetch the remaining pages in chunks of 8, tolerating page failures.
	async function getPage(p) {
		for (const host of EM_HOSTS) {
			try {
				const res = await fetchJson(`${host}/api/qt/clist/get?${base.replace("%P", String(p))}`, {
					headers: { referer: "https://quote.eastmoney.com/" },
					timeoutMs: 8000,
				});
				if (Array.isArray(res?.data?.diff)) return res;
			} catch {
				/* try next host */
			}
		}
		return null;
	}
	for (let start = 2; start <= pages; start += 8) {
		const chunk = [];
		for (let p = start; p < start + 8 && p <= pages; p++) chunk.push(p);
		const results = await Promise.all(chunk.map((p) => getPage(p).catch(() => null)));
		for (const res of results) {
			for (const r of res?.data?.diff ?? []) pcts.push(Number(r.f3));
		}
	}
	let up = 0;
	let down = 0;
	let flat = 0;
	let limitUp = 0;
	let limitDown = 0;
	for (const pct of pcts) {
		if (!Number.isFinite(pct)) continue;
		if (pct > 0.001) up++;
		else if (pct < -0.001) down++;
		else flat++;
		if (pct >= 9.85) limitUp++;
		if (pct <= -9.85) limitDown++;
	}
	const val = { up, down, flat, limitUp, limitDown, total, counted: pcts.length };
	breadthCache.at = Date.now();
	breadthCache.val = val;
	return val;
}

/** 涨停/跌停 exact counts via the EM topic pools (push2ex). */
export async function fetchEmLimitPools() {
	const ut = "7eea3edcaed734bea9cbfc24409ed989";
	const date = new Date();
	const ymd = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
	const pools = { limitUp: null, limitDown: null };
	const fetchPool = async (path, key) => {
		for (const host of ["https://push2ex.eastmoney.com", "http://48.push2ex.eastmoney.com"]) {
			try {
				const j = await fetchJson(
					`${host}/${path}?ut=${ut}&dpt=wz.ztzt&Pageindex=0&pagesize=1&sort=fbt%3Aasc&date=${ymd}`,
					{ headers: { referer: "https://quote.eastmoney.com/" }, timeoutMs: 8000 }
				);
				const tc = Number(j?.data?.tc);
				if (Number.isFinite(tc) && tc >= 0) return tc;
			} catch {
				/* next host */
			}
		}
		return null;
	};
	pools.limitUp = await fetchPool("getTopicZTPool", "zt");
	pools.limitDown = await fetchPool("getTopicDTPool", "dt");
	return pools;
}

/** Per-day capital-flow series for one stock (主力/大单/中单/小单净流入, 元). */
export async function fetchEmFflowKline(code) {
	const prefix = code.startsWith("sh") ? "1" : "0";
	const secid = `${prefix}.${String(code).slice(2)}`;
	const query =
		`lmt=0&klt=101&secid=${secid}&fields1=f1,f2,f3,f7` +
		"&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61";
	let payload = null;
	let lastError = new Error("eastmoney fflow unavailable");
	for (let round = 0; round < 2 && payload === null; round++) {
		if (round > 0) await new Promise((r) => setTimeout(r, 500));
		for (const host of EM_KLINE_HOSTS) {
			try {
				payload = await fetchJson(`${host}/api/qt/stock/fflow/kline/get?${query}`, {
					headers: { referer: "https://quote.eastmoney.com/" },
					timeoutMs: 8000,
				});
				if (Array.isArray(payload?.data?.klines) && payload.data.klines.length > 0) break;
				payload = null;
			} catch (error) {
				lastError = error;
				payload = null;
			}
		}
	}
	const list = payload?.data?.klines;
	if (!Array.isArray(list)) throw lastError instanceof Error ? lastError : new Error("eastmoney fflow unavailable");
	return list.map((s) => {
		const p = String(s).split(",");
		return {
			date: p[0],
			main: Number(p[1]) || 0, // 主力净流入(元)
			small: Number(p[3]) || 0, // 小单
			middle: Number(p[2]) || 0, // 中单
			big: Number(p[4]) || 0, // 大单
			xl: Number(p[5]) || 0, // 超大单
		};
	});
}

/** Dragon-tiger (龙虎榜) daily details from the EM datacenter API. */
export async function fetchEmLonghu(date, { page = 1, size = 20 } = {}) {
	const query =
		`reportName=RPT_DAILYBILLBOARD_DETAILSNEW&columns=ALL` +
		`&filter=(TRADE_DATE%3D%27${date}%27)&sortColumns=BILLBOARD_NET_AMT&sortTypes=-1` +
		`&pageNumber=${Math.max(Number(page) || 1, 1)}&pageSize=${Math.min(Math.max(Number(size) || 20, 1), 100)}`;
	let payload = null;
	let lastError = new Error("eastmoney longhu unavailable");
	// datacenter-web sits on its own farm; try the primary then the numbered mirror.
	const hosts = ["https://datacenter-web.eastmoney.com", "http://datacenter.eastmoney.com"];
	for (let round = 0; round < 2 && payload === null; round++) {
		if (round > 0) await new Promise((r) => setTimeout(r, 500));
		for (const host of hosts) {
			try {
				payload = await fetchJson(`${host}/api/data/v1/get?${query}`, {
					headers: { referer: "https://data.eastmoney.com/" },
					timeoutMs: 8000,
				});
				if (Array.isArray(payload?.result?.data)) break;
				payload = null;
			} catch (error) {
				lastError = error;
				payload = null;
			}
		}
	}
	const list = payload?.result?.data;
	if (!Array.isArray(list)) throw lastError instanceof Error ? lastError : new Error("eastmoney longhu unavailable");
	const rows = list.map((r) => ({
		code: String(r.SECURITY_CODE ?? ""),
		name: String(r.SECURITY_NAME_ABBR ?? ""),
		changePct: n(r.CHANGE_RATE),
		close: n(r.CLOSE_PRICE),
		netAmt: n(r.BILLBOARD_NET_AMT), // 龙虎榜净买额(元)
		buyAmt: n(r.BILLBOARD_BUY_AMT),
		sellAmt: n(r.BILLBOARD_SELL_AMT),
		reason: String(r.EXPLANATION ?? ""),
		market: String(r.MARKET ?? ""),
	}));
	return { rows, total: n(payload?.result?.count) ?? rows.length };
}

/** History API hosts (separate farm from the clist gateway above). */
const EM_KLINE_HOSTS = ["https://push2his.eastmoney.com", "http://48.push2his.eastmoney.com"];

/**
 * Daily forward-adjusted kline via the Eastmoney history API. Independent of
 * Tencent's fqkline feed, which starts serving 501 anti-bot challenges under
 * bulk scanning — this acts as the screener's fallback source.
 * @param {string} code lowercase symbol like "sz000001" / "sh600519"
 * @returns {Promise<Array<{date,open,close,high,low,volume}>>}
 */
export async function fetchEmDailyKline(code) {
	const prefix = code.startsWith("sh") ? "1" : "0";
	const secid = `${prefix}.${String(code).slice(2)}`;
	const query =
		`secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57` +
		"&klt=101&fqt=1&end=20500101&lmt=120";
	let payload = null;
	let lastError = new Error("eastmoney kline unavailable");
	for (let round = 0; round < 2 && payload === null; round++) {
		if (round > 0) await new Promise((r) => setTimeout(r, 500));
		for (const host of EM_KLINE_HOSTS) {
			try {
				payload = await fetchJson(`${host}/api/qt/stock/kline/get?${query}`, {
					headers: { referer: "https://quote.eastmoney.com/" },
					timeoutMs: 8000,
				});
				if (Array.isArray(payload?.data?.klines) && payload.data.klines.length > 0) break;
				payload = null;
			} catch (error) {
				lastError = error;
				payload = null;
			}
		}
	}
	const list = payload?.data?.klines;
	if (!Array.isArray(list)) throw lastError instanceof Error ? lastError : new Error("eastmoney kline unavailable");
	return list.map((s) => {
		const [date, open, close, high, low, volume] = String(s).split(",");
		return { date, open: Number(open), close: Number(close), high: Number(high), low: Number(low), volume: Number(volume) };
	});
}
