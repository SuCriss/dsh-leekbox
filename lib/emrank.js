// Shared adapter for the Eastmoney push2 clist feed.
//
// The previous source (Sina Market_Center.getHQNodeData) became unreachable
// from many networks, so the rank routes and the screener universe both read
// Eastmoney now. Rows come back in the legacy Sina field naming so all
// downstream code keeps working unchanged:
//   symbol "sh600519", code "600519", trade price, pricechange, changepercent,
//   open/high/low, volume in 手, amount in 万元, turnoverratio %, per/pb,
//   mktcap/nmc in 万元.
import { fetchJson, feedError, errorDetail } from "./fetch-utils.js";
import { fetchSinaRankPage, fetchSinaSectorPage, sinaRankSupports, sinaSectorSupports } from "./sinarank.js";

/** 上游失败时的统一文案（见 fetch-utils.js 的 feedError）。
 * 这些 message 会被 /rank、/sector、/sentiment 原样透给浏览器,必须是中文;
 * 主机名/池子/排序字段等技术细节一律走 detail,只进日志。 */
const clistCoolingError = () => feedError("行情接口正在限流冷却，请稍后重试", "em clist throttled (cooldown)");

/** 池子中文名 —— 报错时要说清是哪个榜取不到,不能只说"失败了"。
 * key 与前端 RANK 的 POOL_CHOICES 保持一致。 */
const NODE_LABEL = {
	hs_a: "沪深A股",
	sh_a: "沪A",
	sz_a: "深A",
	cyb: "创业板",
	kcb: "科创板",
	main: "主板",
	non_main: "非主板",
	etf: "ETF",
	cb: "可转债",
	lof: "LOF",
};

/** 板块类型中文名,同上。 */
const SECTOR_LABEL = { industry: "行业", concept: "概念", region: "地域" };

const EM_FIELDS = "f2,f3,f4,f5,f6,f8,f9,f10,f12,f13,f14,f15,f16,f17,f18,f20,f21,f23,f62";

/** Hosts tried in order: main farm first, then mirrors (the main gateway
 * intermittently answers 502; the delay host is the stable fallback). */
const EM_HOSTS = [
	"https://push2.eastmoney.com",
	"https://push2delay.eastmoney.com",
	"http://48.push2.eastmoney.com",
];

/** clist-only cooldown.
 *
 * Eastmoney throttles the clist route *per egress IP* while the same host's
 * other routes (ulist.np / stock/get / push2ex) keep answering 200. Measured
 * 2026-09-22: clist 502 on every host for 20+ minutes, the identical URL
 * fetched through a third-party relay returned 200 with full data.
 *
 * Once clist trips we stop paying its timeout on every refresh and let the
 * Sina fallback serve; the cooldown re-probes so we return to Eastmoney (the
 * only source of 主力净流入) as soon as the throttle lifts. */
const CLIST_COOLDOWN_MS = 60 * 1000;
let clistDownUntil = 0;
const clistThrottled = () => Date.now() < clistDownUntil;
const markClistDown = () => {
	clistDownUntil = Date.now() + CLIST_COOLDOWN_MS;
};
const markClistUp = () => {
	clistDownUntil = 0;
};

/** 测试用：把 clist 冷却窗口清零。
 *
 * 冷却是**模块级状态**，而 verify-fixes 的前半段跑真实网络，一次失败就把后面
 * 用 stub 的用例全挡在 fetch 之前（表现为"行映射用例莫名失败"）。与其让测试等
 * 60s 到期，不如给一个明确的复位口子。 */
export function resetClistCooldownForTests() {
	clistDownUntil = 0;
}

