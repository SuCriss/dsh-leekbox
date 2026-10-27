# LeekBox 韭菜盒子 · A-share market dashboard for DeepSeek Harness

[![npm](https://img.shields.io/npm/v/dsh-leekbox?color=2f9e44&label=npm)](https://www.npmjs.com/package/dsh-leekbox)
[![CI](https://github.com/SuCriss/dsh-leekbox/actions/workflows/ci.yml/badge.svg)](https://github.com/SuCriss/dsh-leekbox/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![platform](https://img.shields.io/badge/platform-web-1098ad)
[![stars](https://img.shields.io/github/stars/SuCriss/dsh-leekbox?style=social)](https://github.com/SuCriss/dsh-leekbox/stargazers)

English | [简体中文](README.md)

<img src="docs/og.png" alt="LeekBox — realtime A-share market dashboard for DeepSeek Harness: quotes, intraday and candlestick K-line, watchlist P/L and price alerts, technical screener, limit-up sentiment, AI stock analysis" width="100%">

**LeekBox is a realtime A-share (Chinese stock market) dashboard packaged as a DeepSeek Harness (DSH) web client plugin.** After install it adds a 🥬 entry to the DSH sidebar; clicking it opens a trading panel with realtime quotes and indices, intraday charts and forward-adjusted candlestick K-line, a watchlist with position P/L and price alerts, a technical-signal screener, limit-up sentiment and the dragon-tiger list, a 7×24 news feed aggregated from three sources, and AI stock analysis with your own model key. Every request is proxied by the plugin's host half on your machine and served to the browser same-origin under `/api/leekbox/*`, loopback only.

> Looking for an open-source A-share dashboard, a stock screener, a watchlist with price alerts, or a crash-up/limit-up sentiment panel that lives inside your AI workspace instead of yet another app window? This repo is that. Free public data endpoints, no API key required (except the AI analysis model key you configure yourself).

## Contents

- [What it is](#what-it-is)
- [Highlights](#highlights)
- [Quick start](#quick-start)
- [The six tabs](#the-six-tabs)
- [Data sources](#data-sources)
- [Trading session and calendar](#trading-session-and-calendar)
- [Upstream request governance](#upstream-request-governance)
- [Cross-site protection for write routes](#cross-site-protection-for-write-routes)
- [Dragon-tiger list date semantics](#dragon-tiger-list-date-semantics)
- [Failures must be visible](#failures-must-be-visible)
- [Bundle and sources must match](#bundle-and-sources-must-match)
- [Requirements](#requirements)
- [Install](#install)
- [Structure](#structure)
- [FAQ](#faq)
- [Links](#links)
- [Disclaimer](#disclaimer)

## What it is

An **open-source, self-hosted A-share dashboard that lives inside your AI workspace**. It is not a replacement for a full trading terminal — it has no Level-2 data and no order entry. What it optimises for is shape and openness: quotes, screener, news and AI analysis in the same panel, with every upstream adapter readable in `lib/`.

- **A-share only**: Shanghai / Shenzhen / Beijing listed stocks, ETFs and on-exchange funds, convertible bonds, LOFs. No HK, US or futures.
- **Realtime while trading**: 30–60s polling per tab during session hours, no requests when the market is closed or the page is hidden.
- **Zero setup**: free public endpoints — quotes work out of the box; only AI analysis needs a model key.
- **Local only**: routes listen on `127.0.0.1`, data and keys stay in `$DSH_HOME/*.leekbox-*.json` on your machine.

## Highlights

- 📈 **Realtime quotes and indices** — SSE / SZSE / ChiNext / STAR50 with 15 live fields; stock detail popups with an intraday chart, day/week/month/5m/30m forward-adjusted candlesticks (MA5/10/20, volume, crosshair), a 15-day main money-flow bar chart and an F10 fundamentals card.
- ⭐ **Watchlist with position P/L and price alerts** — grouped, inline-editable cost basis, live floating P/L and return %, per-row price / percent thresholds watched during trading hours (toast + desktop notification + beep).
- 🔍 **Screener** — 13 weighted technical signals, or the intersection of 7 preset strategies; signal definitions live on the server and the UI renders itself from that metadata.
- 🌡️ **Limit-up sentiment thermometer** — market breadth, limit-up strength, board-sealing rate and consecutive-board height weighted into a 0–100 score, with the consecutive-board ladder, broken-board rate and the expandable limit-up pool.
- 🐉 **Dragon-tiger list** — the date parameter walks back to the most recent *published* trading day instead of pretending "not published yet" means "no data".
- 📰 **7×24 news** — Sina / Eastmoney / Jin10 aggregated with cross-source dedup, important items highlighted, related stocks clickable.
- 🤖 **AI stock analysis** — the server summarises live quote + last 60 daily bars + F10 fundamentals and sends it to your model; supports DeepSeek / OpenAI / Anthropic Claude / Moonshot Kimi / Zhipu / Qwen and other OpenAI-compatible providers.
- 🔎 **Millisecond full-market search** — local index of ~8,000 instruments matched by code, name or pinyin initials, results carrying live prices.

## Quick start

```bash
# 1) get the code
git clone https://github.com/SuCriss/dsh-leekbox.git

# 2) link it into the web profile's node_modules
#    Windows
mklink /J "%DSH_HOME%\profiles\web\node_modules\dsh-leekbox" "<repo path>"
#    macOS / Linux
ln -s "<repo path>" "$DSH_HOME/profiles/web/node_modules/dsh-leekbox"

# 3) register it in $DSH_HOME/profiles/web/cordis.patch.yml:
#    - insert:
#        - id: leekbox
#          name: 'dsh-leekbox'

# 4) the profile watcher recomposes in ~1s; refresh the browser and the 🥬 entry appears
```

Details in [Install](#install). Requires DSH ≥ 0.1.1-rc.1 and the **web profile**.

## The six tabs

| Tab | What it does |
| --- | --- |
| 📊 大盘 | SSE / SZSE / ChiNext / STAR50 realtime indices, 30s auto-refresh; a **sentiment thermometer** on top — a 0–100 composite (breadth 40% + limit-up strength 25% + sealing rate 20% + board height 15%, missing inputs renormalised over the remaining weights) rendered as a segmented arc with a smooth needle, plus up/down counts, limit-up/limit-down, broken boards, sealing rate and the highest board |
| 💹 行情 | Search stocks / ETFs / convertible bonds / LOFs (code, name, pinyin initials; local index, millisecond response) + multi-pool boards (A-share / main board / non-main / ETF / convertible bond / LOF, by gain, amount, turnover or main net inflow) + sector boards + dragon-tiger list |
| ⭐ 自选 | Persistent watchlist with realtime quotes (`$DSH_HOME/.leekbox-watchlist.json`), grouped; **position cost & live P/L** (click the qty/cost cells to edit inline; live floating P/L + return % + a summary bar), **price alerts** (🔔 per-row button: price above/below, % move thresholds; watched during trading hours, toast + desktop notification + beep on trigger, then auto-removed; persisted in `$DSH_HOME/.leekbox-alerts.json`); one-click JSON backup / CSV export (position fields included), import from JSON/CSV/text (merge or replace) |
| 🔍 选股 | Two modes: **score screening** (price / change / turnover filters + 13 technical signals + weighted ranking) and **multi-strategy intersection** (7 presets in parallel; a stock must hit several of them and is ranked by hit count) |
| 📰 快讯 | 7×24 news aggregated from Sina, Eastmoney and Jin10, filterable by source; important items highlighted in red; 60s auto-refresh; related stocks clickable |
| 🤖 分析 | **AI stock analysis**: pick a stock and have the server summarise its live quote + last 60 daily bars + F10 fundamentals into a structured Chinese analysis (risk note and disclaimer included; copy / regenerate). Configure the model in the panel header ⚙️ **global settings**: a **provider dropdown** (DeepSeek / OpenAI / **Anthropic Claude** / Moonshot Kimi / Zhipu / Qwen / b.ai etc.; OpenAI-compatible and native Anthropic protocols) + a **model dropdown** (fetch the real list or type one); persisted in `$DSH_HOME/.leekbox-analysis.json`, key stored server-side and shown masked only |

The market tab also keeps a **consecutive-board ladder** (2板/3板/… plus the highest board) with an expandable limit-up pool list.

Clicking any stock name (including in the watchlist) opens a dedicated detail popup, Tonghuashun-style: large price header, 15 live indicators, an **intraday minute chart** (price line + volume-weighted average line + volume bars + prev-close baseline with a relative-% right axis and hover tooltip), candlestick K-line — forward-adjusted (qfq), day/week/month/5m/30m, with MA5/10/20 overlays, volume subchart, last-price line and a hover crosshair legend — plus a **main money-flow bar chart** (last 15 days, inflow red / outflow green, hover shows the day's net inflow) over the flow detail table, and an **F10 fundamentals card** (last 8 report periods: revenue / net profit with YoY, weighted ROE, gross margin, debt ratio, EPS — Eastmoney F10 feed). Popups are draggable, can be stacked for comparison, close via ESC or the backdrop.

## Data sources

- Realtime quotes / indices / intraday / K-line: Tencent Finance (`qt.gtimg.cn`, `web.ifzq.gtimg.cn`, `ifzq.gtimg.cn`)
- F10 fundamentals: Eastmoney F10 (`datacenter.eastmoney.com`, dual-host fallback)
- Rankings / screener universe: Eastmoney (`push2.eastmoney.com`, mirror fallback; Sina as secondary source)
- Search: local full-market index (Eastmoney push2 clist snapshot, ~8k instruments, 6h cache) + Tencent smartbox pinyin fallback + batched live quotes; falls back to Eastmoney `searchadapter` while the index warms up
- News: Sina zhibo stream + Eastmoney fast news (`np-listapi.eastmoney.com`) + Jin10 flashes; cross-source dedup merges the same event into one item even when worded differently
- AI analysis: model is user-configured (OpenAI-compatible or Anthropic); stock data reuses the quote / K-line / F10 feeds above, and the request is proxied server-side through `/chat/completions` (key stays server-side, never sent to the browser)

All requests are proxied by the plugin's host half (a cordis plugin inside the
web profile) and served to the browser same-origin under `/api/leekbox/*`,
loopback-only. For research reference only — not investment advice.

## Trading session and calendar

Trading days are not "Monday to Friday" — Chinese public holidays such as National Day and Spring Festival are *weekday* closures, so a real calendar is required. The plugin does not ship a holiday table; it derives trading days from the **date sequence of the index daily K-line** (holidays produce no bar) and caches the result:

- `lib/calendar.js` exposes `sessionState()`: `preOpen` / `auction` (9:15–9:25) / `open` / `lunch` / `closed` / `weekend` / `holiday`, always evaluated in **UTC+8** regardless of host timezone. `GET /api/leekbox/calendar` returns the trading-day list; `/health` and `/sentiment` carry a summary. The first request never blocks: it answers with the weekday heuristic tagged `source: weekday-fallback` and rebuilds in the background.
- The client uses it for two decisions: the **status label** in the panel header and **whether to poll at all** — no requests outside session hours or while the page is hidden, with an immediate refetch when it comes back.
- Outside session hours upstream data stops changing, so cache TTLs widen (`sessionTtl`, ×20 by default).
- **The right edge of the daily series**: a daily bar only exists once that day has been traded, so "today is not in the trading-day set" must never be read as "today is closed" — otherwise every trading day shows 休市. The order of judgement is: today has a bar → trading day; the date falls inside the published window `[from, to]` but has no bar → definitely closed; today is right of the window → probe whether the index has intraday bars today (yes → trading day, no and past 09:35 → closed, otherwise mark `provisional` and fall back to the weekday heuristic). The calendar rebuilds unconditionally across midnight, re-probes every 90s in the early-morning window, and returns to the 12h TTL once today's bar lands.

## Upstream request governance

The hottest routes used to hit upstream on every request while the client polls every 15–60s and stacked detail popups request the same code concurrently — that is not just waste, it trips Eastmoney's per-IP throttle. Everything now goes through `lib/route-cache.js`:

- **TTL cache + single flight**: concurrent requests for the same key share one upstream call.
- **stale-if-error**: on upstream hiccups, serve the last good value (10 minutes for some routes, 30 minutes for historical K-line, 24 hours for F10) instead of a 502 wall. The precondition semantics are unchanged — only real data is ever cached, never an "empty snapshot".
- **Session-aware TTL**: widens after the close and on holidays, following the calendar above.
- Observability: `GET /api/leekbox/metrics` (version / uptime / session / index state / per-cache hit rate, evictions, stale serves); `/health` carries the same stats.
- When the limit-up pool or the breadth numbers are unavailable, `/sentiment` renders the gap instead of failing the whole card (`partial: true`).

## Cross-site protection for write routes

The loopback fence (socket address + Host header) does not stop **browser-initiated cross-site requests**: a malicious page calling `fetch(..., {mode:"no-cors"})` against a local port still presents `Host: 127.0.0.1`, and although it cannot read the response, the write already happened. Every write route therefore also requires:

- `Origin` absent or pointing at the local host (otherwise 403);
- `Content-Type: application/json` (otherwise 415) — a cross-site `no-cors` string body is `text/plain`, which closes that door completely.

## Dragon-tiger list date semantics

The `date` parameter of `GET /api/leekbox/longhu?date=YYYY-MM-DD` is a **walk-back start point**, not "this exact day":

- Today's list is published only after the close, so intraday, weekend and holiday requests for today are necessarily empty. The server walks back to the most recent day that has one (weekends are skipped), and returns both `requestedDate` and `date` (what is actually shown) — the UI says so when they differ.
- **Backwards only**: data after the start point is never used.
- Malformed dates (e.g. `2026-02-30`, `2026-13-01`, `20261009`) return **400** rather than silently substituting today.
- The whole walk-back has a 15s budget so "multiple days × retries × hosts" cannot stall a request for minutes.

## Failures must be visible

The most insidious class of bug in this project is **silent failure**: no exception, no message, just a wrong answer or nothing at all.

- **User-initiated actions** (add/remove watchlist, rename group, delete alert) must report failure through `notifyFailure(what)`, the same toast channel the price alerts use.
- **Background polling / prewarming / optional enrichment** (F10, first money-flow load, sentiment) stay quiet: the block keeps its title, shows the reason and offers a retry button instead of disappearing.
- On failure the previous data is cleared, so stale rows never masquerade as the current result.

## Bundle and sources must match

`lib/client.js` is a **committed build artifact** (the host loads it directly without building). CI fails when rebuilding produces a diff.

One counter-intuitive detail: **esbuild does not overwrite the output when the build fails**, so "the hash did not change after a rebuild" can also mean "the build has been failing and the artifact is stale". That is why `client-bundle-test.mjs` additionally checks the **import/export pairing of all 15 modules** under `src/client/*` — a missing `export` breaks the build and that assertion fails with the file and symbol name.

## Requirements

- DeepSeek Harness (DSH) **>= 0.1.1-rc.1** (declared as `dsh.engines.dsh` in `package.json`)
- **web profile** only (`dsh.client.platform: "web"`): the route host lives inside the DSH process and the browser bundle talks to it same-origin under `/api/leekbox/*` (loopback only)
- Node.js >= 20 for building the bundle / running the test suite (not needed by the host at runtime)

## Install

```sh
# 1) link the package into the web profile's node_modules
mklink /J "%DSH_HOME%\profiles\web\node_modules\dsh-leekbox" "<repo path>"
# then append to $DSH_HOME\profiles\web\cordis.patch.yml:
# - insert:
#     - id: leekbox
#       name: 'dsh-leekbox'
```

The profile watcher recomposes in about a second, so the host half is live
immediately; refresh the browser for the sidebar entry. Host-side changes to
`lib/index.js` need a DSH restart.

## Structure

- `lib/index.js` — host half: `/api/leekbox/*` routes + watchlist persistence + AI analysis (model config persistence + `/chat/completions` proxy)
- `lib/calendar.js` — trading calendar and session state (derived from the index daily K-line, UTC+8 sessions)
- `lib/route-cache.js` — route-level TTL cache + single flight + stale-if-error + stats
- `lib/search-index.js` — local full-market search index (code / name / pinyin initials)
- `lib/client.js` — browser bundle: sidebar entry + dashboard panel (React). **Generated, do not hand-edit** — sources live in `src/client/` (15 single-responsibility files), bundled with esbuild via `npm run build` (`npm run dev` for watch mode); React is injected by the host and never bundled
- `cordis.patch.yml` — plugin roster registration (`dsh.bundle.patch`)

### Screener module

The screener is split across five files, with `lib/screener.js` as the facade (`runScreener` / `screenerProgress` / `screenerMeta`):

- `lib/screener.js` — orchestration: universe snapshot, per-symbol daily K-line, base filters, ranking, progress
- `lib/indicators.js` — pure indicator math (EMA/MACD/RSI/KDJ/SMA/BOLL/crossovers), no I/O
- `lib/signals.js` — **single source of truth for signals and strategies** (weights, groups, copy, composition) + scoring
- `lib/screener-cache.js` — result cache (LRU + 15 min TTL) and daily K-line cache (adaptive TTL)
- `lib/screener-validate.js` — parameter normalisation + validation errors carrying `error.code`

`GET /api/leekbox/screener/meta` publishes the signal/strategy metadata the UI renders from, so adding a signal on the server is reflected in the panel automatically.

## FAQ

**Is this a website or a desktop app?**
Neither — it is a DeepSeek Harness plugin running inside the DSH **web profile**: the routes live in the DSH process, the UI is a panel in your browser. Installing means dropping the package into `$DSH_HOME/profiles/web/node_modules` and registering one line in `cordis.patch.yml`.

**Do I need a paid market-data API or an account?**
No. Quotes, indices, K-line, rankings, the dragon-tiger list and the news feed all come from free public endpoints (Tencent Finance / Eastmoney / Sina / Jin10). The only credential you may add is a model key for the AI analysis tab.

**How realtime is it?**
30–60s polling per tab during session hours (details refresh along with open popups). Outside session hours or while the page is hidden, no requests are made; coming back triggers an immediate refetch.

**Does it support Hong Kong, US or futures markets?**
No. A-share only: Shanghai/Shenzhen/Beijing stocks, ETFs and on-exchange funds, convertible bonds, LOFs.

**Are my watchlist and keys uploaded somewhere?**
No. Routes listen on `127.0.0.1` only and the browser talks to them same-origin. Watchlist, positions, alerts and model config are written to `$DSH_HOME/.leekbox-*.json`; the model key stays server-side and is shown masked in the UI.

**Why does the header sometimes say 休市 (closed)?**
That is the trading calendar reporting a non-trading day: a weekend, a public holiday (including makeup working days), or a day that has not opened yet. It is derived from the index daily K-line plus an intraday probe, so it distinguishes "closed today" from "today's bar is not out yet" — see [Trading session and calendar](#trading-session-and-calendar).

**How does the screener pick stocks?**
Not randomly: 13 technical signals (moving averages, MACD, RSI, KDJ, BOLL, volume expansion, crossovers…) computed from daily bars and weighted into a score; the multi-strategy mode intersects 7 presets and ranks by hit count. All signals and weights are defined in `lib/signals.js`.

**How is this different from a broker terminal?**
It gives up data depth (no Level-2, no tick-by-tick, no full financial database) and order entry, and gains shape and openness: it lives inside your AI workspace, the whole pipeline is open source, and you can change signals and weights yourself.

## Links

- Releases: https://github.com/SuCriss/dsh-leekbox/releases
- Issues: https://github.com/SuCriss/dsh-leekbox/issues
- npm: https://www.npmjs.com/package/dsh-leekbox
- 简体中文 README: [README.md](README.md)
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md) · Changelog: [CHANGELOG.md](CHANGELOG.md)

## Disclaimer

This plugin only aggregates public free quote endpoints; data may be delayed
or missing. Everything here is for learning and research, not investment
advice. 股市有风险，入市需谨慎。
