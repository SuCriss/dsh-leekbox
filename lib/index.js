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
import { fetchText, fetchJson, decodeGbk, fetchJsonAcrossHosts } from "./fetch-utils.js";
import { fetchEmRankPage, fetchEmDailyKline, fetchEmSectorPage, fetchEmLimitPools, fetchEmFflowKline, fetchEmLonghu, fetchEmSentimentDetail, fetchEmBreadth } from "./emrank.js";
import { runScreener, screenerProgress } from "./screener.js";

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
	// 5/6/9 → 沪市（5=ETF/LOF, 6=主板, 9=B股）
	if (digits.startsWith("5") || digits.startsWith("6") || digits.startsWith("9")) return "sh" + digits;
	// 4/8 → 北交所
	if (digits.startsWith("4") || digits.startsWith("8")) return "bj" + digits;
	// 0/1/2/3 → 深市（0/3=主板/创业板, 1=ETF/LOF/转债, 2=B股）
	return "sz" + digits;
}

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
	if (payload === null) throw new Error("sina zhibo unavailable");
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
	if (!Array.isArray(rows)) throw new Error("eastmoney fast news unavailable");
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
	if (buffer === null) throw new Error("jin10 flash unavailable");
	const text = buffer.toString("utf8");
	const start = text.indexOf("[");
	const end = text.lastIndexOf("]");
	if (start < 0 || end <= start) throw new Error("jin10 flash malformed");
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

/** Content-similarity key: strip case / punctuation / whitespace and keep the
 * first N codepoints, so the same headline from another source collapses onto
 * one key while genuinely different items stay distinct. */
