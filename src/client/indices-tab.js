// 韭菜盒子 LeekBox — 客户端 bundle 源码：大盘页（指数 + 情绪）
// 由 build.mjs 打包进 lib/client.js（npm run build）；不要手改产物。
import { h, useCallback, useEffect, useState } from "./react.js";
import { API, api, cnMarket, describeError, fmt, fmtPct, fmtSign, marketOpenLabel, nowTime, openOnRow, trend, useTradingInterval } from "./core.js";
import { SentimentCard } from "./sentiment.js";

export function IndicesTab({ onOpen }) {
	const [indices, setIndices] = useState([]);
	const [error, setError] = useState("");
	const [ts, setTs] = useState("");
	const load = useCallback(() => {
		api(API.indices)
			.then((data) => {
				setIndices(data.indices ?? []);
				setTs(nowTime());
				setError("");
			})
			.catch((e) => setError(describeError(e)));
	}, []);
	useEffect(() => {
		load();
	}, [load]);
	useTradingInterval(load, 30000);
	const mkt = marketOpenLabel();
	return h(
		"div",
		null,
		h("div", { className: "lkb-status" }, h("span", null, `更新于 ${ts}`), h("span", null, mkt.label)),
		error === "" ? null : h("div", { className: "lkb-error" }, error),
		h(
			"div",
			{ className: "lkb-grid" },
			indices.map((q) => {
				const dir = q.change > 0 ? "up" : q.change < 0 ? "down" : "flat";
				const dirColor = dir === "up" ? "#e03131" : dir === "down" ? "#0f9d6e" : "#ced4da";
				const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "—";
				return h(
					"div",
					{ className: "lkb-indexCard", key: q.code, style: { "--lkb-dir": dirColor }, onClick: (e) => openOnRow(e, onOpen, q.code, q.name) },
					h(
						"div",
						{ className: "lkb-indexName" },
						q.name,
						h("span", { className: "lkb-tag" }, cnMarket(q.market) + q.code.slice(2))
					),
					h("div", { className: "lkb-indexValue " + trend(q.change) }, fmt(q.price)),
					h(
						"div",
						{ className: "lkb-indexChange " + trend(q.change) },
						h("span", { className: "lkb-indexArrow" }, arrow),
						fmtPct(q.changePct),
						h("span", { className: "lkb-code", style: { marginLeft: 2 } }, fmtSign(q.change))
					),
					h(
						"div",
						{ className: "lkb-indexMeta" },
						h("span", null, `高 ${fmt(q.high)}`),
						h("span", null, `低 ${fmt(q.low)}`),
						h("span", null, `振幅 ${fmt(q.amplitude)}%`)
					)
				);
			})
		),
		h("div", { className: "lkb-status", style: { marginTop: 10 } }, "点击指数卡片可弹出详情窗口（K线 · 前复权）"),
		h(SentimentCard, null)
	);
}
