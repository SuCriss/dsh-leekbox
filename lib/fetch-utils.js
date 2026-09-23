// Shared fetch helpers for the LeekBox host half.
const UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Fetch text with a timeout; returns null on any network failure. */
export async function fetchText(url, opts = {}) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10000);
	try {
		const response = await fetch(url, {
			signal: controller.signal,
			redirect: "follow",
			headers: {
				"user-agent": UA,
				accept: "*/*",
				...(opts.headers ?? {}),
			},
		});
		if (!response.ok) return null;
		const buf = await response.arrayBuffer();
		return Buffer.from(buf);
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

/** Decode a byte buffer as GBK (Tencent feeds) with a UTF-8 fallback. */
export function decodeGbk(buffer) {
	if (buffer === null) return "";
	try {
		return new TextDecoder("gbk").decode(buffer);
	} catch {
		return buffer.toString("utf8");
	}
}

/** Fetch and JSON-parse with the shared timeout; null on failure. */
export async function fetchJson(url, opts = {}) {
	const buffer = await fetchText(url, opts);
	if (buffer === null) return null;
	try {
		return JSON.parse(buffer.toString("utf8"));
	} catch {
		return null;
	}
}

//#region 面向浏览器的报错约定
//
// 客户端把响应体里的 error 字段**原样渲染**给用户(见 lib/client.js 的 api())。
// 所以这里的规矩只有一条:
//
//   message —— 能直接给用户看的中文,一句话说清"什么没取到、要不要重试"。
//   detail  —— host / node / sort / 上游字段名这类排查用的技术细节,只进服务端
//              日志(`fail()` 会写进响应的 reason 字段,但界面不渲染它)。
//
// 以前 throw new Error("rank feed unavailable") 这种英文文案会直接糊到用户脸上,
// 就是因为没有这层约定 —— 报错信息既不是给用户看的,也没留下排查线索。

/** 构造一个"文案给用户、细节给日志"的错误。 */
export function feedError(message, detail) {
	const error = new Error(message);
	if (detail !== undefined && detail !== null && detail !== "") error.detail = String(detail);
	return error;
}

/** 取出错误的技术细节;没有就返回空串。 */
export function errorDetail(error) {
	return error instanceof Error && typeof error.detail === "string" ? error.detail : "";
}

/** 只把中文文案透给浏览器。
 *
 * 兜底存在的原因是:上游异常、Node 内建错误(ENOENT/ECONNRESET)、以及任何
 * 漏翻的英文都会走到这里 —— 与其让用户看到英文,不如换成一句通用中文,
 * 真正的原因留给 `reason` 和服务端日志。 */
export function userMessage(error, fallback = "数据获取失败，请稍后重试") {
	const message =
		error instanceof Error ? error.message : typeof error === "string" ? error : "";
	return /[\u4e00-\u9fa5]/.test(message) ? message : fallback;
}
//#endregion

/** Try the same path on several hosts until one returns parseable JSON.
 * Tencent's quote hosts intermittently serve anti-bot challenge pages or 5xx,
 * so callers pass a host list and a urlOf(host) builder. Returns the parsed
 * payload plus the winning host; throws when every host fails. */
export async function fetchJsonAcrossHosts(hosts, urlOf, opts = {}) {
	let last = feedError("上游数据源全部不可用，请稍后重试", `all hosts failed: ${hosts.join(", ")}`);
	for (const host of hosts) {
		try {
			const payload = await fetchJson(urlOf(host), opts);
			if (payload !== null) return { payload, host };
		} catch (error) {
			last = error instanceof Error ? error : new Error(String(error));
		}
	}
	throw last;
}
