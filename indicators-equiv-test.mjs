// 指标数学等价性 —— 回归测试（无网络）。
//
// 背景：kdj() 与 boll() 从"每个下标重算一遍窗口"的 O(n²) 写法改成了单调队列 /
// 滚动 sum·sumSq 的 O(n) 写法。这类改写最容易悄悄改变数值口径（平滑初值、窗口
// 边界、标准差是除 n 还是 n-1），所以这里把**重构前的原始实现**内联成参照物，
// 在同一批数据上逐点对比，把数值语义钉死。
import { kdj, boll, sma, macd, rsi, ema, crossUp } from "./lib/indicators.js";

let fail = 0;
const check = (name, ok, note = "") => {
	if (!ok) fail++;
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${note === "" ? "" : `  — ${note}`}`);
};

//#region 参照实现（重构前 lib/screener.js 的原始写法）
function kdjRef(klines, n = 9) {
	const kArr = [], dArr = [], jArr = [];
	let k = 50, d = 50;
	for (let i = 0; i < klines.length; i++) {
		const lo = klines.slice(Math.max(0, i - n + 1), i + 1);
		const llv = Math.min(...lo.map((x) => x.low));
		const hhv = Math.max(...lo.map((x) => x.high));
		const rsv = hhv === llv ? 50 : ((klines[i].close - llv) / (hhv - llv)) * 100;
		k = (2 / 3) * k + (1 / 3) * rsv;
		d = (2 / 3) * d + (1 / 3) * k;
		kArr.push(k); dArr.push(d); jArr.push(3 * k - 2 * d);
	}
	return { k: kArr, d: dArr, j: jArr };
}
function bollRef(closes, n = 20, k = 2) {
	const mid = sma(closes, n);
	const upper = new Array(closes.length).fill(null);
	const lower = new Array(closes.length).fill(null);
	for (let i = 0; i < closes.length; i++) {
		if (mid[i] === null) continue;
		const slice = closes.slice(Math.max(0, i - n + 1), i + 1);
		const mean = mid[i];
		let variance = 0;
		for (const v of slice) variance += (v - mean) ** 2;
		variance /= slice.length;
		const std = Math.sqrt(variance);
		upper[i] = mean + k * std;
		lower[i] = mean - k * std;
	}
	return { mid, upper, lower };
}
//#endregion

/** 随机游走 + 平盘段（触发 hhv === llv 兜底）+ 跳空，覆盖边界。 */
function makeSeries(seed, len = 300) {
	let s = seed >>> 0;
	const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
	const out = [];
	let px = 10 + rnd() * 40;
	for (let i = 0; i < len; i++) {
		if (i > 100 && i < 120) px = 20; // 完全平盘：高低点相同
		else if (i % 47 === 0) px = Math.max(0.5, px * 1.15); // 跳空
		else px = Math.max(0.5, px + (rnd() - 0.5) * px * 0.06);
		out.push({
			date: `d${i}`, open: px, close: px,
			high: px * (1 + rnd() * 0.02), low: px * (1 - rnd() * 0.02),
			volume: 1000 + rnd() * 9000,
		});
	}
	return out;
}

//#region 1. kdj / boll 逐点等价
{
	const TOL = 1e-9;
	let maxDiff = 0;
	let nullMismatch = 0;
	let points = 0;
	for (let seed = 1; seed <= 25; seed++) {
		const kl = makeSeries(seed);
		const closes = kl.map((x) => x.close);
		const a = kdjRef(kl);
		const b = kdj(kl);
		const bo = bollRef(closes);
		const bn = boll(closes);
		for (let i = 0; i < kl.length; i++) {
			for (const f of ["k", "d", "j"]) {
				points++;
				maxDiff = Math.max(maxDiff, Math.abs(a[f][i] - b[f][i]));
			}
			for (const f of ["mid", "upper", "lower"]) {
				points++;
				if ((bo[f][i] === null) !== (bn[f][i] === null)) { nullMismatch++; continue; }
				if (bo[f][i] === null) continue;
				maxDiff = Math.max(maxDiff, Math.abs(bo[f][i] - bn[f][i]));
			}
		}
	}
	check(`kdj/boll 与参照实现等价（${points} 采样点）`, maxDiff < TOL, `最大绝对误差 ${maxDiff}`);
	check("kdj/boll 的 null 位置完全一致", nullMismatch === 0, `不一致 ${nullMismatch} 处`);
	check("BOLL 窗口未满处为 null", boll([1, 2, 3]).upper.every((v) => v === null));
	check("BOLL 前 19 位为 null、第 20 位起有值", (() => {
		const b = boll(Array.from({ length: 30 }, (_, i) => 10 + i));
		return b.mid.slice(0, 19).every((v) => v === null) && b.mid.slice(19).every((v) => typeof v === "number");
	})());
}

//#region 2. 平盘段不得产生 NaN / Infinity
{
	const flat = makeSeries(7).slice(101, 119);
	const fk = kdj(flat);
	const fb = boll(flat.map((x) => x.close));
	const finite = (arr) => arr.every((v) => v === null || Number.isFinite(v));
	check("平盘段 KDJ 无 NaN/Infinity", finite(fk.k) && finite(fk.d) && finite(fk.j));
	check("平盘段 BOLL 无 NaN/Infinity", finite(fb.upper) && finite(fb.lower));
	// 全平盘：hhv === llv → RSV 兜底 50 → K/D 从 50 起不动
	const dead = Array.from({ length: 40 }, () => ({ date: "d", open: 5, close: 5, high: 5, low: 5, volume: 1 }));
	const dk = kdj(dead);
	check("全平盘 KDJ 兜底为 50", Math.abs(dk.k[39] - 50) < 1e-9 && Math.abs(dk.d[39] - 50) < 1e-9, `k=${dk.k[39]} d=${dk.d[39]}`);
	// 常数序列：方差为 0 → 上下轨收成中轨
	const cb = boll(Array.from({ length: 30 }, () => 8));
	check("常数序列 BOLL 上下轨等于中轨", cb.upper[29] === 8 && cb.lower[29] === 8 && cb.mid[29] === 8, `${cb.lower[29]}/${cb.mid[29]}/${cb.upper[29]}`);
}

//#region 3. 单调队列的窗口正确性（滑动 max/min 必须随窗口移动）
{
	// 造一个"历史最高点会滑出窗口"的序列：close 在 [0,10] 间对称摆动，
	// high = close + 1，low = close - 1，故每个窗口的 hhv/llv 都不同且可手算。
	// 若单调队列的队首过期剔除写错，hhv 会一直停在旧高点，RSV 随之算错。
	const closes = [10, 8, 6, 4, 2, 0, 2, 4, 6, 8, 10, 8, 6, 4, 2, 0, 2, 4];
	const kl = closes.map((c, i) => ({ date: `d${i}`, open: c, close: c, high: c + 1, low: c - 1, volume: 1 }));
	const N = 9;
	const k = kdj(kl, N);
	// 参照物：直接照 RSV 定义手算（窗口 = 最近 N 根）
	const expected = [];
	let ek = 50, ed = 50;
	for (let i = 0; i < kl.length; i++) {
		const win = kl.slice(Math.max(0, i - N + 1), i + 1);
		const hhv = Math.max(...win.map((x) => x.high));
		const llv = Math.min(...win.map((x) => x.low));
		const rsv = hhv === llv ? 50 : ((kl[i].close - llv) / (hhv - llv)) * 100;
		ek = (2 / 3) * ek + (1 / 3) * rsv;
		ed = (2 / 3) * ed + (1 / 3) * ek;
		expected.push({ k: ek, d: ed, j: 3 * ek - 2 * ed });
	}
	const maxDiff = expected.reduce((m, e, i) => Math.max(m, Math.abs(e.k - k.k[i]), Math.abs(e.d - k.d[i]), Math.abs(e.j - k.j[i])), 0);
	check("滑动窗口 max/min 随窗口移动（手算 RSV 参照）", maxDiff < 1e-9, `最大误差 ${maxDiff}`);

	// 决定性断言：下标 9 的窗口 [1..9] 已不含下标 0 的最高价 11，
	// 此时 hhv=9、llv=-1、close=8 → RSV=(8-(-1))/(9-(-1))*100 = 90。
	const rsv9 = ((8 - -1) / (9 - -1)) * 100;
	const expK9 = (2 / 3) * expected[8].k + (1 / 3) * rsv9;
	check("窗口滑出后旧高点被剔除（RSV=90）", Math.abs(k.k[9] - expK9) < 1e-9, `实际 ${k.k[9]} vs 期望 ${expK9}`);
	// 反证：若队首未剔除，hhv 会停在 11，RSV 变成 (8-(-1))/(11-(-1))*100 = 75，K 会明显偏小
	const staleK9 = (2 / 3) * expected[8].k + (1 / 3) * 75;
	check("未剔除旧高点的错误结果确实不同（断言有效）", Math.abs(staleK9 - expK9) > 1, `${staleK9.toFixed(4)} vs ${expK9.toFixed(4)}`);
}

//#region 4. 其余指标保持原语义（防止拆分时改错）
{
	check("ema 首值即种子", ema([5, 7, 9], 3)[0] === 5);
	check("sma 窗口未满为 null", sma([1, 2, 3, 4], 3).slice(0, 2).every((v) => v === null) && sma([1, 2, 3, 4], 3)[2] === 2);
	const closes = Array.from({ length: 60 }, (_, i) => 10 + Math.sin(i / 4) * 2 + i * 0.1);
	const m = macd(closes);
	check("macd 三线等长", m.dif.length === closes.length && m.dea.length === closes.length && m.hist.length === closes.length);
	check("macd hist = (dif - dea) * 2", Math.abs(m.hist[59] - (m.dif[59] - m.dea[59]) * 2) < 1e-12);
	const r = rsi(closes, 6);
	check("rsi 前 period 位为 null", r.slice(0, 6).every((v) => v === null) && typeof r[6] === "number");
	check("rsi 落在 0..100", r.slice(6).every((v) => v >= 0 && v <= 100));
	check("rsi 单边上涨为 100", rsi(Array.from({ length: 20 }, (_, i) => i + 1), 6)[19] === 100);
	check("crossUp 命中当根上穿", crossUp([0, 1, 3], [1, 2, 2], 2, 3) === true);
	check("crossUp 未上穿为 false", crossUp([3, 2, 1], [1, 2, 2], 2, 3) === false);
	check("crossUp 当根为 null 直接 false", crossUp([1, null], [0, 0], 1, 3) === false);
}

console.log(fail === 0 ? "\n✅ 指标数学与原实现等价" : `\n${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
