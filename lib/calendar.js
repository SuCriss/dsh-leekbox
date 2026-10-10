// LeekBox 交易日历与交易时段状态。
//
// 背景：全仓此前只有"周一~周五 + 9:30-11:30 / 13:00-15:00"这一条启发式
// （客户端 core.js 的 marketOpenLabel）。它会把国庆/春节这类**工作日假期**
// 判成"交易中"：界面显示错误的标签，轮询还会整天重复打上游，而东财 clist
// 是按出口 IP 限流的（见 emrank.js 的冷却逻辑）。
//
// 真值来源不需要新接口：指数日 K 的日期序列天然就是交易日序列（节假日没有
// K 线）。首次请求**不阻塞**——立刻用"工作日启发式"回答并把构建放到后台，
// 构建完成后同一进程内的后续请求拿到真实日历。拿不到就永远退回启发式，
// 由 `source: "weekday-fallback"` 如实标注，绝不假装知道。
// 取数通过 provider 注入（见 lib/index.js 的 setKlineProvider）：直接 import
// ./emrank.js 会形成 calendar ⇄ emrank 循环依赖，将来 emrank 想读时段状态时
// 会踩到未初始化的绑定。
let klineProvider = null;

/** 由宿主侧注入"取指数日 K"的实现；未注入时构建必然失败，退化为工作日启发式。 */
export function setKlineProvider(fn) {
	klineProvider = typeof fn === "function" ? fn : null;
}

//#region 常量

/** 缓存多久重建一次（交易日集合变化很慢，失败也按这个节奏重试）。 */
const CAL_TTL_MS = 12 * 60 * 60 * 1000;
/** 取多少根日 K 来推导交易日（30 个交易日 ≈ 6 周，足够覆盖长假）。 */
const CAL_BARS = 60;
/** 境内市场的本地时间基准：东八区。宿主机时区不参与判断。 */
const CN_OFFSET_MIN = 8 * 60;

/** 连续集合竞价 9:15-9:25 开始有参考价；这里只标注时段，不放行轮询竞价
 *  （竞价期间上游价格抖动大，交给后续功能决定是否消费）。 */
const SESSION_BOUNDS = [
	[9 * 60 + 15, 9 * 60 + 25, "auction"],
	[9 * 60 + 30, 11 * 60 + 30, "open"],
	[11 * 60 + 30, 13 * 60, "lunch"],
	[13 * 60, 15 * 60, "open"],
];

export const SESSION_LABEL = {
	preOpen: "盘前",
	auction: "集合竞价",
	open: "交易中",
	lunch: "午间休市",
	closed: "已收盘",
	weekend: "休市",
	holiday: "休市",
};

//#endregion

//#region 时区无关的时刻计算

/**
 * 把任意 Date 换算成"东八区墙上时间"。
 *
 * 用 Date.UTC 的字段再补 8 小时，避免 `toLocaleString(timeZone)` 的解析开销，
 * 也避免宿主机时区影响结论——用户在 UTC 机器上跑插件时，"现在几点"仍然是指
 * 北京时间，否则整个交易时段判断全错。
 */
function cnParts(date = new Date()) {
	const shifted = new Date(date.getTime() + CN_OFFSET_MIN * 60 * 1000);
	return {
		year: shifted.getUTCFullYear(),
		month: shifted.getUTCMonth() + 1,
		day: shifted.getUTCDate(),
		weekday: shifted.getUTCDay(), // 0 = 周日
		minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
	};
}

