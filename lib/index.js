// 韭菜盒子 LeekBox — host half.
//
// Serves the A-share data source: a family of /api/leekbox/* routes that
// proxy public free quote feeds (Tencent, Sina, Eastmoney search) into
// normalized JSON for the browser half (./client), plus a persisted
// watchlist. Everything rides the shared loopback trust fence: the routes
// only answer requests arriving from the local web GUI.
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { fetchText, fetchJson, decodeGbk, fetchJsonAcrossHosts, feedError, errorDetail, userMessage } from "./fetch-utils.js";
import { fetchEmRankPage, fetchEmDailyKline, fetchEmSectorPage, fetchEmLimitPools, fetchEmFflowKline, fetchEmLonghu, fetchEmSentimentDetail, fetchEmBreadth, fetchEmF10Main, parseDateOnly } from "./emrank.js";
import { runScreener, screenerProgress, screenerMeta } from "./screener.js";
import { ERR_ALREADY_RUNNING, ERR_INVALID_PARAMS, pickScreenerParams } from "./screener-validate.js";
import { getInstrumentIndex, instrumentIndexStatus, searchInstruments, searchSmartbox, marketFromCode, tencentSymbol, TYPE_LABEL, getInstrumentIndexDelta } from "./search-index.js";
import { SESSION_LABEL, calendarSnapshot, cnDateStr, ensureCalendar, sessionSummary, setKlineProvider, sessionTtl } from "./calendar.js";
import { cached, routeCacheStats } from "./route-cache.js";

// 交易日历由指数日 K 推导（见 ./calendar.js）。provider 注入而不是在 calendar.js
// 里 import emrank.js：那条路径会形成 calendar ⇄ emrank 循环依赖。
setKlineProvider((code, opts) => fetchEmDailyKline(code, opts));

/** 插件版本，/health 与 /metrics 里回带，便于确认"跑的是哪一版"。 */
const PKG_VERSION = (() => {
	try {
		return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version ?? "";
	} catch {
		return "";
	}
})();

//#region trust fence (loopback only)

function isIPv4Loopback(v4) {
	const parts = v4.split(".");
	return parts.length === 4 && parts[0] === "127" && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

function isLoopbackAddress(address) {
	if (address === void 0) return false;
	const normalized = address.toLowerCase();
	if (normalized === "::1") return true;
	if (normalized.startsWith("::ffff:")) return isIPv4Loopback(normalized.slice(7));
	return isIPv4Loopback(normalized);
}

function isLoopbackHostname(hostname) {
	if (hostname === "localhost" || hostname === "[::1]") return true;
	return isIPv4Loopback(hostname);
}

/** Loopback fence: socket address AND Host header must be loopback. */
function isLoopbackRequest(request) {
	if (!isLoopbackAddress(request.socket.remoteAddress)) return false;
	const host = request.headers.host;
	if (typeof host !== "string") return false;
	let hostUrl;
	try {
		hostUrl = new URL("http://" + host);
	} catch {
		return false;
	}
	return isLoopbackHostname(hostUrl.hostname);
}

/** `Origin` 头是否指向本机。
 *
 * 回环栅栏只看 socket + Host，挡不住**浏览器发起的跨站请求**：恶意页面用
 * `fetch(..., {mode:"no-cors", body:"{...}"})` 打本机端口时，Host 头是
 * 127.0.0.1:19387（照常通过），响应虽然读不到，但写操作已经生效了。
 * 所以写路由必须额外看 Origin —— 它由浏览器强制填写，页面脚本改不了。
 *
 * 缺失（非浏览器调用、同源表单、curl）一律放行：那是本机用户自己的请求，
 * 栅栏要挡的是"别的网页拿着你的浏览器当跳板"。 */
function isLoopbackOrigin(origin) {
	if (typeof origin !== "string" || origin === "") return true;
	if (origin === "null") return false; // 沙箱 iframe / 隐私模式：无法确认来源
	let url;
	try {
		url = new URL(origin);
	} catch {
		return false;
	}
	return isLoopbackHostname(url.hostname);
}

/** JSON 写接口必须声明 application/json。
 *
 * 这是上面那道 Origin 检查的**第二道锁**，也是跨站 `no-cors` 的命门：字符串
 * body 的默认 Content-Type 是 text/plain，属 CORS 简单请求、不触发预检，
 * 但带不上 application/json。要求它就能把这条路径彻底堵死（并补上 415 的
 * 正确语义——以前 body 不合法一律回 400"格式不对"）。 */
function isJsonContentType(value) {
	if (typeof value !== "string") return false;
	return /^application\/(?:[a-z0-9.+-]*\+)?json\b/i.test(value.trim());
}

//#endregion

//#region http helpers

const JSON_HEADERS = {
	"content-type": "application/json; charset=utf-8",
	"referrer-policy": "no-referrer",
	"cache-control": "no-store",
};

function writeJson(res, status, body) {
	res.writeHead(status, JSON_HEADERS);
	res.end(JSON.stringify(body));
}

async function readJsonBody(req, maxBytes = 128 * 1024) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		const buffer = chunk;
		size += buffer.length;
		if (size > maxBytes) {
			req.destroy();
			return null;
		}
		chunks.push(buffer);
	}
	const text = Buffer.concat(chunks).toString("utf8");
	if (text === "") return null;
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

function queryParam(url, name) {
	const value = url.searchParams.get(name);
	return value === null ? void 0 : value;
}

function isJsonObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

//#endregion

//#region fetch helpers (imported from fetch-utils.js)
//#endregion

//#region Tencent quote parsing

/**
 * Parse one v_<code>="..." line from qt.gtimg.cn into a normalized quote.
 * Field index reference (0-based, ~ separated):
 *   1 name, 2 code, 3 price, 4 prevClose, 5 open, 6 volume(手), 7 outer, 8 inner,
 *   30 time yyyyMMddHHmmss, 31 change, 32 changePct, 33 high, 34 low,
 *   37 amount(万), 38 turnoverRate, 39 pe, 41 high2, 42 low2, 43 amplitude,
 *   44 floatMv(亿), 45 totalMv(亿), 46 pb, 47 limitUp, 48 limitDown, 49 volumeRatio
 */
function parseTencentLine(line) {
	const eq = line.indexOf("=");
	if (eq < 0) return null;
	const key = line.slice(0, eq).trim();
	const code = key.startsWith("v_") ? key.slice(2) : key;
	const value = line.slice(eq + 1).trim();
	if (!value.startsWith('"')) return null;
	const body = value.slice(1, value.lastIndexOf('"'));
	const f = body.split("~");
	if (f.length < 40 || f[1] === "") return null;
	const num = (i) => {
		const v = Number(f[i]);
		return Number.isFinite(v) ? v : null;
	};
	return {
		code: code || f[2],
		name: f[1],
		price: num(3),
		prevClose: num(4),
		open: num(5),
		volume: num(6), // 手
		high: num(33),
		low: num(34),
		time: f[30] || "",
		change: num(31),
		changePct: num(32),
		amount: num(37), // 万元
		turnoverRate: num(38),
		pe: num(39),
		amplitude: num(43),
		floatMv: num(44), // 亿元
		totalMv: num(45), // 亿元
		pb: num(46),
		limitUp: num(47),
		limitDown: num(48),
		volumeRatio: num(49),
		market: code.startsWith("sh") ? "SH" : code.startsWith("sz") ? "SZ" : code.startsWith("bj") ? "BJ" : "",
	};
}

/** Normalize a user-supplied code: "600519" -> "sh600519" (defaults: 6xx/5xx/9xx->sh, 0/2/3->sz, 4/8->bj). */
function normalizeCode(raw) {
	let code = String(raw).trim().toLowerCase();
	// Accept 5- or 6-digit codes with or without prefix (ETF／沪市转债 may be 5-digit).
	if (/^(sh|sz|bj)\d{5,6}$/.test(code)) return code;
	const digits = code.replace(/\D/g, "");
	if (!/^\d{5,6}$/.test(digits)) return null;
	// 11xxxx → 沪市可转债 110/113/118
	if (digits.startsWith("11")) return "sh" + digits;
	// 43/83/87/92xxxx → 北交所（92 在 9 之前判断，避免被并入沪市 B 股）
	if (/^(4|8|92)/.test(digits)) return "bj" + digits;
	// 5/6/9 → 沪市（5=ETF/LOF, 6=主板, 9=B股）
	if (digits.startsWith("5") || digits.startsWith("6") || digits.startsWith("9")) return "sh" + digits;
	// 0/1/2/3 → 深市（0/3=主板/创业板, 1=ETF/LOF/转债, 2=B股）
	return "sz" + digits;
}

/** Index codes (normalized): 上证系列 sh000xxx、深证系列 sz399xxx、北证 bj899xxx
 * （沪市个股从不以 000 开头，深市个股从不以 399 开头，故前缀判定无歧义）。
 * 指数不是可交易标的，禁止写入自选股。 */
const INDEX_CODE_RE = /^(?:sh000|sz399|sh899|bj899)/;

