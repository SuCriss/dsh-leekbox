// LeekBox 路由级缓存 + 单飞（in-flight 去重）。
//
// 为什么需要它：这个插件最热的路由（/quote /rank /sector /news /fflow
// /minute /kline）此前**每次请求都直打上游**，而客户端是按 15~60s 的周期
// 轮询的，多开几个详情窗还会并发同码请求。项目自己记录过东财 clist 按出口
// IP 限流（见 emrank.js 的冷却逻辑）——重复请求不只是浪费，它会主动触发限流。
//
// 这里提供三件东西，缺一不可：
//   1. TTL 缓存        —— 同一 key 在 TTL 内只打一次上游。
//   2. 单飞            —— 并发同 key 的请求共享同一个 Promise（缓存挡不住
//                        并发：第一次请求写缓存前，第二个请求已经进来了）。
//   3. stale-if-error  —— 上游抖动时返回上次成功的数据（带 generatedAt），
//                        而不是把 502 糊到用户脸上。这是图表类页面的正确降级：
//                        数据稍旧 ≫ 整个面板空白。
//
// TTL 支持传函数，于是"盘中短、盘后长"可以写成一行：非交易时段上游数据不再
// 变化，TTL 拉长到小时级可以省掉整晚的空转请求（配合 ./calendar.js）。
//
// 注意：缓存的是**已经成形、可以直接回给浏览器的响应对象**，所以调用方必须
// 传完整响应体、不要在缓存外再加工——否则命中与未命中两条路径会漂移。
// README 承诺的"绝不返回假的 0/0"语义不受影响：缓存只在拿到真实数据后写入，
// 上游失败不会写入任何"空快照"。

//#region 注册表（供 /health 观测与测试重置）

/** 进程内所有缓存实例：`/metrics` 用它输出命中率，测试用它清状态。 */
const registry = new Map();

export function routeCacheStats() {
	const out = {};
	for (const [name, cache] of registry) {
		const total = cache.hits + cache.misses;
		out[name] = {
			size: cache.map.size,
			hits: cache.hits,
			misses: cache.misses,
			stores: cache.stores,
			evictions: cache.evictions,
			staleServes: cache.staleServes,
			hitRate: total === 0 ? 0 : Number((cache.hits / total).toFixed(4)),
			lastAt: cache.lastAt,
		};
	}
	return out;
}

/** 测试用：就地清空所有缓存（不换实例——路由闭包持有的是这些对象）。 */
export function resetRouteCachesForTests() {
	for (const cache of registry.values()) {
		cache.map.clear();
		cache.inflight.clear();
		cache.stale.clear();
		cache.hits = 0;
		cache.misses = 0;
		cache.stores = 0;
		cache.evictions = 0;
		cache.staleServes = 0;
		cache.lastAt = 0;
	}
}

//#endregion

//#region 核心

/**
 * 建一个带 TTL / 单飞 / 容量上限的缓存。
 *
 * @param {string} name 观测名（出现在 /metrics 里）
 * @param {{max?: number}} [opts] max 为条目上限，超出按 LRU 淘汰
 */
export function createCache(name, { max = 200 } = {}) {
	const cache = {
		name,
		max,
		map: new Map(), // key -> { val, at }
		inflight: new Map(), // key -> Promise
		stale: new Map(), // key -> { val, at }：上次成功值，供 stale-if-error
		hits: 0,
		misses: 0,
		stores: 0,
		evictions: 0,
		staleServes: 0,
		lastAt: 0,
	};
	registry.set(name, cache);
	return cache;
}

/** 命中即回迁，保证 Map 的插入顺序就是真正的 LRU 顺序。 */
function readFresh(cache, key, ttlMs) {
	const hit = cache.map.get(key);
	if (hit === void 0) return void 0;
	if (Date.now() - hit.at >= ttlMs) {
		cache.map.delete(key);
		return void 0;
	}
	cache.map.delete(key);
	cache.map.set(key, hit);
	cache.hits += 1;
	return hit.val;
}

function write(cache, key, val, staleIfError) {
	const at = Date.now();
	cache.map.delete(key);
	cache.map.set(key, { val, at });
	cache.stores += 1;
	if (staleIfError > 0) {
		cache.stale.delete(key);
		cache.stale.set(key, { val, at });
		if (cache.stale.size > cache.max) cache.stale.delete(cache.stale.keys().next().value);
	}
	if (cache.map.size > cache.max) {
		cache.map.delete(cache.map.keys().next().value);
		cache.evictions += 1;
	}
	cache.lastAt = at;
}

/**
 * 包一层缓存取数。
 *
 * @param {object} opts
 * @param {string} opts.name 缓存实例名（同名共享实例，便于按域分组统计）
 * @param {string} opts.key  缓存键；调用方负责把参数拼进 key
 * @param {number|(() => number)} opts.ttlMs 存活时间；传函数可做"盘中短、盘后长"
 * @param {() => Promise<any>} opts.load 未命中时的真实取数（抛错就往上抛）
 * @param {number} [opts.max] 条目上限（默认 200）
 * @param {number} [opts.staleIfError] 取数失败时，容忍多久前的旧值（毫秒）。
 *   0 / 不传 = 不降级，失败照旧抛（默认保持原有错误语义）。
 */
export async function cached({ name, key, ttlMs, load, max = 200, staleIfError = 0 }) {
	const cache = registry.get(name) ?? createCache(name, { max });
	const ttl = typeof ttlMs === "function" ? Number(ttlMs()) || 0 : Number(ttlMs) || 0;
	const fresh = readFresh(cache, key, ttl);
	if (fresh !== void 0) return fresh;

	// 单飞：同 key 的并发请求排队等第一个结果。注意这个 Promise 也带走了
	// 失败——上游挂掉时并发请求一起收到同一个错误，而不是各打一次上游。
	const pending = cache.inflight.get(key);
	if (pending !== void 0) return pending;

	const task = (async () => {
		try {
			const val = await load();
			write(cache, key, val, staleIfError);
			return val;
		} catch (error) {
			if (staleIfError > 0) {
				const prev = cache.stale.get(key);
				if (prev !== void 0 && Date.now() - prev.at < staleIfError) {
					cache.staleServes += 1;
					return prev.val;
				}
			}
			throw error;
		} finally {
			cache.inflight.delete(key);
		}
	})();

	cache.misses += 1;
	cache.inflight.set(key, task);
	return task;
}

//#endregion
