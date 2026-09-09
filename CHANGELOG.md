# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.7.4] - 2026-09-09

### Removed

- **移除 K 线图上的压力位/支撑位画线**：0.7.2 引入的两条常驻曲线观感不佳（既不
  贴蜡烛形态也非标准 S/R 表达），撤下；压力位/支撑位仅保留悬停浮窗数值展示。
  算法回归 0.7.3 定义：收盘价上方最近摆动高点/下方最近摆动低点（60 根窗口、左
  右各 2 根确认，枢轴点回退 + 区间极值兜底，无未来函数，恒保证 `压力位 ≥ 收盘
  ≥ 支撑位`），不再为画线做任何平滑或改写。

## [0.7.3] - 2026-09-08

### Fixed

- **修复悬停 K 线时整个插件窗口崩溃退出**：0.7.2 浮窗代码中 `mas.map(fn, h(...))` 的
  第二个 `h(...)` 实为 `map()` 的第二参数（thisArg 位），在渲染时被立即求值，其内部引
  用的 `series`/`mi` 不在该作用域，首次悬停触发浮窗分支渲染时抛出 `ReferenceError`
  导致 React 整树卸载。改为 `mas.flatMap((series, mi) => [h(...), h(...)])` 返回元素对
  数组；补充回归测试验证浮窗 10 个数值格（开高低收量/MA×3/压撑×2）完整求值。

## [0.7.2] - 2026-09-08

### Changed

- **K 线悬停信息改为跟随鼠标的浮窗**：移除图上方的固定图例条，鼠标悬停任意 K 线时
  在光标旁弹出浮窗（靠近右/下边缘自动翻转，不遮挡十字光标），内容含日期、开/高/
  低/收（涨跌着色）、量、MA5/MA10/MA20（均线配色）、压力位/支撑位。
- **压力位/支撑位改为图上常驻曲线**（类似 MA 线画法）：逐日滚动计算（每日只用截
  至当日的数据），红色为压力位、绿色为支撑位，随十字光标在历史各日平滑变化。

## [0.7.1] - 2026-09-08

### Added

- **K 线悬停浮窗新增压力位/支撑位**：十字光标悬停任意一根 K 线时，图例在 MA5/10/
  20 之后追加 `压力位`（红）/`支撑位`（绿）两项，并在价格图上以两条虚线横线同步标
  注，随悬停日实时更新（日/周/月/5分/30分周期均生效）。
  - 算法只用截至悬停日的数据（无未来函数）：取最近 60 根 K 线检测摆动高低点（左
    右各 2 根确认的局部极值），压力位 = 收盘价上方最近的摆动高点，支撑位 = 下方
    最近的摆动低点；
  - 无摆动点时回退经典枢轴点公式（前一日 `P=(H+L+C)/3`，`R1=2P−L`，`S1=2P−H`）；
  - 区间极值兜底，保证恒有 `压力位 ≥ 收盘 ≥ 支撑位`。

## [0.7.0] - 2026-09-08

### Changed

- **行情搜索重做**：结果展示与性能全面重构。
  - 服务端新增本地全市场搜索索引（`lib/search-index.js`）：沪深京 A 股 + ETF/
    LOF/可转债约 8 千只标的一次性快照（东方财富 push2 clist，多镜像重试 + 分块
    并发），缓存 6 小时并后台热更新，插件挂载时即开始预热。代码前缀、名称关键
    字、拼音首字母（`Intl.Collator` 中文拼音排序推导，零依赖）搜索均在 ~1ms
    内从内存返回；全拼输入（如 `maotai`）由腾讯 smartbox 兜底；索引未就绪时回
    退原东方财富 searchadapter（响应新增 `source`/`meta` 字段标注来源与耗时）。
  - 搜索结果附带实时行情：每次搜索对结果集发起一次腾讯批量行情请求，命中条目
    直接带 `price/changePct/turnoverRate/amount`，无需二次点击。
  - 客户端搜索结果展示重做：搜索框增加放大镜/清空按钮，下拉式结果卡（不再把
    下方榜单压下去）——每条结果带类型徽章（股票/ETF/LOF/转债）、沪/深/北市场标
    识、实时价格 + 涨跌幅着色、加自选 ☆；骨架屏加载态、无结果提示、Esc/Enter
    快捷键、点击外部自动收起；防抖 350ms → 120ms 并带竞态序号保护。
- 修复北交所代码归一：`920xxx` 之前被 `9 → 沪市` 规则错误映射为 `sh`，服务端
  `normalizeCode` 与客户端 `normCode` 现在都将其映射到 `bj`（43/83/87/88 已覆盖）。

- 修复所有列表（搜索结果/榜单/条件选股）☆ 状态永不点亮的问题：自选股服务端
  存储的是规范化代码（`sh603626`），而 UI 行携带裸代码（`603626`）直接比对导致
  永不匹配——新增 `isWatched()` 两侧统一过 `normCode` 比对；☆ 点击成功后立即
  广播 `leekbox:watchlist-changed` 事件，面板即时刷新自选列表（不再等 20s 轮询）。

- 彻底移除原生 `window.confirm`（☆ 移出自选、覆盖导入确认）：原生同步模态框会
  抢占窗口焦点，在本嵌入式 WebView 中取消后渲染进程鼠标捕获状态可能卡死（搜索框
  点不聚焦，需最小化窗口恢复）。改为插件内自绘确认对话框（`lkbConfirm`，保持
  Promise<boolean> 契约）：Esc=取消 / Enter=确定 / 点遮罩取消，暗色主题适配，
  不抢焦点、不阻塞渲染。

### Fixed

