// 韭菜盒子 LeekBox — 客户端 bundle 源码：AI 个股分析页
// 由 build.mjs 打包进 lib/client.js（npm run build）；不要手改产物。
//
// 上半部分是模型配置（API 地址 / 密钥 / 模型名，存服务端，密钥只显示脱敏值），
// 下半部分是选股 + 分析：搜到个股后由服务端汇总行情/K线/财报并调模型生成结论。
import { h, useCallback, useEffect, useRef, useState } from "./react.js";
import { API, api, describeError, fmt, fmtPct, normCode, trend } from "./core.js";

/** 搜索去抖：用户停下 350ms 后才发请求，避免每敲一个键都打一次上游。 */
const SEARCH_DEBOUNCE_MS = 350;

export function AnalysisTab({ onOpen }) {
	// ---- 模型配置 ----
	const [baseUrl, setBaseUrl] = useState("");
	const [apiKey, setApiKey] = useState("");
	const [model, setModel] = useState("");
	const [maskedKey, setMaskedKey] = useState("");
	const [configured, setConfigured] = useState(false);
	const [saving, setSaving] = useState(false);
	const [cfgMsg, setCfgMsg] = useState("");

	// ---- 个股分析 ----
	const [kw, setKw] = useState("");
	const [hits, setHits] = useState([]);
	const [searching, setSearching] = useState(false);
	const [searchOpen, setSearchOpen] = useState(false);
	const [picked, setPicked] = useState(null); // { code, name, price, changePct }
	const [analyzing, setAnalyzing] = useState(false);
	const [analysis, setAnalysis] = useState("");
	const [anMeta, setAnMeta] = useState(null); // { name, model }
	const [error, setError] = useState("");

	const searchSeq = useRef(0);
	const boxRef = useRef(null);

	// 载入已存配置（密钥只回脱敏值）。
	useEffect(() => {
		api(API.analysisConfig)
			.then((d) => {
				setBaseUrl(d?.baseUrl ?? "");
				setModel(d?.model ?? "");
				setMaskedKey(d?.apiKey ?? "");
				setConfigured(d?.configured === true);
			})
			.catch(() => {});
	}, []);

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

	const save = useCallback(() => {
		const b = baseUrl.trim();
		const m = model.trim();
		if (b === "" || m === "") {
			setCfgMsg("API 地址与模型名不能为空");
			return;
		}
		setSaving(true);
		setCfgMsg("");
		api(API.analysisConfig, { method: "POST", body: { baseUrl: b, apiKey: apiKey.trim(), model: m } })
			.then((d) => {
				setMaskedKey(d?.apiKey ?? "");
				setConfigured(d?.configured === true);
				setApiKey("");
				setCfgMsg(d?.written === false ? "保存失败：配置未能写入，请重试" : "已保存");
			})
			.catch((e) => setCfgMsg(describeError(e)))
			.finally(() => setSaving(false));
	}, [baseUrl, apiKey, model]);

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

	return h(
		"div",
		null,
		// ---- 模型配置 ----
		h(
			"div",
			{ className: "lkb-anCard" },
			h("div", { className: "lkb-anTitle" }, "🔌 模型配置"),
			h(
				"div",
				{ className: "lkb-status", style: { marginBottom: 8 } },
				configured
					? h("span", null, `已配置 · ${baseUrl} · ${model}${maskedKey !== "" ? " · 密钥 " + maskedKey : ""}`)
					: h("span", null, "尚未配置模型，请填写 OpenAI 兼容接口的地址与模型名")
			),
			h(
				"div",
				{ className: "lkb-anFieldRow" },
				h(
					"div",
					{ className: "lkb-anField" },
					h("div", { className: "lkb-anLabel" }, "API 地址（OpenAI 兼容，如 https://api.openai.com/v1）"),
					h("input", {
						className: "lkb-input",
						value: baseUrl,
						onInput: (e) => setBaseUrl(e.target.value),
						placeholder: "https://api.openai.com/v1",
						spellcheck: "false",
					})
				),
				h(
					"div",
					{ className: "lkb-anField" },
					h("div", { className: "lkb-anLabel" }, "模型名（如 gpt-4o-mini / deepseek-chat）"),
					h("input", {
						className: "lkb-input",
						value: model,
						onInput: (e) => setModel(e.target.value),
						placeholder: "gpt-4o-mini",
						spellcheck: "false",
					})
				),
				h(
					"div",
					{ className: "lkb-anField" },
					h("div", { className: "lkb-anLabel" }, "API 密钥（留空则不修改已存密钥）"),
					h("input", {
						className: "lkb-input",
						type: "password",
						value: apiKey,
						onInput: (e) => setApiKey(e.target.value),
						placeholder: maskedKey !== "" ? "已设置（留空保持不变）" : "sk-…",
						autocomplete: "off",
					})
				)
			),
			h(
				"div",
				{ className: "lkb-scActions", style: { marginTop: 4 } },
				h("button", { className: "lkb-btn", onClick: save, disabled: saving }, saving ? "保存中…" : "保存配置"),
				cfgMsg === "" ? null : h("span", { className: "lkb-status", style: { marginLeft: 10 } }, cfgMsg)
			)
		),
		// ---- 个股分析 ----
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
					h("button", { className: "lkb-btn", onClick: run, disabled: analyzing || !configured }, analyzing ? "分析中…" : "开始分析")
				),
			!configured && picked !== null ? h("div", { className: "lkb-status", style: { marginTop: 6 } }, "请先在上方保存模型配置") : null,
			error === "" ? null : h("div", { className: "lkb-error", style: { marginTop: 10 } }, error),
			analysis === ""
				? null
				: h(
					"div",
					null,
					h(
						"div",
						{ className: "lkb-status", style: { marginTop: 10 } },
						h("span", null, `个股分析 · ${anMeta?.name ?? picked.name}${anMeta?.model ? " · " + anMeta.model : ""}`)
					),
					h("div", { className: "lkb-anResult" }, analysis)
				)
		)
	);
}
