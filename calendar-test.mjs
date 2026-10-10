// 交易日历 + 交易时段：只走纯函数与 stubbed provider，无网络。
//
// 这一层替代了此前"周一~周五 9:30-11:30/13:00-15:00"的启发式。要卡住的行为：
//   1. 时段边界按**东八区**判定（宿主机时区不参与），9:15/9:25/9:30/11:30/13:00/15:00 逐点核对；
//   2. 工作日假期必须判为休市（`session=holiday`、`open=false`）——这是全天轮询的根因；
//   3. 日历没就绪时如实降级为工作日启发式并标注 source，绝不假装知道；
//   4. sessionTtl 在非交易时段放大 TTL（省掉盘后/假期的空转请求）；
//   5. /api/leekbox/calendar 首次请求**不阻塞**（拿不到真日历也立刻回 200）。
import assert from "node:assert/strict";
import {
	SESSION_LABEL, calendarSnapshot, cnDateStr, ensureCalendar, isTradingDay,
	resetCalendarForTests, sessionState, sessionSummary, sessionTtl, setCalendarForTests, setKlineProvider,
} from "./lib/calendar.js";

let failures = 0;
function check(name, ok, detail) {
	if (!ok) failures += 1;
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail === undefined ? "" : "  — " + detail}`);
}

const pad = (n) => String(n).padStart(2, "0");
const dayStr = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
/** 东八区墙上时间 → UTC Date（宿主机时区无关）。 */
const cnTime = (y, m, d, hh, mm) => new Date(Date.UTC(y, m - 1, d, hh - 8, mm, 0));

// 2025-01-06 是周一；01-08 周三；01-11 周六。
const Y = 2025;

//#region 1. 时区无关的时刻换算
console.log("== 1) 东八区墙上时间 ==");
{
	// 2025-01-06 09:30 北京时间 = 01:30 UTC；在 UTC 机器与 UTC+9 机器上结论必须一致。
	check("cnDateStr 按东八区取日期（UTC 01:30 → 当天）", cnDateStr(cnTime(Y, 1, 6, 9, 30)) === dayStr(Y, 1, 6), cnDateStr(cnTime(Y, 1, 6, 9, 30)));
	// 北京时间 00:30 时，UTC 还是前一天 16:30 —— 日期必须取北京的那天。
	check("cnDateStr 跨日边界取北京日期", cnDateStr(cnTime(Y, 1, 7, 0, 30)) === dayStr(Y, 1, 7), cnDateStr(cnTime(Y, 1, 7, 0, 30)));
}

//#region 2. 时段边界（逐点）
console.log("== 2) 交易时段边界 ==");
{
	setCalendarForTests([dayStr(Y, 1, 6), dayStr(Y, 1, 7), dayStr(Y, 1, 8)]);
	const cases = [
		[8, 30, "preOpen", false, "盘前"],
		[9, 15, "auction", false, "集合竞价开始"],
		[9, 24, "auction", false, "集合竞价中"],
		[9, 25, "preOpen", false, "竞价结束到开盘前的空档"],
		[9, 30, "open", true, "开盘"],
		[11, 29, "open", true, "上午尾盘"],
		[11, 30, "lunch", false, "午休开始（11:30 之后不算盘中）"],
		[12, 59, "lunch", false, "午休中"],
		[13, 0, "open", true, "下午开盘"],
		[14, 59, "open", true, "尾盘"],
		[15, 0, "closed", false, "15:00 起收盘"],
		[22, 0, "closed", false, "夜间"],
	];
	for (const [hh, mm, session, open, note] of cases) {
		const s = sessionState(cnTime(Y, 1, 6, hh, mm));
		check(`${pad(hh)}:${pad(mm)} → ${session}（${note}）`, s.session === session && s.open === open, `session=${s.session} open=${s.open} label=${s.label}`);
		check(`${pad(hh)}:${pad(mm)} 标签是中文`, s.label === SESSION_LABEL[session], s.label);
	}
}

//#region 3. 工作日假期（真日历 vs 启发式）
console.log("== 3) 真日历与工作日假期 ==");
{
	// 2025-01-08（周三）从交易日集合里剔除 = 模拟调休/节假日。
	setCalendarForTests([dayStr(Y, 1, 6), dayStr(Y, 1, 7)]);
	const holiday = sessionState(cnTime(Y, 1, 8, 10, 0));
	check("真日历下，工作日假期判为 holiday", holiday.session === "holiday", `session=${holiday.session} label=${holiday.label}`);
	check("工作日假期 open=false（不轮询）", holiday.open === false && holiday.tradingDay === false, `open=${holiday.open} tradingDay=${holiday.tradingDay}`);
	check("工作日假期标签显示休市", holiday.label === "休市", holiday.label);
	check("isTradingDay 用真日历", isTradingDay(dayStr(Y, 1, 6)) === true && isTradingDay(dayStr(Y, 1, 8)) === false);
	check("真日历下 source 如实标注", holiday.source === "test", holiday.source);

	// 同一时刻，没有真日历时必须是"周一~周五 → 交易中"，并标明是启发式。
	resetCalendarForTests();
	const fallback = sessionState(cnTime(Y, 1, 8, 10, 0));
	check("无日历时退化为工作日启发式（如实标注）", fallback.source === "weekday-fallback" && fallback.calendarReady === false, `source=${fallback.source} ready=${fallback.calendarReady}`);
	check("无日历时工作日盘中判为 open（旧行为不变）", fallback.open === true && fallback.session === "open", `open=${fallback.open}`);
	const sat = sessionState(cnTime(Y, 1, 11, 10, 0));
	check("无日历时周末判为 weekend", sat.session === "weekend" && sat.open === false, `session=${sat.session}`);
	check("无日历时周末标签与真日历一致（都是休市）", sat.label === SESSION_LABEL.holiday, sat.label);
}

//#region 4. sessionTtl
console.log("== 4) sessionTtl：非交易时段放大 TTL ==");
{
	setCalendarForTests([dayStr(Y, 1, 6)]);
	check("盘中 TTL 不变", sessionTtl(30 * 1000, 20, cnTime(Y, 1, 6, 10, 0)) === 30 * 1000);
	check("盘后 TTL ×20", sessionTtl(30 * 1000, 20, cnTime(Y, 1, 6, 16, 0)) === 600 * 1000, String(sessionTtl(30 * 1000, 20, cnTime(Y, 1, 6, 16, 0))));
	check("周末 TTL ×20", sessionTtl(30 * 1000, 20, cnTime(Y, 1, 11, 10, 0)) === 600 * 1000);
	check("默认倍数 20", sessionTtl(1000, void 0, cnTime(Y, 1, 6, 16, 0)) === 20000);
}

//#region 5. 快照形状
console.log("== 5) calendarSnapshot / sessionSummary ==");
{
	setCalendarForTests([dayStr(Y, 1, 6), dayStr(Y, 1, 7), dayStr(Y, 1, 9)], dayStr(Y, 1, 6));
	const snap = calendarSnapshot(cnTime(Y, 1, 6, 10, 0));
	check("快照带完整交易日列表", snap.tradingDays.length === 3 && snap.tradingDays.includes(dayStr(Y, 1, 9)), snap.tradingDays.join(","));
	check("快照带已过去的最近交易日", snap.lastTradingDay === dayStr(Y, 1, 6), snap.lastTradingDay);
	check("快照带下一个交易日", snap.nextTradingDay === dayStr(Y, 1, 7), snap.nextTradingDay);
	check("快照内嵌 session", snap.session.session === "open" && snap.session.open === true, JSON.stringify(snap.session));
	const sum = sessionSummary(cnTime(Y, 1, 6, 10, 0));
	check("sessionSummary 字段齐全", sum.session === "open" && sum.label === "交易中" && sum.open === true && sum.tradingDay === true && sum.calendarReady === true, JSON.stringify(sum));
}

//#region 6. 构建：后台单飞 + 失败降级
console.log("== 6) 日历构建：单飞 / 失败降级 / 不阻塞 ==");
{
	resetCalendarForTests();
	let calls = 0;
	setKlineProvider(async () => {
		calls += 1;
		await new Promise((r) => setTimeout(r, 20));
		return [
			{ date: dayStr(Y, 1, 6) }, { date: dayStr(Y, 1, 7) }, { date: dayStr(Y, 1, 8) },
			{ date: dayStr(Y, 1, 9) }, { date: dayStr(Y, 1, 10) },
		];
	});
	// 首次请求必须**立刻**拿到结果（启发式），不能被网络拖住。
	const t0 = Date.now();
	const immediate = calendarSnapshot(cnTime(Y, 1, 6, 10, 0));
	const elapsed = Date.now() - t0;
	check("首次快照不阻塞（<5ms，返回启发式）", elapsed < 5 && immediate.source === "weekday-fallback", `${elapsed}ms source=${immediate.source}`);
	const [a, b, c] = await Promise.all([ensureCalendar(), ensureCalendar(), ensureCalendar()]);
	check("ensureCalendar 单飞：3 次并发只打 1 次上游", calls === 1, `calls=${calls}`);
	check("并发返回同一个 Promise 结果", a === true && b === true && c === true);
	const built = calendarSnapshot(cnTime(Y, 1, 6, 10, 0));
	check("构建后拿到真日历", built.source === "index-daily-kline" && built.tradingDays.length === 5, `source=${built.source} days=${built.tradingDays.length}`);

	// 构建失败：静默降级，不抛、不把快照变空。
	resetCalendarForTests();
	setKlineProvider(async () => {
		throw new Error("upstream down");
	});
	const ok = await ensureCalendar();
	check("构建失败返回 false 而不抛", ok === false);
	const degraded = calendarSnapshot(cnTime(Y, 1, 6, 10, 0));
	check("构建失败后仍是可用的启发式快照", degraded.source === "weekday-fallback" && degraded.session.open === true, `source=${degraded.source}`);

	// 未注入 provider：同样静默降级。
	resetCalendarForTests();
	setKlineProvider(null);
	check("未注入 provider 时不抛", (await ensureCalendar()) === false);
}

//#region 7. 客户端 ↔ 服务端口径一致（cjs bundle 里的纯函数对照服务端 sessionState）
console.log("== 7) 客户端 / 服务端时段口径一致 ==");
{
	// 客户端是 CJS 产物、依赖 window.__ModuleLoader__，这里照 client-bundle-test
	// 的方式用桩把它 require 进来，直接对照 classifySession（纯函数）。
	const { readFileSync } = await import("node:fs");
	const bundle = readFileSync("lib/client.js", "utf8");
	let registered = null;
	globalThis.window = { __ModuleLoader__: { load: (def) => { registered = def; } } };
	const reactStub = {
		createElement: () => ({}),
		useState: (v) => [v, () => {}],
		useEffect: () => {},
		useRef: (v) => ({ current: v }),
		useCallback: (fn) => fn,
	};
	new Function(bundle)();
	// 产物只导出 { apply, inject }，classifySession 在内层模块作用域里，
	// 所以按源码锚点把它抽出来单独执行（与 screener-meta-test 的做法一致）。
	const start = bundle.indexOf("function classifySession(");
	assert.ok(start > 0, "bundle 里应有 classifySession（客户端时段判定的纯函数）");
	let i = bundle.indexOf("{", start);
	let depth = 0;
	let end = -1;
	for (; i < bundle.length; i++) {
		if (bundle[i] === "{") depth++;
		else if (bundle[i] === "}") {
			depth--;
			if (depth === 0) {
				end = i + 1;
				break;
			}
		}
	}
	const classify = new Function(`${bundle.slice(start, end)}\nreturn classifySession;`)();

	// 同一天里逐点对照：每 5 分钟一个采样点 + 所有关键边界（含边界前后一分钟）。
	const startOfDay = Date.UTC(2025, 0, 6, 0, 0, 0); // 东八区 2025-01-06 08:00
	const boundaries = [9 * 60 + 14, 9 * 60 + 15, 9 * 60 + 24, 9 * 60 + 25, 9 * 60 + 29, 9 * 60 + 30, 11 * 60 + 29, 11 * 60 + 30, 12 * 60 + 59, 13 * 60, 14 * 60 + 59, 15 * 60, 15 * 60 + 1];
	const samples = [];
	// m 是"当天分钟数"，取值 0..1439（1440 已经是第二天 00:00，日期会翻页，
	// 客户端因无真日历会把它当成工作日 —— 那是既有语义，另开一条断言覆盖）。
	for (let m = 0; m <= 24 * 60 - 1; m += 5) samples.push(m);
	for (const m of boundaries) if (!samples.includes(m)) samples.push(m);
	let mismatches = [];
	for (const tradingDay of [true, false]) {
		// 注意：休市那一轮必须给一个"不含 01-06 的真日历"（比如只有 01-07），
		// 不能给空集合——空集合在两边都表示"没有日历、未知"，会退化成启发式
		// 而不是"真日历说这天休市"。
		setCalendarForTests(tradingDay ? [dayStr(Y, 1, 6)] : [dayStr(Y, 1, 7)], dayStr(Y, 1, 6));
		for (const m of samples) {
			// 东八区墙上时间 m 分钟 → UTC 时刻
			const at = new Date(startOfDay + m * 60 * 1000 - 8 * 60 * 60 * 1000);
			const server = sessionState(at);
			const client = classify(1, m, tradingDay);
			const fields = ["session", "label", "open", "tradingDay"];
			for (const f of fields) {
				if (server[f] !== client[f]) mismatches.push(`trading=${tradingDay} m=${m} ${f}: server=${server[f]} client=${client[f]}`);
			}
		}
	}
	check(`客户端与服务端在 ${samples.length}×2 个采样点上完全一致（含全部边界）`, mismatches.length === 0, mismatches.slice(0, 3).join(" | "));

	// 无日历（未知）时两边都必须退化为"工作日启发式"
	resetCalendarForTests();
	let fallbackMismatch = 0;
	for (let m = 0; m <= 24 * 60 - 1; m += 5) {
		const at = new Date(startOfDay + m * 60 * 1000 - 8 * 60 * 60 * 1000);
		const server = sessionState(at);
		const client = classify(1, m, null);
		if (server.open !== client.open || server.calendarReady !== client.calendarReady) fallbackMismatch += 1;
	}
	check("无日历时两边都退化为工作日启发式且都标注 calendarReady=false", fallbackMismatch === 0, `${fallbackMismatch} 处不一致`);
	// 午夜边界：客户端拿不到真日历时会把 00:00 当工作日盘中？—— 不，00:00 是
	// preOpen（不在任何交易时段内），这里把这条语义钉住，免得以后改时段逻辑
	// 把午夜误判成可轮询。
	{
		const client = classify(1, 0, null);
		check("午夜：open=false（preOpen，不轮询）", client.open === false && client.session === "preOpen", JSON.stringify(client));
		const clientHoliday = classify(1, 12 * 60, false);
		check("休市日午间仍 open=false", clientHoliday.open === false && clientHoliday.tradingDay === false, JSON.stringify(clientHoliday));
	}
	// 周末：客户端未知态必须与服务端周末一致
	{
		const sat = new Date(Date.UTC(2025, 0, 11, 2, 0, 0)); // 东八区周六 10:00
		const server = sessionState(sat);
		const client = classify(6, 10 * 60, null);
		check("周末：客户端未知态 = 服务端 weekend", server.session === client.session && server.open === client.open, `server=${server.session} client=${client.session}`);
	}
}

resetCalendarForTests();
setKlineProvider(null);

console.log(failures === 0 ? "\n✅ 交易日历测试全部通过" : `\n${failures} 处失败`);
process.exit(failures === 0 ? 0 : 1);
