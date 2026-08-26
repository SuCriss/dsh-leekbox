# LeekBox 韭菜盒子 🥬

[English](README.en.md) | 简体中文

An A-share market dashboard as a DeepSeek Harness (DSH) web client plugin.
Click the 🥬 entry in the DSH sidebar to open the dashboard.

| Tab | What it does |
| --- | --- |
| 📊 大盘 | SSE / SZSE / ChiNext / STAR50 realtime indices, 30s auto-refresh |
| 💹 行情 | Stock search (code / name / pinyin) + gainers, losers, turnover, volume boards |
| ⭐ 自选 | Persistent watchlist with realtime quotes (`$DSH_HOME/.leekbox-watchlist.json`) |
| 🔍 选股 | Multi-signal screener over the whole market: pool + basic filters + technical signals, weighted score ranking |
| 📰 快讯 | 7x24 news aggregated from Sina, Eastmoney and Jin10, filterable by source; important items highlighted in red |

Clicking any stock name (including in the watchlist) opens a dedicated detail
popup window, Tonghuashun-style: large price header, 15 live indicators, and
candlestick K-line — forward-adjusted (qfq), day/week/month/5m/30m, with
MA5/10/20 overlays, volume subchart, last-price line and a hover crosshair
legend. No intraday minute chart. Popups are draggable, can be stacked for
comparison, close via ESC or the backdrop.

## Data sources

- Realtime quotes / indices / K-line: Tencent Finance (qt.gtimg.cn, web.ifzq.gtimg.cn, ifzq.gtimg.cn)
- Rankings / screener universe: Sina Finance (vip.stock.finance.sina.com.cn)
- Search suggest: Eastmoney (searchadapter.eastmoney.com)
- News: Sina zhibo stream + Eastmoney fast news (np-listapi.eastmoney.com) + Jin10 flashes

All requests are proxied by the plugin's host half (a cordis plugin inside the
web profile) and served to the browser same-origin under `/api/leekbox/*`,
loopback-only. For research reference only — not investment advice.

## Install

```sh
dsh plugin --profile web add <this repo>
```

or manually:

```sh
mklink /J "$DSH_HOME\profiles\web\node_modules\@leekbox\dsh-leekbox" "<repo path>"
# then append to $DSH_HOME/profiles/web/cordis.patch.yml:
# - insert:
#     - id: leekbox
#       name: '@leekbox/dsh-leekbox'
```

Refresh the page after install. Host-side changes need a DSH restart.

## Structure

- `lib/index.js` — host half: `/api/leekbox/*` routes + watchlist persistence
- `lib/client.js` — browser bundle: sidebar entry + dashboard panel (React)
- `lib/screener.js` — screener engine (indicators computed from daily K-line)
- `cordis.patch.yml` — plugin roster registration (`dsh.bundle.patch`)

## Disclaimer

This plugin only aggregates public free quote endpoints; data may be delayed
or missing. Everything here is for learning and research, not investment
advice. 股市有风险，入市需谨慎。
