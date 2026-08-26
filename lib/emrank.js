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
