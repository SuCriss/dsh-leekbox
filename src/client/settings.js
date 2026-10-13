// 韭菜盒子 LeekBox — 客户端 bundle 源码：全局设置弹窗（AI 模型配置）
// 由 build.mjs 打包进 lib/client.js（npm run build）；不要手改产物。
//
// 面板头部 ⚙️ 打开。配置读/写走 core.js 的全局单例（saveAnalysisConfig /
// getAnalysisConfig），密钥只在服务端落盘，界面只显示脱敏值。
import { h, useEffect, useState } from "./react.js";
import { describeError, getAnalysisConfig, saveAnalysisConfig } from "./core.js";

export function SettingsDialog({ onClose }) {
	const [baseUrl, setBaseUrl] = useState("");
	const [apiKey, setApiKey] = useState("");
	const [model, setModel] = useState("");
	const [maskedKey, setMaskedKey] = useState("");
	const [saving, setSaving] = useState(false);
	const [msg, setMsg] = useState("");

	// 打开时从全局单例取当前配置（面板挂载时已经 loadAnalysisConfig 过一次）。
	useEffect(() => {
		const c = getAnalysisConfig();
		setBaseUrl(c.baseUrl);
		setModel(c.model);
		setMaskedKey(c.maskedKey);
		setApiKey("");
		setMsg("");
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
					{ className: "lkb-anField", style: { marginBottom: 10 } },
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
