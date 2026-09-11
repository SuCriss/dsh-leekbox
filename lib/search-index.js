// Local instrument search index for the LeekBox search route.
//
// The old search proxied Eastmoney's searchadapter suggest API per keystroke,
// which answers in ~0.7–3s. This module instead snapshots the whole on-exchange
// instrument universe once (≈8k rows: SH/SZ/BJ stocks + ETF/LOF/CB funds) via
// the same Eastmoney clist feed the rank/screener routes already use, then
// answers searches from memory in ~1ms: code prefix, name substring and pinyin
// initials (zero-dependency, via Intl.Collator's zh pinyin collation).
//
// The snapshot is built lazily on first search, cached ~6h, and refreshed in
// the background (stale-while-revalidate) so searches never block on a rebuild.
import { fetchText, fetchJson } from "./fetch-utils.js";

const EM_HOSTS = [
	// The delay mirror serves the same clist data and rate-limits far less
	// aggressively; for static fields (code/name/market) the delay is
	// irrelevant, so it goes first. The live gateways back it up.
	"https://push2delay.eastmoney.com",
	"https://push2.eastmoney.com",
	"http://48.push2.eastmoney.com",
];

/** fs selectors: all stocks (SH/SZ A+B + BJ) in one universe, funds in another. */
const FS_ALL_STOCKS = "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048";
const FS_ALL_FUNDS = "b:MK0021,b:MK0354,m:1+t:5,m:0+t:10";

const INDEX_TTL = 6 * 60 * 60 * 1000; // 6h — new listings appear on next refresh
const PAGE_SIZE = 100;
const CHUNK = 6; // parallel pages per round (same pacing as the breadth fetch)

//#region pinyin initials (Intl.Collator zh collation, no dictionary)

/** Boundary hanzi for each pinyin initial letter (i/u/v never start a syllable).
 * Semantics: ch sorts >= bound → ch belongs to that letter's bucket (closed on
 * the left), so a boundary char itself resolves to its own letter.
 * `夕` (the lowest xi-syllable char) anchors x: the previous anchor `昔` sat above
 * 夕/汐/兮/西/希/吸 in the collation and dropped them into the w bucket. */
const PINYIN_BOUNDS = [
	["a", "阿"], ["b", "八"], ["c", "嚓"], ["d", "搭"], ["e", "蛾"], ["f", "发"], ["g", "噶"],
	["h", "哈"], ["j", "击"], ["k", "喀"], ["l", "垃"], ["m", "妈"], ["n", "拿"], ["o", "哦"],
	["p", "啪"], ["q", "期"], ["r", "然"], ["s", "撒"], ["t", "塌"], ["w", "挖"], ["x", "夕"],
	["y", "压"], ["z", "匝"],
];

/** Polyphone readings that the collation gets wrong for stock-name usage.
 * The collator picks each char's primary reading; names use the other one:
 * 行 háng (banks), 长 cháng (长江/长城), 厦 xià (厦门), 藏 zàng (西藏).
 * 重 is deliberately NOT overridden — both readings are common in real names
 * (重庆 chóng vs 重工 zhòng), so it carries a second matched variant instead. */
const PINYIN_OVERRIDE = { 行: "h", 长: "c", 厦: "x", 藏: "z" };

/** Alternate initials for genuinely two-reading chars; rows whose name contains
 * one get an `abbr2` variant that scoreRow matches alongside `abbr`. */
const PINYIN_AMBIG = { 重: "c" };
const PINYIN_AMBIG_RE = /[重]/;

let collator = null;
try {
	collator = new Intl.Collator("zh-Hans-CN");
} catch {
	collator = null;
}

/** First pinyin letter of one hanzi, or null when unresolvable (non-CJK, rare chars). */
export function pinyinInitial(ch) {
	const over = PINYIN_OVERRIDE[ch];
	if (over !== undefined) return over;
	if (collator === null) return null;
	let letter = null;
	for (const [l, bound] of PINYIN_BOUNDS) {
		if (collator.compare(ch, bound) >= 0) letter = l;
	}
	return letter;
}

/** Pinyin-initial string for a name: hanzi → initial letter, ASCII kept as-is.
 * `altMap` (optional) substitutes alternate readings for ambiguous chars. */
