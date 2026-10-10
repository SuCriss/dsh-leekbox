// 韭菜盒子 LeekBox — 客户端 bundle 源码：7×24 快讯页
// 由 build.mjs 打包进 lib/client.js（npm run build）；不要手改产物。
import { h, useCallback, useEffect, useRef, useState } from "./react.js";
import { API, api, describeError, useInterval } from "./core.js";

export const NEWS_SOURCES = [
	{ key: "all", label: "全部" },
	{ key: "sina", label: "新浪" },
	{ key: "em", label: "东财" },
	{ key: "jin10", label: "金十" },
];
const NEWS_SOURCE_LABEL = { sina: "新浪", em: "东财", jin10: "金十" };

/** 判重用的归一化文本:去空白/标点,只留字母数字与汉字。 */
const newsTextKey = (s) => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

export function NewsTab({ onOpen }) {
	const [items, setItems] = useState([]);
	const [page, setPage] = useState(1);
	const [hasMore, setHasMore] = useState(false);
	const [loading, setLoading] = useState(false);
	const [src, setSrc] = useState("all");
	const [error, setError] = useState("");
	const newsLoadSeq = useRef(0);
	// 已翻到的页号。60s 自动刷新要按它重新取满，不能只取第 1 页把下面的页丢掉。
	const pageRef = useRef(1);
	/** 从第 1 页起连续取到 lastPage，附件式拼装（去重）。用于自动刷新。 */
	const loadThrough = useCallback(async (lastPage, source) => {
		const seq = ++newsLoadSeq.current;
		setLoading(true);
		try {
			const collected = [];
			const seenId = new Set();
			const seenText = new Set();
			let totalPage = 1;
			for (let p = 1; p <= lastPage; p++) {
				const data = await api(API.news + `?source=${source}&page=${p}&size=30`);
				if (seq !== newsLoadSeq.current) return; // 已被更新的请求取代
				// The server re-merges per request and the feeds shift between
				// pages, so skip anything already collected.
				for (const n of data.items ?? []) {
					const tk = newsTextKey(n.text);
					if (seenId.has(n.id) || seenText.has(tk)) continue;
					seenId.add(n.id);
					seenText.add(tk);
					collected.push(n);
				}
				totalPage = data.totalPage ?? 1;
			}
			if (seq !== newsLoadSeq.current) return;
			setItems(collected);
			setHasMore(lastPage < totalPage);
			setError("");
		} catch (e) {
			if (seq !== newsLoadSeq.current) return;
			setError(describeError(e));
		} finally {
			if (seq === newsLoadSeq.current) setLoading(false);
		}
	}, []);
	const load = useCallback((p, append, source) => {
		const seq = ++newsLoadSeq.current;
		setLoading(true);
		api(API.news + `?source=${source}&page=${p}&size=30`)
			.then((data) => {
				if (seq !== newsLoadSeq.current) return; // stale response
				const incoming = data.items ?? [];
				setItems((prev) => {
					if (!append) return incoming;
					// The server re-merges per request and the feeds shift
					// between pages, so skip anything already on screen.
					const seenId = new Set(prev.map((n) => n.id));
					const seenText = new Set(prev.map((n) => newsTextKey(n.text)));
					return [
						...prev,
						...incoming.filter((n) => !seenId.has(n.id) && !seenText.has(newsTextKey(n.text))),
					];
				});
				setHasMore(p < (data.totalPage ?? 1));
				setError("");
			})
			.catch((e) => {
				if (seq !== newsLoadSeq.current) return;
				setError(describeError(e));
			})
			.finally(() => {
				if (seq !== newsLoadSeq.current) return;
				setLoading(false);
			});
	}, []);
	useEffect(() => {
		pageRef.current = 1;
		setPage(1);
		load(1, false, src);
	}, [load, src]);
	// 自动刷新：保留用户已翻到的深度（以前恒取第 1 页，翻出来的页会被静默丢弃，
	// 但 page 仍停在 3 —— 于是"加载更多"从第 4 页继续，第 2、3 页永久缺失）。
	useInterval(() => loadThrough(pageRef.current, src), 60000);
	const more = () => {
		if (loading) return; // prevent double requests
		const next = page + 1;
		pageRef.current = next;
		setPage(next);
		load(next, true, src);
	};
	return h(
		"div",
		null,
		h(
			"div",
			{ className: "lkb-chipRow" },
			NEWS_SOURCES.map((c) =>
				h(
					"button",
					{ key: c.key, className: "lkb-chip", "data-active": src === c.key ? "true" : "false", onClick: () => setSrc(c.key) },
					c.label
				)
			)
		),
		h("div", { className: "lkb-status" }, "7×24 财经快讯（新浪 · 东财 · 金十） · 每 60 秒自动刷新 · 红色为重要资讯"),
		error === "" ? null : h("div", { className: "lkb-error" }, error),
		items.map((n) =>
			h(
				"div",
				{ className: "lkb-newsItem" + (n.important ? " lkb-newsImportant" : ""), key: n.id },
				h(
					"div",
					{ className: "lkb-newsMeta" },
					h("span", null, n.time),
					h("span", { className: "lkb-srcBadge" }, NEWS_SOURCE_LABEL[n.source] ?? n.source ?? ""),
					n.important ? h("span", { className: "lkb-newsFlag" }, "重要") : null,
					(n.tags ?? []).map((t) => h("span", { className: "lkb-newsTag", key: t }, t))
				),
				h("div", { className: "lkb-newsText" }, n.text),
				(n.stocks ?? []).length > 0
					? h(
						"div",
						{ className: "lkb-newsStocks" },
						(n.stocks ?? []).map((s) =>
							h(
								"button",
								{ key: s.code, className: "lkb-newsStock", onClick: () => onOpen(s.code, s.name) },
								s.name,
								h("span", { className: "lkb-code" }, s.code)
							)
						)
					)
					: null
			)
		),
		loading && items.length === 0 ? h("div", { className: "lkb-empty" }, "加载中…") : null,
		hasMore ? h("div", { className: "lkb-pager" }, h("button", { className: "lkb-btnGhost", onClick: more, disabled: loading }, loading ? "加载中…" : "加载更多")) : null
	);
}
