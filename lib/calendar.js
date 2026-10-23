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
//
// ⚠️ 日 K 序列有一个**右边界**问题（2026-10-23 线上事故）：日线只包含"已经
// 走完（或至少已经出现过）"的交易日，今天那根最早也要到集合竞价才有。于是
// 「今天不在集合里」既可能是"今天休市"，也可能只是"今天的日线还没出"，旧实现
// 一律当成休市 → 任何交易日的白天都显示"休市"（12 小时 TTL 还会把早盘那份
// 错误快照一直留到晚上）。现在把两者分开：
//   1. 日期落在已发布序列的覆盖窗口 [from, to] 内且不在集合里 → 确定休市；
//   2. 日期在右边界之后（今天的日线还没出）→ 先用 5 分钟线探测今天开没开盘；
//      探测到当天分时 → 交易日；探测不到且已过开盘确认时刻 → 休市；
//      否则（盘前/探测失败）→ 保持"未定"，退回工作日启发式，绝不谎报休市；
//   3. 跨到新的一天必须重建（序列右边界每天都会前移）。
let klineProvider = null;

/** 由宿主侧注入"取指数日 K"的实现；未注入时构建必然失败，退化为工作日启发式。 */
export function setKlineProvider(fn) {
	klineProvider = typeof fn === "function" ? fn : null;
}

//#region 常量

/** 缓存多久重建一次（交易日集合变化很慢，失败也按这个节奏重试）。 */
const CAL_TTL_MS = 12 * 60 * 60 * 1000;
/** 今天的日线还没出时的重探节奏：早盘窗口要快，凌晨不必空转。 */
const CAL_TTL_PROBE_FAST_MS = 90 * 1000;
const CAL_TTL_PROBE_SLOW_MS = 10 * 60 * 1000;
const CAL_TTL_PROBE_NIGHT_MS = 60 * 60 * 1000;
/** 取多少根日 K 来推导交易日（30 个交易日 ≈ 6 周，足够覆盖长假）。 */
const CAL_BARS = 60;
/** 境内市场的本地时间基准：东八区。宿主机时区不参与判断。 */
const CN_OFFSET_MIN = 8 * 60;
/** 过了这一刻还没有今天的日线、也没有今天的分时，就认定今天不是交易日。
 *  实测 2026-10-23：09:05 上证日线还没有当天那根，09:23 已经有了；5 分钟线
 *  09:30 起才有当天第一根。留到 09:35，给上游延迟留一次缓冲。 */
const CN_SETTLE_MINUTES = 9 * 60 + 35;

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

/**
 * 日历状态。
 *
 * `days` / `from` / `to` 描述**已发布的**日线覆盖窗口：`[from, to]` 之内的
 * 工作日若不在集合里，那一定是没开市（窗口内不可能"还没出"）。`verdict` 是
 * 对"今天"这一天的单独结论——今天往往落在 `to` 之后（当天的日线还没出），
 * 这时只能靠 5 分钟线探测 + 时间推断，结论单独存，不污染交易日集合。
 */