/** Today's date as YYYY-MM-DD, used for the longhu default. */
function todayStr() {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

//#endregion

//#region Sina news parsing

/** Parse the Sina 7x24 zhibo feed into a flat news list. */
function parseSinaNews(payload) {
	const feed = payload?.result?.data?.feed?.list;
	if (!Array.isArray(feed)) return [];
	return feed
		.map((item) => {
			let stocks = [];
			let docurl = item.docurl ?? "";
			try {
				const ext = JSON.parse(item.ext ?? "{}");
				if (Array.isArray(ext.stocks)) {
					stocks = ext.stocks
						.filter((s) => s && s.symbol)
						.map((s) => ({
							symbol: s.symbol,
							name: s.key ?? "",
							market: s.market ?? "",
						}));
				}
				if (!docurl && ext.docurl) docurl = ext.docurl;
			} catch {
				/* ext malformed — ignore */
			}
			const tags = Array.isArray(item.tag) ? item.tag.map((t) => t.name ?? "").filter(Boolean) : [];
			return {
				id: String(item.id ?? ""),
				source: "sina",
				text: item.rich_text ?? "",
				time: item.create_time ?? "",
				ts: newsTimeToMs(item.create_time),
				tags,
				stocks,
				url: docurl,
				anchor: item.anchor ?? "",
				important: Number(item.is_focus) === 1 || Number(item.top_value) > 0,
			};
		})
		.filter((n) => n.text !== "");
}

//#endregion

//#region multi-source news (sina / eastmoney / jin10)

/** Parse common Chinese feed datetime strings ("2026-08-26 10:52:34", "08-26 10:52", "10:52") into epoch ms; null when unparseable. */
function newsTimeToMs(s) {
	const t = String(s ?? "").trim();
	if (t === "") return null;
	let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
	if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0).getTime();
	m = t.match(/^(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
	if (m) {
		const now = new Date();
		return new Date(now.getFullYear(), +m[1] - 1, +m[2], +m[3], +m[4], m[5] ? +m[5] : 0).getTime();
	}
	m = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
	if (m) {
		const now = new Date();
		return new Date(now.getFullYear(), now.getMonth(), now.getDate(), +m[1], +m[2], m[3] ? +m[3] : 0).getTime();
	}
	return null;
}

/** Keyword fallback so important flashes stand out even without a source flag. */
const NEWS_IMPORTANT_KW = /(突发|重磅|重大|紧急|超预期)/;

/** Strip HTML tags/entities from rich flash content. */
function stripHtml(s) {
	return String(s ?? "")
		.replace(/<[^>]*>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/\s+/g, " ")
		.trim();
}

async function fetchSinaNews(size) {
	const payload = await fetchJson(
		`https://zhibo.sina.com.cn/api/zhibo/feed?page=1&page_size=${Math.min(Math.max(size, 5), 100)}&zhibo_id=152&tag_id=0&dire=f&dpc=1`
	);
	if (payload === null) throw feedError("新浪快讯源暂时不可用", "sina zhibo: empty response");
	return parseSinaNews(payload);
}

/** Eastmoney 7x24 fast news (kuaixun.eastmoney.com). titleColor semantics are not public — importance relies on keywords. */
async function fetchEastmoneyNews(size) {
	const payload = await fetchJson(
		`https://np-listapi.eastmoney.com/comm/web/getFastNewsList?client=web&biz=web_724&fastColumn=102&sortEnd=&pageSize=${Math.min(
			Math.max(size, 5),
			100
		)}&req_trace=${Date.now()}`,
		{ headers: { referer: "https://kuaixun.eastmoney.com/" } }
	);
	const rows = payload?.data?.fastNewsList;
	if (!Array.isArray(rows)) throw feedError("东财快讯源暂时不可用", "em fastNewsList: missing data.fastNewsList");
	return rows.map((r) => ({
		id: `em-${r.code ?? r.realSort ?? ""}`,
		source: "em",
		text: stripHtml(r.title) || stripHtml(r.summary),
		time: String(r.showTime ?? ""),
		ts: newsTimeToMs(r.showTime),
		tags: [],
		stocks: [],
		url: "",
		anchor: "",
		important: r.titleColor === 1 || r.titleColor === "red",
	}));
}

/** Jin10 flash feed (flash_newest.js is "var newest = [...]"); English-only flashes are skipped. */
async function fetchJin10News(size) {
	const buffer = await fetchText(`https://www.jin10.com/flash_newest.js?t=${Date.now()}`, {
		headers: { referer: "https://www.jin10.com/" },
	});
	if (buffer === null) throw feedError("金十快讯源暂时不可用", "jin10 flash_newest: empty response");
	const text = buffer.toString("utf8");
	const start = text.indexOf("[");
	const end = text.lastIndexOf("]");
	if (start < 0 || end <= start) throw feedError("金十快讯源返回内容异常", "jin10 flash_newest: no JSON array in body");
	const rows = JSON.parse(text.slice(start, end + 1));
	const out = [];
	for (const r of rows) {
		const content = stripHtml(r?.data?.content ?? "");
		const title = stripHtml(r?.data?.title ?? "");
		const full = title && content && !content.startsWith(title) ? `${title} ${content}` : content || title;
		if (full === "") continue;
		if (!/[\u4e00-\u9fff]/.test(full)) continue; // skip English-only flashes
		out.push({
			id: `j10-${r.id ?? ""}`,
			source: "jin10",
			text: full,
			time: String(r.time ?? ""),
			ts: newsTimeToMs(r.time),
			tags: [],
			stocks: [],
			url: r?.data?.source_link ?? "",
			anchor: "",
			important: r.important === 1 || r.important === true,
		});
		if (out.length >= Math.min(Math.max(size, 5), 100)) break;
	}
	return out;
}

const NEWS_FETCHERS = { sina: fetchSinaNews, em: fetchEastmoneyNews, jin10: fetchJin10News };

/** Two flashes inside this window whose text is near-identical count as one
 * event reported by several sources; templated flashes repeating hours apart
 * never collapse. */
const NEWS_DUP_WINDOW_MS = 10 * 60 * 1000;
/** Fuzzy matching only fires on texts long enough to be specific. */
const NEWS_DUP_MIN_LEN = 8;
/** Bigram-overlap floors: enough shared character pairs plus either a high
 * Jaccard ratio or one text almost fully contained in the other. */
const NEWS_DUP_MIN_SHARED = 6;
const NEWS_DUP_JACCARD = 0.55;
const NEWS_DUP_CONTAINED = 0.75;

/** Collapse flash text for comparison: lowercase, keep letters/digits only. */
function newsNormalizedText(text) {
	return String(text ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Character-bigram set of a normalized string — Chinese-friendly similarity. */
function newsBigrams(norm) {
	const grams = new Set();
	for (let i = 0; i + 1 < norm.length; i++) grams.add(norm.slice(i, i + 2));
	return grams;
}

/** Same-event test for two prepared records ({norm, grams, ts}). Exact and
 * prefix matches ignore time; fuzzy bigram similarity additionally requires
 * both timestamps inside NEWS_DUP_WINDOW_MS. */
function isSameNewsEvent(a, b) {
	const x = a.norm;
	const y = b.norm;
	if (x === "" || y === "") return false;
	if (x === y) return true;
	const minLen = Math.min(x.length, y.length);
	// One source truncated or extended the other's headline.
	if (minLen >= 10 && (x.startsWith(y) || y.startsWith(x))) return true;
	if (minLen < NEWS_DUP_MIN_LEN) return false;
	if (a.ts !== null && b.ts !== null && Math.abs(a.ts - b.ts) > NEWS_DUP_WINDOW_MS) return false;
	let shared = 0;
	for (const g of a.grams) if (b.grams.has(g)) shared++;
	if (shared < NEWS_DUP_MIN_SHARED) return false;
	const union = a.grams.size + b.grams.size - shared;
	return shared / union >= NEWS_DUP_JACCARD || shared / Math.min(a.grams.size, b.grams.size) >= NEWS_DUP_CONTAINED;
}

/** Merge multi-source lists: dedupe by source:id, then collapse same-event
 * flashes across sources (exact / prefix / fuzzy-in-window match — the first
 * source's copy wins, and a dropped duplicate's importance flag is inherited).
 * Keyword-highlight importance, newest first. */
function mergeNews(lists) {
	const seenId = new Set();
	const kept = [];
	const out = [];
	for (const list of lists) {
		if (!Array.isArray(list)) continue;
		for (const item of list) {
			const idKey = `${item.source}:${item.id}`;
			if (seenId.has(idKey)) continue;
			seenId.add(idKey);
			const text = String(item.text ?? item.title ?? "");
			const norm = newsNormalizedText(text);
			const rec = {
				norm,
				grams: norm === "" ? null : newsBigrams(norm),
				ts: Number.isFinite(item.ts) ? item.ts : null,
			};
			const dupIdx = kept.findIndex((k) => isSameNewsEvent(k, rec));
			if (dupIdx >= 0) {
				if (item.important === true && out[dupIdx].important !== true) out[dupIdx].important = true;
				continue;
			}
			kept.push(rec);
			out.push({ ...item, important: item.important === true || NEWS_IMPORTANT_KW.test(text) });
		}
	}
	out.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
	return out;
}

//#endregion

//#region watchlist storage

function watchlistPath(dshHome) {
	return join(dshHome, ".leekbox-watchlist.json");
}

function readWatchlist(dshHome) {
	try {
		const raw = readFileSync(watchlistPath(dshHome), "utf8");
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed)) return parsed;
	} catch {
		/* missing or invalid — start empty */
	}
	return [];
}

/** Validate a position quantity (股数): a non-negative integer capped at 1e10;
 *  anything else is rejected (null). 0 means "no position" and is dropped. */
function parseQty(v) {
	if (typeof v !== "number" || !Number.isFinite(v)) return null;
	const n = Math.round(v);
	if (n < 0 || n > 1e10) return null;
	return n;
}

/** Validate a cost price (成本价): a positive finite number capped at 1e7; else null. */
function parseCost(v) {
	if (typeof v !== "number" || !Number.isFinite(v)) return null;
	if (v <= 0 || v > 1e7) return null;
	return v;
}

/** Drop the empty-position fields so stored entries stay compact. */
function withPosition(entry, qty, cost) {
	if (qty !== null && qty > 0) entry.qty = qty;
	if (cost !== null) entry.cost = cost;
	return entry;
}

/**
 * Serialize read-modify-write cycles on a JSON-backed list (watchlist, alerts).
 * add/remove/import are "read -> transform -> write" triples; two concurrent
 * requests could interleave between the read and the write and lose an update
 * (the atomic rename only prevents a torn file, not a lost entry). The queue
 * chains every mutation so each cycle sees the previous one's result; a thrown
 * transform keeps the chain alive for later mutations.
 */
function makeListLock() {
	let queue = Promise.resolve();
	return function withLock(run) {
		const task = queue.then(() => run());
		queue = task.then(
			() => undefined,
			() => undefined
		);
		return task;
	};
}

const withWatchlistLock = makeListLock();
const withAlertsLock = makeListLock();

function writeWatchlist(dshHome, list) {
	const file = watchlistPath(dshHome);
	const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
	try {
		writeFileSync(tmp, JSON.stringify(list, null, 2), "utf8");
		renameSync(tmp, file);
		return true;
	} catch {
		try {
			if (existsSync(tmp)) unlinkSync(tmp);
		} catch {}
		return false;
	}
}

//#endregion

//#region alerts storage
// 价格预警持久化:与自选股同一套"临时文件 + 原子改名"写法。条件求值放在客户端
// (面板轮询行情时判定),服务端只负责存取——不常驻计时器、不引入推送通道。

function alertsPath(dshHome) {
	return join(dshHome, ".leekbox-alerts.json");
}

function readAlerts(dshHome) {
	try {
		const raw = readFileSync(alertsPath(dshHome), "utf8");
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed)) return parsed;
	} catch {
		/* missing or invalid — start empty */
	}
	return [];
}

