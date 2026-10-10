// 选股元数据单一来源 —— 回归测试（无网络）。
//
// 背景：信号/策略列表原先在 lib/client.js 里手抄了一份服务端（lib/screener.js）的
// 副本，服务端加信号或改权重时前端不会跟着变，两边悄悄漂移。现在服务端是唯一
// 定义处（lib/signals.js），客户端经 GET /screener/meta 拉取，本地只留离线兜底。
//
// 这个测试从两端卡住这条约定：
//   1. 抽取客户端真实的 buildScreenMeta 源码（不是手抄副本）跑行为断言；
//   2. 断言服务端**新增**一个信号后，面板会自动出现它 —— 这正是手抄副本做不到、
//      而单一来源必须做到的那件事。
import { readFileSync } from "node:fs";
import { screenerMeta } from "./lib/signals.js";

const clientSrc = readFileSync(new URL("./lib/client.js", import.meta.url), "utf8");
// bundle 锚点：esbuild 会把模块顶层 const 降级成 var，锚点不带 const 前缀。
// end 必须用整条声明语句的开头（把 var 也让出去），否则切片末尾留个 dangling
// "var "，new Function 直接 SyntaxError。
const start = clientSrc.indexOf("SIGNAL_HINT = {");
const endM = /(?:var|const|let) NODE_CHIPS = \[/.exec(start < 0 ? "" : clientSrc.slice(start));
const end = endM === null ? -1 : start + endM.index;
if (start < 0 || end <= start) throw new Error("client.js 标记找不到（buildScreenMeta 区域）");
// 跑的是文件里真实的那份源码（含兜底常量），不是手抄副本。
const { buildScreenMeta } = new Function(`${clientSrc.slice(start, end)}\nreturn { buildScreenMeta };`)();

let fail = 0;
const check = (name, ok, note = "") => {
	if (!ok) fail++;
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${note === "" ? "" : `  — ${note}`}`);
};

const server = screenerMeta();
const m = buildScreenMeta(server);

console.log(`服务端 signals=${server.signals.length} strategies=${server.strategies.length}`);
console.log(`面板     signals=${m.signals.length} strategies=${m.strategies.length} groups=${m.groups.length}`);

// 1) 服务端的每个信号都进了面板，key 集合完全一致
const sk = server.signals.map((s) => s.key).join(",");
const ck = m.signals.map((s) => s.key).join(",");
check("信号 key 集合与顺序与服务端一致", sk === ck, `${sk} vs ${ck}`);

// 2) 分组覆盖全部信号，且不含空组
const covered = new Set(m.groups.flatMap((g) => g.items));
check("分组覆盖全部信号", covered.size === m.signals.length, `覆盖 ${covered.size}/${m.signals.length}`);
check("没有空分组", m.groups.every((g) => g.items.length > 0), m.groups.map((g) => `${g.key}:${g.items.length}`).join(" "));

// 3) 每个 key 都有可渲染的中文标签（不会出现 undefined）
const missing = m.signals.filter((s) => typeof m.labelOf[s.key] !== "string" || m.labelOf[s.key] === "");
check("每个信号都有标签", missing.length === 0, missing.map((s) => s.key).join(","));
const hasCJK = /[\u4e00-\u9fa5]/;
check("标签都是中文", m.signals.every((s) => hasCJK.test(m.labelOf[s.key])), m.labelOf[sk.split(",")[0]]);

// 4) 展示文案微调生效，未微调的沿用服务端文案
check("有提示文案的信号被覆盖", m.labelOf.jOversold === "J值超卖(<20)", m.labelOf.jOversold);
check("无提示文案的信号沿用服务端", m.labelOf.maBullish === "均线多头", m.labelOf.maBullish);
check("服务端 label 无提示时原样透出", server.signals.find((s) => s.key === "macdGold").label === "MACD金叉", server.signals.find((s) => s.key === "macdGold").label);
check("有提示的信号按提示展示", m.labelOf.macdGold === "MACD金叉(近3日)", m.labelOf.macdGold);

// 5) 策略完整带 desc
check("策略数量与服务端一致", m.strategies.length === server.strategies.length);
check("策略都带 desc", m.strategies.every((s) => typeof s.desc === "string" && s.desc !== ""));

// 6) 核心诉求：服务端**新增**一个信号，面板自动出现（旧的手抄副本做不到这点）
const grown = buildScreenMeta({
	...server,
	signals: [...server.signals, { key: "brandNew", label: "全新信号", weight: 99, group: "vol" }],
	signalGroups: server.signalGroups.map((g) => (g.key === "vol" ? { ...g, items: [...g.items, "brandNew"] } : g)),
});
check("服务端新增信号自动出现在面板", grown.signals.some((s) => s.key === "brandNew"), `signals=${grown.signals.length}`);
check("新增信号能被勾选发送", grown.signals.filter((s) => ({ brandNew: true })[s.key]).map((s) => s.key).join(",") === "brandNew");

// 7) 兜底：meta 为 null / 残缺时仍渲染出可用面板
const fb = buildScreenMeta(null);
check("meta=null 时走本地兜底", fb.signals.length === 13 && fb.groups.length === 4 && fb.strategies.length === 7,
	`${fb.signals.length}/${fb.groups.length}/${fb.strategies.length}`);
check("兜底标签也是中文", fb.signals.every((s) => hasCJK.test(fb.labelOf[s.key])));
const partial = buildScreenMeta({ signals: [{ key: "macdGold", label: "MACD金叉" }], signalGroups: [], strategies: [] });
check("残缺 meta 不渲染 undefined 分组", partial.groups.length === 0 || partial.groups.every((g) => g.items.length > 0));
check("未知 key 不进分组", buildScreenMeta({ signals: [{ key: "macdGold", label: "MACD金叉" }], signalGroups: [{ key: "x", label: "X", items: ["macdGold", "ghost"] }] }).groups[0].items.join(",") === "macdGold");

//#region 8. 端到端：路由按 error.code 分流 + 白名单过滤未知字段（无网络）
{
	const os = await import("node:os");
	const idx = await import("./lib/index.js");
	const routes = idx.makeRoutes({}, { dshHome: os.tmpdir(), logger: { warn() { } } });
	const screener = routes.find((r) => r.path === "/api/leekbox/screener");
	const origFetch = globalThis.fetch;
	// 股票池返回 1 只"无价格"的票：引擎会走到基础过滤阶段并因缺 trade 淘汰它，
	// 于是 candidates=0 直接收工 —— 全程不碰 K 线源。
	// （注意不能用空页：buildUniverse 把"整页为空"判为源整体挂掉并抛错，这是 A4 的行为。）
	globalThis.fetch = async () => new Response(JSON.stringify({
		data: { total: 1, diff: [{ f12: "600519", f13: 1, f14: "贵州茅台" }] },
	}), { status: 200, headers: { "content-type": "application/json" } });
	const post = async (body) => {
		const res = { code: null, body: null, writeHead(c) { this.code = c; }, end(b) { this.body = b; } };
		const req = {
			method: "POST", url: "/api/leekbox/screener", headers: { host: "127.0.0.1:1", "content-type": "application/json", origin: "http://127.0.0.1:1" },
			socket: { remoteAddress: "127.0.0.1" },
			async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); },
		};
		await screener.handler(req, res);
		return { code: res.code, parsed: res.body ? JSON.parse(res.body) : null };
	};
	try {
		// 校验类错误 → 400（旧实现靠正则匹配中文文案判 400，改文案就退化成 502）
		const bad = await post({ require: ["nope"] });
		check("未知信号 → 400", bad.code === 400, `${bad.code} ${bad.parsed?.error}`);
		check("未知信号文案是中文", hasCJK.test(bad.parsed?.error ?? ""), bad.parsed?.error);

		// multi 空策略 → 400；multi 未知策略 → 400
		const emptyMulti = await post({ mode: "multi", strategies: [] });
		check("multi 空策略 → 400", emptyMulti.code === 400, `${emptyMulti.code} ${emptyMulti.parsed?.error}`);
		const badStrat = await post({ mode: "multi", strategies: ["bogus"] });
		check("multi 未知策略 → 400", badStrat.code === 400, `${badStrat.code} ${badStrat.parsed?.error}`);

		// 白名单：混入未知字段仍按默认参数正常跑（股票池只有 1 只且无 K 线 → 200 + 空结果）
		const junk = await post({ totallyBogus: 1, require: [], universe: 1 });
		check("未知字段被过滤且不报错", junk.code === 200, `${junk.code} ${junk.parsed?.error ?? ""}`);
		check("无匹配时返回空结果行", junk.parsed?.matched === 0 && Array.isArray(junk.parsed?.rows) && junk.parsed.rows.length === 0, JSON.stringify(junk.parsed));
		check("未知字段没有渗进结果", junk.parsed?.totallyBogus === void 0, JSON.stringify(junk.parsed));
	} finally {
		globalThis.fetch = origFetch;
	}
}
//#endregion

console.log(fail === 0 ? "\n✅ 元数据单一来源 + 路由错误码分流打通" : `\n${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