/** Node id → Eastmoney fs universe selector. */
const NODE_FS = {
	hs_a: "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23",
	sh_a: "m:1+t:2,m:1+t:23",
	sz_a: "m:0+t:6,m:0+t:80",
	cyb: "m:0+t:80",
	kcb: "m:1+t:23",
	// 主板 / 非主板二分：两池相加恰等于 hs_a（北交所不在沪深A股池内，保持一致）。
	main: "m:1+t:2,m:0+t:6", // 沪主板 600/601/603/605 + 深主板 000/001/002/003（中小板已并入）
	non_main: "m:0+t:80,m:1+t:23", // 创业板 300/301 + 科创板 688
	// 场内基金 / ETF：东财板块代码 MK0021（含沪深ETF/LOF/REITs）
	etf: "b:MK0021",
	// 可转债：MK0354
	cb: "b:MK0354",
	// LOF 基金
	lof: "m:1+t:5,m:0+t:10",
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
 * One page of the A-share list off Eastmoney's clist gateway, normalized to the
 * legacy Sina shape. Internal — callers go through fetchEmRankPage, which falls
 * back to Sina while this route is throttled.
 * @returns {Promise<{rows: Array<object>, total: number}>} total = full list size on EM side
 */
async function fetchEastmoneyRankPage({ node = "hs_a", sort = "changepercent", order = "desc", page = 1, size = 30 }) {
	if (clistThrottled()) throw clistCoolingError();
	const fs = NODE_FS[node] ?? NODE_FS.hs_a;
	const fid = SORT_FID[sort] ?? SORT_FID.changepercent;
	const po = order === "asc" ? 0 : 1;
	const pz = Math.min(Math.max(Number(size) || 30, 1), 100);
	const pn = Math.max(Number(page) || 1, 1);
	const query =
		`pn=${pn}&pz=${pz}&po=${po}&np=1&fltt=2&invt=2&fid=${fid}` +
		`&fs=${encodeURIComponent(fs)}&fields=${EM_FIELDS}`;
	let payload = null;
	let lastError = feedError("东财榜单接口暂时不可用", "em clist: every host failed");
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
	if (!Array.isArray(diff)) {
		markClistDown();
		throw lastError;
	}
	markClistUp();
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
		netflow: n(r.f62), // 主力净流入(元)；基金/转债等无此字段时为 null
	}));
	return { rows, total: Math.max(n(payload?.data?.total) ?? 0, rows.length) };
}

/**
 * Fetch one page of the A-share list. Eastmoney first — it is the only source of
 * 主力净流入 — then Sina, so the rank page survives an Eastmoney clist throttle.
 * Pools Sina has no feed for (main / non_main / cb / lof) and sort=netflow still
 * fail while Eastmoney is down; the error names the reason instead of hiding it.
 * @param {object} opts
 * @param {string} [opts.node] hs_a | sh_a | sz_a | cyb | kcb | main | non_main | etf | cb | lof
 * @param {string} [opts.sort] changepercent | price | amount | turnoverratio | volume | netflow
 * @param {string} [opts.order] desc | asc
 * @param {number} [opts.page]
 * @param {number} [opts.size] 1..100
 * @returns {Promise<{rows: Array<object>, total: number}>}
 */
