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