export function pinyinAbbr(name, altMap) {
	let out = "";
	for (const ch of name) {
		if (/[a-z0-9]/i.test(ch)) {
			out += ch.toLowerCase();
			continue;
		}
		const initial = (altMap !== void 0 && altMap[ch] !== void 0) ? altMap[ch] : pinyinInitial(ch);
		if (initial !== null) out += initial;
	}
	return out;
}

//#endregion

//#region classification + row shaping

/** Type label from the code pattern (funds share one fs bucket, so pattern-split). */
function classify(code, fromStocksUniverse) {
	if (fromStocksUniverse) return "stock";
	if (/^(11|12)\d{4}$/.test(code)) return "cb";
	if (/^16\d{4}$/.test(code) || /^50[0-2]\d{3}$/.test(code)) return "lof";
	if (/^5[1-9]\d{4}$/.test(code) || /^15\d{4}$/.test(code)) return "etf";
	return "fund";
}

export const TYPE_LABEL = {
	stock: "股票",
	etf: "ETF",
	lof: "LOF",
	cb: "可转债",
	fund: "基金",
};

/** Canonical market from the bare code (EM's f13 says SZ for BJ stocks too, so
 * the code pattern is the reliable source): 11→SH债, 12/13→SZ债, 4/8/92→BJ,
 * 5/6/9→SH, else SZ. Matches the server's normalizeCode and client's normCode. */
export function marketFromCode(code) {
	if (/^11/.test(code)) return "SH";
	if (/^(12|13)/.test(code)) return "SZ";
	if (/^(4|8|92)/.test(code)) return "BJ";
	if (/^[569]/.test(code)) return "SH";
	return "SZ";
}

/** Tencent-style symbol for the batched quote fetch, e.g. "sh600519". */
export function tencentSymbol(code, market) {
	const m = market && /^(SH|SZ|BJ)$/.test(market) ? market.toLowerCase() : marketFromCode(code).toLowerCase();
	return m + code;
}

function marketOf(f13) {
	return f13 === 1 ? "SH" : f13 === 0 ? "SZ" : "BJ";
}
void marketOf; // kept for reference; shapeRow now uses marketFromCode

function shapeRow(r, fromStocksUniverse) {
	const code = String(r.f12 ?? "");
	const name = String(r.f14 ?? "").trim();
	if (!/^\d{5,6}$/.test(code) || name === "") return null;
	// f13 says SZ for BJ stocks too — derive the market from the code pattern.
	const market = marketFromCode(code);
	return {
		code,
		name,
		market, // SH | SZ | BJ
		type: classify(code, fromStocksUniverse),
		quoteId: `${market === "SH" ? "1" : "0"}.${code}`,
		lower: name.toLowerCase(),
		abbr: pinyinAbbr(name),
		// Alternate reading for ambiguous chars (重 chóng/zhòng) — only built when
		// the name contains one, so the 8k-row snapshot carries ~a dozen extras.
		abbr2: PINYIN_AMBIG_RE.test(name) ? pinyinAbbr(name, PINYIN_AMBIG) : void 0,
	};
}

//#endregion

//#region snapshot build

async function fetchPage(fs, page) {
	const query =
		`pn=${page}&pz=${PAGE_SIZE}&po=1&np=1&fltt=2&invt=2&fid=f12` +
		`&fs=${encodeURIComponent(fs)}&fields=f12,f13,f14`;
	// The EM gateways throttle IP bursts: rapid-fire retries keep tripping the
	// limiter, so retries are spaced out (2.5s between rounds, hosts staggered).
	for (let round = 0; round < 3; round++) {
		if (round > 0) await new Promise((r) => setTimeout(r, 2500));
		for (const host of EM_HOSTS) {
			if (round > 0 || host !== EM_HOSTS[0]) await new Promise((r) => setTimeout(r, 400));
			try {
				const payload = await fetchJson(`${host}/api/qt/clist/get?${query}`, {
					headers: { referer: "https://quote.eastmoney.com/" },
					timeoutMs: 8000,
				});
				if (Array.isArray(payload?.data?.diff)) return payload.data;
			} catch {
				/* try next host */
			}
		}
	}
	return null;
}

