// 临时可视化 bench：把 src/client/styles.js 里真实的 CSS 原样抽出来，配上
// 标签栏的真实 DOM 结构，生成浅色/深色/窄屏三张对照页，用于肉眼验收。
// 不是产物的一部分，验收完可直接删掉整个 .bench-tabs 目录。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const styles = readFileSync(join(here, "..", "src", "client", "styles.js"), "utf8");
const css = styles.match(/const CSS = `([\s\S]*?)`;/)[1];

const TABS = [
	["indices", "大盘"],
	["market", "行情"],
	["watchlist", "自选"],
	["screener", "选股"],
	["news", "快讯"],
];

const ICONS = {
	indices: `<path d="M3 3v16.5A1.5 1.5 0 0 0 4.5 21H21"/><path d="M17.5 18V10"/><path d="M12.5 18V6"/><path d="M7.5 18v-5"/>`,
	market: `<path d="M8 3v2.5"/><rect x="5.75" y="5.5" width="4.5" height="8" rx="1"/><path d="M8 13.5V17"/><path d="M16 6v2"/><rect x="13.75" y="8" width="4.5" height="9" rx="1"/><path d="M16 17v3"/>`,
	star: `<path d="M12 3.6l2.6 5.27 5.82.85-4.21 4.1.99 5.78L12 16.87l-5.2 2.73.99-5.78-4.21-4.1 5.82-.85z"/>`,
	screener: `<path d="M3.5 5.5h17"/><path d="M6.5 12h11"/><path d="M10 18.5h4"/>`,
	news: `<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h9A1.5 1.5 0 0 1 16 5.5V19H5.5A1.5 1.5 0 0 1 4 17.5z"/><path d="M16 9h2.5A1.5 1.5 0 0 1 20 10.5v6a2.5 2.5 0 0 1-2.5 2.5"/><path d="M7 8.5h6"/><path d="M7 12.5h6"/>`,
};

const svg = (key) =>
	`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false">${ICONS[key]}</svg>`;

const tabBar = (active) =>
	`<div class="lkb_tabBar" role="tablist" aria-label="韭菜盒子面板"><div class="lkb_tabTrack">${TABS.map(([key, label]) => {
		const on = key === active;
		const badge = key === "watchlist" ? `<span class="lkb_tabBadge">7</span>` : "";
		return `<button type="button" class="lkb_tab" id="lkb-tab-${key}" role="tab" title="${label}" aria-selected="${on}" aria-controls="lkb-tabpanel" tabindex="${on ? 0 : -1}" data-active="${on}"><span class="lkb_tabIcon" aria-hidden="true">${svg(key)}</span><span class="lkb_tabLabel">${label}</span>${badge}</button>`;
	}).join("")}</div></div>`;

const indexCard = (name, code, value, pct, dir, up) => `<div class="lkb-indexCard" style="--lkb-dir:${dir}">
	<div class="lkb-indexName">${name}<span class="lkb-tag">指数</span></div>
	<div class="lkb-indexValue">${value}</div>
	<div class="lkb-indexChange ${up ? "lkb-up" : "lkb-down"}"><span class="lkb-indexArrow">${up ? "▲" : "▼"}</span><span>${pct}</span></div>
	<div class="lkb-indexMeta"><span>高 3 421.55</span><span>低 3 368.10</span><span>振幅 1.58%</span></div>
	<div class="lkb-code">${code}</div>
</div>`;

