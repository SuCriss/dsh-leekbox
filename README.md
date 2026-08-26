# 韭菜盒子 LeekBox 🥬

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[English](README.en.md) | 简体中文

A-share 看盘助手 —— DeepSeek Harness (DSH) Web 客户端插件。

在 DSH Web 界面的左侧边栏出现 🥬 入口，点击打开行情面板：

| Tab | 功能 |
| --- | --- |
| 📊 大盘 | 上证 / 深成 / 创业板 / 科创50 实时指数，30 秒自动刷新 |
| 💹 行情 | 股票搜索（代码/名称/拼音）+ 涨幅榜 / 跌幅榜 / 成交额榜 / 换手率榜 |
| ⭐ 自选 | 自选股实时行情（持久化在 `$DSH_HOME/.leekbox-watchlist.json`） |
| 🔍 选股 | 按价格、涨跌幅、换手率区间筛选全市场 |
| 📰 快讯 | 新浪 / 东财 / 金十 三源聚合 7×24 快讯，来源可筛选，重要资讯红色高亮，60 秒自动刷新，可点相关股票直达详情 |

点击任意股票（自选里点股票名称即可）会弹出独立的个股详情窗口（类似同花顺）：大字现价 + 涨跌、15 项实时指标、日/周/月/5分/30分 K 线（前复权，蜡烛图 + MA5/10/20 均线 + 成交量 + 十字光标），一键加自选。不含当日分时图。详情窗口可拖动、可同时打开多个，ESC 或点击遮罩逐层关闭。

## 数据源

- 实时行情 / 指数 / 分时 / K线：腾讯财经（qt.gtimg.cn / web.ifzq.gtimg.cn / ifzq.gtimg.cn）
- 榜单 / 选股：东方财富（push2.eastmoney.com，多镜像自动回退）
- 搜索：东方财富（searchadapter.eastmoney.com）
- 7×24 快讯：新浪财经直播流（zhibo.sina.com.cn）+ 东方财富快讯（np-listapi.eastmoney.com）+ 金十数据（jin10.com）；重要资讯 = 各源官方标记（金十星标 / 新浪焦点）+ 关键词兜底（突发/重磅/重大/紧急/超预期）

所有数据由插件服务端（web profile 内的 cordis 插件）代理抓取并标准化，浏览器端同源调用 `/api/leekbox/*`，仅限本机 loopback 访问。数据仅供研究参考，不构成投资建议。

## 安装

```bash
# 1. 把包链接进 web profile 的 node_modules（或 pnpm add file:...）
mklink /J "$DSH_HOME\profiles\web\node_modules\@leekbox\dsh-leekbox" "<本包路径>"

# 2. 在 $DSH_HOME/profiles/web/cordis.patch.yml 追加：
# - insert:
#     - id: leekbox
#       name: '@leekbox/dsh-leekbox'

# 3. profile 配置文件 watcher 会在 ~1s 内热重组合，无需重启（服务端立即生效）；
#    浏览器刷新页面后侧边栏出现 🥬 入口。
#    若修改了 lib/index.js（服务端代码），需要重启 DeepSeek Harness 进程生效。
```

## 结构

- `lib/index.js` — 服务端 cordis 插件：`/api/leekbox/*` 路由 + 自选股持久化
- `lib/client.js` — 浏览器端 bundle：侧边栏入口 + 行情面板（React）
- `cordis.patch.yml` — 插件行注册（`dsh.bundle.patch`）

## 免责声明

本插件仅聚合公开免费行情接口，数据可能有延迟或缺失；所有内容仅供学习研究，不构成任何投资建议。股市有风险，入市需谨慎。