- 搜索下拉卡与搜索框在部分皮肤（如 stellar-diva，将 `--dsw-alias-bg-base` 重映射
  为随透明度可到 0 的玻璃色）下完全透明的问题：两层叠打底色（别名色 over 实色，
  暗色模式用 `#151517`）；同时修正 `.lkb-searchInput` 左内边距被后置 `.lkb-input`
  规则覆盖导致放大镜图标压住 placeholder 的层叠问题。
- 搜索结果无行情时不再显示 "— —" 占位横杠（价格/涨跌幅字段缺失时直接隐藏）。
- 重新聚焦搜索框时，若已有关键词则立即恢复展示上次搜索结果。

## [0.6.2] - 2026-09-07

### Added

- 主板 / 非主板池切换（market board pool toggle): the stocks rank tab gains
  two new pools beside 沪深A股 — 主板 (SH main board 600/601/603/605 + SZ main
  board 000/001/002/003, mid-board merged) and 非主板 (ChiNext 300/301 + STAR
  688). The two pools exactly partition 沪深A股 (3486 + 2070 = 5556), so the
  rank lists can now be filtered by board without leaving the tab. Routed
  through the existing `node` parameter as `main` / `non_main` Eastmoney
  universe selectors.

## [0.6.1] - 2026-09-01

### Fixed

- Watchlist entries added via the ☆ star button (search results, rank tables,
  screener results) were stored with the stock code as their name, so the
  watchlist table rendered the code twice (名称显示两个编号). The star button
  now sends the stock name along with the code, the watchlist table prefers
  the live quote name as a display fallback, and `/watchlist/add` also
  refreshes the stored name of existing entries when a real name is provided.

## [0.6.0] - 2026-09-02

### Added

- Multi-strategy intersection screener mode (多策略交叉选股): run 7 preset
  strategies (MACD金叉 / 均线多头 / 放量突破 / 超卖反弹 / 趋势转强 / 创60日新高 /
  强势连涨) simultaneously and show stocks that hit ≥ N strategies, sorted by
  hit count then score. The screener tab now has a mode toggle between
  "评分选股" (standard weighted-score) and "多策略交叉" (multi-strategy
  intersection). A new `minStrategyHits` parameter controls the hit threshold.

## [0.5.0] - 2026-08-31

### Added

- Market sentiment thermometer (市场情绪温度计): the market tab now shows
  up/down/limit-up/limit-down/broken-board counts, a consecutive-board ladder
  (连板梯队, 2板/3板/… with counts), the highest board, and an expandable
  limit-up pool list (name, board count, industry; click to open the detail
  popup). New `/api/leekbox/sentiment` payload with `up/down/flat`, `broken`,
  `ladder`, `maxBoard` and `ztList` from the Eastmoney topic pools plus
  whole-market breadth.
- ETF / 可转债 / LOF support:
  - Rank pool selector in the market tab: 沪深A股 / ETF·场内基金 / 可转债 /
    LOF (Eastmoney `b:MK0021` / `b:MK0354` / `m:1+t:5,m:0+t:10`), reusing the
    existing rank route with a `node` parameter.
  - `normalizeCode` now accepts 5-digit codes (ETF/LOF) and maps 11xxxx
    (沪市可转债) to `sh`, so ETF/bond codes work in watchlist, quote, kline
    and search.
  - Search now returns A-share stocks, on-exchange funds (ETF/LOF, Classify
    `Fund`) and convertible bonds (Classify `Bond`) instead of stocks only.

## [0.4.0] - 2026-08-31

### Added

- Watchlist import/export: export the watchlist as a JSON backup (group-aware,
  re-importable) or as UTF-8 CSV for Excel/WPS; import from JSON, CSV or plain
  pasted text (one stock per line, `code[,name[,group]]`, quoted cells and a
  `code`/`代码` header row tolerated). Two modes: merge (skip duplicates,
  default) and replace (with a client-side confirmation). Imported codes are
  normalized the same way as manual adds, invalid lines are reported back.
- Toolbar row in the watchlist tab with 导入 / 覆盖导入 / 导出 JSON / 导出 CSV
  buttons and a status line; the toolbar is also available when the watchlist
  is empty.

### Fixed

- `normalizeCode` had its function body jammed onto the signature line.
- `writeWatchlist` failure path contained dead code (a no-op `require` check)
  that never cleaned up the leftover `.tmp` file; it now unlinks it.
- Row-level open-detail clicks no longer fire when the click lands on an
  interactive child: changing the group `<select>` in the watchlist (or any
  future select/button inside a quote row) no longer pops the detail window.

## [0.2.0] - 2026-08-26

### Added

- Stock detail popup windows (THS-style): draggable, stackable, ESC / backdrop
  layer-by-layer close; opened by clicking a stock name in any tab including the
  watchlist.
- Candlestick K-line chart with forward-adjusted data (qfq), MA5/10/20 overlays,
  volume subchart, last-price dashed line and a hover crosshair legend.
- Multi-source 7x24 news feed: Sina zhibo + Eastmoney fast news + Jin10 flashes,
  merged newest-first with per-source filter chips and source badges.
- Important-news highlighting: official flags (Jin10 star / Sina focus) plus a
  keyword fallback (突发/重磅/重大/紧急/超预期).
- Screener UI redesign: segmented pool picker, range inputs, grouped technical
  signals with per-group counters, gradient run button, rank medals and score
  tier pills in results.

### Changed

- Main panel window title shortened to 韭菜盒子.

### Removed

- Intraday minute chart from the stock detail view (per user preference).

## [0.1.0] - 2026-08-25

### Added

- Initial release: realtime indices board, quote search + ranking tables,
  persisted watchlist, multi-signal screener with weighted scoring,
  Sina-only 7x24 news feed, stock detail page with minute chart and K-line.
