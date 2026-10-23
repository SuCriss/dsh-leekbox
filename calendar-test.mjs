// 交易日历 + 交易时段：只走纯函数与 stubbed provider，无网络。
//
// 这一层替代了此前"周一~周五 9:30-11:30/13:00-15:00"的启发式。要卡住的行为：
//   1. 时段边界按**东八区**判定（宿主机时区不参与），9:15/9:25/9:30/11:30/13:00/15:00 逐点核对；
//   2. 工作日假期必须判为休市（`session=holiday`、`open=false`）——这是全天轮询的根因；
//   3. 日历没就绪时如实降级为工作日启发式并标注 source，绝不假装知道；
//   4. sessionTtl 在非交易时段放大 TTL（省掉盘后/假期的空转请求）；
//   5. /api/leekbox/calendar 首次请求**不阻塞**（拿不到真日历也立刻回 200）；
//   6. **日线序列的右边界**（2026-10-23 线上事故）：日 K 只有"已经出现过"的交易日，
//      今天那根要到集合竞价前后才有。所以"今天不在集合里"绝不能被当成"今天休市"，
//      否则任何交易日的白天都显示休市；判断要靠"今天有没有分时"+"过了开盘确认时刻
//      还没有"两步走，跨日还必须无条件重建（否则 12 小时 TTL 会把昨天的集合带到今天）；
//   7. 客户端与服务端对同一份日历必须得出同一个"今天是不是交易日"。
import assert from "node:assert/strict";
import {
	SESSION_LABEL, calendarSnapshot, cnDateStr, ensureCalendar, isTradingDay,
	resetCalendarForTests, sessionState, sessionSummary, sessionTtl, setCalendarForTests,
	setKlineProvider, setTodayVerdictForTests,
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
const D = (d) => dayStr(Y, 1, d);

/**
 * 上游桩：日线按 `days` 返回，5 分钟线按 `probeDate` 返回。
 * `opts.klt === 5` 的那一路就是"今天有没有分时"的探测，单独计数。
 */
function stubProvider({ days, probeDate = "", failDaily = false, failProbe = false }) {
	let dailyCalls = 0;
	let probeCalls = 0;
	let current = days;
	const fn = async (code, opts = {}) => {
		if (opts.klt === 5) {
			probeCalls += 1;
			if (failProbe) throw new Error("minute kline down");
			return probeDate === "" ? [] : [{ date: probeDate }];
		}
		dailyCalls += 1;
		if (failDaily) throw new Error("daily kline down");
		return current.map((dd) => ({ date: dd }));
	};
	return { fn, stats: () => ({ dailyCalls, probeCalls }), setDays: (next) => { current = next; } };
}

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

//#region 3. 日线覆盖窗口：[from, to] 内缺失 = 确定休市
console.log("== 3) 日线覆盖窗口语义 ==");
{
	// 覆盖窗口 [01-06, 01-09] 里独缺 01-08（周三）→ 那天没开市，这是真日历的强证据。
	setCalendarForTests([D(6), D(7), D(9)], D(8));
	const holiday = sessionState(cnTime(Y, 1, 8, 10, 0));
	check("覆盖窗口内缺失的工作日判为 holiday", holiday.session === "holiday", `session=${holiday.session} label=${holiday.label}`);
	check("工作日假期 open=false（不轮询）", holiday.open === false && holiday.tradingDay === false, `open=${holiday.open} tradingDay=${holiday.tradingDay}`);
	check("工作日假期标签显示休市", holiday.label === "休市", holiday.label);
	check("isTradingDay 覆盖窗口内按集合判定", isTradingDay(D(7)) === true && isTradingDay(D(8)) === false);
	check("覆盖窗口内不给 provisional（结论已确定）", holiday.provisional === false, JSON.stringify(holiday));
	check("真日历下 source 如实标注", holiday.source === "test", holiday.source);

	// 同一时刻，没有真日历时必须是"周一~周五 → 交易中"，并标明是启发式。
	resetCalendarForTests();
	const fallback = sessionState(cnTime(Y, 1, 8, 10, 0));
	check("无日历时退化为工作日启发式（如实标注）", fallback.source === "weekday-fallback" && fallback.calendarReady === false, `source=${fallback.source} ready=${fallback.calendarReady}`);
	check("无日历时工作日盘中判为 open（旧行为不变）", fallback.open === true && fallback.session === "open", `open=${fallback.open}`);
	const sat = sessionState(cnTime(Y, 1, 11, 10, 0));
	check("无日历时周末判为 weekend", sat.session === "weekend" && sat.open === false, `session=${sat.session}`);
	check("无日历时周末标签与真日历一致（都是休市）", sat.label === SESSION_LABEL.holiday, sat.label);

	// 右边界之外（今天的日线还没出）且还没有结论 → 只能是"未定"，绝不能判休市。
	setCalendarForTests([D(2), D(3)], D(6));
	const undecided = sessionState(cnTime(Y, 1, 6, 10, 0));
	check("右边界之外没有结论时不判休市（provisional 工作日推定）", undecided.tradingDay === true && undecided.session === "open" && undecided.provisional === true, JSON.stringify(undecided));
	// 有了"今天不是交易日"的结论（分时探测 + 开盘确认时刻）→ 休市。
	setTodayVerdictForTests(D(6), false, "no-session-after-settle");
	const settled = sessionState(cnTime(Y, 1, 6, 10, 0));
	check("有休市结论后 → 休市且不再是 provisional", settled.session === "holiday" && settled.open === false && settled.provisional === false, JSON.stringify(settled));
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
	// 客户端要靠 from/to/todayTrading 才能把"还没出日线"和"真休市"分开。
	check("快照带日线覆盖窗口", snap.from === dayStr(Y, 1, 6) && snap.to === dayStr(Y, 1, 9), `${snap.from}~${snap.to}`);
	check("快照带今天的单项结论", snap.todayTrading === true && snap.todayVia === "test" && snap.provisional === false, `todayTrading=${snap.todayTrading} via=${snap.todayVia} provisional=${snap.provisional}`);
	const sum = sessionSummary(cnTime(Y, 1, 6, 10, 0));
	check("sessionSummary 字段齐全", sum.session === "open" && sum.label === "交易中" && sum.open === true && sum.tradingDay === true && sum.calendarReady === true && sum.provisional === false, JSON.stringify(sum));
}

//#region 6. 构建：后台单飞 + 失败降级
console.log("== 6) 日历构建：单飞 / 失败降级 / 不阻塞 ==");
{
	resetCalendarForTests();
	let calls = 0;
	setKlineProvider(async (code, opts = {}) => {
		// 5 分钟探测不算"构建"（构建一次会额外探一次分时，见 resolveToday）。
		if (opts.klt === 5) return [{ date: `${dayStr(Y, 1, 10)} 15:00` }];
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

//#region 7. 线上事故回归：日线右边界不能让白天显示"休市"
console.log("== 7) 日线右边界（2026-10-23「白天永远休市」回归）==");
{
	// 事故现场：09:05 构建，日线最后一根是昨天，今天的还没出。
	resetCalendarForTests();
	let stub = stubProvider({ days: [D(2), D(3)], probeDate: "" });
	setKlineProvider(stub.fn);
	await ensureCalendar(cnTime(Y, 1, 6, 9, 5));
	const early = sessionState(cnTime(Y, 1, 6, 9, 5));
	check("09:05 日线未出 → 不判休市（盘前 + provisional）", early.tradingDay === true && early.label === "盘前" && early.provisional === true, JSON.stringify(early));
	check("09:05 标签不是休市", early.label !== "休市", early.label);
	// 客户端只吃 /calendar 的响应体：这份 payload 必须让"还没出"和"真休市"可分。
	const earlySnap = calendarSnapshot(cnTime(Y, 1, 6, 9, 5));
	check("09:05 快照：今天落在覆盖窗口右侧且无结论", earlySnap.to === D(3) && earlySnap.today === D(6) && earlySnap.todayTrading === null, `to=${earlySnap.to} today=${earlySnap.today} todayTrading=${earlySnap.todayTrading}`);
	check("09:05 快照标注 provisional（客户端据此不报休市）", earlySnap.provisional === true, `provisional=${earlySnap.provisional}`);

	// 集合竞价前后日线出现 → 早盘窗口 90 秒内自己翻面（不必等到 TTL 过期）。
	resetCalendarForTests();
	stub = stubProvider({ days: [D(2), D(3)] });
	setKlineProvider(stub.fn);
	await ensureCalendar(cnTime(Y, 1, 6, 9, 5)); // 09:05：日线还没有今天，分时也还没有
	const beforeBar = sessionState(cnTime(Y, 1, 6, 9, 20));
	check("09:20 日线仍未出 → 集合竞价，不谎报休市", beforeBar.label === "集合竞价" && beforeBar.provisional === true, JSON.stringify(beforeBar));
	stub.setDays([D(2), D(3), D(6)]); // 上游把今天的日线补上了
	await ensureCalendar(cnTime(Y, 1, 6, 9, 21)); // 90 秒重探
	const afterBar = sessionState(cnTime(Y, 1, 6, 9, 36));
	check("日线出来后 → 交易中（不再 provisional）", afterBar.tradingDay === true && afterBar.session === "open" && afterBar.label === "交易中" && afterBar.provisional === false, JSON.stringify(afterBar));
	check("拿到今天的日线后进入长 TTL（16 分钟后不重复打上游）", (await ensureCalendar(cnTime(Y, 1, 6, 9, 37)), stub.stats().dailyCalls === 2), JSON.stringify(stub.stats()));

	// 工作日假期：日线停在上周五、分时也没有今天 → 09:35 之后确认休市。
	resetCalendarForTests();
	stub = stubProvider({ days: [D(2), D(3)], probeDate: `${D(3)} 15:00` });
	setKlineProvider(stub.fn);
	await ensureCalendar(cnTime(Y, 1, 6, 9, 20));
	const holidayEarly = sessionState(cnTime(Y, 1, 6, 9, 20));
	check("假期 09:20 未到确认时刻 → 只报 provisional，不装懂", holidayEarly.provisional === true && holidayEarly.tradingDay === true, JSON.stringify(holidayEarly));
	await ensureCalendar(cnTime(Y, 1, 6, 9, 36));
	const holidaySettled = sessionState(cnTime(Y, 1, 6, 9, 36));
	check("假期 09:36 后确认休市（分时里没有今天）", holidaySettled.session === "holiday" && holidaySettled.label === "休市" && holidaySettled.open === false, JSON.stringify(holidaySettled));
	check("假期确认后进入长 TTL（不空转上游）", (await ensureCalendar(cnTime(Y, 1, 6, 10, 30)), stub.stats().dailyCalls === 2), JSON.stringify(stub.stats()));

	// 探测失败 ≠ 休市：上游出错时必须保持"未定"。
	resetCalendarForTests();
	stub = stubProvider({ days: [D(2), D(3)], probeDate: "", failProbe: true });
	setKlineProvider(stub.fn);
	await ensureCalendar(cnTime(Y, 1, 6, 14, 0));
	const fault = sessionState(cnTime(Y, 1, 6, 14, 0));
	check("分时探测失败时不谎报休市", fault.provisional === true && fault.tradingDay === true && fault.session === "open", JSON.stringify(fault));

	// 跨日必须重建：12 小时 TTL 会把昨天的集合带进新的一天（事故的第二半原因）。
	resetCalendarForTests();
	stub = stubProvider({ days: [D(2), D(3), D(6)], probeDate: `${D(6)} 15:00` });
	setKlineProvider(stub.fn);
	await ensureCalendar(cnTime(Y, 1, 6, 22, 0)); // 周一收盘后构建：今天在集合里
	check("晚上构建后长 TTL 生效（10 分钟后不重打）", (await ensureCalendar(cnTime(Y, 1, 6, 22, 10)), stub.stats().dailyCalls === 1), JSON.stringify(stub.stats()));
	await ensureCalendar(cnTime(Y, 1, 7, 0, 30)); // 周二凌晨：必须重建
	check("跨日无条件重建（序列右边界每天都会前移）", stub.stats().dailyCalls === 2, JSON.stringify(stub.stats()));
	const nextDay = sessionState(cnTime(Y, 1, 7, 0, 30));
	check("新的一天没结论前仍是 provisional（凌晨显示盘前，不是休市）", nextDay.provisional === true && nextDay.label === "盘前", JSON.stringify(nextDay));
}

//#region 8. 客户端 ↔ 服务端口径一致（cjs bundle 里的纯函数对照服务端）
console.log("== 8) 客户端 / 服务端时段口径一致 ==");
{
	// 客户端是 CJS 产物、依赖 window.__ModuleLoader__，这里照 client-bundle-test
	// 的方式用桩把它 require 进来，直接对照纯函数。
	const { readFileSync } = await import("node:fs");
	const bundle = readFileSync("lib/client.js", "utf8");
	let registered = null;
	globalThis.window = { __ModuleLoader__: { load: (def) => { registered = def; } } };
	new Function(bundle)();
	assert.ok(registered !== null, "bundle 应通过 __ModuleLoader__.load() 注册");
	/** 产物只导出 { apply, inject }，内层函数按源码锚点抽出来单独执行。 */
	const extract = (name) => {
		const start = bundle.indexOf(`function ${name}(`);
		assert.ok(start > 0, `bundle 里应有 ${name}`);
		let i = bundle.indexOf("{", start);
		let depth = 0;
		for (; i < bundle.length; i++) {
			if (bundle[i] === "{") depth++;
			else if (bundle[i] === "}") {
				depth--;
				if (depth === 0) return new Function(`${bundle.slice(start, i + 1)}\nreturn ${name};`)();
			}
		}
		throw new Error(`cannot extract ${name}`);
	};
	const classify = extract("classifySession");
	const resolveDay = extract("resolveDayTrading");

	// 8a. 同一天里逐点对照：每 5 分钟一个采样点 + 所有关键边界（含边界前后一分钟）。
	const startOfDay = Date.UTC(Y, 0, 6, 0, 0, 0); // 东八区 2025-01-06 08:00
	const boundaries = [9 * 60 + 14, 9 * 60 + 15, 9 * 60 + 24, 9 * 60 + 25, 9 * 60 + 29, 9 * 60 + 30, 11 * 60 + 29, 11 * 60 + 30, 12 * 60 + 59, 13 * 60, 14 * 60 + 59, 15 * 60, 15 * 60 + 1];
	const samples = [];
	// m 是"当天分钟数"，取值 0..1439（1440 已经是第二天 00:00，日期会翻页，
	// 客户端因无真日历会把它当成工作日 —— 那是既有语义，另开一条断言覆盖）。
	for (let m = 0; m <= 24 * 60 - 1; m += 5) samples.push(m);
	for (const m of boundaries) if (!samples.includes(m)) samples.push(m);
	let mismatches = [];
	for (const tradingDay of [true, false]) {
		// 休市那一轮要给"真日历说这天休市"：窗口内缺失（01-07、01-09 有日线，
		// 01-06 没有）或直接下结论，两条路径都覆盖到。
		if (tradingDay) setCalendarForTests([D(6)], D(6));
		else {
			setCalendarForTests([D(7), D(9)], D(6));
			setTodayVerdictForTests(D(6), false);
		}
		for (const m of samples) {
			// 东八区墙上时间 m 分钟 → UTC 时刻
			const at = new Date(startOfDay + m * 60 * 1000 - 8 * 60 * 60 * 1000);
			const server = sessionState(at);
			const client = classify(1, m, tradingDay);
			const fields = ["session", "label", "open", "tradingDay"];
			for (const f of fields) {
				if (server[f] !== client[f]) mismatches.push(`trading=${tradingDay} m=${m} ${f}: server=${server[f]} client=${client[f]}`);
			}
			if (server.tradingDay !== tradingDay) mismatches.push(`trading=${tradingDay} m=${m} 服务端日级判定漂移: ${server.tradingDay}`);
		}
	}
	check(`客户端与服务端在 ${samples.length}×2 个采样点上完全一致（含全部边界）`, mismatches.length === 0, mismatches.slice(0, 3).join(" | "));

	// 8b. 日级判定（今天是不是交易日）两边必须同口径 —— 这正是事故的口径。
	const dayCases = [
		{ name: "今天就在日线集合里", days: [D(6), D(7)], today: D(6), expect: true },
		{ name: "窗口内缺失", days: [D(6), D(7), D(9)], today: D(8), expect: false },
		{ name: "右边界之外、已有交易日结论", days: [D(2), D(3)], today: D(6), verdict: true, expect: true },
		{ name: "右边界之外、已有休市结论", days: [D(2), D(3)], today: D(6), verdict: false, expect: false },
		{ name: "右边界之外、没有结论 → 工作日推定", days: [D(2), D(3)], today: D(6), expect: true },
		{ name: "右边界之外的周六 → 周末", days: [D(2), D(3)], today: D(11), expect: false },
	];
	let dayMismatch = 0;
	/** 日期的星期（0=周日）——与日历模块对"东八区墙上日期"的取法一致。 */
	const weekdayOf = (dateStr) => new Date(`${dateStr}T00:00:00Z`).getUTCDay();
	for (const c of dayCases) {
		setCalendarForTests(c.days, c.today);
		if (c.verdict !== void 0) setTodayVerdictForTests(c.today, c.verdict);
		const server = isTradingDay(c.today);
		const snap = calendarSnapshot(cnTime(Y, 1, 6, 10, 0));
		const clientFlag = resolveDay({
			tradingDays: snap.tradingDays,
			from: snap.from,
			to: snap.to,
			today: c.today,
			snapshotToday: snap.today,
			todayTrading: snap.todayTrading,
		});
		// 客户端返回 null = "日级未知"，此时 classifySession 会退回工作日启发式，
		// 有效结论就是"周一~周五"。两边比的是**最终结论**，不是中间表示。
		const weekdays = weekdayOf(c.today);
		const clientEffective = clientFlag === null ? weekdays >= 1 && weekdays <= 5 : clientFlag;
		if (server !== c.expect) dayMismatch += 1, check(`${c.name}：服务端`, server === c.expect, `server=${server} expect=${c.expect}`);
		if (clientEffective !== server) dayMismatch += 1, check(`${c.name}：客户端口径`, clientEffective === server, `server=${server} client=${clientEffective}`);
	}
	check(`日级判定 ${dayCases.length} 个场景客户端与服务端一致`, dayMismatch === 0, `${dayMismatch} 处不一致`);

	// 8c. 跨零点：客户端的"今天"和服务端快照的"今天"不一致时，不许借用它的结论。
	{
		const flag = resolveDay({
			tradingDays: [D(6)], from: D(6), to: D(6), today: D(7), snapshotToday: D(6), todayTrading: true,
		});
		check("跨零点不借用昨天的结论（返回 null 走启发式）", flag === null, String(flag));
	}

	// 8d. 产物里必须有这条接线：服务端的覆盖窗口/今日结论要真的进到客户端状态，
	// 否则今天会退化成"客户端以为日历没就绪"（旧版就是把"没出日线"当休市的）。
	check(
		"客户端产物接线了覆盖窗口 / 今日结论 / provisional",
		["todayTrading", "snapshotToday", "provisional", "CALENDAR_PROVISIONAL_MS"].every((k) => bundle.includes(k))
	);

	// 8e. 无日历（未知）时两边都必须退化为"工作日启发式"
	resetCalendarForTests();
	let fallbackMismatch = 0;
	for (let m = 0; m <= 24 * 60 - 1; m += 5) {
		const at = new Date(startOfDay + m * 60 * 1000 - 8 * 60 * 60 * 1000);
		const server = sessionState(at);
		const client = classify(1, m, null);
		if (server.open !== client.open || server.calendarReady !== client.calendarReady) fallbackMismatch += 1;
	}
	check("无日历时两边都退化为工作日启发式且都标注 calendarReady=false", fallbackMismatch === 0, `${fallbackMismatch} 处不一致`);
	check("无日历时客户端日级判定返回 null（不知道就是不知道）", resolveDay({ tradingDays: null, from: "", to: "", today: D(6), snapshotToday: D(6), todayTrading: null }) === null);
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
		const sat = new Date(Date.UTC(Y, 0, 11, 2, 0, 0)); // 东八区周六 10:00
		const server = sessionState(sat);
		const client = classify(6, 10 * 60, null);
		check("周末：客户端未知态 = 服务端 weekend", server.session === client.session && server.open === client.open, `server=${server.session} client=${client.session}`);
	}
}

resetCalendarForTests();
setKlineProvider(null);

console.log(failures === 0 ? "\n✅ 交易日历测试全部通过" : `\n${failures} 处失败`);
process.exit(failures === 0 ? 0 : 1);
