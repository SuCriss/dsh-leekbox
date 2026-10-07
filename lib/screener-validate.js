// 选股参数校验与归一化。
//
// 这一层同时服务两个入口：
//   - HTTP 路由（lib/index.js）读原始请求体后先归一化，再交给引擎；
//   - 引擎 runScreener 自己也归一化一次，保证直接 import 调用时同样严格。
// 归一化是幂等的，重复调用没有副作用。
//
// 失败一律抛 ScreenerError 并带上**机器可读的 code**，路由据此决定状态码——
// 以前是靠 /^(未知|multi 模式)/ 正则去匹配中文报错文案来判 400，改一句文案
// 就会静默退化成 502，这里把文案和协议解耦。
import { SIGNAL_META, STRATEGY_META } from "./signals.js";

/** 校验类错误码。 */
export const ERR_ALREADY_RUNNING = "screener_already_running";
export const ERR_INVALID_PARAMS = "screener_invalid_params";

/** 带错误码的选股异常；message 是给用户看的中文，code 是给路由看的协议标识。 */
export class ScreenerError extends Error {
	/**
	 * @param {string} message 面向用户的中文文案
	 * @param {string} code 机器可读错误码
	 */
	constructor(message, code) {
		super(message);
		this.name = "ScreenerError";
		this.code = code;
	}
}

/** 请求体允许出现的键，其余一律丢弃（不静默接受拼错的参数）。 */
export const ALLOWED_PARAMS = [
	"node", "universe", "priceMin", "priceMax", "turnoverMin", "turnoverMax",
	"changeMin", "changeMax", "excludeST", "require", "minScore", "lookback",
	"mode", "strategies", "minStrategyHits",
];

/**
 * 只挑出合法键，丢掉未知字段（客户端多传/拼错的参数不会渗进引擎）。
 * @param {object} raw
 * @returns {object}
 */
export function pickScreenerParams(raw) {
	const src = raw && typeof raw === "object" ? raw : {};
	const out = {};
	for (const key of ALLOWED_PARAMS) {
		if (src[key] !== void 0) out[key] = src[key];
	}
	return out;
}

const DEFAULT_UNIVERSE = 800;
const DEFAULT_LOOKBACK = 3;
const DEFAULT_MIN_SCORE = 0;
const DEFAULT_MIN_STRATEGY_HITS = 2;

/** 允许的市场板块。 */
const NODES = new Set(["hs_a", "sh_a", "sz_a", "cyb", "kcb"]);

/** 空串/undefined/null 都算"没填"；填了但不是数字 → null（按未填处理）。 */
function numOrNull(v) {
	if (v === undefined || v === null || v === "") return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

/** 取有限数字，否则回退默认值。 */
function numOr(v, fallback) {
	const n = numOrNull(v);
	return n === null ? fallback : n;
}

/** 字符串数组：只保留字符串元素；非数组返回空数组。 */
function stringList(v) {
	return Array.isArray(v) ? v.filter((k) => typeof k === "string") : [];
}

/**
 * 把任意（可能来自网络、可能带脏字段的）入参归一化成引擎内部使用的规范形状。
 * 未知的键被丢弃，数组去重，数字字段统一为 number|null。
 * @param {object} raw
 * @returns {object} 规范参数
 * @throws {ScreenerError} ERR_INVALID_PARAMS
 */
export function normalizeScreenerParams(raw) {
	const src = raw && typeof raw === "object" ? raw : {};
	const node = typeof src.node === "string" && NODES.has(src.node) ? src.node : "hs_a";
	const universeRaw = numOr(src.universe, DEFAULT_UNIVERSE);
	const universe = universeRaw > 0 ? Math.floor(universeRaw) : 0;
	const lookback = Math.max(1, Math.floor(numOr(src.lookback, DEFAULT_LOOKBACK)));
	const mode = src.mode === "multi" ? "multi" : "standard";

	// 去重但保留定义顺序，让缓存键与返回的 strategies 列表稳定。
	const require = [...new Set(stringList(src.require))];
	const strategies = [...new Set(stringList(src.strategies))];

	const unknownRequire = require.filter((k) => !SIGNAL_META[k]);
	if (unknownRequire.length > 0) {
		throw new ScreenerError(`未知的技术信号: ${unknownRequire.join(", ")}`, ERR_INVALID_PARAMS);
	}
	if (mode === "multi") {
		const unknownStrategies = strategies.filter((k) => !STRATEGY_META[k]);
		if (unknownStrategies.length > 0) {
			throw new ScreenerError(`未知的选股策略: ${unknownStrategies.join(", ")}`, ERR_INVALID_PARAMS);
		}
		if (strategies.length === 0) {
			throw new ScreenerError("multi 模式需要至少选择一个有效策略", ERR_INVALID_PARAMS);
		}
	}

	// 门槛至少 1；同时不超过所选策略数，让"门槛比策略数还高"退化成"全中"，
	// 而不是永远返回空列表。
	const minStrategyHits = Math.max(
		1,
		Math.min(Math.floor(numOr(src.minStrategyHits, DEFAULT_MIN_STRATEGY_HITS)), strategies.length || 1)
	);

	return {
		node,
		universe,
		priceMin: numOrNull(src.priceMin),
		priceMax: numOrNull(src.priceMax),
		turnoverMin: numOrNull(src.turnoverMin),
		turnoverMax: numOrNull(src.turnoverMax),
		changeMin: numOrNull(src.changeMin),
		changeMax: numOrNull(src.changeMax),
		excludeST: src.excludeST === true,
		require,
		minScore: numOr(src.minScore, DEFAULT_MIN_SCORE),
		lookback,
		mode,
		strategies,
		minStrategyHits,
	};
}
