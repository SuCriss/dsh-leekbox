// 韭菜盒子 LeekBox — 客户端 bundle 源码：大盘 · 市场情绪温度计
// 由 build.mjs 打包进 lib/client.js（npm run build）；不要手改产物。
import { h, useCallback, useEffect, useState } from "./react.js";
import { API, api, useTradingInterval } from "./core.js";

/** 情绪分档:按 min 从高到低命中。fg 用于数字/指针,bg 为胶囊底色。 */
const SENTI_TIERS = [
	{ min: 80, label: "沸腾", icon: "🌋", fg: "#e03131", desc: "赚钱效应极致,情绪高潮后警惕退潮" },
	{ min: 60, label: "偏热", icon: "🔥", fg: "#e8681a", desc: "做多氛围偏强,短线情绪活跃" },
	{ min: 40, label: "中性", icon: "😐", fg: "#d9a406", desc: "多空均衡,资金观望" },
	{ min: 20, label: "低迷", icon: "🌧️", fg: "#7cb342", desc: "亏钱效应显现,谨慎追高" },
	{ min: 0, label: "冰点", icon: "❄️", fg: "#0f9d6e", desc: "情绪冰点,往往孕育反转" },
];
/** 分档查询。 */
function sentiTier(score) {
	return SENTI_TIERS.find((t) => score >= t.min) ?? SENTI_TIERS[SENTI_TIERS.length - 1];
}
/** v 从 [lo,hi] 线性映射到 0~100 并夹紧。 */
const thermoMap = (v, lo, hi) => Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100));
/**
 * 综合情绪温度 0~100°:
 * 市场宽度(上涨占比) 40% + 涨停强度(家数) 25% + 封板率 20% + 连板高度 15%;
 * 单路数据缺失时按剩余权重归一,全部缺失返回 null。
 */
function sentiScore(s) {
	if (s === null || s === void 0 || typeof s !== "object") return null;
	const num = (v) => {
		const n = Number(v);
		return v === null || v === void 0 || v === "" || !Number.isFinite(n) ? null : n;
	};
	const up = num(s.up);
	const down = num(s.down);
	const limitUp = num(s.limitUp);
	const broken = num(s.broken);
	const maxBoard = num(s.maxBoard);
	const parts = [];
	if (up !== null && down !== null && up + down > 0) parts.push([thermoMap(up / (up + down), 0.3, 0.7), 0.4]);
	if (limitUp !== null) parts.push([thermoMap(limitUp, 10, 110), 0.25]);
	if (limitUp !== null && broken !== null && limitUp + broken > 0) parts.push([thermoMap(limitUp / (limitUp + broken), 0.35, 0.9), 0.2]);
	if (maxBoard !== null && maxBoard > 0) parts.push([thermoMap(maxBoard, 1, 8), 0.15]);
	if (parts.length === 0) return null;
	const w = parts.reduce((acc, p) => acc + p[1], 0);
	return Math.round(parts.reduce((acc, p) => acc + p[0] * p[1], 0) / w);
}