/** Page through one fs universe completely with chunked concurrency. */
async function fetchUniverse(fs) {
	const first = await fetchPage(fs, 1);
	if (first === null) throw new Error("instrument index: first page failed");
	const total = Math.max(Number(first.total) || first.diff.length, first.diff.length);
	const rows = [...first.diff];
	const pages = Math.ceil(total / PAGE_SIZE);
	for (let start = 2; start <= pages; start += CHUNK) {
		const chunk = [];
		for (let p = start; p < start + CHUNK && p <= pages; p++) chunk.push(p);
		const results = await Promise.all(chunk.map((p) => fetchPage(fs, p).catch(() => null)));
		for (const data of results) {
			if (data === null) continue; // tolerate a failed page; dedupe below
			rows.push(...data.diff);
		}
	}
	// dedupe by code (failed pages retried in later refreshes)
	const seen = new Set();
	const out = [];
	for (const r of rows) {
		const code = String(r.f12 ?? "");
		if (seen.has(code)) continue;
		seen.add(code);
		out.push(r);
	}
	return out;
}

let indexState = {
	rows: null, // Array<shapedRow>
	builtAt: 0,
	building: null, // in-flight Promise
	lastError: null,
	lastFailAt: 0,
	buildMs: 0,
};

const FAIL_BACKOFF_MS = 60 * 1000; // after a failed build, pause before retrying

async function buildIndex() {
	const t0 = Date.now();
	// Sequential universes keep the request rate gentle (bursty concurrent
	// page-1 fetches trip the gateway's IP throttling).
	const stockRaw = await fetchUniverse(FS_ALL_STOCKS);
	const fundRaw = await fetchUniverse(FS_ALL_FUNDS).catch(() => []);
	const rows = [];
	for (const r of stockRaw) {
		const shaped = shapeRow(r, true);
		if (shaped !== null) rows.push(shaped);
	}
	for (const r of fundRaw) {
		const shaped = shapeRow(r, false);
		if (shaped !== null) rows.push(shaped);
	}
	if (rows.length < 100) throw new Error("instrument index: suspiciously small snapshot");
	indexState.rows = rows;
	indexState.builtAt = Date.now();
	indexState.buildMs = Date.now() - t0;
	indexState.lastError = null;
	return indexState;
}

/** Ensure a snapshot exists; rebuilds in the background when stale. */
export function getInstrumentIndex() {
	const fresh = indexState.rows !== null && Date.now() - indexState.builtAt < INDEX_TTL;
	if (fresh) return Promise.resolve(indexState);
	// After a failed build, pause before hammering the feed again.
	if (indexState.rows === null && Date.now() - indexState.lastFailAt < FAIL_BACKOFF_MS) {
		return Promise.resolve(indexState);
	}
	if (indexState.building === null) {
		// EM gateways flap minute-to-minute; retry the whole build a few times
		// with pauses before surfacing a failure (one gateway is usually up).
		const attempt = async (n) => {
			try {
				return await buildIndex();
			} catch (error) {
				if (n <= 0) throw error;
				await new Promise((r) => setTimeout(r, 1500));
				return attempt(n - 1);
			}
		};
		indexState.building = attempt(2)
			.catch((error) => {
				indexState.lastError = error instanceof Error ? error.message : String(error);
				indexState.lastFailAt = Date.now();
				return indexState;
			})
			.finally(() => {
				indexState.building = null;
			});
	}
	// Stale data is still served immediately; only the very first search waits.
	if (indexState.rows !== null) return Promise.resolve(indexState);
	return indexState.building;
}

/** Diagnostics for meta payloads. */
export function instrumentIndexStatus() {
	return {
		ready: indexState.rows !== null,
		total: indexState.rows?.length ?? 0,
		builtAt: indexState.builtAt || null,
		buildMs: indexState.buildMs || null,
		lastError: indexState.lastError,
		rebuilding: indexState.building !== null,
	};
}

//#endregion

//#region matching

/**
 * Score one instrument against the keyword. Returns -1 when it doesn't match.
 * Pure memory work — the whole 8k universe scans in ~1ms.
 */
const TYPE_BONUS = { stock: 6, etf: 4, cb: 4, lof: 0, fund: 0 };

