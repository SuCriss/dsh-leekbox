// 韭菜盒子 LeekBox — 客户端 bundle 源码：AI 个股分析页
// 由 build.mjs 打包进 lib/client.js（npm run build）；不要手改产物。
//
// 模型配置已拆到「全局设置」（面板头部 ⚙️ → settings.js，走 core.js 的全局单例），
// 本页只负责选股 + 调服务端分析。未配置时把「开始分析」换成「去配置模型」入口。
import { h, useCallback, useEffect, useRef, useState } from "./react.js";
import { API, api, describeError, fmt, fmtPct, normCode, trend } from "./core.js";

/** 搜索去抖：用户停下 350ms 后才发请求，避免每敲一个键都打一次上游。 */
const SEARCH_DEBOUNCE_MS = 350;

export function AnalysisTab({ onOpen, configured, onOpenSettings }) {
	const [kw, setKw] = useState("");
	const [hits, setHits] = useState([]);
	const [searching, setSearching] = useState(false);
	const [searchOpen, setSearchOpen] = useState(false);
	const [picked, setPicked] = useState(null); // { code, name, price, changePct }
	const [analyzing, setAnalyzing] = useState(false);
	const [analysis, setAnalysis] = useState("");
	const [anMeta, setAnMeta] = useState(null); // { name, model }
	const [error, setError] = useState("");
	const [copied, setCopied] = useState(false);

	const searchSeq = useRef(0);
	const boxRef = useRef(null);

	// 点搜索框外收起下拉。
	useEffect(() => {
		const onDoc = (e) => {
			if (boxRef.current !== null && !boxRef.current.contains(e.target)) setSearchOpen(false);
		};
		document.addEventListener("pointerdown", onDoc);
		return () => document.removeEventListener("pointerdown", onDoc);
	}, []);

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
		setPicked({ code: normCode(s.code), name: s.name, price: s.price, changePct: s.changePct });
		setKw(`${s.name} ${s.code}`);
		setSearchOpen(false);
		setAnalysis("");
		setAnMeta(null);
		setError("");
	};

	const run = useCallback(() => {
		if (picked === null || analyzing) return;
		setAnalyzing(true);
		setError("");
		setAnalysis("");
		api(API.analysis, { method: "POST", body: { code: picked.code, name: picked.name } })
			.then((d) => {
				setAnalysis(d?.analysis ?? "");
				setAnMeta({ name: d?.name ?? picked.name, model: d?.model ?? "" });
			})
			.catch((e) => setError(describeError(e)))
			.finally(() => setAnalyzing(false));
	}, [picked, analyzing]);

	// 复制分析文本；clipboard API 在 localhost 下可用，非安全上下文回退到 execCommand。
	const copy = useCallback(() => {
		if (analysis === "") return;
		const done = () => {
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		};
		const fallback = () => {
			const ta = document.createElement("textarea");
			ta.value = analysis;
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
			navigator.clipboard.writeText(analysis).then(done).catch(fallback);
		} else {
			fallback();
		}
	}, [analysis]);

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
						? h("button", { className: "lkb-btn", onClick: run, disabled: analyzing }, analyzing ? "分析中…" : "开始分析")
						: h("button", { className: "lkb-btn", onClick: onOpenSettings }, "去配置模型")
				),
			error === "" ? null : h("div", { className: "lkb-error", style: { marginTop: 10 } }, error),
			analysis === ""
				? null
				: h(
					"div",
					null,
					h(
						"div",
						{ className: "lkb-anResultBar", style: { marginTop: 10 } },
						h("span", { className: "lkb-status", style: { flex: 1 } }, `个股分析 · ${anMeta?.name ?? picked.name}${anMeta?.model ? " · " + anMeta.model : ""}`),
						h("button", { className: "lkb-btnGhost", onClick: copy }, copied ? "已复制" : "复制"),
						h("button", { className: "lkb-btnGhost", onClick: run, disabled: analyzing || !configured }, analyzing ? "分析中…" : "重新生成")
					),
					h("div", { className: "lkb-anResult" }, analysis)
				)
		)
	);
}