/** YYYY-MM-DD（东八区墙上日期）。 */
export function cnDateStr(date = new Date()) {
	const p = cnParts(date);
	return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** 时刻落在哪个时段（不考虑是否交易日——那是 calendar 的职责）。 */
function sessionOfMinutes(minutes) {
	const [auctionFrom, auctionTo] = SESSION_BOUNDS[0];
	if (minutes < 9 * 60 + 30) return minutes >= auctionFrom && minutes < auctionTo ? "auction" : "preOpen";
	for (const [from, to, name] of SESSION_BOUNDS) {
		if (minutes >= from && minutes < to) return name;
	}
	return "closed";
}

//#endregion

//#region 日历缓存

/** { tradingDays:Set<string>|null, lastTradingDay, nextTradingDay, builtAt, source } */
const state = {
	tradingDays: null,
	lastTradingDay: "",
	nextTradingDay: "",
	builtAt: 0,
	source: "weekday-fallback", // weekday-fallback | index-daily-kline
};
let buildInFlight = null;

/** 工作日启发式：只排除周末。假期要靠真实日历，这里如实标明是兜底。 */
function isWeekday(dateStr) {
	const [y, m, d] = dateStr.split("-").map(Number);
	const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
	return weekday >= 1 && weekday <= 5;
}

function hasCalendar() {
	return state.tradingDays !== null && state.tradingDays.size > 0;
}

/** 该日期是否为交易日。日历未就绪时退化为"非周末"。 */
export function isTradingDay(dateStr) {
	if (hasCalendar()) return state.tradingDays.has(dateStr);
	return isWeekday(dateStr);
}

/**
 * 用指数日 K 推导交易日序列。
 *
 * 上证指数（sh000001）在任一交易日必有日 K，节假日必然没有——所以日期序列
 * 本身就是交易日历。历史年份的调休也天然正确。
 */
async function buildCalendar() {
	if (klineProvider === null) throw new Error("kline provider not injected");
	const rows = await klineProvider("sh000001", { lmt: CAL_BARS });
	const days = rows.map((r) => String(r.date)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
	if (days.length === 0) throw new Error("index daily kline returned no dated bars");
	const sorted = [...new Set(days)].sort();
	const today = cnDateStr();
	const past = sorted.filter((d) => d <= today);
	const future = sorted.filter((d) => d > today);
	state.tradingDays = new Set(sorted);
	state.lastTradingDay = past.length > 0 ? past[past.length - 1] : "";
	state.nextTradingDay = future.length > 0 ? future[0] : "";
	state.builtAt = Date.now();
	state.source = "index-daily-kline";
}

/** 后台构建（单飞）。失败静默：调用方继续用启发式，并在 TTL 后重试。 */
export function ensureCalendar() {
	if (buildInFlight !== null) return buildInFlight;
	if (hasCalendar() && Date.now() - state.builtAt < CAL_TTL_MS) return Promise.resolve(true);
	buildInFlight = buildCalendar()
		.then(() => true)
		.catch(() => false)
		.finally(() => {
			buildInFlight = null;
		});
	return buildInFlight;
}

/** 测试用：塞入一个确定的日历，不发网络请求。
 *  @param {string[]} days 交易日列表
 *  @param {string} [asOf] 以哪一天为"今天"计算 last/next（默认真今天）
 *  @param {string} [source] 写进快照的 source 标注 */
export function setCalendarForTests(days, asOf = cnDateStr(), source = "test") {
	state.tradingDays = new Set(days);
	const sorted = [...state.tradingDays].sort();
	const past = sorted.filter((d) => d <= asOf);
	const future = sorted.filter((d) => d > asOf);
	state.lastTradingDay = past.length > 0 ? past[past.length - 1] : "";
	state.nextTradingDay = future.length > 0 ? future[0] : "";
	state.builtAt = Date.now();
	state.source = source;
}

export function resetCalendarForTests() {
	state.tradingDays = null;
	state.lastTradingDay = "";
	state.nextTradingDay = "";
	state.builtAt = 0;
	state.source = "weekday-fallback";
	buildInFlight = null;
}

//#endregion

//#region 对外状态

/**
 * 当前交易时段状态。
 *
 * `open` 是"此刻会不会有新价格"的唯一判据：轮询门控、缓存 TTL 都读它。
 * `session` 用 SESSION_LABEL 的键，界面标签直接取用。
 */
export function sessionState(now = new Date()) {
	const p = cnParts(now);
	const today = cnDateStr(now);
	const trading = isTradingDay(today);
	let session;
	if (!trading) {
		session = hasCalendar() ? "holiday" : p.weekday === 0 || p.weekday === 6 ? "weekend" : "holiday";
	} else {
		session = sessionOfMinutes(p.minutes);
	}
	return {
		date: today,
		session,
		label: SESSION_LABEL[session] ?? session,
		open: trading && session === "open",
		tradingDay: trading,
		calendarReady: hasCalendar(),
		source: state.source,
		lastTradingDay: state.lastTradingDay,
		nextTradingDay: state.nextTradingDay,
	};
}

/** `/api/leekbox/calendar` 的响应体：交易日列表 + 当前时段。不像 tick 那样
 *  需要秒级新鲜度，客户端按 30 分钟刷新即可。 */
export function calendarSnapshot(now = new Date()) {
	return {
		ok: true,
		today: cnDateStr(now),
		tradingDays: hasCalendar() ? [...state.tradingDays] : [],
		lastTradingDay: state.lastTradingDay,
		nextTradingDay: state.nextTradingDay,
		builtAt: state.builtAt,
		source: state.source,
		session: sessionState(now),
	};
}

/** 时段状态摘要（嵌进 /health、/sentiment，避免客户端多打一轮）。 */
export function sessionSummary(now = new Date()) {
	const s = sessionState(now);
	return { session: s.session, label: s.label, open: s.open, tradingDay: s.tradingDay, calendarReady: s.calendarReady };
}

/**
 * 按交易时段伸缩 TTL：非交易时段上游数据不再变化，把 TTL 放大 `closedFactor` 倍
 * 就能省掉整晚/整天的空转请求（节假日尤其明显）。
 *
 * @param {number} openTtlMs 交易时段内的 TTL
 * @param {number} closedFactor 盘后放大倍数
 */
export function sessionTtl(openTtlMs, closedFactor = 20, now = new Date()) {
	return sessionState(now).open ? openTtlMs : openTtlMs * closedFactor;
}

//#endregion
