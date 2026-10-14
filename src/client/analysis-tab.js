// 韭菜盒子 LeekBox — 客户端 bundle 源码：AI 个股分析页
// 由 build.mjs 打包进 lib/client.js（npm run build）；不要手改产物。
//
// 模型配置已拆到「全局设置」（面板头部 ⚙️ → settings.js，走 core.js 的全局单例），
// 本页只负责选股 + 调服务端分析。未配置时把「开始分析」换成「去配置模型」入口。
import { h, useCallback, useEffect, useRef, useState } from "./react.js";
import { API, api, describeError, fmt, fmtPct, lkbConfirm, normCode, trend } from "./core.js";

/** 搜索去抖：用户停下 350ms 后才发请求，避免每敲一个键都打一次上游。 */
const SEARCH_DEBOUNCE_MS = 350;

/** 单只股票分析结果的本地缓存键前缀（localStorage，纯前端、不占服务端配置）。 */
const CACHE_PREFIX = "leekbox-analysis:";
/** 缓存条数上限：超出按写入时间淘汰最旧的一条，避免 localStorage 无限膨胀。 */
const CACHE_MAX = 20;
/** 缓存有效期：30 天。超过后仍会回显，但标记为「已过期」提示用户重新生成。 */
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 本地分析缓存。value: { turns, name, model, at, price, changePct, data, klineWindow }。
 * turns 是完整对话轮次数组（首轮分析 + 追问），这样重进页面能恢复整个会话。
 * localStorage 在隐私模式/配额满时会抛异常，全部读写都吞掉错误——
 * 缓存是纯优化，任何失败都不该影响分析主流程。
 */
function readCache(code) {
	try {
		const raw = window.localStorage.getItem(CACHE_PREFIX + code);
		if (raw === null) return null;
		const v = JSON.parse(raw);
		if (!v) return null;
		// 只接受结构合法的 turns；旧版本存的是 text 字符串，读不出来就当没缓存
		// （不做迁移：一份过期的单轮分析没有保留价值）。
		const turns = Array.isArray(v.turns)
			? v.turns
				.filter((t) => t && typeof t.text === "string" && t.text !== "")
				.map((t) => ({ role: t.role === "user" ? "user" : "assistant", text: t.text }))
			: [];
		if (turns.length === 0) return null;
		return {
			turns,
			name: typeof v.name === "string" ? v.name : code,
			model: typeof v.model === "string" ? v.model : "",
			at: Number.isFinite(v.at) ? v.at : 0,
			price: Number.isFinite(v.price) ? v.price : null,
			changePct: Number.isFinite(v.changePct) ? v.changePct : null,
			data: v.data !== null && typeof v.data === "object" ? v.data : null,
			klineWindow: Number.isFinite(v.klineWindow) ? v.klineWindow : null,
		};
	} catch {
		return null;
	}
}

function writeCache(code, value) {
	try {
		window.localStorage.setItem(CACHE_PREFIX + code, JSON.stringify(value));
		pruneCache(code);
	} catch {
		/* 配额满 / 隐私模式：放弃缓存，不影响分析 */
	}
}

/** 淘汰：先删过期条目，仍超出上限则按 at 升序删最旧的，直到降到 CACHE_MAX。 */
function pruneCache(keepCode) {
	const entries = [];
	for (let i = 0; i < window.localStorage.length; i++) {
		const k = window.localStorage.key(i);
		if (k === null || !k.startsWith(CACHE_PREFIX)) continue;
		let at = 0;
		try {
			at = Number(JSON.parse(window.localStorage.getItem(k) ?? "{}")?.at) || 0;
		} catch {
			at = 0;
		}
		entries.push({ key: k, code: k.slice(CACHE_PREFIX.length), at });
	}
	const now = Date.now();
	for (const e of entries) {
		if (e.code !== keepCode && now - e.at > CACHE_TTL_MS) {
			try {
				window.localStorage.removeItem(e.key);
			} catch {}
		}
	}
	const live = entries.filter((e) => e.code === keepCode || now - e.at <= CACHE_TTL_MS);
	if (live.length <= CACHE_MAX) return;
	live
		.filter((e) => e.code !== keepCode)
		.sort((a, b) => a.at - b.at)
		.slice(0, live.length - CACHE_MAX)
		.forEach((e) => {
			try {
				window.localStorage.removeItem(e.key);
			} catch {}
		});
}

