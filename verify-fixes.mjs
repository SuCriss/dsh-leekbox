// Comprehensive behavioral verification of the 8 fixes (run: node verify-fixes.mjs).
// All network access is stubbed — no live feeds involved.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const results = [];
function check(name, ok, detail) {
	results.push({ name, ok, detail });
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}
let failures = 0;
process.on("exit", () => {
	const bad = results.filter((r) => !r.ok).length;
	console.log(bad === 0 ? "\nALL VERIFICATIONS PASSED" : `\n${bad} VERIFICATION(S) FAILED`);
	process.exitCode = bad === 0 ? 0 : 1;
});

// ---------- A. buildUniverse (real shipped function, stubbed fetchEmRankRows) ----------
{
	const src = fs.readFileSync("lib/screener.js", "utf8");
	const start = src.indexOf("async function buildUniverse(");
	let i = src.indexOf("{", start), depth = 0, end = -1;
	for (; i < src.length; i++) { if (src[i] === "{") depth++; else if (src[i] === "}") { depth--; if (!depth) { end = i + 1; break; } } }
	const fnSrc = src.slice(start, end);
	const mk = (impl) => new Function("fetchEmRankRows", fnSrc + "\nreturn buildUniverse;")(impl);
	const full = (p) => Array.from({ length: 100 }, (_, k) => ({ code: `p${p}_${k}`, amount: 5400 - p * 100 - k }));
	const TOTAL = 54;

	{
		let calls = [];
		const impl = async ({ page }) => {
			calls.push(page);
			if (page === 7 && calls.filter((c) => c === 7).length === 1) throw new Error("sim 502"); // fails once, retry succeeds
			if (page > TOTAL) return [];
			return full(page);
		};
		const rows = await mk(impl)("hs_a", 0);
		check("A1 buildUniverse: transient page-7 failure recovered by retry", rows.length === 5400, `rows=${rows.length}, fetches=${calls.length} (incl. 1 retry)`);
		check("A2 page order preserved after retry", rows[600]?.code === "p7_0" && rows[0]?.code === "p1_0", `rows[600]=${rows[600]?.code}`);
	}
	{
		const impl = async ({ page }) => {
			if (page === 1 && !impl.tried1) { impl.tried1 = true; throw new Error("sim 502"); }
			if (page > TOTAL) return [];
			return full(page);
		};
		const rows = await mk(impl)("hs_a", 0);
		check("A3 buildUniverse: page-1 failure recovered by retry", rows.length === 5400, `rows=${rows.length}`);
	}
	{
		const impl = async () => { throw new Error("feed down"); };
		let threw = "";
		try { await mk(impl)("hs_a", 0); } catch (e) { threw = e.message; }
		check("A4 buildUniverse: total outage throws instead of fake empty success", threw.includes("股票池快照为空"), threw);
	}
	{
		const impl = async ({ page }) => (page > TOTAL ? [] : page === TOTAL ? Array.from({ length: 30 }, (_, k) => ({ code: `p54_${k}`, amount: 1 })) : full(page));
		const rows = await mk(impl)("hs_a", 0);
		check("A5 buildUniverse: short last page ends walk (no phantom retry)", rows.length === 5330, `rows=${rows.length}`);
	}
	{
		const impl = async ({ page }) => (page > TOTAL ? [] : full(page));
		const rows = await mk(impl)("hs_a", 300);
		check("A6 buildUniverse(limit=300) = top-300 by amount, page order", rows.length === 300 && rows[299].code === "p3_99", `rows=${rows.length}, rows[299]=${rows[299].code}`);
	}
}

// ---------- B. runScreener fail-fast validation (real module, fetch stubbed) ----------
{
	let fetchCalls = 0;
	const origFetch = globalThis.fetch;
	globalThis.fetch = async (u) => { fetchCalls++; throw new Error("network must not be touched for invalid params"); };
	try {
		const mod = await import("./lib/screener.js");
		async function expect400(name, params, match) {
			let msg = "";
			try { await mod.runScreener(params); } catch (e) { msg = e.message; }
			check(name, msg.includes(match) && fetchCalls === 0, `msg="${msg}", fetchCalls=${fetchCalls}`);
		}
		await expect400("B1 unknown require key rejected before network", { require: ["macd"] }, "未知的技术信号");
		await expect400("B2 multi with empty strategies rejected before network", { mode: "multi", strategies: [] }, "multi 模式");
		await expect400("B3 multi with unknown strategy rejected before network", { mode: "multi", strategies: ["macdGold", "bogus"] }, "未知的选股策略");
		// valid params must proceed to network (proves validation is not over-eager)
		let ok = false;
		try { await mod.runScreener({ mode: "multi", strategies: ["macdGold"] }); } catch (e) { ok = !/未知|multi 模式/.test(e.message); }
		check("B4 valid params pass validation and reach the network", ok && fetchCalls > 0, `fetchCalls=${fetchCalls}`);
	} finally { globalThis.fetch = origFetch; }
}

