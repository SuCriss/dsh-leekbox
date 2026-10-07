// 技术指标数学 —— 纯函数，无网络、无状态、无 I/O。
//
// 约定：所有数组型返回值与入参 closes/klines 等长且下标对齐；窗口尚未凑满的
// 位置一律填 null（而不是 0 或跳过），调用方靠 null 判断"数据还不够"。
// 数值语义与重构前逐位一致，只有 kdj/boll 的**计算方式**从 O(n²) 改为 O(n)。

/** 指数移动平均。首值直接作为种子，与常见的 SMA 播种实现不同——保持原行为。 */
export function ema(values, period) {
	const k = 2 / (period + 1);
	const out = [];
	let prev = values[0];
	out.push(prev);
	for (let i = 1; i < values.length; i++) {
		prev = values[i] * k + prev * (1 - k);
		out.push(prev);
	}
	return out;
}

/** MACD：DIF = EMA(fast) - EMA(slow)，DEA = EMA(DIF, signal)，HIST = (DIF - DEA) * 2。 */
export function macd(closes, fast = 12, slow = 26, signal = 9) {
	const ef = ema(closes, fast);
	const es = ema(closes, slow);
	const dif = closes.map((_, i) => ef[i] - es[i]);
	const dea = ema(dif, signal);
	const hist = dif.map((d, i) => (d - dea[i]) * 2);
	return { dif, dea, hist };
}

/**
 * 相对强弱指标（Wilder 平滑）。
 * 前 period 位为 null；avgLoss 为 0 时按 100 处理（单边上涨）。
 */
export function rsi(closes, period) {
	const out = new Array(closes.length).fill(null);
	if (closes.length <= period) return out;
	let gain = 0;
	let loss = 0;
	for (let i = 1; i <= period; i++) {
		const ch = closes[i] - closes[i - 1];
		if (ch >= 0) gain += ch;
		else loss -= ch;
	}
	let avgGain = gain / period;
	let avgLoss = loss / period;
	out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
	for (let i = period + 1; i < closes.length; i++) {
		const ch = closes[i] - closes[i - 1];
		const g = ch > 0 ? ch : 0;
		const l = ch < 0 ? -ch : 0;
		avgGain = (avgGain * (period - 1) + g) / period;
		avgLoss = (avgLoss * (period - 1) + l) / period;
		out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
	}
	return out;
}

/**
 * KDJ（n 日 RSV，K/D 用 2/3 + 1/3 平滑，J = 3K - 2D），初值 K = D = 50。
 *
 * 滚动窗口的 HHV/LLV 用单调队列维护：每个下标最多进出队一次，整体 O(n)。
 * 旧实现每根 K 线都 slice 一次窗口再 spread 求 min/max，是 O(n²)，在
 * 120 根 × 上千只票的扫描里是实打实的开销。
 */
export function kdj(klines, n = 9) {
	const len = klines.length;
	const kArr = new Array(len);
	const dArr = new Array(len);
	const jArr = new Array(len);
	// 单调队列存下标：maxDq 递减（队首最大），minDq 递增（队首最小）。
	const maxDq = [];
	const minDq = [];
	let maxHead = 0;
	let minHead = 0;
	let k = 50;
	let d = 50;
	for (let i = 0; i < len; i++) {
		const { high, low } = klines[i];
		while (maxDq.length > maxHead && klines[maxDq[maxDq.length - 1]].high <= high) maxDq.pop();
		maxDq.push(i);
		while (maxDq.length > maxHead && maxDq[maxHead] <= i - n) maxHead++;
		while (minDq.length > minHead && klines[minDq[minDq.length - 1]].low >= low) minDq.pop();
		minDq.push(i);
		while (minDq.length > minHead && minDq[minHead] <= i - n) minHead++;
		const hhv = klines[maxDq[maxHead]].high;
		const llv = klines[minDq[minHead]].low;
		const rsv = hhv === llv ? 50 : ((klines[i].close - llv) / (hhv - llv)) * 100;
		k = (2 / 3) * k + (1 / 3) * rsv;
		d = (2 / 3) * d + (1 / 3) * k;
		kArr[i] = k;
		dArr[i] = d;
		jArr[i] = 3 * k - 2 * d;
	}
	return { k: kArr, d: dArr, j: jArr };
}

/** 简单移动平均。窗口未满的位置为 null。 */
export function sma(values, period) {
	const out = new Array(values.length).fill(null);
	let sum = 0;
	for (let i = 0; i < values.length; i++) {
		sum += values[i];
		if (i >= period) sum -= values[i - period];
		if (i >= period - 1) out[i] = sum / period;
	}
	return out;
}

/**
 * 布林带：中轨 = SMA(n)，上下轨 = 中轨 ± k × 总体标准差（除以 n，非 n-1）。
 *
 * 标准差用滚动 sum / sumSq 一次算出，整体 O(n)。方差理论上非负，浮点误差
 * 可能给出极小的负数，这里钳到 0（band 收成一条线），避免 sqrt(负数) = NaN
 * 顺着信号链污染整只票的评分。
 */
export function boll(closes, n = 20, k = 2) {
	const len = closes.length;
	const mid = sma(closes, n);
	const upper = new Array(len).fill(null);
	const lower = new Array(len).fill(null);
	let sum = 0;
	let sumSq = 0;
	for (let i = 0; i < len; i++) {
		const v = closes[i];
		sum += v;
		sumSq += v * v;
		if (i >= n) {
			const drop = closes[i - n];
			sum -= drop;
			sumSq -= drop * drop;
		}
		if (mid[i] === null) continue;
		const mean = mid[i];
		const variance = Math.max(0, sumSq / n - mean * mean);
		const std = Math.sqrt(variance);
		upper[i] = mean + k * std;
		lower[i] = mean - k * std;
	}
	return { mid, upper, lower };
}

/**
 * a 是否在最近 lookback 根内上穿 b（含当根）。
 * 从当根往回扫，命中任一交叉即为 true；任一侧为 null 的相邻两根都跳过。
 */
export function crossUp(a, b, last, lookback) {
	if (a[last] === null || b[last] === null) return false;
	for (let i = last; i > Math.max(0, last - lookback); i--) {
		if (a[i] === null || b[i] === null || a[i - 1] === null || b[i - 1] === null) continue;
		if (a[i] > b[i] && a[i - 1] <= b[i - 1]) return true;
	}
	return false;
}