/** 大盘页市场情绪卡:左侧半圆分段温度仪表(当前档位高亮+游标点) + 右侧无框数据行。 */
export function SentimentCard() {
	const [senti, setSenti] = useState(null);
	const load = useCallback(() => {
		api(API.sentiment)
			.then((d) => {
				setSenti(d);
				try {
					localStorage.setItem("leekbox.sentiment", JSON.stringify(d));
				} catch {}
			})
			.catch(() => {});
	}, []);
	useEffect(() => {
		// 即写即显:复用行情页写入的 localStorage 缓存先渲染,再后台刷新覆盖
		try {
			const raw = localStorage.getItem("leekbox.sentiment");
			if (raw !== null) {
				const cached = JSON.parse(raw);
				if (cached && typeof cached === "object") setSenti(cached);
			}
		} catch {}
		load();
	}, [load]);
	useTradingInterval(load, 60000);
	const num = (v) => (v === null || v === void 0 || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
	const up = num(senti?.up);
	const down = num(senti?.down);
	const limitUp = num(senti?.limitUp);
	const limitDown = num(senti?.limitDown);
	const broken = num(senti?.broken);
	const maxBoard = num(senti?.maxBoard);
	const sealRate = limitUp !== null && broken !== null && limitUp + broken > 0 ? Math.round((limitUp / (limitUp + broken)) * 100) : null;
	const score = sentiScore(senti);
	const tier = score === null ? null : sentiTier(score);
	const tierVars = tier === null ? null : { "--lkb-tier-fg": tier.fg, "--lkb-tier-bg": tier.fg + "14" };
	const dash = "—";
	// —— 半圆分段仪表:viewBox 0 0 200 112,圆心(100,94) 半径 74,五档各占 36°,段间留 1.6° 缺口
	const GX = 100;
	const GY = 94;
	const GR = 74;
	const segPath = (i) => {
		const a0 = ((180 - i * 36 + 1.6) * Math.PI) / 180;
		const a1 = ((180 - (i + 1) * 36 - 1.6) * Math.PI) / 180;
		const x0 = (GX + GR * Math.cos(a0)).toFixed(2);
		const y0 = (GY - GR * Math.sin(a0)).toFixed(2);
		const x1 = (GX + GR * Math.cos(a1)).toFixed(2);
		const y1 = (GY - GR * Math.sin(a1)).toFixed(2);
		return `M ${x0} ${y0} A ${GR} ${GR} 0 0 1 ${x1} ${y1}`;
	};
	// SENTI_TIERS 按分值降序(0=沸腾);仪表段 0..4 = 冰点→沸腾,颜色取反序
	const activeSeg = score === null ? -1 : score >= 80 ? 4 : score >= 60 ? 3 : score >= 40 ? 2 : score >= 20 ? 1 : 0;
	const fmtInt = (v) => (v === null ? dash : Number(v).toLocaleString("en-US"));
	const pairValue = (a, b, clsA, clsB) =>
		h(
			"span",
			{ className: "lkb-tValue" },
			h("b", { className: a !== null ? clsA : "" }, fmtInt(a)),
			h("i", null, "/"),
			h("b", { className: b !== null ? clsB : "" }, fmtInt(b))
		);
	const breadthBar = up !== null && down !== null && up + down > 0 ? Math.round((up / (up + down)) * 1000) / 10 : void 0;
	const cell = (label, valueNode, opts = {}) =>
		h(
			"div",
			{ className: "lkb-tStat", title: opts.title ?? label },
			h("span", { className: "lkb-tLabel" }, label),
			valueNode,
			opts.bar === void 0 ? null : h("div", { className: "lkb-tBar" }, h("div", { className: "lkb-tBarUp", style: { width: opts.bar + "%" } }))
		);
	return h(
		"div",
		null,
		h(
			"div",
			{ className: "lkb-thermo", style: tierVars },
			h(
				"div",
				{ className: "lkb-gauge" },
				h(
					"svg",
					{ viewBox: "0 0 200 112", style: { width: 196, display: "block" } },
					[0, 1, 2, 3, 4].map((i) =>
						h("path", {
							key: "seg" + i,
							d: segPath(i),
							fill: "none",
							stroke: SENTI_TIERS[4 - i].fg,
							strokeWidth: activeSeg === i ? 11 : 8,
							opacity: score === null ? 0.28 : activeSeg === i ? 1 : 0.26,
							strokeLinecap: "butt",
							style: { transition: "opacity .3s, stroke-width .3s" },
						})
					),
					h(
						"g",
						{
							style: {
								transform: `rotate(${(score ?? 0) * 1.8}deg)`,
								transformOrigin: `${GX}px ${GY}px`,
								transition: "transform .8s cubic-bezier(.22,1,.36,1), opacity .3s",
								opacity: score === null ? 0 : 1,
							},
						},
						h("circle", { cx: GX - GR, cy: GY, r: 5.5, fill: tier !== null ? tier.fg : "#adb5bd", stroke: "var(--dsw-alias-bg-base,#fff)", strokeWidth: 2 })
					),
					h("text", { x: GX - GR, y: GY + 13, textAnchor: "middle", fontSize: 8.5, fill: "var(--dsw-alias-label-tertiary,#a2a7b3)" }, "0"),
					h("text", { x: GX + GR, y: GY + 13, textAnchor: "middle", fontSize: 8.5, fill: "var(--dsw-alias-label-tertiary,#a2a7b3)" }, "100")
				),
				h(
					"div",
					{ className: "lkb-gaugeScore" },
					h("span", { className: "lkb-gaugeVal" }, score === null ? dash : score + "°"),
					tier === null
						? h("span", { className: "lkb-gaugeTier" }, "数据获取中…")
						: h("span", { className: "lkb-gaugeTier", title: tier.desc }, tier.icon + " " + tier.label)
				)
			),
			h(
				"div",
				{ className: "lkb-thermoStats" },
				cell(
					"上涨 / 下跌",
					pairValue(up, down, "lkb-up", "lkb-down"),
					{ bar: breadthBar, title: `上涨 ${up ?? dash} 家 / 下跌 ${down ?? dash} 家` }
				),
				cell("涨停 / 跌停", pairValue(limitUp, limitDown, "lkb-up", "lkb-down"), { title: `涨停 ${limitUp ?? dash} 家 / 跌停 ${limitDown ?? dash} 家` }),
				cell("炸板", h("span", { className: "lkb-tValue" }, fmtInt(broken)), { title: "炸板:曾触及涨停后回落的家数" }),
				cell(
					"封板率",
					h("span", { className: "lkb-tValue" }, h("b", { className: sealRate === null ? "" : sealRate >= 70 ? "lkb-up" : sealRate < 50 ? "lkb-down" : "" }, sealRate === null ? dash : sealRate + "%")),
					{ title: "封板率 = 涨停 / (涨停 + 炸板)" }
				),
				cell("最高板", h("span", { className: "lkb-tValue" }, maxBoard !== null && maxBoard > 0 ? maxBoard + "板" : dash), { title: "当日最高连板数" })
			)
		)
	);
}