export async function fetchEmRankPage(opts = {}) {
	const node = opts.node ?? "hs_a";
	const sort = opts.sort ?? "changepercent";
	try {
		return await fetchEastmoneyRankPage(opts);
	} catch (emError) {
		// detail 优先取上游的英文技术细节（有 detail 就用 detail），日志好 grep。
		const em = errorDetail(emError) || (emError instanceof Error ? emError.message : String(emError));
		if (!sinaRankSupports(node, sort)) {
			// 备用源没有这个池子/排序字段,别装作有 —— 说清是哪一个取不到,
			// 用户才知道该换个榜看还是等一会儿。
			const what = sort === "netflow" ? "主力净流入榜" : `${NODE_LABEL[node] ?? node}榜`;
			throw feedError(
				`${what}暂时取不到：行情主源不可用，备用源没有这一项。请稍后重试或换个榜单看`,
				`rank feed unavailable — em: ${em}; no sina fallback for node=${node} sort=${sort}`
			);
		}
		try {
			return await fetchSinaRankPage(opts);
		} catch (sinaError) {
			const sina = errorDetail(sinaError) || (sinaError instanceof Error ? sinaError.message : String(sinaError));
			throw feedError(
				"榜单数据暂时取不到（主源与备用源都不可用，请稍后重试）",
				`rank feed unavailable — em: ${em}; sina: ${sina}; node=${node} sort=${sort}`
			);
		}
	}
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
export async function fetchEmSectorPage(opts = {}) {
	const { type = "industry", sort = "f3" } = opts;
	try {
		return await fetchEastmoneySectorPage(opts);
	} catch (emError) {
		// detail 优先取上游的英文技术细节（有 detail 就用 detail），日志好 grep。
		const em = errorDetail(emError) || (emError instanceof Error ? emError.message : String(emError));
		if (!sinaSectorSupports(type, sort)) {
			const what = sort === "f62" ? `${SECTOR_LABEL[type] ?? type}板块的主力净流入` : `${SECTOR_LABEL[type] ?? type}板块`;
			throw feedError(
				`${what}榜暂时取不到：行情主源不可用，备用源没有这一项。请稍后重试或换个排序看`,
				`sector feed unavailable — em: ${em}; no sina fallback for type=${type} sort=${sort}`
			);
		}
		try {
			return await fetchSinaSectorPage(opts);
		} catch (sinaError) {
			const sina = errorDetail(sinaError) || (sinaError instanceof Error ? sinaError.message : String(sinaError));
			throw feedError(
				"板块数据暂时取不到（主源与备用源都不可用，请稍后重试）",
				`sector feed unavailable — em: ${em}; sina: ${sina}; type=${type} sort=${sort}`
			);
		}
	}
}

/** Eastmoney sector boards. Internal — see fetchEmSectorPage for the fallback. */
async function fetchEastmoneySectorPage({ type = "industry", sort = "f3", order = "desc", page = 1, size = 30 } = {}) {
	if (clistThrottled()) throw clistCoolingError();
	const fs = SECTOR_FS[type] ?? SECTOR_FS.industry;
	const po = order === "asc" ? 0 : 1;
	const pz = Math.min(Math.max(Number(size) || 30, 1), 100);
	const pn = Math.max(Number(page) || 1, 1);
	const query =
		`pn=${pn}&pz=${pz}&po=${po}&np=1&fltt=2&invt=2&fid=${sort}` +
		`&fs=${encodeURIComponent(fs)}&fields=${SECTOR_FIELDS}`;
	let payload = null;
	let lastError = feedError("东财板块接口暂时不可用", "em sector clist: every host failed");
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
	if (!Array.isArray(diff)) {
		markClistDown();
		throw lastError instanceof Error ? lastError : feedError("东财板块接口暂时不可用", "em sector clist: every host failed");
	}
	markClistUp();
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

const breadthCache = { at: 0, val: null, failedAt: 0 };
const BREADTH_TTL = 120 * 1000;
/** 取数失败后的快速失败窗口:期间直接抛错,不再重复撞超时。 */
const BREADTH_FAIL_BACKOFF = 60 * 1000;

/** 全市场涨跌家数。
 *
 * 指数快照的 f104/f105/f106 就是该市场/板块的上涨/下跌/平盘家数:
 * 上证指数(沪市) + 深证成指(深市) + 北证50(北交所) 相加即全市场。
 * 实测 2026-09-22:2319 + 2902 + 345 = 5566 家,与沪深A股口径一致
 * (北证50 返回的是北交所全量 345 家,不是它自己的 50 只成分股)。
 *
 * 这里曾经是"翻遍 clist 全部 56 页再本地统计"——正是这个请求量触发了东财对
 * clist 路由的 IP 级限流(限流只作用于 clist,同主机其它路由照常 200)。换成
 * ulist 后每次刷新只要 1 个请求,顺带把这个坑堵上。
 *
 * 失败语义不变:拿不到就抛错,绝不返回假的 0/0 —— 否则源站不可达时,温度计
 * 会把"数据缺失"渲染成"上涨 0 家 / 下跌 0 家"。调用方按 null 降级。 */
const BREADTH_SECIDS = ["1.000001", "0.399001", "0.899050"];
export async function fetchEmBreadth() {
	if (breadthCache.val && Date.now() - breadthCache.at < BREADTH_TTL) return breadthCache.val;
	if (breadthCache.failedAt && Date.now() - breadthCache.failedAt < BREADTH_FAIL_BACKOFF) {
		throw feedError("涨跌家数暂时取不到（刚失败过，稍后自动重试）", "em breadth: within failure backoff");
	}
	const query = `fltt=2&invt=2&fields=f12,f14,f104,f105,f106&secids=${BREADTH_SECIDS.join(",")}`;
	let payload = null;
	let lastError = feedError("涨跌家数暂时取不到（东财指数快照不可用）", "em breadth: ulist.np every host failed");
	for (let round = 0; round < 2 && payload === null; round++) {
		if (round > 0) await new Promise((r) => setTimeout(r, 700));
		for (const host of EM_HOSTS) {
			try {
				payload = await fetchJson(`${host}/api/qt/ulist.np/get?${query}`, {
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
	if (!Array.isArray(diff) || diff.length === 0) {
		breadthCache.failedAt = Date.now();
		throw lastError;
	}
	let up = 0;
	let down = 0;
	let flat = 0;
	for (const row of diff) {
		up += Number(row.f104) || 0;
		down += Number(row.f105) || 0;
		flat += Number(row.f106) || 0;
	}
	const total = up + down + flat;
	// 三个指数都返回 0:字段语义变了,不能当成"全市场平盘"
	if (total === 0) {
		breadthCache.failedAt = Date.now();
		throw feedError("涨跌家数暂时取不到：指数快照未返回涨跌家数字段", "em breadth: ulist.np f104/f105/f106 all zero");
	}
	const val = { up, down, flat, total };
	breadthCache.at = Date.now();
	breadthCache.val = val;
	breadthCache.failedAt = 0;
	return val;
}

const sentimentCache = { at: 0, val: null };
const SENTIMENT_TTL = 30 * 1000;

/** 涨停/跌停 exact counts via the EM topic pools (push2ex). Fetches both pools
 * in parallel, walks back a few days when today's pool is empty (weekend/holiday
 * or the feed lagging), and caches briefly so UI refreshes don't re-hit it. */
export async function fetchEmLimitPools() {
	if (sentimentCache.val && Date.now() - sentimentCache.at < SENTIMENT_TTL) return sentimentCache.val;
	const ut = "7eea3edcaed734bea9cbfc24409ed989";
	const fetchPool = async (path) => {
		for (let back = 0; back < 6; back++) {
			const t = new Date();
			t.setDate(t.getDate() - back);
			const ymd = `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, "0")}${String(t.getDate()).padStart(2, "0")}`;
			try {
				const j = await fetchJson(
					`https://push2ex.eastmoney.com/${path}?ut=${ut}&dpt=wz.ztzt&Pageindex=0&pagesize=1&sort=fbt%3Aasc&date=${ymd}`,
					{ headers: { referer: "https://quote.eastmoney.com/" }, timeoutMs: 6000 }
				);
				const tc = Number(j?.data?.tc);
				if (Number.isFinite(tc) && tc >= 0) return tc;
			} catch {
				/* try previous day */
			}
		}
		return null;
	};
	const [limitUp, limitDown] = await Promise.all([fetchPool("getTopicZTPool"), fetchPool("getTopicDTPool")]);
	const val = { limitUp, limitDown };
	sentimentCache.at = Date.now();
	sentimentCache.val = val;
	return val;
}

const sentimentDetailCache = { at: 0, val: null };
const SENTIMENT_DETAIL_TTL = 30 * 1000;

/** Market-thermometer detail: limit-up pool with consecutive-board ladder,
 * broken-board (炸板) count and limit-down count. Walks back a few days when
 * today's pool is empty (weekend/holiday) and caches briefly. */
export async function fetchEmSentimentDetail() {
	if (sentimentDetailCache.val && Date.now() - sentimentDetailCache.at < SENTIMENT_DETAIL_TTL) return sentimentDetailCache.val;
	const ut = "7eea3edcaed734bea9cbfc24409ed989";
	const base = "https://push2ex.eastmoney.com/";
	const fetchPool = async (path, size) => {
		for (let back = 0; back < 6; back++) {
			const t = new Date();
			t.setDate(t.getDate() - back);
			const ymd = `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, "0")}${String(t.getDate()).padStart(2, "0")}`;
			try {
				const j = await fetchJson(
					`${base}${path}?ut=${ut}&dpt=wz.ztzt&Pageindex=0&pagesize=${size}&sort=fbt%3Aasc&date=${ymd}`,
					{ headers: { referer: "https://quote.eastmoney.com/" }, timeoutMs: 6000 }
				);
				const pool = Array.isArray(j?.data?.pool) ? j.data.pool : [];
				if (pool.length > 0 || Number.isFinite(Number(j?.data?.tc))) return { pool, tc: Number(j?.data?.tc ?? 0), date: ymd };
			} catch {
				/* try previous day */
			}
		}
		return { pool: [], tc: 0, date: "" };
	};
	const [zt, zb, dt] = await Promise.all([
		fetchPool("getTopicZTPool", 300),
		fetchPool("getTopicZBPool", 300),
		fetchPool("getTopicDTPool", 1),
	]);
	// Consecutive-board ladder (连板梯队) from the limit-up pool's lbc field.
	const boardCount = new Map();
	for (const s of zt.pool) {
		const b = Number(s.lbc) || 1;
		boardCount.set(b, (boardCount.get(b) ?? 0) + 1);
	}
	const ladder = [...boardCount.entries()].sort((a, b) => a[0] - b[0]).map(([board, count]) => ({ board, count }));
	const maxBoard = ladder.length > 0 ? ladder[ladder.length - 1].board : 0;
	const marketOf = (m) => (m === 1 ? "sh" : m === 0 ? "sz" : "bj");
	const ztList = zt.pool.map((s) => ({
		code: marketOf(s.m) + String(s.c ?? ""),
		name: String(s.n ?? ""),
		board: Number(s.lbc) || 1,
		industry: String(s.hybk ?? ""),
		fund: Number(s.fund) || 0,
	}));
	const val = {
		date: zt.date,
		limitUp: zt.pool.length > 0 ? zt.pool.length : zt.tc,
		limitDown: dt.tc,
		broken: zb.pool.length > 0 ? zb.pool.length : zb.tc,
		ladder,
		maxBoard,
		ztList,
	};
	sentimentDetailCache.at = Date.now();
	sentimentDetailCache.val = val;
	return val;
}

/** Per-day capital-flow series for one stock (主力/大单/中单/小单净流入, 元). */
export async function fetchEmFflowKline(code) {
	const prefix = code.startsWith("sh") ? "1" : "0";
	const secid = `${prefix}.${String(code).slice(2)}`;
	const query =
		`lmt=0&klt=101&secid=${secid}&fields1=f1,f2,f3,f7` +
		"&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61";
	let payload = null;
	let lastError = feedError("资金流数据暂时取不到（东财接口不可用）", "em fflow kline: every host failed");
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
	if (!Array.isArray(list)) throw lastError instanceof Error ? lastError : feedError("资金流数据暂时取不到（东财接口不可用）", "em fflow kline: no klines");
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

/** Dragon-tiger (龙虎榜) daily details from the EM datacenter API. When the
 * requested date has no published data yet (today's list lands after the
 * evening close), walk back up to 7 days and return the most recent date that
 * has entries, so the UI always shows real data with its true date. */
export async function fetchEmLonghu(date, { page = 1, size = 20 } = {}) {
	const hosts = ["https://datacenter-web.eastmoney.com", "http://datacenter.eastmoney.com"];
	const one = async (d) => {
		const query =
			`reportName=RPT_DAILYBILLBOARD_DETAILSNEW&columns=ALL` +
			`&filter=(TRADE_DATE%3D%27${d}%27)&sortColumns=BILLBOARD_NET_AMT&sortTypes=-1` +
			`&pageNumber=${Math.max(Number(page) || 1, 1)}&pageSize=${Math.min(Math.max(Number(size) || 20, 1), 100)}`;
		let payload = null;
		let lastError = feedError("龙虎榜数据暂时取不到（东财接口不可用）", "em longhu datacenter: every host failed");
		for (let round = 0; round < 2 && payload === null; round++) {
			if (round > 0) await new Promise((r) => setTimeout(r, 400));
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
		return { payload, lastError };
	};
	let found = null;
	for (let back = 0; back < 8; back++) {
		const t = new Date();
		t.setDate(t.getDate() - back);
		const d = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
		const { payload, lastError } = await one(d);
		if (Array.isArray(payload?.result?.data) && payload.result.data.length > 0) {
			found = { d, payload };
			break;
		}
		if (back === 7) {
			const err = lastError instanceof Error ? lastError : feedError("龙虎榜数据暂时取不到（东财接口不可用）", "em longhu datacenter: no rows in 8 days");
			throw err;
		}
	}
	const { d, payload } = found;
	const list = payload?.result?.data ?? [];
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
	return { date: d, rows, total: n(payload?.result?.count) ?? rows.length };
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
	let lastError = feedError("K线数据暂时取不到（东财接口不可用）", "em daily kline: every host failed");
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
	if (!Array.isArray(list)) throw lastError instanceof Error ? lastError : feedError("K线数据暂时取不到（东财接口不可用）", "em daily kline: no klines");
	return list.map((s) => {
		const [date, open, close, high, low, volume] = String(s).split(",");
		return { date, open: Number(open), close: Number(close), high: Number(high), low: Number(low), volume: Number(volume) };
	});
}