function textDedupKey(text, n = 24) {
	return (text ?? "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "").slice(0, n);
}

/** Merge multi-source lists: dedupe by source:id and by cross-source near-identical
 * headlines, keyword-highlight importance, newest first. */
function mergeNews(lists) {
	const seen = new Set();
	const seenText = new Set();
	const out = [];
	for (const list of lists) {
		if (!Array.isArray(list)) continue;
		for (const item of list) {
			const key = `${item.source}:${item.id}`;
			if (seen.has(key)) continue;
			seen.add(key);
			// Cross-source duplicates (same event, near-identical headline):
			// keep the first occurrence, drop later lookalikes.
			const textKey = textDedupKey(item.text ?? item.title);
			if (textKey.length >= 8) {
				if (seenText.has(textKey)) continue;
				seenText.add(textKey);
			}
			out.push({ ...item, important: item.important === true || NEWS_IMPORTANT_KW.test(item.text ?? "") });
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
 *    {code, name?, group?, addedAt?} entries;
 *  - CSV / pasted text: one stock per line as "code[,name[,group]]" (comma,
 *    semicolon, tab or whitespace separated), optionally quoted; a header row
 *    ("code,..." / "代码,...") is skipped.
 * Returns { entries, invalid }: entries normalized + deduped by code,
 * invalid holds up to IMPORT_MAX_INVALID offending raw tokens.
 */
function parseWatchlistImport(content) {
	const text = String(content ?? "").trim();
	const entries = [];
	const invalid = [];
	const seen = new Set();
	const push = (raw, name, group, addedAt) => {
		const code = normalizeCode(raw);
		if (code === null) {
			if (invalid.length < IMPORT_MAX_INVALID) invalid.push(String(raw ?? "").trim().slice(0, 24));
			return;
		}
		if (seen.has(code) || entries.length >= IMPORT_MAX_ENTRIES) return;
		seen.add(code);
		entries.push({
			code,
			name: typeof name === "string" && name.trim() !== "" ? name.trim().slice(0, 24) : code,
			group: typeof group === "string" && group.trim() !== "" ? group.trim().slice(0, 12) : "默认",
			addedAt: typeof addedAt === "string" && addedAt.trim() !== "" ? addedAt.trim() : void 0,
		});
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
			push(row.code, row.name, row.group, row.addedAt);
		}
		return { entries, invalid };
	}
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (trimmed === "") continue;
		const cells = trimmed.split(/[,;\t]/).map((c) => unquoteCsv(c.trim()));
		// Skip a header row like "code,name,group" / "代码,名称,分组".
		if (/^(code|代码)$/i.test(cells[0])) continue;
		// Plain whitespace-separated "600519 贵州茅台 长线" also works.
		const parts = cells.length === 1 ? trimmed.split(/\s+/) : cells;
		push(parts[0], parts[1], parts[2], void 0);
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
	rank: "/api/leekbox/rank",
	sector: "/api/leekbox/sector",
	sentiment: "/api/leekbox/sentiment",
	fflow: "/api/leekbox/fflow",
	longhu: "/api/leekbox/longhu",
	news: "/api/leekbox/news",
	watchlist: "/api/leekbox/watchlist",
	screener: "/api/leekbox/screener",
	screenerProgress: "/api/leekbox/screener/progress",
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
			writeJson(res, 403, { error: "forbidden: loopback-only" });
			return false;
		}
		if (req.method !== method) {
			writeJson(res, 405, { error: `method not allowed: ${req.method}` });
			return false;
		}
		return true;
	};

	const fail = (res, error) => {
		logger.warn(error);
		writeJson(res, 502, { error: error instanceof Error ? error.message : String(error) });
	};

	return [
		{
			kind: "exact",
			path: ROUTES.health,
			handler: async (req, res) => {
				if (!guard(req, res, "GET")) return;
				writeJson(res, 200, { ok: true, plugin: "leekbox", watchlist: readWatchlist(dshHome).length });
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
						writeJson(res, 400, { error: "expected ?codes=sh600519,sz000001" });
						return;
					}
					writeJson(res, 200, { quotes: await fetchTencentQuotes(codes) });
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
					writeJson(res, 200, { indices: await fetchTencentQuotes(INDEX_CODES) });
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
						writeJson(res, 400, { error: "expected ?code=sh600519" });
						return;
					}
					const period = queryParam(url, "period") ?? "day"; // day|week|month|m5|m15|m30|m60
					const count = Math.min(Math.max(Number(queryParam(url, "count") ?? 120) || 120, 5), 1000);
					const fq = queryParam(url, "fq") ?? "qfq"; // qfq|hfq|none
					const isMinute = /^m\d+$/.test(period);
					const fqSuffix = isMinute || fq === "none" ? "" : fq;
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
							const key = fq === "none" ? "day" : `${fq}${period}`;
							const rows = data?.[key] ?? data?.day;
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
						if (klines === null && period === "day") {
							const em = await fetchEmDailyKline(code);
							if (Array.isArray(em)) klines = em.slice(-count);
						}
					}
					if (klines === null) {
						writeJson(res, 502, { error: `no kline data for ${code} (${period})` });
						return;
					}
					writeJson(res, 200, { code, period, fq, klines });
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
						writeJson(res, 400, { error: "expected ?code=sh600519" });
						return;
					}
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
					writeJson(res, 200, {
						code,
						date: node?.date ?? "",
						points,
						qt: payload?.data?.[code]?.qt ?? null,
					});
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
						writeJson(res, 400, { error: "expected ?kw=茅台" });
						return;
					}
					const payload = await fetchJson(
						`https://searchadapter.eastmoney.com/api/suggest/get?input=${encodeURIComponent(
							kw
						)}&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=${Math.min(
							Math.max(Number(queryParam(url, "count") ?? 10) || 10, 1),
							20
						)}`
					);
					const rows = payload?.QuotationCodeTable?.Data ?? [];
					// AStock=股票 / Fund=场内基金·ETF·LOF / Bond=可转债；港股美股等非 A 股标的
					// 不纳入（quote/kline 代理只面向沪深北）。
					const hits = rows
						.filter((r) => r.Classify === "AStock" || r.Classify === "Fund" || r.Classify === "Bond")
						.map((r) => ({
							code: r.Code,
							name: r.Name,
							pinyin: r.PinYin ?? "",
							market: r.SecurityTypeName ?? "",
							classify: r.Classify ?? "",
							quoteId: r.QuoteID ?? "",
						}));
					writeJson(res, 200, { kw, hits });
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
					const node = queryParam(url, "node") ?? "hs_a"; // hs_a 沪深A股
					// Sina's Market_Center feed became unreachable; ranks now read
					// Eastmoney via the shared adapter (legacy Sina row shape), then
					// map into the client-facing field names.
					let pageData;
					try {
						pageData = await fetchEmRankPage({ node, sort, order, page, size });
					} catch {
						writeJson(res, 502, { error: "rank feed unavailable" });
						return;
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
					}));
					writeJson(res, 200, {
						sort,
						order,
						page,
						size,
						total: pageData.total,
						totalPages: Math.max(1, Math.ceil(pageData.total / size)),
						rows,
					});
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
					const data = await fetchEmSectorPage({ type, sort, order, page, size });
					writeJson(res, 200, { type, sort, order, page, size, total: data.total, rows: data.rows });
				} catch (error) {
					fail(res, error);
				}
			},
		},
		{
			kind: "exact",
			path: ROUTES.sentiment,
			handler: (() => {
				let cache = { at: 0, val: null };
				const TTL = 30 * 1000;
				return async (req, res) => {
					if (!guard(req, res, "GET")) return;
					try {
						if (cache.val && Date.now() - cache.at < TTL) {
							writeJson(res, 200, cache.val);
							return;
						}
						const detail = await fetchEmSentimentDetail();
						const breadth = await fetchEmBreadth();
						// Whole-market size via the rank total (cheap, single page).
						let marketTotal = null;
						try {
							const page = await fetchEmRankPage({ node: "hs_a", sort: "amount", order: "desc", page: 1, size: 5 });
							marketTotal = page.total;
						} catch {
							/* optional */
						}
						const val = {
							ok: true,
							limitUp: detail.limitUp,
							limitDown: detail.limitDown,
							broken: detail.broken,
							ladder: detail.ladder,
							maxBoard: detail.maxBoard,
							ztList: detail.ztList,
							up: breadth.up ?? 0,
							down: breadth.down ?? 0,
							flat: breadth.flat ?? 0,
							marketTotal,
						};
						cache = { at: Date.now(), val };
						writeJson(res, 200, val);
					} catch (error) {
						fail(res, error);
					}
				};
			})(),
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
						writeJson(res, 400, { error: "expected ?code=sh600519" });
						return;
					}
					const limit = Math.min(Math.max(Number(queryParam(url, "count") ?? 30) || 30, 5), 120);
					const days = await fetchEmFflowKline(code);
					writeJson(res, 200, { code, count: limit, rows: days.slice(-limit) });
				} catch (error) {
					fail(res, error);
				}
			},
		},
		{
			kind: "exact",
			path: ROUTES.longhu,
			handler: (() => {
				let cache = { at: 0, val: null };
				const TTL = 60 * 1000;
				return async (req, res) => {
					if (!guard(req, res, "GET")) return;
					try {
						const url = new URL(req.url ?? "/", "http://x");
						const date = queryParam(url, "date") ?? todayStr();
						if (cache.val && cache.reqDate === date && Date.now() - cache.at < TTL) {
							writeJson(res, 200, cache.val);
							return;
						}
						const page = Math.max(Number(queryParam(url, "page") ?? 1) || 1, 1);
						const size = Math.min(Math.max(Number(queryParam(url, "size") ?? 20) || 20, 5), 100);
						const data = await fetchEmLonghu(date, { page, size });
						const val = { date: data.date, page, size, total: data.total, rows: data.rows };
						cache = { at: Date.now(), reqDate: date, val };
						writeJson(res, 200, val);
					} catch (error) {
						fail(res, error);
					}
				};
			})(),
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
					const keys =
						sourceKey === "all" || !NEWS_FETCHERS[sourceKey] ? Object.keys(NEWS_FETCHERS) : [sourceKey];
					// Fetch a deeper window per source so later pages stay filled after the merge.
					const perSource = Math.min(Math.max(size * Math.min(page, 5) + 20, 30), 100);
					const settled = await Promise.allSettled(keys.map((k) => NEWS_FETCHERS[k](perSource)));
					const merged = mergeNews(settled.map((s) => (s.status === "fulfilled" ? s.value : [])));
					if (merged.length === 0 && settled.every((s) => s.status === "rejected")) {
						writeJson(res, 502, { error: "all news feeds unavailable" });
						return;
					}
					const start = (page - 1) * size;
					writeJson(res, 200, {
						page,
						size,
						source: sourceKey,
						total: merged.length,
						totalPage: Math.max(1, Math.ceil(merged.length / size)),
						items: merged.slice(start, start + size),
					});
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
						writeJson(res, 400, { error: "expected { code, name? }" });
						return;
					}
					const normalized = normalizeCode(body.code);
					if (normalized === null) {
						writeJson(res, 400, { error: `invalid code: ${body.code}` });
						return;
					}
					const list = readWatchlist(dshHome);
					if (!list.some((e) => e.code === normalized)) {
						list.push({
							code: normalized,
							name: typeof body.name === "string" && body.name.trim() !== "" ? body.name.trim() : normalized,
							group: typeof body.group === "string" && body.group.trim() !== "" ? body.group.trim().slice(0, 12) : "默认",
							addedAt: new Date().toISOString(),
						});
						writeWatchlist(dshHome, list);
					} else if (typeof body.group === "string" && body.group.trim() !== "") {
						// Move an existing entry into another group.
						const entry = list.find((e) => e.code === normalized);
						entry.group = body.group.trim().slice(0, 12);
						writeWatchlist(dshHome, list);
					}
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
						writeJson(res, 400, { error: "expected { code }" });
						return;
					}
					const list = readWatchlist(dshHome).filter((e) => e.code !== normalizeCode(body.code));
					writeWatchlist(dshHome, list);
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
					const rows = ["code,name,group,addedAt"];
					for (const e of list) {
						const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
						rows.push([e.code, e.name ?? "", e.group ?? "默认", e.addedAt ?? ""].map(cell).join(","));
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
						writeJson(res, 400, { error: "expected { content, mode? }" });
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
					if (!writeWatchlist(dshHome, next)) {
						writeJson(res, 500, { error: "自选股文件写入失败" });
						return;
					}
					writeJson(res, 200, { mode, added, replaced, skipped, invalid: parsed.invalid, watchlist: next });
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
						writeJson(res, 400, { error: "expected a JSON body" });
						return;
					}
					const numParam = (v) => {
						if (v === void 0 || v === null || v === "") return null;
						const n = Number(v);
						return Number.isFinite(n) ? n : null;
					};
					const params = {
						node: typeof body.node === "string" ? body.node : "hs_a",
						universe: numParam(body.universe) ?? 800,
						priceMin: numParam(body.priceMin),
						priceMax: numParam(body.priceMax),
						turnoverMin: numParam(body.turnoverMin),
						turnoverMax: numParam(body.turnoverMax),
						changeMin: numParam(body.changeMin),
						changeMax: numParam(body.changeMax),
						excludeST: body.excludeST === true,
						require: Array.isArray(body.require) ? body.require.filter((k) => typeof k === "string") : [],
						minScore: numParam(body.minScore) ?? 0,
						lookback: numParam(body.lookback) ?? 3,
					};
					const result = await runScreener(params);
					writeJson(res, 200, result);
				} catch (error) {
					if (error instanceof Error && /already running/i.test(error.message)) {
						writeJson(res, 409, { error: error.message });
						return;
					}
					fail(res, error);
				}
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

export { ROUTES, apply, inject, name };