function writeAlerts(dshHome, list) {
	const file = alertsPath(dshHome);
	const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
	try {
		writeFileSync(tmp, JSON.stringify(list, null, 2), "utf8");
		renameSync(tmp, file);
		return true;
	} catch {
		try {
			if (existsSync(tmp)) unlinkSync(tmp);
		} catch {}
		return false;
	}
}

/** Alert kinds: above/below watch an absolute price, pctUp/pctDown a percent move. */
const ALERT_KINDS = {
	above: "价格涨到",
	below: "价格跌破",
	pctUp: "涨幅达到",
	pctDown: "跌幅达到",
};
/** Cap stored alerts so a looping client cannot grow the file forever. */
const ALERTS_MAX = 100;

//#endregion

//#region watchlist import parsing

/** Largest number of entries a single import may add. */
const IMPORT_MAX_ENTRIES = 500;
/** Cap the invalid-item echo so a garbage file cannot blow up the response. */
const IMPORT_MAX_INVALID = 50;

const unquoteCsv = (cell) =>
	cell.length >= 2 && cell.startsWith('"') && cell.endsWith('"') ? cell.slice(1, -1).replace(/""/g, '"') : cell;

/**
 * Parse imported watchlist content. Accepts:
 *  - JSON: the export shape ({version, watchlist:[...]}) or a bare array of
 *    {code, name?, group?, qty?, cost?, addedAt?} entries;
 *  - CSV / pasted text: one stock per line as "code[,name[,group[,qty[,cost]]]]"
 *    (comma, semicolon, tab or whitespace separated), optionally quoted; a
 *    header row ("code,..." / "代码,...") is skipped.
 * Returns { entries, invalid }: entries normalized + deduped by code,
 * invalid holds up to IMPORT_MAX_INVALID offending raw tokens.
 */
function parseWatchlistImport(content) {
	const text = String(content ?? "").trim();
	const entries = [];
	const invalid = [];
	const seen = new Set();
	const push = (raw, name, group, addedAt, qty, cost) => {
		const code = normalizeCode(raw);
		if (code === null || INDEX_CODE_RE.test(code)) {
			if (invalid.length < IMPORT_MAX_INVALID) invalid.push(String(raw ?? "").trim().slice(0, 24));
			return;
		}
		if (seen.has(code) || entries.length >= IMPORT_MAX_ENTRIES) return;
		seen.add(code);
		const entry = {
			code,
			name: typeof name === "string" && name.trim() !== "" ? name.trim().slice(0, 24) : code,
			group: typeof group === "string" && group.trim() !== "" ? group.trim().slice(0, 12) : "默认",
			addedAt: typeof addedAt === "string" && addedAt.trim() !== "" ? addedAt.trim() : void 0,
		};
		// Position columns are best-effort: a bad qty/cost is dropped, not fatal —
		// a half-typed import line shouldn't reject the whole stock.
		const q = parseQty(Number(qty));
		if (q !== null && q > 0) entry.qty = q;
		const c = parseCost(Number(cost));
		if (c !== null) entry.cost = c;
		entries.push(entry);
	};
	if (text.startsWith("{") || text.startsWith("[")) {
		let data;
		try {
			data = JSON.parse(text);
		} catch {
			return { entries, invalid: ["<JSON 解析失败>"] };
		}
		const rows = Array.isArray(data) ? data : isJsonObject(data) && Array.isArray(data.watchlist) ? data.watchlist : [];
		for (const row of rows) {
			if (!isJsonObject(row)) continue;
			push(row.code, row.name, row.group, row.addedAt, row.qty, row.cost);
		}
		return { entries, invalid };
	}
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (trimmed === "") continue;
		const cells = trimmed.split(/[,;\t]/).map((c) => unquoteCsv(c.trim()));
		// Skip a header row like "code,name,group,qty,cost" / "代码,名称,分组".
		if (/^(code|代码)$/i.test(cells[0])) continue;
		// Plain whitespace-separated "600519 贵州茅台 长线" also works.
		const parts = cells.length === 1 ? trimmed.split(/\s+/) : cells;
		push(parts[0], parts[1], parts[2], void 0, parts[3], parts[4]);
	}
	return { entries, invalid };
}

//#endregion

//#region routes

const ROUTES = {
	health: "/api/leekbox/health",
	quote: "/api/leekbox/quote",
	indices: "/api/leekbox/indices",
	kline: "/api/leekbox/kline",
	minute: "/api/leekbox/minute",
	search: "/api/leekbox/search",
	calendar: "/api/leekbox/calendar",
	metrics: "/api/leekbox/metrics",
	rank: "/api/leekbox/rank",
	sector: "/api/leekbox/sector",
	sentiment: "/api/leekbox/sentiment",
	fflow: "/api/leekbox/fflow",
	f10: "/api/leekbox/f10",
	longhu: "/api/leekbox/longhu",
	news: "/api/leekbox/news",
	watchlist: "/api/leekbox/watchlist",
	alerts: "/api/leekbox/alerts",
	screener: "/api/leekbox/screener",
	screenerMeta: "/api/leekbox/screener/meta",
	screenerProgress: "/api/leekbox/screener/progress",
	screenerStream: "/api/leekbox/screener/stream",
	universe: "/api/leekbox/universe",
};

/** The four headline indices, quoted through Tencent. */
const INDEX_CODES = ["sh000001", "sz399001", "sz399006", "sh000688"];

async function fetchTencentQuotes(codes) {
	const url = `https://qt.gtimg.cn/q=${codes.join(",")}`;
	const buffer = await fetchText(url);
	if (buffer === null) return [];
	const text = decodeGbk(buffer);
	const out = [];
	for (const line of text.split(";")) {
		if (!line.includes('="')) continue;
		const q = parseTencentLine(line);
		if (q !== null) out.push(q);
	}
	return out;
}

