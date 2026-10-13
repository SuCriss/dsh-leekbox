// 韭菜盒子 LeekBox — 客户端 bundle 源码：全局设置弹窗（AI 模型配置）
// 由 build.mjs 打包进 lib/client.js（npm run build）；不要手改产物。
//
// 面板头部 ⚙️ 打开。配置读/写走 core.js 的全局单例（saveAnalysisConfig /
// getAnalysisConfig），密钥只在服务端落盘，界面只显示脱敏值。
//
// 模型体系对齐 DSH 客户端的多 provider 模型：`api: openai-completions` 是主流
// 协议，覆盖 OpenAI / DeepSeek / Moonshot / 智谱 / 通义 / b.ai 等一大片厂商，
// 不是只能 OpenAI 一家。这里用「服务商下拉 + 模型下拉（可手填）+ 获取模型」。
import { h, useEffect, useState } from "./react.js";
import { API, api, describeError, getAnalysisConfig, saveAnalysisConfig } from "./core.js";

/** 预设服务商（都是 OpenAI 兼容的 /chat/completions 协议）。models 是离线兜底，
 *  点「获取模型」会用服务端 GET /models 拉真实列表覆盖。 */
const PROVIDERS = [
	{ key: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", models: ["deepseek-chat", "deepseek-reasoner"] },
	{ key: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "o3-mini"] },
	{ key: "moonshot", label: "Moonshot Kimi", baseUrl: "https://api.moonshot.cn/v1", models: ["moonshot-v1-8k", "moonshot-v1-32k", "kimi-k2-0711-preview"] },
	{ key: "zhipu", label: "智谱 GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4", models: ["glm-4-flash", "glm-4-air", "glm-4-plus", "glm-4.5"] },
	{ key: "qwen", label: "通义千问", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", models: ["qwen-turbo", "qwen-plus", "qwen-flash", "qwen-max"] },
	{ key: "bai", label: "b.ai", baseUrl: "https://api.b.ai/v1", models: ["mimo-v2.5", "qwen3.8-flash"] },
	{ key: "custom", label: "自定义", baseUrl: "", models: [] },
];

/** 按 baseUrl 反查预设服务商（忽略末尾斜杠差异）。 */
function providerByBaseUrl(baseUrl) {
	const b = String(baseUrl ?? "").trim().replace(/\/+$/, "");
	if (b === "") return null;
	return PROVIDERS.find((p) => p.baseUrl.replace(/\/+$/, "") === b) ?? null;
}

export function SettingsDialog({ onClose }) {
	const [provider, setProvider] = useState("custom");
	const [baseUrl, setBaseUrl] = useState("");
	const [model, setModel] = useState("");
	const [modelOptions, setModelOptions] = useState([]);
	const [apiKey, setApiKey] = useState("");
	const [maskedKey, setMaskedKey] = useState("");
	const [saving, setSaving] = useState(false);
	const [fetching, setFetching] = useState(false);
	const [msg, setMsg] = useState("");

	// 打开时从全局单例取当前配置；按 baseUrl 反查服务商，模型列表优先用预设兜底。
	useEffect(() => {
		const c = getAnalysisConfig();
		const p = providerByBaseUrl(c.baseUrl);
		setBaseUrl(c.baseUrl);
		setModel(c.model);
		setMaskedKey(c.maskedKey);
		setApiKey("");
		setMsg("");
		if (p !== null) {
			setProvider(p.key);
			setModelOptions(p.models.includes(c.model) ? p.models : [...p.models, c.model]);
		} else {
			setProvider("custom");
			setModelOptions(c.model !== "" ? [c.model] : []);
		}
	}, []);

	// 捕获阶段 ESC 关闭（阻止冒泡到面板自身的 ESC 链：详情窗 → 面板）。
	useEffect(() => {
		const onKey = (e) => {
			if (e.key !== "Escape") return;
			e.stopPropagation();
			e.preventDefault();
			onClose();
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [onClose]);

	// 切服务商：自动填 baseUrl + 用该服务商的预设模型列表，模型名清空让用户选。
	const onProvider = (key) => {
		setProvider(key);
		const p = PROVIDERS.find((x) => x.key === key);
		setBaseUrl(p?.baseUrl ?? "");
		setModelOptions(p?.models ?? []);
		setModel("");
	};

	// 手填 baseUrl：反向匹配服务商（粘一个 DeepSeek 地址就自动跳 DeepSeek）。
	const onBaseUrl = (v) => {
		setBaseUrl(v);
		const p = providerByBaseUrl(v);
		setProvider(p !== null ? p.key : "custom");
	};

	// 获取模型列表：走服务端 GET /models（用当前 baseUrl + 已填/已存的密钥）。
	const fetchModels = () => {
		const b = baseUrl.trim();
		if (b === "" || !/^https?:\/\//i.test(b)) {
			setMsg("请先填写正确的 API 地址");
			return;
		}
		setFetching(true);
		setMsg("");
		api(API.analysisModels, { method: "POST", body: { baseUrl: b, apiKey: apiKey.trim() } })
			.then((d) => {
				const list = (d?.models ?? []).filter((x) => typeof x === "string" && x !== "");
				if (list.length > 0) {
					setModelOptions(list);
					setMsg(`已获取 ${list.length} 个模型`);
				} else {
					setMsg("未获取到模型列表");
				}
			})
			.catch((e) => setMsg(describeError(e)))
			.finally(() => setFetching(false));
	};

	const save = () => {
		const b = baseUrl.trim();
		const m = model.trim();
		if (b === "" || m === "") {
			setMsg("API 地址与模型名不能为空");
			return;
		}
		setSaving(true);
		setMsg("");
		saveAnalysisConfig({ baseUrl: b, apiKey: apiKey.trim(), model: m })
			.then((d) => {
				setMaskedKey(d?.apiKey ?? "");
				setApiKey("");
				setMsg(d?.written === false ? "保存失败：配置未能写入，请重试" : "已保存");
			})
			.catch((e) => setMsg(describeError(e)))
			.finally(() => setSaving(false));
	};

	return h(
		"div",
		{
			className: "lkb_settingsMask",
			onMouseDown: (e) => e.stopPropagation(),
			onClick: (e) => {
				if (e.target === e.currentTarget) onClose();
			},
		},
		h(
			"div",
			{ className: "lkb_settingsBox", role: "dialog", "aria-label": "全局设置" },
			h(
				"div",
				{ className: "lkb-settingsHead" },
				h("span", { className: "lkb-settingsTitle" }, "⚙️ 全局设置 · AI 模型"),
				h("button", { className: "lkb_close", title: "关闭", onClick: onClose }, "✕")
			),
			h(
				"div",
				{ className: "lkb-settingsBody" },
				h(
					"div",
					{ className: "lkb-anField", style: { marginBottom: 10 } },
					h("div", { className: "lkb-anLabel" }, "模型服务商"),
					h(
						"select",
						{ className: "lkb-input", value: provider, onChange: (e) => onProvider(e.target.value) },
						PROVIDERS.map((p) => h("option", { key: p.key, value: p.key }, p.label))
					)
				),
				h(
					"div",
					{ className: "lkb-anField", style: { marginBottom: 10 } },
					h("div", { className: "lkb-anLabel" }, "API 地址（OpenAI 兼容，可改）"),
					h("input", {
						className: "lkb-input",
						value: baseUrl,
						onInput: (e) => onBaseUrl(e.target.value),
						placeholder: "https://api.deepseek.com/v1",
						spellcheck: "false",
					})
				),
				h(
					"div",
					{ className: "lkb-anField", style: { marginBottom: 10 } },
					h("div", { className: "lkb-anLabel" }, "模型（下拉选择或直接输入）"),
					h(
						"div",
						{ className: "lkb-anModelRow" },
						h("input", {
							className: "lkb-input",
							value: model,
							onInput: (e) => setModel(e.target.value),
							placeholder: "选择或输入模型名",
							list: "lkb-model-list",
							spellcheck: "false",
						}),
						h("datalist", { id: "lkb-model-list" }, modelOptions.map((m) => h("option", { key: m, value: m }))),
						h("button", { className: "lkb-btnGhost", onClick: fetchModels, disabled: fetching }, fetching ? "获取中…" : "获取模型")
					)
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
				),
				h(
					"div",
					{ className: "lkb-settingsActions" },
					h("button", { className: "lkb-btn", onClick: save, disabled: saving }, saving ? "保存中…" : "保存"),
					h("button", { className: "lkb-btnGhost", onClick: onClose }, "关闭"),
					msg === "" ? null : h("span", { className: "lkb-status" }, msg)
				)
			)
		)
	);
}
