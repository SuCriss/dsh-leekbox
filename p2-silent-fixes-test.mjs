// 第二批改进的回归测试（无网络、无真 React/DOM）。
//
// 这些缺陷的共同点是"**静默**出错"：不抛异常、不报错，只是悄悄给出错误的结果
// 或悄悄什么都不做，所以必须用断言把行为钉死：
//   ① /longhu?date= 必须真的以请求日期为回溯起点（旧实现完全忽略该参数）
//   ② 资金流柱状图的悬停必须真的选中一根柱子（旧实现的 hover 是死代码）
//   ③ 60s 自动刷新不得丢掉"加载更多"翻出来的页
//   ④ ESC / 点遮罩关的必须是 z 最大的那扇窗，不是数组末位
//   ⑤ 用户主动点击的写操作失败必须说出来
//   ⑥ K 线必须带右侧价格刻度，且 y 方向不被非等比拉伸
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { makeRoutes, ROUTES } from "./lib/index.js";
import { parseDateOnly } from "./lib/emrank.js";
import { resetRouteCachesForTests } from "./lib/route-cache.js";

const bundle = readFileSync("lib/client.js", "utf8");
const clientSrc = {
	core: readFileSync("src/client/core.js", "utf8"),
	panel: readFileSync("src/client/panel.js", "utf8"),
	detail: readFileSync("src/client/detail.js", "utf8"),
	news: readFileSync("src/client/news-tab.js", "utf8"),
	star: readFileSync("src/client/star.js", "utf8"),
	watchlist: readFileSync("src/client/watchlist-tab.js", "utf8"),
	market: readFileSync("src/client/market-tab.js", "utf8"),
};

// ── 从产物里抽出纯函数（产物无法直接 import，内层模块作用域不导出） ──
function extractFunction(src, name) {
	const start = src.indexOf(`function ${name}(`);
	assert.ok(start > 0, `产物里应存在 ${name}`);
	let i = src.indexOf("{", start);
	let depth = 0;
	let end = -1;
	for (; i < src.length; i++) {
		if (src[i] === "{") depth++;
		else if (src[i] === "}") {
			depth--;
			if (depth === 0) {
				end = i + 1;
				break;
			}
		}
	}
	return new Function(`${src.slice(start, end)}\nreturn ${name};`)();
}