function scoreRow(kw, row) {
	const base = TYPE_BONUS[row.type] ?? 0;
	// Pure-digit keyword: code matching (3-6 digits, incl. ETF 5-digit codes).
	if (/^\d{3,6}$/.test(kw)) {
		if (row.code === kw) return 100 + base;
		if (row.code.startsWith(kw)) return 90 - Math.min(row.code.length - kw.length, 9);
		return -1;
	}
	const ascii = /^[a-z0-9]+$/.test(kw);
	if (ascii) {
		// Tier priority by construction: abbr exact 96 > abbr prefix 86 >
		// lower prefix 82 > abbr infix 60 > lower infix 55 — max() picks the
		// highest matching tier. Both reading variants compete equally.
		let best = -1;
		for (const ab of row.abbr2 === void 0 ? [row.abbr] : [row.abbr, row.abbr2]) {
			if (ab === kw) best = Math.max(best, 96 + base);
			else if (ab.startsWith(kw)) best = Math.max(best, 86 - Math.min(ab.length - kw.length, 9) + base);
			else if (ab.includes(kw)) best = Math.max(best, 60 + base);
		}
		if (row.lower.startsWith(kw)) best = Math.max(best, 82 + base); // ASCII inside the name, e.g. "TCL科技"
		if (row.lower.includes(kw)) best = Math.max(best, 55 + base);
		return best;
	}
	// Contains CJK: name substring match.
	if (row.lower === kw) return 100 + base;
	if (row.lower.startsWith(kw)) return 92 + base;
	if (row.lower.includes(kw)) return 70 + base;
	return -1;
}

/**
 * Search the snapshot. Returns [{row, score}] sorted best-first, capped at count.
 * @param {Array<object>} rows snapshot rows
 * @param {string} rawKw user keyword (already trimmed)
 * @param {number} count
 */
export function searchInstruments(rows, rawKw, count) {
	const kw = rawKw.toLowerCase();
	const scored = [];
	for (const row of rows) {
		const score = scoreRow(kw, row);
		if (score > 0) scored.push({ row, score });
	}
	scored.sort((a, b) => b.score - a.score || (a.row.code < b.row.code ? -1 : 1));
	return scored.slice(0, count).map((s) => s.row);
}

//#endregion

//#region Tencent smartbox fallback (full-pinyin queries the initials can't match)

/**
 * Query Tencent's smartbox suggest for full-pinyin input ("maotai", "pingan"),
 * keeping only SH/SZ A-share/fund rows. Returns [] on any failure — it is a
 * best-effort enrichment of the local index, never load-bearing.
 */
export async function searchSmartbox(kw, count) {
	// smartbox answers `v_hint="..."` JavaScript, not JSON — read it as text.
	const buffer = await fetchText(
		`https://smartbox.gtimg.cn/s3/?v=2&q=${encodeURIComponent(kw)}&t=all`,
		{ timeoutMs: 3000 }
	);
	if (buffer === null) return [];
	const text = buffer.toString("utf8");
	const m = text.match(/v_hint="(.*)"/s);
	if (!m || m[1] === "" || m[1] === "N") return [];
	const hits = [];
	for (const part of m[1].split("^")) {
		const f = part.split("~");
		if (f.length < 5) continue;
		const [market, code, name, , tag] = f;
		if (market !== "sh" && market !== "sz") continue; // drop HK/US/index rows
		if (!/^(GP|FJ|EF|LOF|FB)/.test(tag ?? "")) continue; // stocks + funds only
		if (!/^\d{5,6}$/.test(code) || name === "") continue;
		// smartbox returns \uXXXX escapes for CJK — decode them.
		const decodedName = name.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
			String.fromCharCode(parseInt(hex, 16))
		);
		hits.push({
			code,
			name: decodedName,
			market: marketFromCode(code),
			type: /^(GP)/.test(tag) ? "stock" : classify(code, false),
			quoteId: `${market === "sh" ? "1" : "0"}.${code}`,
			lower: decodedName.toLowerCase(),
			abbr: pinyinAbbr(decodedName),
		});
		if (hits.length >= count) break;
	}
	return hits;
}

//#endregion