const body = `<div class="lkb_body" id="lkb-tabpanel" role="tabpanel" aria-labelledby="lkb-tab-indices">
	<div class="lkb-stickyTop">
		<div class="lkb-headRow"><span class="lkb-status"><span class="lkb-spinner"></span>行情刷新中 · 10:31:02</span></div>
		<div class="lkb-pills">
			<span class="lkb-pill">上证 <b class="lkb-up">+0.62%</b></span>
			<span class="lkb-pill">深证 <b class="lkb-up">+1.14%</b></span>
			<span class="lkb-pill">创业板 <b class="lkb-down">-0.28%</b></span>
			<span class="lkb-pill">两市成交额 <b>1.24 万亿</b></span>
		</div>
	</div>
	<div class="lkb-banner"><span class="lkb-code">沪指</span>站上 3 400 点，AI 算力、半导体板块领涨</div>
	<div class="lkb-grid">
		${indexCard("上证指数", "sh000001", "3 402.18", "+0.62%", "#e03131", true)}
		${indexCard("深证成指", "sz399001", "10 884.02", "+1.14%", "#e03131", true)}
		${indexCard("创业板指", "sz399006", "2 176.44", "-0.28%", "#0f9d6e", false)}
	</div>
	<div class="lkb-thermo">
		<div class="lkb-gauge">
			<div class="lkb-gaugeScore"></div>
			<div class="lkb-gaugeVal" style="--lkb-tier-fg:#e8590c">72</div>
			<div class="lkb-gaugeTier" style="--lkb-tier-bg:#fff4e6;--lkb-tier-fg:#e8590c">偏热</div>
		</div>
		<div class="lkb-thermoStats">
			<div class="lkb-tStat"><div class="lkb-tLabel">上涨家数</div><div class="lkb-tValue">3 218</div><div class="lkb-tBar"><div class="lkb-tBarUp" style="width:68%"></div></div></div>
			<div class="lkb-tStat"><div class="lkb-tLabel">下跌家数</div><div class="lkb-tValue">1 546</div><div class="lkb-tBar"></div></div>
			<div class="lkb-tStat"><div class="lkb-tLabel">涨停</div><div class="lkb-tValue">46</div><div class="lkb-tBar"></div></div>
		</div>
	</div>
	<div class="lkb_card" style="box-shadow:none;border:1px solid var(--dsw-alias-border-l1,#e8e9ed)">
		<table>
			<thead><tr><th>名称</th><th>最新价</th><th>涨跌幅</th><th>成交额</th></tr></thead>
			<tbody>
				<tr><td class="lkb_name">中际旭创<span class="lkb_code">300308</span></td><td>142.60</td><td class="lkb-pct lkb-up">+6.42%</td><td>38.2 亿</td></tr>
				<tr><td class="lkb_name">贵州茅台<span class="lkb_code">600519</span></td><td>1 688.00</td><td class="lkb-pct lkb-down">-1.08%</td><td>21.7 亿</td></tr>
			</table>
	</div>
</div>`;

const page = ({ theme, width, title }) => `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title>
<style>
${css}
html,body{margin:0;padding:0;background:${theme === "dark" ? "#141414" : "#eef0f4"};font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
.lkb_overlay{position:static;display:block;background:transparent}
.lkb_card{position:static;margin:24px auto;transform:none;width:${width}}
.lkb_card .lkb_card{margin:0}
</style></head>
<body${theme === "dark" ? ' data-ds-dark-theme=""' : ""}>
	<div class="lkb_overlay"><div class="lkb_card">
		<div class="lkb_head" style="cursor:default">
			<span class="lkb-headTitle"><span class="lkb-logo">🥬</span>韭菜盒子</span>
			<div class="lkb_headRight">
				<span class="lkb_mktStatus" data-open="true">交易中</span>
				<button class="lkb_close" title="关闭">✕</button>
			</div>
		</div>
		${tabBar("indices")}
		${body}
		<div class="lkb_foot">
			<span>数据来源：腾讯财经 / 新浪财经 / 东方财富 / 金十数据</span>
			<span>仅供研究参考，不构成投资建议。股市有风险，入市需谨慎。</span>
		</div>
	</div></div>
</body></html>`;

writeFileSync(join(here, "light-1440.html"), page({ theme: "light", width: "min(980px,94vw)", title: "浅色 1440" }));
writeFileSync(join(here, "dark-1440.html"), page({ theme: "dark", width: "min(980px,94vw)", title: "深色 1440" }));
writeFileSync(join(here, "narrow-375.html"), page({ theme: "light", width: "352px", title: "窄屏 375" }));
console.log("bench pages written to", here);