console.log("== ① /longhu 以请求日期为回溯起点 ==");
{
	// 日期解析：必须拒绝被 Date 静默进位的假日期
	assert.equal(typeof parseDateOnly("2026-10-09"), "number", "合法日期解析为时间戳");
	assert.equal(parseDateOnly("2026-13-01"), null, "13 月必须拒绝");
	assert.equal(parseDateOnly("2026-02-30"), null, "2 月 30 日必须拒绝");
	assert.equal(parseDateOnly("20260209"), null, "紧凑格式必须拒绝（接口约定是 YYYY-MM-DD）");
	assert.equal(parseDateOnly(""), null);
	assert.equal(parseDateOnly(null), null);

	// 真实路由：起点日期必须出现在首个上游请求里
	resetRouteCachesForTests();
	const urls = [];
	const hit = new Set(["2026-10-08"]);
	globalThis.fetch = async (url) => {
		const u = String(url);
		urls.push(u);
		const m = /TRADE_DATE%3D%27(\d{4}-\d{2}-\d{2})%27/.exec(u);
		const d = m === null ? "" : m[1];
		const data = hit.has(d)
			? [{ SECURITY_CODE: "600519", SECURITY_NAME_ABBR: "贵州茅台", CHANGE_RATE: 2.5, CLOSE_PRICE: 1500, BILLBOARD_NET_AMT: 1e8, BILLBOARD_BUY_AMT: 2e8, BILLBOARD_SELL_AMT: 1e8, EXPLANATION: "x", MARKET: "SH" }]
			: [];
		return new Response(JSON.stringify({ result: { count: data.length, data } }), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	};
	const routes = makeRoutes({}, { dshHome: "/tmp", logger: { warn() {} } });
	const route = routes.find((r) => r.path === ROUTES.longhu);
	const call = async (qs) => {
		const req = new EventEmitter();
		req.method = "GET";
		req.url = ROUTES.longhu + qs;
		req.socket = { remoteAddress: "127.0.0.1" };
		req.headers = { host: "localhost" };
		const res = new EventEmitter();
		res.headersSent = false;
		res.body = null;
		res.statusCode = 0;
		res.writeHead = (c) => { res.statusCode = c; };
		res.write = (s) => { res.body = (res.body ?? "") + s; return true; };
		res.end = (s) => { if (s) res.body = (res.body ?? "") + s; };
		await route.handler(req, res);
		return { code: res.statusCode, body: res.body === null ? null : JSON.parse(res.body) };
	};

	const r1 = await call("?date=2026-10-09&size=30");
	assert.equal(r1.code, 200);
	assert.equal(r1.body.requestedDate, "2026-10-09", "响应回带请求起点");
	assert.equal(r1.body.date, "2026-10-08", "起点无数据 → 回溯到 10-08");
	assert.ok(
		urls[0].includes("TRADE_DATE%3D%272026-10-09%27"),
		`首个上游请求必须以请求日期为起点（实际 ${urls[0].slice(0, 110)}）`
	);

	// 非法日期 → 400，不能静默当成今天
	resetRouteCachesForTests();
	for (const bad of ["garbage", "2026-13-01", "2026-02-30"]) {
		const r = await call(`?date=${bad}`);
		assert.equal(r.code, 400, `?date=${bad} 必须 400`);
		assert.match(r.body.error, /日期格式/);
	}

	// 回溯只往过去：起点之后有数据也不许向前取
	resetRouteCachesForTests();
	hit.clear();
	hit.add("2026-10-09");
	urls.length = 0;
	const r2 = await call("?date=2026-10-08&size=30");
	assert.equal(r2.code, 502, "不得向前取用未来日期的数据");
	assert.ok(
		urls.every((u) => !u.includes("2026-10-09")),
		"回溯窗口内不得请求起点之后的日期"
	);

	// 周末不进上游（榜单周末必空，白打一跳）
	resetRouteCachesForTests();
	hit.clear();
	hit.add("2026-10-09"); // 周五
	urls.length = 0;
	// 2026-10-11 是周日 → 应跳过 10-11、10-10，直接命中 10-09
	const r3 = await call("?date=2026-10-11&size=30");
	assert.equal(r3.code, 200);
	assert.equal(r3.body.date, "2026-10-09", "跳过周末后命中周五");
	assert.ok(!urls.some((u) => u.includes("2026-10-11") || u.includes("2026-10-10")), `不得请求周末：${urls.map((u) => u.slice(-60)).join(" ")}`);
}

console.log("== ⑥ K 线价格轴刻度（纯函数） ==");
{
	const ticks = extractFunction(bundle, "priceAxisTicks");
	const t = ticks(100, 200, 4, 180, 4);
	assert.equal(t.length, 4, "4 条刻度");
	assert.equal(t[0].value, 200, "顶部 = 最高价");
	assert.equal(t[3].value, 100, "底部 = 最低价");
	assert.equal(t[0].y, 4, "顶部对齐绘图带上沿");
	assert.ok(Math.abs(t[3].y - 184) < 1e-9, "底部对齐绘图带下沿");
	for (let i = 1; i < t.length; i++) {
		assert.ok(t[i].value < t[i - 1].value, "价格自上而下递减");
		assert.ok(t[i].y > t[i - 1].y, "纵坐标自上而下递增");
	}
	// 退化区间不得产生 NaN（min === max 时上游已经补过 padding，这里再兜一层）
	for (const v of ticks(50, 50, 4, 180, 4)) {
		assert.ok(Number.isFinite(v.value) && Number.isFinite(v.y), "退化区间不产生 NaN");
	}
	assert.doesNotThrow(() => ticks(1, 2, 0, 10, 1), "count=1 不能除零");

	// 渲染接线：K 线必须真的画出轴，且刻度文字走 HTML 浮层（svg 会被横向拉伸）
	assert.match(clientSrc.detail, /const AXIS_W = \d+/, "K 线要有右侧水槽宽度");
	assert.match(clientSrc.detail, /axisTicks\.map/, "刻度要参与渲染");
	assert.match(clientSrc.detail, /lkb-maxis/, "刻度文字走 HTML 浮层（与分时图同一套类）");
	// 命中判定必须扣掉右侧水槽，否则最右侧一根会误判（不锁死括号/空格写法）
	assert.match(clientSrc.detail, /const vx = [^;]*clientX[^;]*rect\.width[^;]*\* W;/, "K 线命中判定要换算到 viewBox 坐标");
	assert.match(clientSrc.detail, /Math\.floor\(vx \/ step\)/, "命中判定按 plotW 的步长");
	// y 方向不缩放：svg 高度恒等于 viewBox 高度
	assert.match(clientSrc.detail, /height: H, display: "block"/, "svg 高度固定 = y 向 scale 1（K 线实体不被压扁）");
}

console.log("== ② 资金流柱状图悬停真的能选中柱子 ==");
{
	// 旧实现只有容器的 onMouseLeave，没有任何 setter 写过 hover → hi 恒为 -1，
	// 高亮与净流入读数永远是死代码。
	assert.match(clientSrc.detail, /onMouseEnter: \(\) => setHover\(\{ i \}\)/, "每根柱子要有 onMouseEnter");
	assert.match(clientSrc.detail, /hover === null \|\| hi < 0/, "未悬停要单独处理");
	assert.match(clientSrc.detail, /悬停柱子查看当日主力净流入/, "未悬停给提示而不是整块空白");
	// 高亮条件必须真的依赖 hi
	assert.match(clientSrc.detail, /opacity: hi === -1 \|\| hi === i \? 0\.85 : 0\.35/, "非选中柱要变暗");
	// 下标必须有界（负/越界不能崩）
	assert.match(clientSrc.detail, /const hi = hover === null \? -1 : Math\.min\(Math\.max\(hover\.i, 0\), n - 1\)/, "下标要 clamp");
}

console.log("== ③ 快讯自动刷新不丢页 ==");
{
	// 自动刷新必须按"已翻到的页号"取满，而不是恒取第 1 页
	assert.match(clientSrc.news, /loadThrough\(pageRef\.current, src\)/, "自动刷新按已翻页号取满");
	assert.doesNotMatch(clientSrc.news, /useInterval\(\(\) => load\(1, false, src\)/, "不得再用恒取第 1 页的旧写法");
	assert.match(clientSrc.news, /pageRef\.current = next/, "翻页要同步记下页号");
	assert.match(clientSrc.news, /pageRef\.current = 1/, "切源要重置页号");
	// 逐页取必须去重（跨页之间源会漂移，同一条会重复出现）
	assert.match(clientSrc.news, /const seenId = new Set\(\)/, "loadThrough 要跨页去重 id");
	assert.match(clientSrc.news, /const seenText = new Set\(\)/, "loadThrough 要跨页去重归一化文本");
	// 序号守卫：慢的旧响应不得覆盖新响应
	assert.match(clientSrc.news, /if \(seq !== newsLoadSeq\.current\) return; \/\/ 已被更新的请求取代/, "loadThrough 要有 stale 守卫");
}

console.log("== ④ ESC / 遮罩关的是置顶窗口 ==");
{
	const topWindow = extractFunction(bundle, "topWindow");
	// 用户依次打开 A、B，然后点回 A 把它抬到最前 → 数组仍是 [A,B]，末位是 B
	const wins = [
		{ id: "a", z: 5 },
		{ id: "b", z: 3 },
	];
	assert.equal(topWindow(wins).id, "a", "置顶 = z 最大，而不是数组末位");
	assert.equal(topWindow([]), null, "空列表返回 null");
	assert.equal(topWindow([{ id: "x" }]).id, "x", "缺 z 时按 0 处理且不崩");
	// 取等号保证"最后被抬起的那个"胜出（z 不会重复，但并列时行为要确定）
	assert.equal(topWindow([{ id: "p", z: 7 }, { id: "q", z: 7 }]).id, "q", "z 并列时取后者");

	// 两处入口都必须用 topWindow，不得再关数组末位
	const uses = clientSrc.panel.match(/topWindow\(/g) ?? [];
	assert.ok(uses.length >= 3, `ESC 与遮罩都要走 topWindow（含定义，实测 ${uses.length} 处）`);
	assert.doesNotMatch(clientSrc.panel, /winsRef\.current\.length > 0\) setWins\(\(prev\) => prev\.slice\(0, -1\)\)/, "ESC 不得再关数组末位");
	assert.doesNotMatch(clientSrc.panel, /const closeTopWin = \(\) => setWins\(\(prev\) => prev\.slice\(0, -1\)\)/, "遮罩不得再关数组末位");
}

console.log("== ⑤ 用户发起的写操作失败要说出来 ==");
{
	assert.match(clientSrc.core, /export function notifyFailure\(/, "core 要提供统一的失败出口");
	assert.match(clientSrc.core, /失败：\$\{reason\}/, "文案格式：<动作>失败：<原因>");
	// 具体接线：这些都是用户主动点击的
	const wired = [
		["star.js 加/移自选", clientSrc.star, /notifyFailure\(on \? "移出自选" : "加入自选"\)/],
		["详情窗 加/移自选", clientSrc.detail, /notifyFailure\(watching \? "移出自选" : "加入自选"\)/],
		["自选 修改分组", clientSrc.watchlist, /notifyFailure\("修改分组"\)/],
		["自选 删除预警", clientSrc.watchlist, /notifyFailure\("删除预警"\)/],
	];
	for (const [name, src, re] of wired) {
		assert.match(src, re, `${name} 必须把失败说出来`);
	}
	// 静默 catch 不允许"全清"：后台轮询/可选信息仍应保持安静，但不能再出现在
	// 上面这些用户操作上。反向断言：明星按钮不得再静默。
	assert.doesNotMatch(clientSrc.star, /\.catch\(\(\) => \{\}\)/, "星标不得静默吞掉失败");
	// 但可选增强信息失败要"保留标题 + 给重试"，不是整块消失
	assert.match(clientSrc.detail, /const \[fflowErr, setFflowErr\] = useState\(""\)/, "资金流要有失败态");
	assert.match(clientSrc.detail, /const \[f10Err, setF10Err\] = useState\(""\)/, "F10 要有失败态");
	assert.match(clientSrc.detail, /fflowErr === ""\s*\?\s*null/, "资金流失败时保留标题块");
	assert.match(clientSrc.detail, /f10Err === ""\s*\?\s*null/, "F10 失败时保留标题块");
	assert.match(clientSrc.detail, /setExtraTick\(\(v\) => v \+ 1\)/, "要有重试入口");
	// notifyFailure 必须走 toast 通道（与价格预警同一条），而不是 console
	assert.match(clientSrc.core, /export function notifyFailure\(what, sink = pushToast\)/, "默认出口是 pushToast");
	assert.match(clientSrc.core, /只用于用户可见、用户发起的操作/, "注释要说明适用范围，避免被滥用");
}

console.log("== ①b 龙虎榜日期选择器接到服务端 ==");
{
	// 服务端已经支持 ?date=，界面上必须真的能选到它（否则这个能力等于不存在）
	assert.match(clientSrc.market, /encodeURIComponent\(lhQuery\)/, "查询日期要真的发给服务端");
	assert.doesNotMatch(clientSrc.market, /API\.longhu \+ `\?date=&page=1&size=30`/, "不得再硬编码空日期");
	assert.match(clientSrc.market, /const \[lhQuery, setLhQuery\] = useState\(""\)/, "要有查询日期状态");
	assert.match(clientSrc.market, /type: "date"/, "要有日期选择控件");
	// 回溯提示：请求日 ≠ 显示日时必须说明，否则用户以为看的就是那天
	assert.match(clientSrc.market, /lhQuery !== "" && lhQuery !== lhDate/, "回溯到别的交易日要提示");
	assert.match(clientSrc.market, /尚未发布，已回溯到最近交易日/, "提示文案要讲清楚原因");
	// 失败时不许把上一次的日期/行留在屏幕上
	assert.match(clientSrc.market, /setLhRows\(\[\]\)/, "失败要清掉旧行");
	assert.match(clientSrc.market, /setLhDate\(""\)/, "失败要清掉旧日期");

	// todayDateStr 必须是本地日期：toISOString 在 UTC+8 的清晨会差一天
	const todayDateStr = extractFunction(bundle, "todayDateStr");
	assert.equal(todayDateStr(new Date(2026, 9, 10, 0, 30)), "2026-10-10", "凌晨 00:30 仍是当天");
	assert.equal(todayDateStr(new Date(2026, 0, 5, 23, 59)), "2026-01-05", "月末/年末补零");
	assert.equal(todayDateStr(new Date(2026, 11, 31, 12, 0)), "2026-12-31", "年末不越界");
	// 与 UTC 的差异正是引入该函数的原因
	const dawn = new Date(2026, 9, 10, 0, 30);
	assert.notEqual(dawn.toISOString().slice(0, 10), todayDateStr(dawn), "不能用 UTC 日期当 max");
}

console.log("\n✅ 第二批改进 测试全部通过");