function makeRoutes(ctx, deps) {
	const { logger } = deps;
	const dshHome = deps.dshHome;

	const guard = (req, res, method) => {
		if (!isLoopbackRequest(req)) {
			writeJson(res, 403, { error: "拒绝访问：本接口仅允许本机请求" });
			return false;
		}
		if (req.method !== method) {
			writeJson(res, 405, { error: `请求方法不支持：收到 ${req.method}，本接口只接受 ${method}` });
			return false;
		}
		// 写接口加两道跨站锁（详见 isLoopbackOrigin / isJsonContentType 的注释）。
		if (method === "POST") {
			if (!isLoopbackOrigin(req.headers.origin)) {
				writeJson(res, 403, { error: "拒绝访问：本接口不接受来自其他站点的写入请求" });
				return false;
			}
			if (!isJsonContentType(req.headers["content-type"])) {
				writeJson(res, 415, { error: "请求体类型不支持：写接口需要 content-type: application/json" });
				return false;
			}
		}
		return true;
	};

	/** 统一的失败出口。
	 *
	 * 浏览器只渲染 error 字段,所以这里只放中文:上游抛的中文文案原样透出,
	 * 万一漏了英文(Node 内建错误、第三方库、未翻译的上游异常)就换成通用文案,
	 * 技术细节走 reason —— 界面不显示,但 devtools / 日志里查得到。 */
	const fail = (res, error) => {
		logger.warn(error);
		writeJson(res, 502, {
			error: userMessage(error),
			reason: errorDetail(error) || (error instanceof Error ? error.message : String(error)),
		});
	};

	return [
		{
			kind: "exact",
			path: ROUTES.health,
			handler: async (req, res) => {
				if (!guard(req, res, "GET")) return;
				// 交易日历首次请求不阻塞：后台构建，构建好后同一进程的后续请求
				// 就拿到真实日历（`source` 字段如实标注用的是哪一路）。
				ensureCalendar();
				writeJson(res, 200, {
					ok: true,
					plugin: "leekbox",
					version: PKG_VERSION,
					watchlist: readWatchlist(dshHome).length,
					alerts: readAlerts(dshHome).length,
					session: sessionSummary(),
					index: instrumentIndexStatus(),
					caches: routeCacheStats(),
				});
			},
		},
		{
			kind: "exact",
			path: ROUTES.calendar,
			handler: async (req, res) => {
				if (!guard(req, res, "GET")) return;
				try {
					// 首次（或重建窗口内）触发后台构建，但**不 await**：拿不到真实
					// 日历时立刻用工作日启发式回答，绝不把首个请求拖在网络上。
					ensureCalendar();
					writeJson(res, 200, calendarSnapshot());
				} catch (error) {
					fail(res, error);
				}
			},
		},
		{
			kind: "exact",
			path: ROUTES.metrics,
			handler: async (req, res) => {
				if (!guard(req, res, "GET")) return;
				try {
					writeJson(res, 200, {
						ok: true,
						version: PKG_VERSION,
						uptimeSec: Math.round(process.uptime()),
						session: sessionSummary(),
						index: instrumentIndexStatus(),
						caches: routeCacheStats(),
					});
				} catch (error) {
					fail(res, error);
				}
			},
		},
		{
			kind: "exact",
			path: ROUTES.quote,
			handler: async (req, res) => {
				if (!guard(req, res, "GET")) return;
				try {
					const raw = queryParam(new URL(req.url ?? "/", "http://x"), "codes") ?? "";
					const codes = raw
						.split(",")
						.map((c) => c.trim())
						.filter(Boolean)
						.slice(0, 50)
						.map(normalizeCode)
						.filter((c) => c !== null);
					if (codes.length === 0) {
						writeJson(res, 400, { error: "缺少参数 codes：用法 ?codes=sh600519,sz000001" });
						return;
					}
					// 短 TTL：行情要新鲜，但多开详情窗 / 自选 + 预警看护会并发同一批
					// 码，单飞能把这一批合并成一次上游请求。3s 对 10~15s 的客户端
					// 轮询周期几乎不损失新鲜度，盘后 TTL 顺势拉长。
					const key = codes.slice().sort().join(",");
					const quotes = await cached({
						name: "quote",
						key,
						ttlMs: () => sessionTtl(3000),
						max: 100,
						load: () => fetchTencentQuotes(codes),
					});
					writeJson(res, 200, { quotes });
				} catch (error) {
					fail(res, error);
				}
			},
		},
		{
			kind: "exact",
			path: ROUTES.indices,
			handler: async (req, res) => {
				if (!guard(req, res, "GET")) return;
				try {
					// 指数只有固定 4 个码、多个页签都在读，是最该去重的一条。
					const indices = await cached({
						name: "indices",
						key: "index",
						ttlMs: () => sessionTtl(3000),
						max: 4,
						load: () => fetchTencentQuotes(INDEX_CODES),
					});
					writeJson(res, 200, { indices });
				} catch (error) {
					fail(res, error);
				}
			},
		},
		{
			kind: "exact",
			path: ROUTES.kline,
			handler: async (req, res) => {
				if (!guard(req, res, "GET")) return;
				try {
					const url = new URL(req.url ?? "/", "http://x");
					const code = normalizeCode(queryParam(url, "code") ?? "");
					if (code === null) {
						writeJson(res, 400, { error: "缺少参数 code：用法 ?code=sh600519" });
						return;
					}
					const period = queryParam(url, "period") ?? "day"; // day|week|month|m5|m15|m30|m60
					const count = Math.min(Math.max(Number(queryParam(url, "count") ?? 120) || 120, 5), 1000);
					const fq = queryParam(url, "fq") ?? "qfq"; // qfq|hfq|none
					const isMinute = /^m\d+$/.test(period);
					const fqSuffix = isMinute || fq === "none" ? "" : fq;
					// 分钟线盘中每根都在变，TTL 必须短；日/周/月线一天只动一次，
					// 盘后可以把 TTL 拉到小时级（跨页签、多窗口复用同一份结果）。
					const ttlOpen = isMinute ? 30 * 1000 : 5 * 60 * 1000;
					const body = await cached({
						name: "kline",
						key: `${code}|${period}|${count}|${fq}`,
						ttlMs: () => sessionTtl(ttlOpen),
						max: 240,
						// 历史 K 线是低频数据：上游抖动时给旧值远好过整张图空白。
						staleIfError: isMinute ? 0 : 30 * 60 * 1000,
						load: async () => {
							// day/week/month -> fqkline (code,period,,,count,fq); minutes -> mkline (code,period,,count).
							// web.ifzq intermittently serves anti-bot challenge pages; ifzq.gtimg.cn
							// returns the identical payload and acts as the fallback host.
							let klines = null;
							if (isMinute) {
								const { payload } = await fetchJsonAcrossHosts(
									["https://ifzq.gtimg.cn", "https://web.ifzq.gtimg.cn"],
									(host) => `${host}/appstock/app/kline/mkline?param=${encodeURIComponent(`${code},${period},,${count}`)}`
								);
								const data = payload?.data?.[code];
								const rows = data?.[period] ?? data?.day;
								if (Array.isArray(rows)) {
									klines = rows.map((r) => ({
										date: r[0],
										open: Number(r[1]),
										close: Number(r[2]),
										high: Number(r[3]),
										low: Number(r[4]),
										volume: Number(r[5]),
									}));
								}
							} else {
								// Daily/weekly/monthly bars: Tencent first, then the independent
								// Eastmoney history feed (which also serves forward-adjusted data
								// and survives Tencent's anti-bot rate limiting under load).
								try {
									const { payload } = await fetchJsonAcrossHosts(
										["https://ifzq.gtimg.cn", "https://web.ifzq.gtimg.cn"],
										(host) =>
											`${host}/appstock/app/fqkline/get?param=${encodeURIComponent(`${code},${period},,,${count},${fqSuffix}`)}`
									);
									const data = payload?.data?.[code];
									// fq=none 时腾讯把序列放在裸周期键下（day/week/month），
									// 以前恒取 "day"，于是 week/month + fq=none 必然 502。
									const dataKey = isMinute || fq === "none" ? period : `${fq}${period}`;
									const rows = data?.[dataKey] ?? data?.day;
									if (Array.isArray(rows)) {
										klines = rows.map((r) => ({
											date: r[0],
											open: Number(r[1]),
											close: Number(r[2]),
											high: Number(r[3]),
											low: Number(r[4]),
											volume: Number(r[5]),
										}));
									}
								} catch {
									// Tencent blocked/rate-limited — fall back to Eastmoney.
								}
								// 兜底要与请求的周期 / 复权口径一致：以前只兜 day 且写死
								// fqt=1（前复权），请求 hfq 时会拿到前复权数据却标着 hfq。
								const klt = { day: 101, week: 102, month: 103 }[period];
								if (klines === null && klt !== void 0) {
									const fqt = fq === "qfq" ? 1 : fq === "hfq" ? 2 : 0;
									const em = await fetchEmDailyKline(code, { lmt: count, klt, fqt });
									if (Array.isArray(em)) klines = em.slice(-count);
								}
							}
							if (klines === null) {
								throw feedError(
									`没有取到 ${code} 的 K 线数据（周期 ${period}），请稍后重试`,
									`tencent fqkline + em fallback both empty (code=${code} period=${period} fq=${fq} count=${count})`
								);
							}
							return { code, period, fq, klines };
						},
					});
					writeJson(res, 200, body);
				} catch (error) {
					fail(res, error);
				}
			},
		},
		{
			kind: "exact",
			path: ROUTES.minute,
			handler: async (req, res) => {
				if (!guard(req, res, "GET")) return;
				try {
					const url = new URL(req.url ?? "/", "http://x");
					const code = normalizeCode(queryParam(url, "code") ?? "");
					if (code === null) {
						writeJson(res, 400, { error: "缺少参数 code：用法 ?code=sh600519" });
						return;
					}
					// 分时图每笔都在动：盘中 20s 足够（客户端整窗是 10s 轮询 quote，
					// 分时只在切到「分时」页签时取），盘后一整天不会变，TTL 拉长。
					const body = await cached({
						name: "minute",
						key: code,
						ttlMs: () => sessionTtl(20 * 1000),
						max: 40,
						load: async () => {
							const { payload } = await fetchJsonAcrossHosts(
								["https://ifzq.gtimg.cn", "https://web.ifzq.gtimg.cn"],
								(host) => `${host}/appstock/app/minute/query?code=${code}`
							);
							const node = payload?.data?.[code]?.data;
							const rows = Array.isArray(node?.data) ? node.data : [];
							const points = rows.map((line) => {
								const [time, price, volume, amount] = line.split(/\s+/);
								return {
									time,
									price: Number(price),
									volume: Number(volume),
									amount: Number(amount),
								};
							});
							return {
								code,
								date: node?.date ?? "",
								points,
								qt: payload?.data?.[code]?.qt ?? null,
							};
						},
					});
					writeJson(res, 200, body);
				} catch (error) {
					fail(res, error);
				}
			},
		},
		{
			kind: "exact",
			path: ROUTES.search,
			handler: async (req, res) => {
				if (!guard(req, res, "GET")) return;
				try {
					const url = new URL(req.url ?? "/", "http://x");
					const kw = (queryParam(url, "kw") ?? "").trim();
					if (kw === "") {
						writeJson(res, 400, { error: "缺少参数 kw：请提供搜索关键词" });
						return;
					}
					const count = Math.min(Math.max(Number(queryParam(url, "count") ?? 12) || 12, 1), 50);
					const t0 = Date.now();
					// Fast path: the full-market instrument snapshot (built once, cached
					// ~6h) answers code / name / pinyin-initial searches in ~1ms.
					// Bound the cold-start wait: a healthy build finishes in a few
					// seconds, but an unreachable feed would otherwise block the first
					// search for minutes (3 rounds × 3 hosts × 8s per page, ×3 tries).
					// On timeout we fall through to the legacy suggest adapter while
					// the build keeps running in the background.
					let idxTimer = null;
					const index = await Promise.race([
						getInstrumentIndex(),
						new Promise((resolve) => {
							idxTimer = setTimeout(() => resolve(null), 3000);
						}),
					]);
					if (idxTimer !== null) clearTimeout(idxTimer);
					let hits = [];
					let source = "index";
					if (index?.rows) {
						hits = searchInstruments(index.rows, kw, count);
						// Full-pinyin queries ("maotai") don't match initials-only rows:
						// enrich via Tencent's smartbox suggest when the index came up
						// short. Best-effort — failures just return fewer hits.
						if (hits.length === 0 && /^[a-z]+$/.test(kw)) {
							const sb = await searchSmartbox(kw, count).catch(() => []);
							hits = sb;
							if (sb.length > 0) source = "smartbox";
						}
					} else {
						// Cold/failed snapshot: keep the legacy Eastmoney suggest adapter
						// working (slow but immediate) while the index builds.
						source = "suggest";
						const payload = await fetchJson(
							`https://searchadapter.eastmoney.com/api/suggest/get?input=${encodeURIComponent(
								kw
							)}&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=${count}`
						);
						const rows = payload?.QuotationCodeTable?.Data ?? [];
						hits = rows
							.filter((r) => r.Classify === "AStock" || r.Classify === "Fund" || r.Classify === "Bond")
							.map((r) => {
								const code = String(r.Code ?? "");
								return {
									code,
									name: r.Name,
									market: marketFromCode(code),
									type: r.Classify === "AStock" ? "stock" : r.Classify === "Bond" ? "cb" : "fund",
									quoteId: r.QuoteID ?? "",
									lower: String(r.Name ?? "").toLowerCase(),
									abbr: String(r.PinYin ?? "").toLowerCase(),
								};
							});
					}
					// Attach live quotes (best effort): one batched Tencent call for the
					// result set so the UI can show price / change % inline. Quote
					// failure/hang just leaves the fields null (raced at 2.5s so the
					// search stays fast even when Tencent drags).
					const symbols = hits.map((s) => tencentSymbol(s.code, s.market));
					const quotes =
						symbols.length > 0
							? await Promise.race([
									fetchTencentQuotes(symbols),
									new Promise((resolve) => setTimeout(() => resolve([]), 2500)),
								])
							: [];
					// parseTencentLine keys quotes by the prefixed symbol ("sh600519").
					const quoteByCode = new Map(quotes.map((q) => [q.code, q]));
					const shaped = hits.map((s) => {
						const q = quoteByCode.get(tencentSymbol(s.code, s.market));
						return {
							code: s.code,
							name: s.name,
							pinyin: s.abbr,
							market: s.market,
							type: s.type,
							typeLabel: TYPE_LABEL[s.type] ?? "",
							classify:
								s.type === "stock" ? "AStock" : s.type === "cb" ? "Bond" : "Fund",
							quoteId: s.quoteId,
							price: q?.price ?? null,
							change: q?.change ?? null,
							changePct: q?.changePct ?? null,
							turnoverRate: q?.turnoverRate ?? null,
							amount: q?.amount ?? null,
							time: q?.time ?? "",
						};
					});
					writeJson(res, 200, {
						kw,
						hits: shaped,
						source,
						meta: { ...instrumentIndexStatus(), elapsedMs: Date.now() - t0 },
					});
				} catch (error) {
					fail(res, error);
				}
			},
		},
		{
			kind: "exact",
			path: ROUTES.rank,
			handler: async (req, res) => {
				if (!guard(req, res, "GET")) return;
				try {
					const url = new URL(req.url ?? "/", "http://x");
					// sort: changepercent | price | amount | turnoverratio | volume
					const sort = queryParam(url, "sort") ?? "changepercent";
					const order = queryParam(url, "order") ?? "desc";
					const page = Math.max(Number(queryParam(url, "page") ?? 1) || 1, 1);
					const size = Math.min(Math.max(Number(queryParam(url, "size") ?? 20) || 20, 5), 100);
					// node: hs_a 沪深A股 | sh_a 沪A | sz_a 深A | cyb 创业板 | kcb 科创板
					//       main 主板(沪+深) | non_main 非主板(创业板+科创板) | etf/cb/lof 场内基金
					const node = queryParam(url, "node") ?? "hs_a";
					// 榜单是 clist 域最贵的一条，客户端 60s 轮一次；15s TTL 把多页签 /
					// 多窗口的重复请求合并掉，同时留住盘中应有的新鲜度。上游抖动时
					// 10 分钟内的旧值好过整页 502。
					const body = await cached({
						name: "rank",
						key: `${node}|${sort}|${order}|${page}|${size}`,
						ttlMs: () => sessionTtl(15 * 1000),
						max: 240,
						staleIfError: 10 * 60 * 1000,
						load: async () => {
							// Ranks read Eastmoney's clist gateway first (legacy Sina row shape)
							// and fall back to Sina's Market_Center feed when that route is
							// throttled — see fetchEmRankPage.
							let pageData;
							try {
								pageData = await fetchEmRankPage({ node, sort, order, page, size });
							} catch (error) {
								// 这里原本是个空 catch:上游为什么挂完全看不到,报错文案也帮不上忙。
								// 把原因带出来 —— 备用源覆盖不到的池子(主板/可转债/LOF/主力净流入)
								// 失败时,用户至少知道该换个榜看。
								const reason = error instanceof Error ? error.message : String(error);
								logger.warn(`[leekbox] rank feed failed (node=${node} sort=${sort} page=${page}): ${errorDetail(error) || reason}`);
								error.detail = errorDetail(error) || reason;
								throw error;
							}
							const rows = pageData.rows.map((r) => ({
								symbol: r.symbol,
								code: r.code,
								name: r.name,
								price: r.trade,
								change: r.pricechange,
								changePct: r.changepercent,
								open: r.open,
								high: r.high,
								low: r.low,
								volume: r.volume,
								amount: r.amount,
								turnoverRate: r.turnoverratio,
								pe: r.per,
								pb: r.pb,
								mktcap: r.mktcap,
								nmc: r.nmc,
								netflow: r.netflow, // 主力净流入(元)，基金/转债等可能为 null
							}));
							return {
								sort,
								order,
								page,
								size,
								total: pageData.total,
								totalPages: Math.max(1, Math.ceil(pageData.total / size)),
								rows,
							};
						},
					});
					writeJson(res, 200, body);
				} catch (error) {
					fail(res, error);
				}
			},
		},
		{
			kind: "exact",
			path: ROUTES.sector,
			handler: async (req, res) => {
				if (!guard(req, res, "GET")) return;
				try {
					const url = new URL(req.url ?? "/", "http://x");
					const type = queryParam(url, "type") ?? "industry"; // industry|concept|region
					const sort = queryParam(url, "sort") ?? "f3";
					const order = queryParam(url, "order") ?? "desc";
					const page = Math.max(Number(queryParam(url, "page") ?? 1) || 1, 1);
					const size = Math.min(Math.max(Number(queryParam(url, "size") ?? 30) || 30, 5), 100);
					// 板块涨跌是分钟级变化的慢变量，但它同样走被限流的 clist 域；
					// 翻页 + 切类型会产生大量组合请求，缓存收益很高。
					const body = await cached({
						name: "sector",
						key: `${type}|${sort}|${order}|${page}|${size}`,
						ttlMs: () => sessionTtl(5 * 60 * 1000),
						max: 120,
						staleIfError: 30 * 60 * 1000,
						load: async () => {
							const data = await fetchEmSectorPage({ type, sort, order, page, size });
							return { type, sort, order, page, size, total: data.total, rows: data.rows };
						},
					});
					writeJson(res, 200, body);
				} catch (error) {
					fail(res, error);
				}
			},
		},
		{
			kind: "exact",
			path: ROUTES.sentiment,
			handler: async (req, res) => {
				if (!guard(req, res, "GET")) return;
				try {
					const body = await cached({
						name: "sentiment",
						key: "snapshot",
						// 以前是手写的一份 30s 缓存，没有单飞（两个页签同时打开会双打
						// 上游）；这里换成统一的 cached()，并叠上"池子挂了也能降级"的
						// 语义 —— 以前 push2ex 一挂，整张情绪卡直接 502。
						ttlMs: () => sessionTtl(30 * 1000),
						max: 4,
						load: async () => {
							// 三路数据源并发取数(此前逐个 await,冷启动要串行等全部分页):
							// limit 池 / breadth 全市场涨跌家数。两路任一失败都降级为 null,
							// 前端按缺失渲染,不拖垮整条情绪条。全市场总数直接用 breadth 的
							// total(同源同值),省掉一次额外的榜单请求。
							const [detail, breadth] = await Promise.all([
								fetchEmSentimentDetail().catch(() => null),
								fetchEmBreadth().catch(() => null),
							]);
							if (detail === null && breadth === null) {
								throw feedError("情绪数据暂时取不到（涨停池与涨跌家数均不可用），请稍后重试", "em sentiment: pools + breadth both failed");
							}
							return {
								ok: true,
								date: detail?.date ?? "",
								limitUp: detail?.limitUp ?? null,
								limitDown: detail?.limitDown ?? null,
								broken: detail?.broken ?? null,
								ladder: detail?.ladder ?? [],
								maxBoard: detail?.maxBoard ?? null,
								ztList: detail?.ztList ?? [],
								up: breadth?.up ?? null,
								down: breadth?.down ?? null,
								flat: breadth?.flat ?? null,
								marketTotal: breadth?.total ?? null,
								// 部分缺失要可分辨：前端据此决定"是 0 家还是没取到"。
								partial: detail === null || breadth === null,
								session: sessionSummary(),
							};
						},
					});
					writeJson(res, 200, body);
				} catch (error) {
					fail(res, error);
				}
			},
		},
		{
			kind: "exact",
			path: ROUTES.fflow,
			handler: async (req, res) => {
				if (!guard(req, res, "GET")) return;
				try {
					const url = new URL(req.url ?? "/", "http://x");
					const code = normalizeCode(queryParam(url, "code") ?? "");
					if (code === null) {
						writeJson(res, 400, { error: "缺少参数 code：用法 ?code=sh600519" });
						return;
					}
					const limit = Math.min(Math.max(Number(queryParam(url, "count") ?? 30) || 30, 5), 120);
					// 资金流是日频数据，一天只更新一次；以前每次打开详情窗都全量重取。
					const body = await cached({
						name: "fflow",
						key: code,
						ttlMs: () => sessionTtl(5 * 60 * 1000, 24),
						max: 80,
						staleIfError: 6 * 60 * 60 * 1000,
						load: async () => {
							const days = await fetchEmFflowKline(code);
							return { code, count: limit, rows: days.slice(-limit) };
						},
					});
					writeJson(res, 200, body);
				} catch (error) {
					fail(res, error);
				}
			},
		},
		{
			kind: "exact",
			path: ROUTES.f10,
			handler: async (req, res) => {
				if (!guard(req, res, "GET")) return;
				try {
					const url = new URL(req.url ?? "/", "http://x");
					const code = normalizeCode(queryParam(url, "code") ?? "");
					if (code === null) {
						writeJson(res, 400, { error: "缺少参数 code：用法 ?code=sh600519" });
						return;
					}
					// 财报摘要低频变化:每 code 缓存 1 小时,LRU 上限 80 只防无限增长。
					// （以前这份 LRU 是手写的，且没有单飞——并发两个请求会双打上游。）
					const body = await cached({
						name: "f10",
						key: code,
						ttlMs: 60 * 60 * 1000,
						max: 80,
						staleIfError: 24 * 60 * 60 * 1000,
						load: async () => ({ code, reports: await fetchEmF10Main(code) }),
					});
					writeJson(res, 200, body);
				} catch (error) {
					fail(res, error);
				}
			},
		},
		{
			kind: "exact",
			path: ROUTES.longhu,
			handler: async (req, res) => {
				if (!guard(req, res, "GET")) return;
				try {
					const url = new URL(req.url ?? "/", "http://x");
					// date 是回溯起点（当日榜单盘后才出）。留空/不传 = 中国的今天；
					// 给了非法值必须报 400 而不是静默当成今天——龙虎榜是按日期查询的，
					// 静默换日期等于给用户一份标着别的日子的数据。
					const dateRaw = (queryParam(url, "date") ?? "").trim();
					if (dateRaw !== "" && parseDateOnly(dateRaw) === null) {
						writeJson(res, 400, { error: "日期格式不正确，应为 YYYY-MM-DD（例如 2026-10-09）" });
						return;
					}
					const date = dateRaw === "" ? cnDateStr() : dateRaw;
					const page = Math.max(Number(queryParam(url, "page") ?? 1) || 1, 1);
					const size = Math.min(Math.max(Number(queryParam(url, "size") ?? 20) || 20, 5), 100);
					// 龙虎榜盘后才出、当天不再变；缓存按"请求日期 + 分页"分键
					// （以前只按日期分键，翻页会互相顶掉）。
					const body = await cached({
						name: "longhu",
						key: `${date}|${page}|${size}`,
						ttlMs: () => sessionTtl(60 * 1000, 10),
						max: 60,
						staleIfError: 6 * 60 * 60 * 1000,
						load: async () => {
							const data = await fetchEmLonghu(date, { page, size });
							// 回带请求的起点日期与真实命中日期（后者用于界面标注
							// "该日无榜单，已显示最近交易日"）。
							return { date: data.date, requestedDate: date, page, size, total: data.total, rows: data.rows };
						},
					});
					writeJson(res, 200, body);
				} catch (error) {
					fail(res, error);
				}
			},
		},
		{
			kind: "exact",
			path: ROUTES.news,
			handler: async (req, res) => {
				if (!guard(req, res, "GET")) return;
				try {
					const url = new URL(req.url ?? "/", "http://x");
					const sourceKey = queryParam(url, "source") ?? "all"; // all|sina|em|jin10
					const page = Math.max(Number(queryParam(url, "page") ?? 1) || 1, 1);
					const size = Math.min(Math.max(Number(queryParam(url, "size") ?? 30) || 30, 5), 100);
					// 快讯一次要打 3 个源；客户端 60s 轮一次，翻页还会重复取同一批
					// （服务端每次重新 merge 全量）。45s TTL + 单飞把三倍开销摊平，
					// 盘后拉长（快讯整夜照发，但没必要每 60s 重打三源）。
					const body = await cached({
						name: "news",
						key: `${sourceKey}|${page}|${size}`,
						ttlMs: () => sessionTtl(45 * 1000, 4),
						max: 60,
						staleIfError: 30 * 60 * 1000,
						load: async () => {
							const keys =
								sourceKey === "all" || !NEWS_FETCHERS[sourceKey] ? Object.keys(NEWS_FETCHERS) : [sourceKey];
							// Fetch a deeper window per source so later pages stay filled after the merge.
							const perSource = Math.min(Math.max(size * Math.min(page, 5) + 20, 30), 100);
							const settled = await Promise.allSettled(keys.map((k) => NEWS_FETCHERS[k](perSource)));
							const merged = mergeNews(settled.map((s) => (s.status === "fulfilled" ? s.value : [])));
							if (merged.length === 0 && settled.every((s) => s.status === "rejected")) {
								throw feedError("快讯源全部不可用，请稍后重试", `news: all sources failed (${keys.join(",")})`);
							}
							const start = (page - 1) * size;
							return {
								page,
								size,
								source: sourceKey,
								total: merged.length,
								totalPage: Math.max(1, Math.ceil(merged.length / size)),
								items: merged.slice(start, start + size),
							};
						},
					});
					writeJson(res, 200, body);
				} catch (error) {
					fail(res, error);
				}
			},
		},
		{
			kind: "exact",
			path: ROUTES.watchlist,
			handler: async (req, res) => {
				if (!guard(req, res, "GET")) return;
				try {
					const list = readWatchlist(dshHome);
					writeJson(res, 200, { watchlist: list });
				} catch (error) {
					fail(res, error);
				}
			},
		},
		{
			kind: "exact",
			path: ROUTES.watchlist + "/add",
			handler: async (req, res) => {
				if (!guard(req, res, "POST")) return;
				try {
					const body = await readJsonBody(req);
					if (!isJsonObject(body) || typeof body.code !== "string") {
						writeJson(res, 400, { error: "请求体格式不对：需要 { code, name? }" });
						return;
					}
					const normalized = normalizeCode(body.code);
					if (normalized === null) {
						writeJson(res, 400, { error: `股票代码无法识别：${body.code}` });
						return;
					}
					if (INDEX_CODE_RE.test(normalized)) {
						writeJson(res, 400, { error: `指数不可加入自选: ${normalized}` });
						return;
					}
					// Optional position fields: qty (股数, non-negative integer) and
					// cost (成本价, > 0). `null` explicitly clears a stored value;
					// anything else invalid is a 400 so silent data loss can't happen.
					// Validation stays outside the write lock so bad input never
					// touches the file (and 400s don't turn into 502s).
					let qty;
					let cost;
					if (body.qty !== void 0) {
						if (body.qty === null) {
							qty = null; // explicit null = clear the stored qty
						} else {
							qty = parseQty(body.qty);
							if (qty === null) {
								writeJson(res, 400, { error: "持仓数量无效：需要非负整数（股）" });
								return;
							}
						}
					}
					if (body.cost !== void 0) {
						if (body.cost === null) {
							cost = null; // explicit null = clear the stored cost
						} else {
							cost = parseCost(body.cost);
							if (cost === null) {
								writeJson(res, 400, { error: "成本价无效：需要大于 0 的数字" });
								return;
							}
						}
					}
					const list = await withWatchlistLock(() => {
						const current = readWatchlist(dshHome);
						if (!current.some((e) => e.code === normalized)) {
							current.push(
								withPosition(
									{
										code: normalized,
										name: typeof body.name === "string" && body.name.trim() !== "" ? body.name.trim().slice(0, 24) : normalized,
										group: typeof body.group === "string" && body.group.trim() !== "" ? body.group.trim().slice(0, 12) : "默认",
										addedAt: new Date().toISOString(),
									},
									qty ?? null,
									cost ?? null
								)
							);
						} else {
							// Update group / name / position for existing entries.
							const entry = current.find((e) => e.code === normalized);
							if (typeof body.group === "string" && body.group.trim() !== "") {
								entry.group = body.group.trim().slice(0, 12);
							}
							if (typeof body.name === "string" && body.name.trim() !== "" && body.name.trim() !== entry.code) {
								entry.name = body.name.trim().slice(0, 24);
							}
							if (qty !== void 0) {
								if (qty === null || qty === 0) delete entry.qty;
								else entry.qty = qty;
							}
							if (cost !== void 0) {
								if (cost === null) delete entry.cost;
								else entry.cost = cost;
							}
						}
						writeWatchlist(dshHome, current);
						return current;
					});
					writeJson(res, 200, { watchlist: list });
				} catch (error) {
					fail(res, error);
				}
			},
		},
		{
			kind: "exact",
			path: ROUTES.watchlist + "/remove",
			handler: async (req, res) => {
				if (!guard(req, res, "POST")) return;
				try {
					const body = await readJsonBody(req);
					if (!isJsonObject(body) || typeof body.code !== "string") {
						writeJson(res, 400, { error: "请求体格式不对：需要 { code }" });
						return;
					}
					const list = await withWatchlistLock(() => {
						const next = readWatchlist(dshHome).filter((e) => e.code !== normalizeCode(body.code));
						writeWatchlist(dshHome, next);
						return next;
					});
					writeJson(res, 200, { watchlist: list });
				} catch (error) {
					fail(res, error);
				}
			},
		},
		{
			kind: "exact",
			path: ROUTES.watchlist + "/export",
			handler: async (req, res) => {
				if (!guard(req, res, "GET")) return;
				const url = new URL(req.url ?? "/", "http://x");
				const format = (queryParam(url, "format") ?? "json").toLowerCase();
				const list = readWatchlist(dshHome);
				const stamp = todayStr().replace(/-/g, "");
				const common = {
					"referrer-policy": "no-referrer",
					"cache-control": "no-store",
				};
				if (format === "csv") {
					// Leading BOM so Excel opens the file as UTF-8 instead of GBK mojibake.
					const rows = ["code,name,group,qty,cost,addedAt"];
					for (const e of list) {
						const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
						rows.push([e.code, e.name ?? "", e.group ?? "默认", e.qty ?? "", e.cost ?? "", e.addedAt ?? ""].map(cell).join(","));
					}
					res.writeHead(200, {
						...common,
						"content-type": "text/csv; charset=utf-8",
						"content-disposition": `attachment; filename="leekbox-watchlist-${stamp}.csv"`,
					});
					res.end("\uFEFF" + rows.join("\r\n") + "\r\n");
					return;
				}
				res.writeHead(200, {
					...common,
					"content-type": "application/json; charset=utf-8",
					"content-disposition": `attachment; filename="leekbox-watchlist-${stamp}.json"`,
				});
				res.end(JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), count: list.length, watchlist: list }, null, 2));
			},
		},
		{
			kind: "exact",
			path: ROUTES.watchlist + "/import",
			handler: async (req, res) => {
				if (!guard(req, res, "POST")) return;
				try {
					const body = await readJsonBody(req, 256 * 1024);
					if (!isJsonObject(body) || typeof body.content !== "string") {
						writeJson(res, 400, { error: "请求体格式不对：需要 { content, mode? }" });
						return;
					}
					const mode = body.mode === "replace" ? "replace" : "merge";
					const parsed = parseWatchlistImport(body.content);
					if (parsed.entries.length === 0) {
						const detail = parsed.invalid.length > 0 ? `（无效项 ${parsed.invalid.length} 个）` : "";
						writeJson(res, 400, { error: `没有可导入的自选股${detail}` });
						return;
					}
					const now = new Date().toISOString();
					const out = await withWatchlistLock(() => {
						let next;
						let added = 0;
						let replaced = 0;
						let skipped = 0;
						if (mode === "replace") {
							next = parsed.entries.map((e) => ({ ...e, addedAt: e.addedAt ?? now }));
							replaced = next.length;
						} else {
							next = [...readWatchlist(dshHome)];
							const known = new Set(next.map((e) => e.code));
							for (const entry of parsed.entries) {
								if (known.has(entry.code)) {
									skipped += 1;
									continue;
								}
								known.add(entry.code);
								next.push({ ...entry, addedAt: entry.addedAt ?? now });
								added += 1;
							}
						}
						return { next, added, replaced, skipped, written: writeWatchlist(dshHome, next) };
					});
					if (!out.written) {
						writeJson(res, 500, { error: "自选股文件写入失败" });
						return;
					}
					writeJson(res, 200, { mode, added: out.added, replaced: out.replaced, skipped: out.skipped, invalid: parsed.invalid, watchlist: out.next });
				} catch (error) {
					fail(res, error);
				}
			},
		},
		{
			kind: "exact",
			path: ROUTES.alerts,
			handler: async (req, res) => {
				if (!guard(req, res, "GET")) return;
				try {
					writeJson(res, 200, { alerts: readAlerts(dshHome) });
				} catch (error) {
					fail(res, error);
				}
			},
		},
		{
			kind: "exact",
			path: ROUTES.alerts + "/add",
			handler: async (req, res) => {
				if (!guard(req, res, "POST")) return;
				try {
					const body = await readJsonBody(req);
					if (!isJsonObject(body) || typeof body.code !== "string" || typeof body.kind !== "string") {
						writeJson(res, 400, { error: "请求体格式不对：需要 { code, kind, price? }" });
						return;
					}
					const kind = body.kind;
					if (!(kind in ALERT_KINDS)) {
						writeJson(res, 400, { error: `预警类型无效：${kind}（可选 ${Object.keys(ALERT_KINDS).join(" / ")}）` });
						return;
					}
					const normalized = normalizeCode(body.code);
					if (normalized === null) {
						writeJson(res, 400, { error: `股票代码无法识别：${body.code}` });
						return;
					}
					if (INDEX_CODE_RE.test(normalized)) {
						writeJson(res, 400, { error: `指数不支持预警: ${normalized}` });
						return;
					}
					// above/below need an absolute target price; pctUp/pctDown a percent
					// threshold (positive magnitude — direction is the kind's job).
					let price = null;
					let pct = null;
					if (kind === "above" || kind === "below") {
						price = typeof body.price === "number" && Number.isFinite(body.price) && body.price > 0 && body.price <= 1e7 ? body.price : null;
						if (price === null) {
							writeJson(res, 400, { error: "目标价无效：需要大于 0 的数字" });
							return;
						}
					} else {
						pct = typeof body.pct === "number" && Number.isFinite(body.pct) && body.pct > 0 && body.pct <= 30 ? body.pct : null;
						if (pct === null) {
							writeJson(res, 400, { error: "涨跌幅阈值无效：需要大于 0 且不超过 30 的数字" });
							return;
						}
					}
					// 去重/上限检查必须在写锁内:两个并发 add 否则会双双通过检查。
					const out = await withAlertsLock(() => {
						const list = readAlerts(dshHome);
						if (list.some((a) => a.code === normalized && a.kind === kind && a.price === price && a.pct === pct)) {
							return { state: "dupe" };
						}
						if (list.length >= ALERTS_MAX) {
							return { state: "max" };
						}
						list.push({
							id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
							code: normalized,
							name: typeof body.name === "string" && body.name.trim() !== "" ? body.name.trim().slice(0, 24) : normalized,
							kind,
							price,
							pct,
							createdAt: new Date().toISOString(),
						});
						return { state: writeAlerts(dshHome, list) ? "ok" : "write-failed", alerts: list };
					});
					if (out.state === "dupe") {
						writeJson(res, 400, { error: "相同的预警已存在" });
						return;
					}
					if (out.state === "max") {
						writeJson(res, 400, { error: `预警最多保留 ${ALERTS_MAX} 条，请先删除不用的预警` });
						return;
					}
					if (out.state === "write-failed") {
						writeJson(res, 500, { error: "预警文件写入失败" });
						return;
					}
					writeJson(res, 200, { alerts: out.alerts });
				} catch (error) {
					fail(res, error);
				}
			},
		},
		{
			kind: "exact",
			path: ROUTES.alerts + "/remove",
			handler: async (req, res) => {
				if (!guard(req, res, "POST")) return;
				try {
					const body = await readJsonBody(req);
					if (!isJsonObject(body) || typeof body.id !== "string") {
						writeJson(res, 400, { error: "请求体格式不对：需要 { id }" });
						return;
					}
					const list = await withAlertsLock(() => {
						const next = readAlerts(dshHome).filter((a) => a.id !== body.id);
						writeAlerts(dshHome, next);
						return next;
					});
					writeJson(res, 200, { alerts: list });
				} catch (error) {
					fail(res, error);
				}
			},
		},
		{
			kind: "exact",
			path: ROUTES.screener,
			handler: async (req, res) => {
				if (!guard(req, res, "POST")) return;
				try {
					const body = await readJsonBody(req);
					if (!isJsonObject(body)) {
						writeJson(res, 400, { error: "请求体不是合法的 JSON" });
						return;
					}
					// 参数归一化与校验都交给引擎（lib/screener-validate.js）：
					// 路由不再自己抄一份字段表，避免两边默认值漂移。这里只做白名单
					// 过滤，把客户端多传/拼错的字段挡在引擎之外。
					const result = await runScreener(pickScreenerParams(body));
					writeJson(res, 200, result);
				} catch (error) {
					// 按错误码分流，而不是去正则匹配中文文案 —— 以前改一句提示语
					// 就会让 400 静默退化成 502。
					const code = error instanceof Error ? error.code : void 0;
					if (code === ERR_ALREADY_RUNNING) {
						writeJson(res, 409, { error: userMessage(error) });
						return;
					}
					if (code === ERR_INVALID_PARAMS) {
						writeJson(res, 400, { error: userMessage(error) });
						return;
					}
					fail(res, error);
				}
			},
		},
		{
			kind: "exact",
			path: ROUTES.screenerMeta,
			handler: async (req, res) => {
				if (!guard(req, res, "GET")) return;
				// 信号/策略元数据的唯一下发点：客户端据此渲染勾选面板，
				// 服务端加信号或改权重时前端自动跟随，不再各存一份手抄表。
				writeJson(res, 200, screenerMeta());
			},
		},
		{
			kind: "exact",
			path: ROUTES.screenerProgress,
			handler: async (req, res) => {
				if (!guard(req, res, "GET")) return;
				writeJson(res, 200, screenerProgress());
			},
		},
		{
			kind: "exact",
			path: ROUTES.universe,
			handler: async (req, res) => {
				if (!guard(req, res, "GET")) return;
				try {
					const url = new URL(req.url ?? "/", "http://x");
					const sinceRaw = queryParam(url, "since");
					const fullMode = queryParam(url, "full") === "true";
					const sinceBuiltAt = sinceRaw === void 0 ? NaN : Number(sinceRaw);

					// Delta mode: only when the client gave us a valid baseline version.
					if (!fullMode && Number.isFinite(sinceBuiltAt)) {
						const delta = getInstrumentIndexDelta(sinceBuiltAt);
						return writeJson(res, 200, {
							type: "delta",
							...delta,
							since: sinceBuiltAt,
							message: `Universe changed by ${delta.added.length} adds / ${delta.removed.length} removes`,
						});
					}

					// Full mode: return the complete snapshot so the client can populate
					// its cache and use the returned builtAt as the next `?since` value.
					const index = await getInstrumentIndex();
					if (!index.rows) {
						return writeJson(res, 503, {
							error: "股票列表暂时不可用，请稍后重试",
							status: instrumentIndexStatus(),
						});
					}
					const wantRows = queryParam(url, "rows") !== "false";
					writeJson(res, 200, {
						type: "full",
						total: index.rows.length,
						builtAt: index.builtAt,
						buildMs: index.buildMs,
						...(wantRows ? { rows: index.rows } : {}),
						status: instrumentIndexStatus(),
					});
				} catch (error) {
					// A stale/unresolvable baseline is the client's signal to do a full
					// fetch — surface 412 with the current builtAt rather than a 502.
					if (error instanceof Error && error.status === 412) {
						return writeJson(res, 412, {
							error: userMessage(error),
							reason: errorDetail(error) || error.message,
							needsFullRefresh: true,
							currentBuiltAt: error.currentBuiltAt ?? null,
						});
					}
					fail(res, error);
				}
			},
		},
		{
			kind: "exact",
			path: ROUTES.screenerStream,
			handler: async (req, res) => {
				if (!guard(req, res, "GET")) return;
				// SSE stream of screener progress. Only one scan runs at a time, so this
				// tails the shared progress snapshot without needing a task id: emit a
				// `progress` event on every change, then a terminal `done` once the scan
				// finishes. `partial` in each snapshot is the live-growing match list.
				res.writeHead(200, {
					"content-type": "text/event-stream; charset=utf-8",
					"cache-control": "no-cache, no-transform",
					connection: "keep-alive",
					"X-Accel-Buffering": "no",
				});
				const MAX_LIFETIME_MS = 5 * 60 * 1000; // hard cap so an idle stream can't leak
				const HEARTBEAT_MS = 15 * 1000; // keep proxies from closing a quiet-but-live stream
				const startedAt = Date.now();
				let lastJson = "";
				let lastSendAt = startedAt;
				let sawRunning = false;
				let finished = false;
				let timer = null;
				const close = () => {
					if (finished) return;
					finished = true;
					if (timer) clearInterval(timer);
					try {
						res.end();
					} catch {
						/* already closed */
					}
				};
				const send = (event, data) => {
					try {
						res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
						lastSendAt = Date.now();
					} catch {
						close(); // broken pipe; the `close` listener is a no-op after this
					}
				};
				const tick = () => {
					if (finished) return;
					if (Date.now() - startedAt > MAX_LIFETIME_MS) return close();
					const snap = screenerProgress();
					if (snap.running) sawRunning = true;
					const json = JSON.stringify(snap);
					if (json !== lastJson) {
						lastJson = json;
						send("progress", snap);
					} else if (Date.now() - lastSendAt > HEARTBEAT_MS) {
						// Comment frame flushes to keep the connection warm with no data churn.
						try {
							res.write(": keep-alive\n\n");
							lastSendAt = Date.now();
						} catch {
							return close();
						}
					}
					// Only treat "not running" as terminal once we've actually watched a scan.
					// Otherwise a stream opened before the scan starts would close instantly.
					if (!snap.running && sawRunning) {
						if (snap.error) send("error", { ...snap, final: true });
						else send("done", { ...snap, final: true });
						close();
					}
				};
				req.on("close", close);
				res.on("error", close);
				tick(); // emit the current snapshot immediately
				timer = setInterval(tick, 250);
			},
		},
	];
}

