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

/**
 * 真实波幅（True Range）。首值用 high-low，后续取 max(high-low, |high-prevClose|, |low-prevClose|)。
 */
export function trueRange(klines) {
	const out = new Array(klines.length).fill(null);
	if (klines.length === 0) return out;
	out[0] = klines[0].high - klines[0].low;
	for (let i = 1; i < klines.length; i++) {
		const hl = klines[i].high - klines[i].low;
		const hc = Math.abs(klines[i].high - klines[i - 1].close);
		const lc = Math.abs(klines[i].low - klines[i - 1].close);
		out[i] = Math.max(hl, hc, lc);
	}
	return out;
}

/**
 * ATR（Average True Range）：Wilder 平滑，首 period 根用简单平均，后续用 (prev*(period-1) + cur) / period。
 */
export function atr(klines, period = 14) {
	const tr = trueRange(klines);
	const out = new Array(tr.length).fill(null);
	if (tr.length < period) return out;
	let sum = 0;
	for (let i = 0; i < period; i++) sum += tr[i];
	out[period - 1] = sum / period;
	for (let i = period; i < tr.length; i++) {
		out[i] = (out[i - 1] * (period - 1) + tr[i]) / period;
	}
	return out;
}

/**
 * TD 序列（DeMark Sequential）：计数连续收盘价高于/低于 4 根前的收盘价。
 * 返回 { setup: number[], countdown: number[] }，setup 到 9 重置，countdown 到 13 重置。
 */
export function tdSequence(closes) {
	const len = closes.length;
	const setup = new Array(len).fill(0);
	const countdown = new Array(len).fill(0);
	if (len < 5) return { setup, countdown };
	// Setup phase
	for (let i = 4; i < len; i++) {
		if (closes[i] > closes[i - 4]) {
			setup[i] = setup[i - 1] > 0 ? setup[i - 1] + 1 : 1;
			if (setup[i] > 9) setup[i] = 1;
		} else if (closes[i] < closes[i - 4]) {
			setup[i] = setup[i - 1] < 0 ? setup[i - 1] - 1 : -1;
			if (setup[i] < -9) setup[i] = -1;
		}
	}
	// Countdown phase (simplified: count consecutive setup completions)
	for (let i = 12; i < len; i++) {
		if (setup[i - 3] === 9 && closes[i] >= closes[i - 2]) {
			countdown[i] = countdown[i - 1] > 0 ? countdown[i - 1] + 1 : 1;
			if (countdown[i] > 13) countdown[i] = 1;
		} else if (setup[i - 3] === -9 && closes[i] <= closes[i - 2]) {
			countdown[i] = countdown[i - 1] < 0 ? countdown[i - 1] - 1 : -1;
			if (countdown[i] < -13) countdown[i] = -1;
		}
	}
	return { setup, countdown };
}

/**
 * 蜡烛形态识别：返回最近 N 根 K 线的形态标签数组。
 * 支持：看涨吞没、早晨之星、长上影、长下影、十字星。
 */
export function candlePatterns(klines) {
	const out = new Array(klines.length).fill(null);
	if (klines.length < 3) return out;
	for (let i = 2; i < klines.length; i++) {
		const c = klines[i];
		const p = klines[i - 1];
		const pp = klines[i - 2];
		const body = Math.abs(c.close - c.open);
		const upper = c.high - Math.max(c.open, c.close);
		const lower = Math.min(c.open, c.close) - c.low;
		const range = c.high - c.low;
		if (range === 0) continue;
		const patterns = [];
		// 十字星
		if (body < range * 0.1) patterns.push("十字星");
		// 长上影
		if (upper > body * 2 && upper > lower * 2) patterns.push("长上影");
		// 长下影
		if (lower > body * 2 && lower > upper * 2) patterns.push("长下影");
		// 看涨吞没
		if (p.close < p.open && c.close > c.open && c.close > p.open && c.open < p.close) {
			patterns.push("看涨吞没");
		}
		// 早晨之星（三根 K 线组合）
		if (pp.close < pp.open && Math.abs(p.close - p.open) < (pp.high - pp.low) * 0.3 && c.close > c.open && c.close > pp.open) {
			patterns.push("早晨之星");
		}
		if (patterns.length > 0) out[i] = patterns.join(",");
	}
	return out;
}

/**
 * VWAP（Volume Weighted Average Price）：滚动窗口内的成交量加权平均价。
 */
export function vwap(klines, period = 20) {
	const out = new Array(klines.length).fill(null);
	if (klines.length < period) return out;
	for (let i = period - 1; i < klines.length; i++) {
		let sumPV = 0;
		let sumV = 0;
		for (let j = i - period + 1; j <= i; j++) {
			const typical = (klines[j].high + klines[j].low + klines[j].close) / 3;
			sumPV += typical * klines[j].volume;
			sumV += klines[j].volume;
		}
		if (sumV > 0) out[i] = sumPV / sumV;
	}
	return out;
}