/** 「X 分钟前 / X 小时前 / X 天前」；用于结果栏展示缓存时间。 */
function agoText(at) {
	if (!Number.isFinite(at) || at <= 0) return "";
	const d = Date.now() - at;
	if (d < 60_000) return "刚刚";
	if (d < 3_600_000) return `${Math.floor(d / 60_000)} 分钟前`;
	if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} 小时前`;
	return `${Math.floor(d / 86_400_000)} 天前`;
}

/** 本地时间戳「2025-01-15 14:30」，用于复制出去的文本头。 */
function stampText(at) {
	const d = new Date(Number.isFinite(at) && at > 0 ? at : Date.now());
	const p = (n) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** K 线窗口选项：日线根数。60 约 3 个月、120 约半年、250 约一年。 */
const KLINE_WINDOWS = [
	{ key: 60, label: "3 月" },
	{ key: 120, label: "半年" },
	{ key: 250, label: "1 年" },
];

/** 追问输入的最大长度（与服务端 FOLLOWUP_QUESTION_MAX 对齐）。 */
const QUESTION_MAX = 1000;

export function AnalysisTab({ onOpen, configured, onOpenSettings }) {
	const [kw, setKw] = useState("");
	const [hits, setHits] = useState([]);
	const [searching, setSearching] = useState(false);
	const [searchOpen, setSearchOpen] = useState(false);
	const [picked, setPicked] = useState(null); // { code, name, price, changePct }
	const [analyzing, setAnalyzing] = useState(false);
	// 对话轮次：{ role: "assistant"|"user", text }。首轮分析是第 0 条 assistant，
	// 之后 user/assistant 交替。用数组而不是单个字符串，是因为追问要保留
	// 完整上下文 —— 也要回传给服务端组 messages。
	const [turns, setTurns] = useState([]);
	const [anMeta, setAnMeta] = useState(null); // { name, model, at, cached, data, klineWindow }
	const [stage, setStage] = useState(""); // 取数/生成阶段的提示文案
	const [error, setError] = useState("");
	const [copied, setCopied] = useState(false);
	const [klineWindow, setKlineWindow] = useState(60);
	const [draft, setDraft] = useState(""); // 追问输入框内容

	const searchSeq = useRef(0);
	const boxRef = useRef(null);
	// 当前在跑的流式请求；重新生成/卸载时 abort 掉，避免两个流同时往
	// analysis 里追加导致文本交错（也省掉一次没用的上游 LLM 计费）。
	const aborterRef = useRef(null);
	// 同步重入锁：must 在 await（lkbConfirm）之前置位，analyzing 状态来不及。
	const runningRef = useRef(false);
	// 运行代次：stop() 会 ++，让被中止那一轮的 finally 认领不到锁，
	// 避免它把「停止后用户立刻开的新一轮」的锁误清掉。
	const runSeqRef = useRef(0);
	// 用户主动中止（切走 Tab / 点停止）不算错误，不该弹红字。
	const abortedRef = useRef(false);
	// 追问输入框的 DOM 引用：追问完成后重新聚焦，方便连续追问。
	const askRef = useRef(null);
	// 对话轮次的镜像。streamInto 是 useCallback([], ...)，闭包里的 turns
	// 永远是首次渲染的空数组 —— 组历史 messages 必须读这个 ref 才是最新值。
	const turnsRef = useRef([]);
	turnsRef.current = turns;


	// 点搜索框外收起下拉。
	useEffect(() => {
		const onDoc = (e) => {
			if (boxRef.current !== null && !boxRef.current.contains(e.target)) setSearchOpen(false);
		};
		document.addEventListener("pointerdown", onDoc);
		return () => document.removeEventListener("pointerdown", onDoc);
	}, []);

	// 组件卸载（切走 Tab / 关面板）时中止在跑的流，防止往已卸载的
	// 组件里 setState，也避免后台白跑完一次 LLM 请求。
	useEffect(
		() => () => {
			abortedRef.current = true;
			// 顶掉代次：晚到的 delta / finally 都认不出自己，不再碰状态。
			runSeqRef.current++;
			if (aborterRef.current !== null) {
				try {
					aborterRef.current.abort();
				} catch {}
				aborterRef.current = null;
			}
		},
		[]
	);

	// 搜索去抖。
	useEffect(() => {
		const q = kw.trim();
		if (q === "") {
			setHits([]);
			setSearching(false);
			setSearchOpen(false);
			return;
		}
		const seq = ++searchSeq.current;
		setSearching(true);
		const timer = setTimeout(() => {
			api(API.search + `?kw=${encodeURIComponent(q)}&count=8`)
				.then((d) => {
					if (seq !== searchSeq.current) return;
					setHits((d?.hits ?? []).filter((s) => /^(sh|sz|bj)\d{6}$/.test(normCode(s.code))));
					setSearchOpen(true);
				})
				.catch(() => {
					if (seq !== searchSeq.current) return;
					setHits([]);
				})
				.finally(() => {
					if (seq === searchSeq.current) setSearching(false);
				});
		}, SEARCH_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [kw]);

	const pick = (s) => {
		const code = normCode(s.code);
		setPicked({ code, name: s.name, price: s.price, changePct: s.changePct });
		setKw(`${s.name} ${s.code}`);
		setSearchOpen(false);
		setError("");
		setDraft("");
		// 命中本地缓存就直接回显，不用等用户再点一次「开始分析」。
		const cached = readCache(code);
		if (cached !== null) {
			setTurns(cached.turns);
			setAnMeta({
				name: cached.name,
				model: cached.model,
				at: cached.at,
				cached: true,
				data: cached.data,
				klineWindow: cached.klineWindow,
			});
			// 缓存里带了当时用的 K 线窗口就恢复它，避免"看到的是半年线数据、
			// 选择器却显示 3 月"这种不一致。
			if (KLINE_WINDOWS.some((w) => w.key === cached.klineWindow)) setKlineWindow(cached.klineWindow);
		} else {
			setTurns([]);
			setAnMeta(null);
		}
	};

	/**
	 * 真正跑流。seq 是本轮代次。
	 *
	 * 两种模式：
	 *  - 首轮（question 为空）：清空重新开始，delta 追加进第 0 条 assistant；
	 *  - 追问（question 非空）：先把 user 问句 + 空的 assistant 占位压进
	 *    turns，delta 追加进最后那条 —— 这样流式输出直接就长在对话里。
	 * turns 要一并回传给服务端组 messages（追问需要完整上下文）。
	 */
	const streamInto = useCallback(async (aborter, target, seq, question = "") => {
		/** 本轮是否已被 stop / 新的一轮顶掉；是则不再碰任何状态。 */
		const stale = () => seq !== void 0 && seq !== runSeqRef.current;
		const isFollowup = question !== "";
		setAnalyzing(true);
		setError("");
		setStage("");
		// 追问时保留已有对话，只在其后追加；首轮则清空重来。
		setTurns((prev) => (isFollowup ? [...prev, { role: "user", text: question }, { role: "assistant", text: "" }] : [{ role: "assistant", text: "" }]));
		if (!isFollowup) setAnMeta(null);
		// 流式累积用一个局部变量，最后一次性写缓存；不要依赖 setState 的
		// 异步值，否则缓存里可能存到半截文本。
		let acc = "";
		let meta = null;
		let sawDelta = false;
		// 追加到最后一条 assistant 上。用函数式更新拿 prev，避免闭包读到旧数组。
		const appendDelta = (text) => {
			setTurns((prev) => {
				if (prev.length === 0) return prev;
				const next = prev.slice();
				const lastIdx = next.length - 1;
				const last = next[lastIdx];
				if (last.role !== "assistant") return prev;
				next[lastIdx] = { role: "assistant", text: last.text + text };
				return next;
			});
		};
		try {
			// 追问要带上历史：把已有 turns 转成服务端认识的 {role, content}。
			// 读 turnsRef 而不是闭包里的 turns —— 后者在 useCallback([], ...)
			// 下永远是空数组，会让服务端拿到 0 条历史（模型就"失忆"了）。
			const history = isFollowup
				? turnsRef.current
					.filter((t) => t.text !== "")
					.map((t) => ({ role: t.role, content: t.text }))
				: [];
			const payload = { code: target.code, name: target.name, klineWindow };
			if (isFollowup) {
				payload.question = question;
				payload.turns = history;
			}
			const response = await fetch(API.analysisStream, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(payload),
				signal: aborter.signal,
			});
			if (!response.ok || response.body === null) {
				// 非流式错误（400/502 等）：读 JSON error 字段。
				let msg = `服务返回异常（HTTP ${response.status}）`;
				try {
					const j = await response.json();
					if (typeof j?.error === "string") msg = j.error;
				} catch {}
				throw new Error(msg);
			}
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buf = "";
			let eventName = "";
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buf += decoder.decode(value, { stream: true });
				let idx;
				while ((idx = buf.indexOf("\n")) >= 0) {
					const line = buf.slice(0, idx);
					buf = buf.slice(idx + 1);
					const t = line.endsWith("\r") ? line.slice(0, -1) : line;
					if (t === "") {
						eventName = "";
						continue;
					}
					if (t.startsWith("event:")) {
						eventName = t.slice(6).trim();
						continue;
					}
					if (t.startsWith("data:")) {
						const payloadJson = t.slice(5).trim();
						let json = null;
						try {
							json = JSON.parse(payloadJson);
						} catch {}
						if (json === null) continue;
						if (eventName === "stage") {
							// 服务端先报阶段：取数要打多个上游，这段等待需要有反馈。
							if (json.stage === "data" && !stale()) setStage("正在获取行情与资金数据…");
						} else if (eventName === "meta") {
							meta = { name: json.name, model: json.model };
							if (!stale()) {
								setStage("");
								setAnMeta((prev) => ({
									name: json.name,
									model: json.model,
									at: Date.now(),
									cached: false,
									data: json.data !== null && typeof json.data === "object" ? json.data : null,
									klineWindow: Number.isFinite(json.klineWindow) ? json.klineWindow : klineWindow,
								}));
							}
						} else if (eventName === "delta") {
							const text = typeof json.text === "string" ? json.text : "";
							if (text === "") continue;
							// 被顶掉的那一轮绝不能再往对话里追加，否则
							// 新旧两段文本会交错（这正是本次改造要修的 bug）。
							if (stale()) continue;
							if (!sawDelta) {
								sawDelta = true;
								setStage("");
							}
							acc += text;
							appendDelta(text);
						} else if (eventName === "error") throw new Error(typeof json.error === "string" ? json.error : "分析失败，请稍后重试");
						// done 事件无需处理
					}
				}
			}
			// 成功收尾：落缓存（只在确实拿到正文时写，避免把空结果缓存住）。
			if (acc !== "" && !stale()) {
				const at = Date.now();
				// 缓存里存**完整对话**：追问属于这次分析上下文的一部分，
				// 只存首轮会让用户回来看到半截会话。同样读 ref 取最新值。
				const finalTurns = isFollowup
					? [...turnsRef.current.filter((t) => t.text !== ""), { role: "user", text: question }, { role: "assistant", text: acc }]
					: [{ role: "assistant", text: acc }];
				writeCache(target.code, {
					turns: finalTurns,
					name: meta?.name ?? target.name,
					model: meta?.model ?? "",
					at,
					price: Number.isFinite(target.price) ? target.price : null,
					changePct: Number.isFinite(target.changePct) ? target.changePct : null,
					data: meta?.data ?? null,
					klineWindow,
				});
				setStage("");
				setAnMeta((prev) => ({
					name: meta?.name ?? target.name,
					model: meta?.model ?? "",
					at,
					cached: false,
					data: prev?.data ?? null,
					klineWindow: prev?.klineWindow ?? klineWindow,
				}));
			}
		} catch (e) {
			// 主动 abort（切走 / 重新生成 / 卸载）不是错误，静默退出。
			if (abortedRef.current || stale() || e?.name === "AbortError") {
				// 追问失败时把刚压进去的空 assistant 占位收掉，避免留一个空气泡。
				if (isFollowup && !stale()) setTurns((prev) => (prev.length > 0 && prev[prev.length - 1].role === "assistant" && prev[prev.length - 1].text === "" ? prev.slice(0, -1) : prev));
				return;
			}
			setError(describeError(e));
			if (isFollowup) setTurns((prev) => (prev.length > 0 && prev[prev.length - 1].role === "assistant" && prev[prev.length - 1].text === "" ? prev.slice(0, -1) : prev));
		} finally {
			if (aborterRef.current === aborter) aborterRef.current = null;
			if (!abortedRef.current && !stale()) setAnalyzing(false);
		}
	}, []);

	/**
	 * 发起一次分析。两件事在 await 之前就要做完，否则会重入：
	 * run 是 async 的，lkbConfirm 又是 await —— 弹窗期间 analyzing 仍是
	 * false，而「开始分析」和结果栏的「重新生成」是两个入口，用户连点两下
	 * 就会排进两个 run 双双越过门控。runningRef 同步置位把重入挡死。
	 */
	const run = useCallback(async () => {
		if (picked === null || analyzing || runningRef.current) return;
		runningRef.current = true;
		// 认领本轮代次：若中途被 stop() 顶掉，finally 不该再动锁和新一轮的状态。
		const seq = ++runSeqRef.current;
		try {
			// 有旧结果时二次确认，避免误触把当前内容冲掉。
			if (turns.length > 0 && !(await lkbConfirm("重新生成会清空当前分析与追问记录，确定继续？"))) return;
			// 上一轮的流若还活着（异常路径 / 用户没等 finally），先掐掉再开新的。
			if (aborterRef.current !== null) {
				try {
					aborterRef.current.abort();
				} catch {}
			}
			abortedRef.current = false;
			const aborter = new AbortController();
			aborterRef.current = aborter;
			await streamInto(aborter, picked, seq, "");
		} catch (e) {
			// streamInto 已把可预期错误转成 error 状态；这里只兜底未知异常，
			// 避免 run 的 promise 悬着导致 runningRef 卡在 true（按钮点不动）。
			if (seq === runSeqRef.current) setError(describeError(e));
		} finally {
			// 只有仍是本轮时才放锁：被 stop() 顶掉后，锁已经由 stop 放过了。
			if (seq === runSeqRef.current) runningRef.current = false;
		}
	}, [picked, analyzing, turns, streamInto]);

	/**
	 * 追问。与 run 共用同一套锁与代次：追问和重新生成都会开流，
	 * 两者不能并发（否则两条流会交错写进对话）。
	 */
	const ask = useCallback(async () => {
		const q = draft.trim();
		if (q === "" || picked === null || analyzing || runningRef.current) return;
		runningRef.current = true;
		const seq = ++runSeqRef.current;
		try {
			if (aborterRef.current !== null) {
				try {
					aborterRef.current.abort();
				} catch {}
			}
			abortedRef.current = false;
			const aborter = new AbortController();
			aborterRef.current = aborter;
			setDraft("");
			await streamInto(aborter, picked, seq, q);
		} catch (e) {
			if (seq === runSeqRef.current) setError(describeError(e));
		} finally {
			if (seq === runSeqRef.current) runningRef.current = false;
			// 追问完成后把焦点还给输入框，方便连续追问。
			if (!abortedRef.current && askRef.current !== null) {
				try {
					askRef.current.focus();
				} catch {}
			}
		}
	}, [draft, picked, analyzing, streamInto]);

	/** 用户主动停止生成。 */
	const stop = useCallback(() => {
		abortedRef.current = true;
		// 让旧的 run 在 finally 里认领不到锁（见 run 里的 runSeq 检查）。
		runSeqRef.current++;
		if (aborterRef.current !== null) {
			try {
				aborterRef.current.abort();
			} catch {}
			aborterRef.current = null;
		}
		// 同步放锁：abort 后 reader.read() 的 unwinding 是异步的，不等它——
		// 否则用户点「停止」后要等旧流真正退出才能再点「开始分析」，按钮像卡死。
		runningRef.current = false;
		setAnalyzing(false);
	}, []);

	// 复制分析文本；clipboard API 在 localhost 下可用，非安全上下文回退到 execCommand。
	// 复制出去的是「带上下文的完整快照」：粘贴给别人时能看清是谁、什么价位、
	// 哪个模型、什么时候生成的——这些信息在只复制正文时会全部丢失。
	// 有追问时把整个对话都带上，并按「问 / 答」标注角色。
	const copy = useCallback(() => {
		const body = turns.filter((t) => t.text !== "");
		if (body.length === 0) return;
		const head = [`【${anMeta?.name ?? picked?.name ?? ""} ${picked?.code ?? ""}】`.trim()];
		const line = [];
		if (Number.isFinite(picked?.price)) line.push(`现价 ${fmt(picked.price)}`);
		if (Number.isFinite(picked?.changePct)) line.push(fmtPct(picked.changePct));
		if (line.length > 0) head.push(line.join(" "));
		const tail = [];
		if (anMeta?.model) tail.push(`模型 ${anMeta.model}`);
		if (anMeta?.at) tail.push(stampText(anMeta.at));
		if (tail.length > 0) head.push(tail.join(" · "));
		// 首轮 assistant 不加前缀（它就是"分析正文"）；追问轮开始标注角色。
		const rendered =
			body.length === 1 && body[0].role === "assistant"
				? body[0].text
				: body.map((t) => (t.role === "user" ? `【追问】${t.text}` : `【回答】\n${t.text}`)).join("\n\n");
		const payload = `${head.join("\n")}\n\n${rendered}`;
		const done = () => {
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		};
		const fallback = () => {
			const ta = document.createElement("textarea");
			ta.value = payload;
			ta.style.position = "fixed";
			ta.style.opacity = "0";
			document.body.appendChild(ta);
			ta.select();
			try {
				document.execCommand("copy");
				done();
			} catch {}
			document.body.removeChild(ta);
		};
		if (navigator.clipboard && window.isSecureContext) {
			navigator.clipboard.writeText(payload).then(done).catch(fallback);
		} else {
			fallback();
		}
	}, [turns, anMeta, picked]);

	return h(
		"div",
		null,
		h(
			"div",
			{ className: "lkb-anCard" },
			h("div", { className: "lkb-anTitle" }, "🤖 个股分析"),
			h(
				"div",
				{ className: "lkb-anField", ref: boxRef },
				h("div", { className: "lkb-anLabel" }, "输入代码 / 名称 / 拼音首字母搜索个股"),
				h("input", {
					className: "lkb-input",
					value: kw,
					onInput: (e) => setKw(e.target.value),
					onFocus: () => hits.length > 0 && setSearchOpen(true),
					placeholder: "如 600519 / 贵州茅台 / gzmt",
					spellcheck: "false",
				}),
				searching ? h("div", { className: "lkb-status", style: { marginTop: 6 } }, "搜索中…") : null,
				searchOpen && hits.length > 0
					? h(
						"div",
						{ className: "lkb-anResults" },
						hits.map((s) =>
							h(
								"div",
								{ key: s.code, className: "lkb-anHit", onClick: () => pick(s) },
								h("span", { className: "lkb-name", style: { flex: 1 } }, s.name),
								h("span", { className: "lkb-code" }, s.code),
								h("span", { className: "lkb-anPct " + trend(s.changePct) }, s.price === null || s.price === void 0 ? "—" : fmt(s.price)),
								h("span", { className: "lkb-anPct " + trend(s.changePct) }, s.changePct === null || s.changePct === void 0 ? "—" : fmtPct(s.changePct))
							)
						)
					)
					: null
			),
			picked === null
				? h("div", { className: "lkb-empty" }, "先在搜索框里选一只股票，再点「开始分析」")
				: h(
					"div",
					{ className: "lkb-anPicked" },
					h("span", { className: "lkb-name" }, picked.name),
					h("span", { className: "lkb-code" }, picked.code),
					picked.price !== null && picked.price !== void 0
						? h("span", { className: "lkb-anPct " + trend(picked.changePct) }, fmt(picked.price))
						: null,
					picked.changePct !== null && picked.changePct !== void 0
						? h("span", { className: "lkb-anPct " + trend(picked.changePct) }, fmtPct(picked.changePct))
						: null,
					h("span", { style: { flex: 1 } }),
					h("button", { className: "lkb-btnGhost", onClick: () => onOpen(picked.code, picked.name) }, "打开详情"),
					configured
						? h(
							"button",
							{ className: "lkb-btn", onClick: analyzing ? stop : run, disabled: false },
							analyzing ? "停止生成" : turns.length === 0 ? "开始分析" : "重新生成"
						)
						: h("button", { className: "lkb-btn", onClick: onOpenSettings }, "去配置模型")
				),
			// K 线窗口：影响喂给模型的日线根数（进而影响 MA60/MA120 与区间分位
			// 能否算出）。放在分析按钮下方，改完下次生成生效。
			picked === null
				? null
				: h(
					"div",
					{ className: "lkb-anWindowRow" },
					h("span", { className: "lkb-anLabel" }, "分析所用 K 线窗口"),
					h(
						"div",
						{ className: "lkb-seg", role: "radiogroup", "aria-label": "K 线窗口" },
						KLINE_WINDOWS.map((w) =>
							h(
								"button",
								{
									key: w.key,
									type: "button",
									className: "lkb-segBtn",
									"data-active": klineWindow === w.key ? "true" : "false",
									// 已有结果时切换不会立即重算，明确告知用户需要重新生成，
									// 避免"我改了但结论没变"的困惑。
									title: turns.length > 0 ? `切换后需点「重新生成」才会生效` : `使用近 ${w.key} 个交易日日线`,
									onClick: () => setKlineWindow(w.key),
								},
								w.label
							)
						)
					),
					turns.length > 0 && anMeta?.klineWindow !== null && anMeta?.klineWindow !== void 0 && anMeta.klineWindow !== klineWindow
						? h("span", { className: "lkb-anWindowHint" }, "当前结果基于 " + (KLINE_WINDOWS.find((w) => w.key === anMeta.klineWindow)?.label ?? anMeta.klineWindow) + "，需重新生成")
						: null
				),
			error === "" ? null : h("div", { className: "lkb-error", style: { marginTop: 10 } }, error),
			// 取数阶段反馈：服务端要打多个上游，这段时间没有任何输出，
			// 不给提示的话界面看起来像卡住了。
			analyzing && stage !== "" && turns.length === 0
				? h("div", { className: "lkb-anStage" }, h("span", { className: "lkb-spinner" }), h("span", null, stage))
				: null,
			turns.length === 0
				? null
				: h(
					"div",
					null,
					// 对话区：首轮是分析正文，之后 user/assistant 交替。
					h(
						"div",
						{ className: "lkb-anThread" },
						turns.map((t, i) =>
							t.role === "user"
								? h("div", { key: i, className: "lkb-anAsk" }, t.text)
								: h("div", { key: i, className: "lkb-anReply" }, t.text)
						)
					),
					h(
						"div",
						{ className: "lkb-anResultBar" },
						h(
							"span",
							{ className: "lkb-status", style: { flex: 1 } },
							`个股分析 · ${anMeta?.name ?? picked.name}${anMeta?.model ? " · " + anMeta.model : ""}`
						),
						anMeta?.at
							? h(
								"span",
								{ className: "lkb-anAgo", title: stampText(anMeta.at) },
								`${anMeta.cached ? "缓存" : "生成于"} ${agoText(anMeta.at)}`
							)
							: null,
						h("button", { className: "lkb-btnGhost", onClick: copy }, copied ? "已复制" : "复制"),
						analyzing
							? h("button", { className: "lkb-btnGhost", onClick: stop }, "停止")
							: h("button", { className: "lkb-btnGhost", onClick: run, disabled: !configured }, "重新生成")
					),
					// 数据齐备情况：让用户知道这次分析"看到了什么"，
					// 缺哪一项就知道哪部分结论不可靠。
					dataBadges(anMeta?.data)
				),
			// 追问输入：只有已有分析、且已配置模型时才显示。
			turns.length === 0 || !configured
				? null
				: h(
					"div",
					{ className: "lkb-anAskRow" },
					h("input", {
						ref: askRef,
						className: "lkb-input",
						value: draft,
						maxLength: QUESTION_MAX,
						onInput: (e) => setDraft(e.target.value),
						// Enter 直接发送（中文输入法组合中的 Enter 不触发，
						// 否则拼音选词会被误当成提交）。
						onKeyDown: (e) => {
							if (e.key !== "Enter") return;
							if (e.nativeEvent?.isComposing === true || e.isComposing === true) return;
							e.preventDefault();
							ask();
						},
						placeholder: analyzing ? "生成中，可先点「停止」再追问…" : "追问，例如：它的负债率在行业里算高吗？",
						spellcheck: "false",
						disabled: analyzing,
					}),
					h(
						"button",
						{ className: "lkb-btn", onClick: analyzing ? stop : ask, disabled: !analyzing && draft.trim() === "" },
						analyzing ? "停止" : "追问"
					)
				)
		)
	);
}

/** 数据齐备徽章：有数据 = 亮色，缺数据 = 灰且带删除线语义（这里用 title 说明）。 */
const DATA_LABELS = [
	["quote", "行情"],
	["kline", "K线"],
	["f10", "财报"],
	["fflow", "资金流"],
	["news", "新闻"],
	["sectors", "板块"],
];

function dataBadges(flags) {
	if (flags === null || flags === void 0) return null;
	const known = DATA_LABELS.filter(([k]) => typeof flags[k] === "boolean");
	if (known.length === 0) return null;
	const missing = known.filter(([k]) => flags[k] !== true).map(([, label]) => label);
	return h(
		"div",
		{ className: "lkb-anData" },
		known.map(([k, label]) =>
			h(
				"span",
				{
					key: k,
					className: "lkb-anDataItem",
					"data-on": flags[k] === true ? "true" : "false",
					title: flags[k] === true ? `${label}：已用于本次分析` : `${label}：本次未取到，相关结论可能不完整`,
				},
				label
			)
		),
		missing.length > 0 ? h("span", { className: "lkb-anDataNote" }, `缺 ${missing.join(" / ")}`) : null
	);
}