//#endregion

//#region plugin

/** Stable cordis plugin name. */
const name = "leekbox";

/** Services required before the routes can mount. */
const inject = ["webServer"];

function applyImpl(ctx, config) {
	if (config?.enabled === false) return;
	const dshHome = config?.dshHome ?? process.env.DSH_HOME ?? join(homedir(), ".dsh");
	const routes = makeRoutes(ctx, {
		dshHome,
		logger: { warn: (error) => ctx.logger.warn(error) },
	});
	ctx.effect(
		() => {
			const disposers = routes.map((route) => ctx.webServer.register(route));
			// Warm the local search index in the background so the first search
			// already answers from memory (~1ms) instead of the remote adapter.
			getInstrumentIndex().catch(() => {});
			return () => {
				for (const dispose of disposers) dispose();
			};
		},
		"leekbox: routes"
	);
}

/** Single-instance guard so a standalone install and an aggregate bundle can coexist. */
const MOUNTED = Symbol.for("dsh-leekbox.mounted");
function mountOnce(fn) {
	return (...args) => {
		const g = globalThis;
		if (g[MOUNTED] === true) return;
		g[MOUNTED] = true;
		args[0]?.effect?.(() => () => {
			g[MOUNTED] = false;
		});
		return fn(...args);
	};
}

const apply = mountOnce(applyImpl);

//#endregion

export { ROUTES, apply, inject, makeRoutes, name };