// ---------- C. /search cold-start timeout (real routes, hanging index feed) ----------
{
	const origFetch = globalThis.fetch;
	globalThis.fetch = async (url, opts) => {
		const u = String(url);
		if (u.includes("push2")) {
			// hang until aborted — simulates an unreachable (not refusing) feed
			return new Promise((_, reject) => {
				const t = setTimeout(() => reject(new Error("timeout")), 60000);
				if (opts?.signal) opts.signal.addEventListener("abort", () => { clearTimeout(t); reject(new Error("aborted")); });
			});
		}
		// searchadapter etc. fail fast
		throw new Error("down");
	};
	try {
		const mod = await import("./lib/index.js");
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lkb-vfy-"));
		const routes = mod.makeRoutes({}, { dshHome: dir, logger: { warn() { } } });
		const search = routes.find((r) => r.path === "/api/leekbox/search");
		const t0 = Date.now();
		const res = { code: null, body: null, writeHead(c) { this.code = c; }, end(b) { this.body = b; } };
		const req = { method: "GET", url: "/api/leekbox/search?kw=600519&count=5", headers: { host: "127.0.0.1:1" }, socket: { remoteAddress: "127.0.0.1" }, async *[Symbol.asyncIterator]() { } };
		await search.handler(req, res);
		const elapsed = Date.now() - t0;
		const body = JSON.parse(res.body);
		check("C1 /search responds despite hung index feed", res.code === 200 && elapsed < 6000, `status=${res.code}, elapsed=${elapsed}ms, source=${body.source}, hits=${(body.hits ?? []).length}`);
		check("C2 /search fell back to the suggest adapter", body.source === "suggest", `source=${body.source}`);
		globalThis.fetch = origFetch;
		// give the background build a tick to fail, then clean up
	} finally { globalThis.fetch = origFetch; }
}

// ---------- D. netflow chain (real emrank + real route, stubbed fetch) ----------
{
	const origFetch = globalThis.fetch;
	globalThis.fetch = async () => new Response(JSON.stringify({
		data: { total: 1, diff: [{ f12: "600519", f13: 1, f14: "贵州茅台", f2: 1500, f3: 2.5, f4: 36.5, f5: 12345, f6: 987654321, f8: 1.7, f9: 22, f10: 1.1, f17: 1490, f15: 1510, f16: 1480, f18: 1463.5, f20: 1.88e12, f21: 1.88e12, f23: 8.9, f62: 123456789 }] },
	}), { status: 200, headers: { "content-type": "application/json" } });
	try {
		const em = await import("./lib/emrank.js");
		const page = await em.fetchEmRankPage({ node: "hs_a", sort: "netflow", order: "desc", page: 1, size: 5 });
		check("D1 rank row now carries netflow (f62)", page.rows[0].netflow === 123456789, `netflow=${page.rows[0].netflow}`);

		const idx = await import("./lib/index.js");
		const routes = idx.makeRoutes({}, { dshHome: os.tmpdir(), logger: { warn() { } } });
		const rank = routes.find((r) => r.path === "/api/leekbox/rank");
		const res = { code: null, body: null, writeHead(c) { this.code = c; }, end(b) { this.body = b; } };
		const req = { method: "GET", url: "/api/leekbox/rank?sort=netflow&page=1&size=5", headers: { host: "127.0.0.1:1" }, socket: { remoteAddress: "127.0.0.1" }, async *[Symbol.asyncIterator]() { } };
		await rank.handler(req, res);
		const body = JSON.parse(res.body);
		check("D2 /rank route passes netflow through", body.rows?.[0]?.netflow === 123456789, `netflow=${body.rows?.[0]?.netflow}`);
	} finally { globalThis.fetch = origFetch; }
}

// ---------- E. watchlist index-code guard (real routes) ----------
{
	const mod = await import("./lib/index.js");
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lkb-vfy-"));
	const routes = mod.makeRoutes({}, { dshHome: dir, logger: { warn() { } } });
	const add = routes.find((r) => r.path === "/api/leekbox/watchlist/add");
	const imp = routes.find((r) => r.path === "/api/leekbox/watchlist/import");
	const drive = async (route, body) => {
		const res = { code: null, body: null, writeHead(c) { this.code = c; }, end(b) { this.body = b; } };
		const req = { method: "POST", url: route.path, headers: { host: "127.0.0.1:1" }, socket: { remoteAddress: "127.0.0.1" }, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); } };
		await route.handler(req, res);
		return { code: res.code, body: res.body ? JSON.parse(res.body) : null };
	};
	const r1 = await drive(add, { code: "sh000001", name: "上证指数" });
	check("E1 /watchlist/add rejects index codes", r1.code === 400 && /指数/.test(r1.body.error), `${r1.code} ${r1.body.error}`);
	const r2 = await drive(imp, { content: "sh000001,上证指数\n600519,贵州茅台", mode: "merge" });
	check("E2 /watchlist/import treats index codes as invalid", r2.code === 200 && (r2.body.invalid ?? []).includes("sh000001") && r2.body.added === 1, `invalid=${JSON.stringify(r2.body.invalid)}, added=${r2.body.added}`);
	const r3 = await drive(add, { code: "sz000001", name: "平安银行" });
	check("E3 sz000001 (平安银行) still accepted — no false positive", r3.code === 200, `${r3.code}`);
	fs.rmSync(dir, { recursive: true, force: true });
}

// ---------- F. worker breaker stops survivors ----------
// fetchKlinesConcurrent is module-private and needs a live feed to drive, so the
// aborted-flag wiring is verified against the real source (flag set BEFORE the
// throw, loop condition re-checked, throw guarded against double-trip).
{
	const src = fs.readFileSync("lib/screener.js", "utf8");
	const hasFlag = /let aborted = false;/.test(src)
		&& /while \(!aborted && idx < codes\.length\)/.test(src)
		&& /if \(consecFailures >= 60 && !aborted\)/.test(src)
		&& src.indexOf("aborted = true;") < src.indexOf("throw new Error(\"行情数据源被限流");
	check("F1 worker breaker: aborted flag gates the loop before the throw (source-verified)", hasFlag, "");
}
