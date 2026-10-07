// 冷启动保护必须在**全新进程**里验：复用率 EMA 是模块级状态，先跑过热批次就
// 再也测不出"从没见过复用"的初始情形了。
import {
	recordKlineLookup, klineCacheStats, MIN_KLINE_TTL, MAX_KLINE_TTL,
} from "./lib/screener-cache.js";

let fail = 0;
const check = (n, ok, note = "") => {
	if (!ok) fail++;
	console.log(`${ok ? "PASS" : "FAIL"}  ${n}${note === "" ? "" : `  — ${note}`}`);
};

const t0 = klineCacheStats();
check("冷启动起点：reuseEma = 0", t0.reuseEma === 0, String(t0.reuseEma));
check("冷启动起点：TTL = 10min", t0.currentKlineTTL === 10 * 60 * 1000, String(t0.currentKlineTTL));

// 连续 5 个"全 miss"批次 —— 这正是首次全市场扫描的真实形态。
// 旧实现在这里会把 TTL 一路缩短到 5min 下界（越缩越难命中，自我强化的雪崩）。
for (let batch = 0; batch < 5; batch++) {
	for (let i = 0; i < 200; i++) recordKlineLookup(false);
	const s = klineCacheStats();
	check(`冷批次 ${batch + 1} 后 TTL 未被缩短`, s.currentKlineTTL === 10 * 60 * 1000, `${s.currentKlineTTL} (ema=${s.reuseEma.toFixed(3)})`);
}
const t1 = klineCacheStats();
check("TTL 始终不低于起点", t1.currentKlineTTL >= t0.currentKlineTTL, `${t0.currentKlineTTL} -> ${t1.currentKlineTTL}`);
check("TTL 不越过上下界", t1.currentKlineTTL >= MIN_KLINE_TTL && t1.currentKlineTTL <= MAX_KLINE_TTL, String(t1.currentKlineTTL));

// 反证：养出真实复用后，同一个低复用批次就应该被允许缩短 —— 否则上一条会因为
// "永远不缩"而恒真，测不出任何东西。
for (let i = 0; i < 200; i++) recordKlineLookup(true);
const beforeShrink = klineCacheStats().currentKlineTTL;
for (let i = 0; i < 200; i++) recordKlineLookup(false);
const after = klineCacheStats();
check("见过复用后低复用才缩短 TTL", after.currentKlineTTL < beforeShrink, `${beforeShrink} -> ${after.currentKlineTTL}`);

console.log(fail === 0 ? "\n✅ 冷启动保护有效" : `\n${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