const state = {
	tradingDays: null, // Set<string>|null 已发布的交易日
	days: [], // 同一批日期的升序数组（算 last / next 用）
	from: "", // 覆盖窗口左边界
	to: "", // 覆盖窗口右边界（= 已发布的最新一根日线）
	verdict: null, // { date, trading, via } 对"今天"的判定；null = 还没定
	builtAt: 0,
	builtOn: "", // 构建时的东八区日期，跨日必须重建
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

/** 该日期是否落在已发布日线的覆盖窗口内（窗口内"缺失"才算确定休市）。 */
function inCoverage(dateStr) {
	return hasCalendar() && dateStr >= state.from && dateStr <= state.to;
}

function verdictFor(dateStr) {
	return state.verdict !== null && state.verdict.date === dateStr ? state.verdict : null;
}

/** 这个日期是不是已经拿到了日线（今天那根通常要等开盘）。 */
function hasBar(dateStr) {
	return hasCalendar() && state.tradingDays.has(dateStr);
}

/**
 * 该日期是否为交易日。
 *
 * 判据按可信度从高到低：已发布的日线集合 → 覆盖窗口内的"缺失"（确定休市）→
 * 今天的单项结论（分时探测/时间推断）→ 工作日启发式（未定时的兜底）。
 * 日历未就绪时退化为"非周末"。
 */
export function isTradingDay(dateStr) {
	if (!hasCalendar()) return isWeekday(dateStr);
	if (hasBar(dateStr)) return true;
	if (inCoverage(dateStr)) return false;
	const verdict = verdictFor(dateStr);
	if (verdict !== null) return verdict.trading;
	// 覆盖窗口之外（右边界之后 = 今天的日线还没出）：按工作日推定。
	return isWeekday(dateStr);
}

/**
 * 用指数日 K 推导交易日序列。
 *
 * 上证指数（sh000001）在任一交易日必有日 K，节假日必然没有——所以日期序列
 * 本身就是交易日历。历史年份的调休也天然正确。
 */
async function buildCalendar(now) {
	if (klineProvider === null) throw new Error("kline provider not injected");
	const rows = await klineProvider("sh000001", { lmt: CAL_BARS });
	const days = rows.map((r) => String(r.date)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
	if (days.length === 0) throw new Error("index daily kline returned no dated bars");
	const sorted = [...new Set(days)].sort();
	state.tradingDays = new Set(sorted);
	state.days = sorted;
	state.from = sorted[0];
	state.to = sorted[sorted.length - 1];
	state.builtAt = now.getTime();
	state.builtOn = cnDateStr(now);
	state.source = "index-daily-kline";
	await resolveToday(now);
}

/**
 * 判定"今天"是不是交易日。
 *
 * 今天通常落在日线覆盖窗口的右边界之后——当天那根要到集合竞价前后才出现，
 * 收盘后才有终值。这一段只能靠两件事判：今天有没有分时数据（真的开过盘），
 * 以及"已经过了开盘确认时刻还没有分时"（那就是没开市）。
 * 两者都给不出结论时保持 null，让 isTradingDay 退回工作日启发式——盘前本来就
 * 该显示"盘前/集合竞价"，这里绝不能因为"查不到"就谎报休市。
 */
async function resolveToday(now) {
	const today = cnDateStr(now);
	state.verdict = null;
	if (hasBar(today)) {
		state.verdict = { date: today, trading: true, via: "daily-kline" };
		return;
	}
	if (inCoverage(today)) {
		// 覆盖窗口说明这批日线是"到某一个未来日期为止"的（测试/历史回溯）；
		// 窗口内缺一根只可能是没开市。
		state.verdict = { date: today, trading: false, via: "daily-kline" };
		return;
	}
	if (today < state.from) return;
	if (!isWeekday(today)) {
		state.verdict = { date: today, trading: false, via: "weekend" };
		return;
	}
	const probe = await probeTodaySession(now);
	if (probe === true) {
		state.verdict = { date: today, trading: true, via: "minute-probe" };
		return;
	}
	if (probe === false && cnParts(now).minutes >= CN_SETTLE_MINUTES) {
		state.verdict = { date: today, trading: false, via: "no-session-after-settle" };
	}
}

/**
 * 今天有没有分时数据。
 *
 * @returns {Promise<boolean|null>} true = 今天开过盘；false = 没有今天的分时；
 *   null = 探测失败（上游出错/空数据），调用方必须当成"不知道"，不能当成休市。
 */
async function probeTodaySession(now) {
	if (klineProvider === null) return null;
	try {
		const rows = await klineProvider("sh000001", { klt: 5, lmt: 1 });
		if (!Array.isArray(rows) || rows.length === 0) return null;
		const last = String(rows[rows.length - 1]?.date ?? "");
		if (last === "") return null;
		// 日线是 "YYYY-MM-DD"，5 分钟线是 "YYYY-MM-DD HH:mm"，取日期部分即可。
		return last.slice(0, 10) === cnDateStr(now);
	} catch {
		return null;
	}
}

/**
 * 距离下次重建还要等多久。
 *
 * "今天还没有日线"是唯一需要频繁重试的状态：早盘那半小时里今天是不是交易日
 * 关系到整天的标签和轮询门控，必须尽快定下来；拿到今天的日线之后集合就稳定了。
 * 跨日则无条件重建——序列右边界每天都会前移，12 小时的 TTL 会把昨天的集合
 * 带进新的一天（这正是"白天永远显示休市"的第二半原因）。
 */
function probeTtl(now) {
	if (!hasCalendar()) return 0;
	const today = cnDateStr(now);
	if (today !== state.builtOn) return 0;
	if (hasBar(today)) return CAL_TTL_MS;
	const verdict = verdictFor(today);
	if (verdict !== null) {
		// 今天已经有结论了。唯一还值得再探的是"靠分时确认过的交易日"：等当天
		// 日线出来把集合补齐（last/next 会跟着变）。休市结论不再重探，别空转。
		return verdict.via === "minute-probe" ? CAL_TTL_PROBE_SLOW_MS : CAL_TTL_MS;
	}
	const minutes = cnParts(now).minutes;
	if (minutes >= 9 * 60 + 5 && minutes <= 9 * 60 + 50) return CAL_TTL_PROBE_FAST_MS;
	if (minutes < 9 * 60 + 5) return CAL_TTL_PROBE_NIGHT_MS;
	return CAL_TTL_PROBE_SLOW_MS;
}

/** 后台构建（单飞）。失败静默：调用方继续用启发式，并在 TTL 后重试。 */
export function ensureCalendar(now = new Date()) {
	if (buildInFlight !== null) return buildInFlight;
	if (hasCalendar() && now.getTime() - state.builtAt < probeTtl(now)) return Promise.resolve(true);
	buildInFlight = buildCalendar(now)
		.then(() => true)
		.catch(() => false)
		.finally(() => {
			buildInFlight = null;
		});
	return buildInFlight;
}

/** 测试用：塞入一个确定的日历，不发网络请求。
 *  @param {string[]} days 交易日列表
 *  @param {string} [asOf] 以哪一天为"今天"计算覆盖窗口与 last/next（默认真今天）
 *  @param {string} [source] 写进快照的 source 标注 */
export function setCalendarForTests(days, asOf = cnDateStr(), source = "test") {
	const sorted = [...new Set(days)].sort();
	state.tradingDays = new Set(sorted);
	state.days = sorted;
	state.from = sorted.length > 0 ? sorted[0] : "";
	state.to = sorted.length > 0 ? sorted[sorted.length - 1] : "";
	state.builtAt = Date.now();
	state.builtOn = asOf;
	state.source = source;
	// 与真实构建保持一致：给出"以 asOf 为今天"的单项结论（覆盖窗口之外保持未定，
	// 由 isTradingDay 退回工作日启发式）。
	state.verdict = null;
	if (sorted.includes(asOf)) state.verdict = { date: asOf, trading: true, via: source };
	else if (inCoverage(asOf)) state.verdict = { date: asOf, trading: false, via: source };
}

/** 测试用：直接给"今天"下结论（跳过上游探测）。
 *  @param {string} date 东八区日期
 *  @param {boolean} trading 是不是交易日
 *  @param {string} [via] 结论来源标注 */
export function setTodayVerdictForTests(date, trading, via = "test") {
	state.verdict = { date, trading: trading === true, via };
}

export function resetCalendarForTests() {
	state.tradingDays = null;
	state.days = [];
	state.from = "";
	state.to = "";
	state.verdict = null;
	state.builtAt = 0;
	state.builtOn = "";
	state.source = "weekday-fallback";
	buildInFlight = null;
}

//#endregion

//#region 对外状态

/** 已发布日线覆盖窗口内最近 / 下一个交易日（按"今天"现算，跨日不留旧值）。 */
function lastAndNext(today) {
	let last = "";
	let next = "";
	for (const d of state.days) {
		if (d <= today) last = d;
		else if (next === "") next = d;
	}
	return { last, next };
}

/**
 * 当前交易时段状态。
 *
 * `open` 是"此刻会不会有新价格"的唯一判据：轮询门控、缓存 TTL 都读它。
 * `session` 用 SESSION_LABEL 的键，界面标签直接取用。
 * `provisional` = 今天还没被日线/探测确认，当前结论是工作日推定出来的；界面
 * 可以据此少报"休市"，调用方也可以据此提高重探频率。
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
	const verdict = verdictFor(today);
	const { last, next } = lastAndNext(today);
	return {
		date: today,
		session,
		label: SESSION_LABEL[session] ?? session,
		open: trading && session === "open",
		tradingDay: trading,
		calendarReady: hasCalendar(),
		provisional: hasCalendar() && !hasBar(today) && verdict === null,
		todayVia: verdict === null ? "" : verdict.via,
		source: state.source,
		lastTradingDay: last,
		nextTradingDay: next,
	};
}

/** `/api/leekbox/calendar` 的响应体：交易日列表 + 当前时段。不像 tick 那样
 *  需要秒级新鲜度，客户端按 30 分钟刷新即可。 */
export function calendarSnapshot(now = new Date()) {
	const today = cnDateStr(now);
	const { last, next } = lastAndNext(today);
	const verdict = verdictFor(today);
	const provisional = hasCalendar() && !hasBar(today) && verdict === null;
	return {
		ok: true,
		today,
		tradingDays: hasCalendar() ? state.days : [],
		// 日线覆盖窗口：客户端据此判断"今天不在集合里"到底是确定休市还是还没出。
		from: state.from,
		to: state.to,
		// 服务端对"今天"的单项结论；null = 还没定（客户端退回工作日启发式）。
		todayTrading: verdict === null ? null : verdict.trading,
		todayVia: verdict === null ? "" : verdict.via,
		// 今天的结论还只是"工作日推定"（日线没出、也还没到能判死的时刻）。
		provisional: provisional,
		lastTradingDay: last,
		nextTradingDay: next,
		builtAt: state.builtAt,
		source: state.source,
		session: sessionState(now),
	};
}

/** 时段状态摘要（嵌进 /health、/sentiment，避免客户端多打一轮）。 */
export function sessionSummary(now = new Date()) {
	const s = sessionState(now);
	return {
		session: s.session,
		label: s.label,
		open: s.open,
		tradingDay: s.tradingDay,
		calendarReady: s.calendarReady,
		provisional: s.provisional,
	};
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
