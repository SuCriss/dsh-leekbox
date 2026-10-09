# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- **客户端拆分为多文件源码 + esbuild 构建链**：3661 行的 `lib/client.js` 单文件按原 region 边界拆成 `src/client/` 下 14 个职责文件（react 桥接 / 样式 / API 与格式化 core / 星标 / 情绪仪表 / 大盘·行情·自选·选股·快讯五个页签 / 个股详情弹窗 / 主面板 / 侧边栏入口 / 插件入口），`build.mjs` 用 esbuild 打包回单文件产物——react / react-dom/client 保持 external（宿主 ModuleLoader 注入，杜绝双 React），产物继续提交进仓库，`npm run build` 重建、`npm run dev` watch。跨页签复用的 `fmtYi`（元→亿）上移到 core，顺带发现并删掉了从未使用的 `useMemo` 解构。运行时依赖依旧为零，esbuild 仅 devDependencies。

### Fixed

- **CI 的测试清单手抄漂移**：`ci.yml` 的 `unit-tests` job 把 `package.json` 的 `scripts.test` 手抄了一遍，抄漏 3 个——`p0-position-alerts-test.mjs`（持仓/预警写锁端到端）、`p0-minute-fflow-test.mjs`（分时+资金流数据形状）、`p1-f10-longhu-test.mjs`（F10/龙虎榜字段映射）。它们在本地 `npm test` 一直是绿的，却从未在 CI 上跑过，等于 P0/P1 那几批改动少了 CI 保护。现在该 job 直接 `npm test`，`scripts.test` 成为唯一来源，新增测试不再需要同步改 workflow。

### Tests

- 新增 `client-bundle-test.mjs` 并接入 `npm test`（15 → 16 个）：桩 React 跑 factory，卡住产物契约——ModuleLoader 包装 / 插件 id / `require("react")` 各恰 1 处未内联 / 导出 `{apply, inject}`。
- 抽产物源码的三个测试锚点改为与 bundler 无关的形式：esbuild 会把模块顶层 `const` 降级为 `var` 并剥离注释，`sentiment-score-test.mjs` 的注释锚点改为 `function SentimentCard(`，`error-text-test.mjs` / `screener-meta-test.mjs` 的锚点去掉 `const` 前缀（后者 end 锚点按整条声明语句对齐，避免 dangling `var`）。
- CI 新增 `client-bundle` job：`npm ci`（lockfile 已入库，npm 缓存恢复）→ `npm run build` → `git diff --exit-code`，提交过时产物直接红。

## [0.10.0] - 2026-10-09

### Added

- **个股 F10 财务摘要**：个股详情弹窗在资金流向之后新增「财务摘要」卡片——最近 8 个报告期的 营收/归母净利（亿元）+ 同比、ROE（加权）、销售毛利率、资产负债率、基本每股收益，最新报告期在前。数据走东财 F10 datacenter 报表（`RPT_F10_FINANCE_MAINFINADATA`，字段形状已对 live API 核验），新 `fetchEmF10Main()`（双主机回退 + 退避重试，SECUCODE 过滤支持 sh/sz/bj）与 `GET /api/leekbox/f10` 路由（财报低频变化：每 code 缓存 1 小时，LRU 上限 80 只）；取数失败静默——财务面是增强信息，不挡主行情。

### Changed

- **自选股 / 预警写操作串行化**：add/remove/import 与预警 add/remove 都是"读→改→写"三步，原子改名只能防文件写坏、防不了并发丢更新。新增 `makeListLock()` 写锁（Promise 链），自选股与预警各自的 mutation 全部串行执行——每个读改写周期看到上一个的结果，抛错的 mutation 不断链。`/watchlist/add` 的参数校验与 `/import` 的解析留在锁外，400 分流不受影响；预警的去重/上限检查移入锁内（否则两个并发 add 会双双通过检查）。

### Tests

- 新增 `p1-f10-longhu-test.mjs` 并接入 `npm test`（14 → 15 个）：F10 字段映射与 live API 形状逐字段对齐（含 bj 代码 `.BJ` SECUCODE、负同比保留符号、中文错误文案）、`/f10` 每 code 缓存命中零重取、`/longhu` 榜单行形状与当日数据首试即中。
- `p0-position-alerts-test.mjs` 补第 6 节：20 个并发 add（不同代码）全部落盘且每个响应反映自己的新增——写锁的并发不变量回归。

## [0.9.0] - 2026-10-08

### Added

- **当日分时图**：个股详情弹窗的「分时」周期不再复用 1 分钟 K 线柄，改为走专用 `GET /api/leekbox/minute`（此前该路由已取数但前端从未消费），新 `MinuteChart` 组件画出标准分时形态：价格线 + 均价线（成交量加权累计均价 Σ价×量/Σ量，不依赖 amount 字段的单位约定）+ 成交量柱（按逐刻涨跌着色）+ 昨收虚线基准，右侧标注相对昨收的涨跌幅，悬停浮窗带时间/价/均/幅/量。
- **资金流向柱状图**：个股详情弹窗在资金流分明细表之上新增 `FflowChart`——最近 15 日主力净流入柱状图（流入红/流出绿，零轴基准，悬停高亮并显示当日净流入额）；明细表保留最近 8 日。
- **持仓成本与实时盈亏**：自选股条目支持 `qty`（股数）与 `cost`（成本价）字段——表格新增 持仓/成本（点击单元格内联编辑：Enter/失焦保存、Esc 取消、清空即清除，服务端校验）与 盈亏（按现价实时计算浮动盈亏额 + 收益率）两列；设有完整持仓时表格上方显示汇总条（持仓只数 / 市值 / 成本 / 浮动盈亏 / 总收益率）。导出 CSV/JSON 携带持仓字段，导入（CSV `code,name,group,qty,cost` 列与 JSON 行）同样解析；坏 qty/cost 字段丢弃而不拒绝整只股票。
- **价格预警**：自选股表格行内 🔔 按钮为个股设置预警（价格涨到 / 价格跌破 / 涨幅达到 / 跌幅达到），新存储文件 `.leekbox-alerts.json`（与自选股同一套"临时文件 + 原子改名"写法）与三条路由（`GET /api/leekbox/alerts` 列表、`POST .../add`、`POST .../remove`；全量校验：类型白名单 / 代码归一化 / 指数拒绝 / 目标价与涨跌幅阈值范围 / 去重 / 100 条上限，错误文案中文）。新 `AlertWatcher` 挂在面板内与行情同一时钟轮询（仅交易时段、批量合并取价），触发后右下角 toast + 浏览器通知（权限在用户添加预警的手势内惰性申请）+ WebAudio 蜂鸣，并自动移除该条（一次性）；预警卡片在自选页统一管理（列表 + 删除）。`/health` 顺带带上预警条数。

### Fixed

- **显式清除持仓被误判为无效**：`POST /watchlist/add` 传 `qty: null`（清除已存股数）原先与解析失败落入同一 400 分支，持仓一旦设置就无法清除；现区分"显式 null = 清除"与"校验失败 = 400"。

### Tests

- 新增 2 个无网络回归测试并接入 `npm test`（12 → 14 个）：`p0-position-alerts-test.mjs`（真实路由 handler 端到端：持仓存/改/清/校验 400、CSV/JSON 导入导出携带持仓字段、预警增删/去重/全量校验/非回环 403、health 双计数）、`p0-minute-fflow-test.mjs`（stub 上游驱动真实 minute/fflow handler，锁定新图表消费的数据形状契约）。

## [0.8.13] - 2026-10-07

### Changed

- **版本号对齐发布**：`v0.8.12` 的 tag 是在 CI 修复提交（`ad52a79`）之后才创建的，那次发版号的 release 说明里虽然写了 CI 修复，但版本号本身没有独立覆盖它的发布记录。本次 bump 到 `0.8.13` 把 CI 修复单独作为一个可见版本发布；代码与 `v0.8.12` 完全一致（两者 diff 仅含版本号与 CHANGELOG）。

## [0.8.12] - 2026-10-07

### Changed

- **选股模块按职责拆分**：原 722 行的 `lib/screener.js` 一个文件承担了股票池、K线取数、指标数学、信号、策略、结果缓存、进度与编排 8 件事。现拆为 5 个文件，`lib/screener.js` 保留为对外门面（`runScreener` / `screenerProgress` / `screenerCacheStats` / `klineCacheStats` / `screenerMeta` 签名与返回字段不变）：
  - `lib/indicators.js` — 纯指标数学，无 I/O、无状态
  - `lib/signals.js` — 信号与策略的唯一定义处（权重/分组/文案/策略组成）+ 打分
  - `lib/screener-cache.js` — 结果缓存与日K缓存（含自适应 TTL）
  - `lib/screener-validate.js` — 参数归一化 + 带 `error.code` 的校验异常
  - `lib/screener.js` — 编排层（股票池 / 取数 / 过滤 / 排序 / 进度）
- **路由不再自己抄一份参数表**：`POST /api/leekbox/screener` 原先在 `lib/index.js` 里重复实现了一遍字段清洗与默认值（与引擎各存一份，易漂移），现统一由 `screener-validate.js` 归一化，路由只做白名单过滤。

### Added

- **`GET /api/leekbox/screener/meta`**：下发信号/策略元数据（key、label、weight、group、desc、策略组成）。前端据此渲染勾选面板，服务端新增信号或改权重时界面自动跟随；客户端保留离线兜底副本，接口不可用时仍能渲染面板。

### Fixed

- **自适应 K 线 TTL 的批次计数永不归零**：`adjustKlineTTL()` 在查找次数不足 `TTL_BATCH_SIZE` 时提前 `return`，导致 `ttlHits`/`ttlMisses` 跨批次持续累积、`reuseEma` 永远算不出来。现改为累积到满一批才评估并归零，并补上"冷启动批次不得缩短 TTL"的回归测试。
- **结果缓存统计语义**：写入缓存时累加的是 `misses`，把"写"记成了"未命中"。现拆出 `stores`（`misses` 字段为兼容旧监控面板保留同值），并新增 `evictions`。
- **结果缓存淘汰不是 LRU**：原先按插入顺序 `shift()`，命中不回迁位置，热键会被冷键挤掉。现用 `Map` 实现真正的 LRU，并顺手摘除过期条目。
- **KDJ 与 BOLL 的 O(n²) 计算**：`kdj()` 每根 K 线都 slice 一次窗口再 spread 求 min/max，`boll()` 每个下标重算一遍方差。现分别改用单调队列与滚动 sum/sumSq，降为 O(n)；经 7.2 万采样点对比，最大绝对误差 2.5e-11（仅浮点累加误差）。`boll()` 同时把浮点误差导致的负方差钳到 0，避免 `sqrt(负数)` 顺着信号链污染评分。
- **路由靠正则匹配中文文案判 400**：`/^(未知|multi 模式)/` 一旦改动提示语就会让 400 静默退化成 502。现改为按 `error.code`（`screener_invalid_params` / `screener_already_running`）分流。

### Tests

- 新增 `indicators-equiv-test.mjs`（把重构前的 O(n²) 实现内联为参照物，4.5 万采样点逐点对比 kdj/boll；含"旧高点滑出窗口"的决定性断言与反证）、`kline-ttl-coldstart-test.mjs`（必须在全新进程验：复用率 EMA 是模块级状态）、`screener-meta-test.mjs`（抽取客户端真实 `buildScreenMeta` 源码跑断言，含"服务端新增信号自动出现在面板"与路由错误码分流端到端），并接入 `npm test`。
- CI 的 `node --check` 补全 4 个新模块（7 → 11 个），无网络套件补全 3 个新测试（9 → 12 个）——原先新模块与新测试都不在 CI 覆盖范围内。

## [0.8.11] - 2026-10-02

### Added

- **P0 宇宙增量刷新**：`GET /api/leekbox/universe?since=<builtAt>` 返回自上基线版本以来的增量（`added` 携带完整成形行、`removed` 为代码列表），基线缺失或超出保留的 10 个快照时以 412 `{ needsFullRefresh: true, currentBuiltAt }` 提示客户端回退全量；默认返回全量行，`?rows=false` 可只要元数据。`lib/search-index.js` 新增 `indexHistory` 快照环与 `getInstrumentIndexDelta()`（412 错误消息为中文、技术细节留 `reason`，与全仓错误文案约定一致）。
- **P1 选股结果缓存**：`runScreener` 按归一化参数（require/strategies 排序后序列化）做 LRU 结果缓存（上限 500 条、TTL 15 分钟），命中直接返回 `cacheHit: true` + "Cached result (N stocks)"，不再重复打行情源；新增 `screenerCacheStats()` 结构化出口（total/hits/misses/hitRate）。
- **P1 部分结果实时流出**：K 线抓取重构为逐到达评分（`fetchKlinesConcurrent(codes, onEach)`），每根序列取到即刻过 `scoreRow` 并推入 `_progress.partial`，前端轮询 progress 即可增量渲染，无需等整轮扫描结束。
- **P2 选股进度 SSE 流**：`GET /api/leekbox/screener/stream` 以 250ms 尾随共享进度快照（单飞扫描保证无需任务 id），变化即发 `progress` 事件，扫描结束发 `done`（失败发 `error`）；含 15s 心跳注释帧与 5 分钟硬寿命上限，防代理断连与空闲泄漏。

### Tests

- 新增 4 个无网络回归测试并接入 `npm test` 与 CI：`p0-universe-delta-test.mjs`（快照环 + 增量/412）、`p1-screener-cache-test.mjs`（缓存命中零 fetch + 深比较）、`p1-p2-stream-test.mjs`（partial 单调增长直至收敛）、`p2-sse-route-test.mjs`（真实路由 handler 端到端：progress/done 帧、非回环 403）。

## [0.8.7] - 2026-10-02

### Fixed

- **成交额显示缩小 100 倍**：A 股榜单表格列头「成交额」使用 `fmtAmount()` 时未乘 10000（服务端返回万元），导致显示为"50.00 万”而非“50.00 亿”，现统一转换为元单位。
- **自选股 >50 只行情静默丢失**：`/quote` 服务端保护栅栏限制单次请求 50 码，但自选列表无上限；此前超长部分永远无报价，现分片并发 fetch 再合并结果。
- **板块列表无法翻页**：sector 数据硬编码 `page=1&size=30`；新增 `sectorPage`/`sectorPageSize` 状态与分页 UI（首页/上一页/下一页/末页 + 每页条数选择）。
- **快速切换 stale response**：sector/longhu 加载时未做请求顺序守卫，板块 tab/龙虎榜 tab 快速切换会覆盖旧数据；news 双击"加载更多”也易重复请求。分别引入 `loadSeq`/`newsLoadSeq` 计数器守卫所有异步响应，more() 增加 loading 防抖判断。
- **ScreenerTab 定时器泄漏**：组件卸载时清空调度器未执行，持续轮询 `/progress`；现通过 ref 记录 ID 并在 useEffect cleanup 中清除。

### Security / CI / Tooling

- **CI 补全语法检查与行为测试**：加入 `lib/search-index.js` 至 `node --check`；PR/推送自动跑 4 个 stubbed 回归测试（verify-fixes/pinyin/news-dedup/sentiment-score/error-text）排除有网络依赖的 screener-test.mjs/rank-fallback-test.mjs。
- **本地脚本完善**：package.json 新增 `check`/`test` 二脚本。

## [0.8.10] - 2026-10-02

### Changed

- **K 线缓存 TTL 改为自适应**：原先是固定的 10 分钟常量，现按实测复用率动态调整（区间 5–30 分钟，起步 10 分钟）。连续扫描大量命中缓存说明扫描间隔够近，TTL 每次 ×1.25 上调；复用率掉下来说明缓存在过期数据上浪费请求，×0.8 下调。**冷启动不会被误缩**：首次扫描必然全 miss，若此时就缩 TTL 会形成"越缩越 miss"的死亡螺旋，因此下调前要求复用率 EMA 已见过真实复用（`MIN_BATCH_REUSES`），每 200 次 lookup 才评估一次以免单轮扫描抖动控制器。
- 新增 `klineCacheStats()` 导出，供 `/meta` 与调试读取当前 TTL、批内命中率与复用率 EMA。缓存评估走结构化出口而非日志，日志通道保持干净。

## [0.8.9] - 2026-10-02

### Fixed

- **选股池并发翻页产生重复行**：`buildUniverse` 以 5 页并发拉取，成交额排名在翻页间隙漂移会让同一只股票落进两页。重复行既浪费 K 线请求（每股一次），又让 `slice(limit)` 少给几只票。现按 code 去重并保留首次出现的条目（页序即金额序，即排名更靠前的那次）。
- **`/rank` 日志通道**：失败分支此前把用户可见文案写进 `console.error`，与全仓约定的日志通道不一致。现改走注入的 `logger.warn`，内容用 `errorDetail()` 的技术细节（host/node/sort），中文用户文案仍只在响应的 `error` 字段里。

### CI / Tooling

- **verify-fixes.mjs C 段不再碰真实网络**：`/search` 冷启动超时用例此前会打到东财 suggest 线上接口，CI 里既慢又可能因限流抖动。现在 push2（指数构建）挂起以触发 3s 超时、suggest 返回桩数据、其余源一律抛错，并断言 hits 的形状（code/name/market）。挂起请求的计时器在段尾统一清除，避免 60s 计时器把测试进程拖住。
- **screener-test.mjs 补断言与退出码**：此前只有 `console.log`，无论结果如何都返回 0，CI 看不出失败。现引入 `check()` 计数 scanned/candidates/computed/matched 之间的子集关系与逐行必填字段，失败置 `process.exitCode = 1`。耗时断言改用实测墙钟时间——`result.elapsed` 是 `"35s"` 这样的带单位字符串，拿它和毫秒阈值比较永远为 false。
- **CI 加固**：`syntax-check`/`unit-tests`/`manifest` 拆成三个并行 job，各自加 `timeout-minutes`；`concurrency` 配 `cancel-in-progress` 让同分支的新推送作废旧运行；权限收紧为 `contents: read`；`setup-node` 开启 npm 缓存。

### Release

- 纠正 v0.8.9 标签发布时 package.json 未同步 bump 的版本不一致（当时仍停在 0.8.8），本版补上。
- 纠正 v0.8.9 把 `/rank` 的 `reason` 字段一并改成中文用户文案的失误：`reason` 是给排查用的技术细节通道（`errorDetail()`），应与 `logger.warn` 写进日志的内容一致；浏览器渲染的是 `error` 字段，`reason` 里塞中文并没有帮助用户，反而丢了定位上游哪个 host 挂掉的信息。现在 `error` 中文 / `reason` 技术细节 / 日志同一条技术细节，三者各归其位。

## [0.8.8] - 2026-10-02

### Fixed

- **v0.8.7 release 版本不一致**：release commit 漏 bump package.json 版本号，导致 tag v0.8.7 对应的实际代码仍是 0.8.6；同时 CHANGELOG 错误声称新增 `audit` 脚本。本发布纠正两者：版本 bump 到 0.8.8，CHANGELOG 更正为仅含 check/test 二脚本。
- **资金流向字段错位**：lib/emrank.js 的 fflow kline 响应体中资金流顺序应为 date/main/xl/big/middle/small，原代码将 middle↔xl/big 位置互换，导致用户端柱状图中"中单/小单"完全颠倒；现已按 EM API 实际顺序修正映射。

## [0.8.6] - 2026-09-23

### Fixed

- **数据取不到时报英文文案**：客户端把响应体里的 `error` 字段**原样渲染**到红色错误条上，而服务端一路抛的都是英文——`rank feed unavailable`、`all news feeds unavailable`、`instrument index: first page failed`、`expected ?code=sh600519` 等等。用户在行情页/板块页/快讯页/自选页看到的报错全是英文，既不知道是哪个榜挂了，也不知道要不要重试。现在从两端一起堵住：
  - **服务端新增报错约定**（`lib/fetch-utils.js` 的 `feedError(message, detail)` / `userMessage(error)` / `errorDetail(error)`）：`message` 是给用户看的中文，一句话说清"什么没取到、要不要重试"；`detail` 是 host / node / sort / 上游字段名这类排查用的技术细节，**只进日志**（`fail()` 会写进响应的 `reason` 字段，界面不渲染它）。`lib/emrank.js`、`lib/index.js`、`lib/search-index.js`、`lib/screener.js` 里所有能透到浏览器的文案按这条约定改完，报错还会**点名是哪一个榜**：`主板榜暂时取不到：行情主源不可用，备用源没有这一项。请稍后重试或换个榜单看`、`主力净流入榜暂时取不到：…`，而不是原来那句看不出所以然的 `rank feed unavailable`。
  - **服务端出口兜底**：`/rank`、`fail()` 等所有失败出口一律过 `userMessage()`——漏翻的英文（Node 内建 `ENOENT`/`ECONNRESET`、第三方库异常、上游直接透传）会被换成通用中文，真正原因留在 `reason` 里。也就是说**即使以后再有人写出英文文案，界面也不会漏出去**。
  - **客户端兜住浏览器自己的报错**（`lib/client.js` 新增 `describeError()`）：以前 `fetch` 断网抛的 `TypeError: Failed to fetch`、超时中止抛的 `The operation was aborted.`、以及非 JSON 响应的兜底 `HTTP 502`，都会原封不动显示给用户。现在统一映射为「网络连接失败，请检查网络后重试」/「请求超时，请稍后重试」/「服务返回异常（HTTP 502）」，被替换掉的原文写进 `console.warn` 便于排查。`api()` 现在是最后一道闸：服务端漏翻的英文也会在这里被换成中文并带上状态码。13 处错误展示点（指数/榜单/板块/龙虎榜/自选/选股/快讯/个股详情/K线弹窗/导出）全部改走 `describeError`。
  - **选股"任务已在运行"改用错误码判定**：`/screener` 路由此前靠正则匹配英文 `already running` 决定回 409；文案改中文后这类匹配会静默失效，改为 `error.code === "screener_already_running"`（保留正则兜底）。

### Added

- `error-text-test.mjs`：报错文案中文化的回归测试（59 项断言，无网络）。静态扫描服务端所有 4xx/5xx 响应的 `error` 字段必须是中文（动态拼接的必须过 `userMessage()`），抽取 `lib/client.js` 里**真实的那份** `describeError` 源码跑行为断言（断网/超时/HTTP 码/中文透传/未知英文），并断言"任何输出都不含纯英文"、客户端无 `setError(e.message)` 直通。

### Changed

- `verify-fixes.mjs`：新增 D3/D4 —— 直接驱动 `/rank` 路由断言**上游整体挂掉时 `error` 是纯中文、`reason` 保留技术细节**（这条正是本次修复的端到端验证）。同时修掉一个测试自身的坑：`lib/emrank.js` 的 clist 冷却窗口是模块级状态，前半段跑过真实网络后它一直生效，把后面用 stub 的 D1/D2 挡在 `fetch` 之前，导致「行映射」用例被误判成失败、脚本中途抛错（此前靠 60s 冷却自然到期，稳定性看运气）。现在 `lib/emrank.js` 导出 `resetClistCooldownForTests()`，测试显式复位，全套 21 项断言可稳定跑完。

## [0.8.5] - 2026-09-22

### Fixed

- **行情页整页取不到数（`rank feed unavailable`）**：东财对 clist 路由做**按出口 IP 的限流**——该路由返回 nginx 502（直连则是 TCP reset），而**同一主机**的其它路由（`ulist.np` / `stock/get` / `push2ex`）照常 200。实测 2026-09-22：push2 / push2delay / 全部编号镜像连续 20 分钟以上 502，而同一个 URL 经第三方中转（不同出口 IP）返回 200 且数据完整——所以既不是源站宕机，也不是参数写错。clist 是 rank / 板块 / 选股股票池 / 涨跌家数的共同上游，一处被限流就全线断供。
  - 新增 `lib/sinarank.js` 备用源（新浪 `Market_Center`，返回同一套 legacy 行形状），`fetchEmRankPage` / `fetchEmSectorPage` 改为「东财优先 → 新浪兜底」。单位已用东财 `stock/get` 逐字段校准：`volume` 股→手（÷100）、`amount` 元→万元（÷1e4）、`mktcap`/`nmc` 本就是万元（1:1）、价格/涨跌幅/换手/pe/pb 1:1。覆盖 `hs_a / sh_a / sz_a / cyb / kcb / etf`。
  - 新增 clist 熔断（60s 冷却）：clist 一挂就跳过重试，避免每次刷新都白等超时；冷却到期自动回探，东财一恢复就切回（它是 `主力净流入` 的唯一来源）。
  - **备用源覆盖不到的部分明确报错而不是返回错数据**：`main` / `non_main` / `cb` / `lof` 四个池子新浪没有对应 node，`sort=netflow` 新浪没有该列，板块的 `f62` 排序同理——这些请求会带上原因失败。
  - `/rank` 路由原本是**空 `catch`**，上游为什么挂完全看不到；现在记录原因并在响应里带 `reason` 字段。
- **涨跌家数改走指数快照，单次请求取代 56 页全市场翻页**：`fetchEmBreadth` 此前逐页翻完 clist 全市场（`pz=100` → 56 个请求/次，14 并发），这个请求量正是触发上述 IP 限流的原因。现改用 `ulist.np` 的 `f104/f105/f106`（上证指数 + 深证成指 + 北证50 = 沪 + 深 + 北交所全量，实测 2319 + 2902 + 345 = 5566 家），**1 个请求**搞定，同时不再依赖被限流的 clist。失败语义不变：取不到就抛错，绝不返回假的 0/0。

### Added

- `rank-fallback-test.mjs`：16 项断言。含以 `stock/get` 为真值的单位校验（价格/成交量/成交额/总市值/流通市值逐字段比对），以及"覆盖不到的池子必须报错而非返回错数据"的负向断言。

## [0.8.4] - 2026-09-11

### Fixed

- **7x24 快讯跨源重复**：跨源去重此前只做"去标点后前 24 字符精确前缀"匹配——两家源对同一事件的措辞稍有差异（多"中国"二字、换动词、多一句补充）即漏判，同一事件以不同来源标签重复出现。现在改为三层判定：①全文归一化精确匹配 → ②前缀包含（一源截断/扩写另一源的标题）→ ③10 分钟时间窗内的字符二元组相似度（共享二元组 ≥ 6 且 Jaccard ≥ 0.55 或包含率 ≥ 0.75），窗外与对立方向（增加/减少）的相似模板仍保留为独立条目；合并保留首个（信息最全）副本，被丢弃副本的重要标记（如金十星标）继承给保留项。前端「加载更多」追加分页时再按 id+归一化文本过滤，避免源流移动导致翻页边界重复。新增 `news-dedup-test.mjs` 回归（12 项断言，纯 stub 无网络）。

## [0.8.3] - 2026-09-11

### Fixed

- **拼音首字母搜索大面积失配**：`x` 档边界字由`昔`改为`夕`（此前`西`整族 xi 音字被归入 w 桶——陕西煤业/山西汾酒/江西铜业/西藏矿业等搜不到），边界判定改为闭区间语义（边界字自身不再落错桶）；多音字按股票名实际读音索引——`行`→háng（招商银行 `zsyh`、34/36 银行股此前全错）、`长`→cháng（长江电力 `cjdl`）、`厦`→xià（厦门）、`藏`→zàng（西藏）；`重`双读音（重庆 chóng / 三一重工 zhòng 都常见）引入第二变读音 `abbr2` 参与同级匹配，两种拼法均能命中。新增 `pinyin-test.mjs` 回归（41 名称/边界用例 + 11 匹配用例）。
- **选股股票池静默截断**：`buildUniverse` 此前把单个分页失败当作"列表结束"——54 页中第 7 页一次瞬时 502 会把全市场 5400 只截成 600 只并当成功缓存；现在失败页跳过并自动补抓一轮、按页序拼接（保住"成交额前 N"语义），仅真正的空页/短页终止遍历，全源不可用时明确报错而非返回"0 只匹配"。
- **选股熔断后孤儿 worker**：限流中止 throw 后其余 4 个 worker 此前继续消费队列（继续轰击已限流的源站、可与新扫描并发写进度）；现在 trip 时先置 `aborted` 标志，幸存 worker 立即收工。
- **选股参数静默空结果**：未知技术信号键（`macd`≠`macdGold`）、未知策略键、multi 模式空策略列表此前会爬完全市场后返回 `matched:0` 的"成功"；现在在进入任何网络请求前 fail fast，`/screener` 路由返回 400 与具体原因；`minStrategyHits` 钳位到 `[1, 已选策略数]`，不再出现恒空或退化为"全部命中"。
- **指数弹窗可加自选**：上证/深证/北证指数代码弹出的详情窗此前按个股渲染——提供 ☆ 加自选（服务端照单全收，指数被写进自选股文件）并显示无意义的涨停/跌停；现在指数窗显示「指数」标签并隐藏加自选/涨跌停，服务端 `/watchlist/add` 对指数代码返回 400、导入一律记为无效（`sz000001` 平安银行等深市个股不受影响）。
- **确认框永久卡死**：确认框开着时关闭面板，模块级 `confirmState` 不复位——此后所有 `lkbConfirm` 静默返回 false，星标/覆盖导入直到刷新页面都无反应；现在面板卸载时取消挂起的确认框。
- **搜索冷启动长时间阻塞**：本地索引未就绪时 `/search` 会无超时等待索引构建（源站挂起时实测 12s 未返回，最坏 ~3 分钟），而路由里的 2.5s 行情 race 罩不住它；现在索引等待加 3s 超时，超时降级走原有 searchadapter 兜底，构建仍在后台继续。
- **主力净流入榜名不副实**：`sort=netflow` 排序生效但 `f62` 从未进入 fields/行映射/响应/表格——整榜"按隐形数字排序"；现在全链路打通：clist fields 增加 `f62`，行映射 `netflow`，`/rank` 透传，榜单表格新增「主力净流入」列（红绿着色，基金/转债无此数据显示"—"）。

### Added

- **测试脚本**：`pinyin-test.mjs`（拼音首字母回归）与 `verify-fixes.mjs`（本轮 8 项修复的 18 项行为断言，全 stub 无网络依赖）。

## [0.8.2] - 2026-09-10

### Docs

- **声明宿主要求**：README（中/英）新增「环境要求」小节——DeepSeek Harness (DSH) **≥ 0.1.1-rc.1**（`dsh.engines.dsh`），仅运行于 **web profile**（`dsh.client.platform: "web"`），浏览器端经同源 `/api/leekbox/*` 访问（仅限 loopback）。仅文档变更，代码无改动。

## [0.8.1] - 2026-09-10

### Changed

- **行情数据只在交易时段轮询**：新增 `useTradingInterval`（交易判定复用 `marketOpenLabel`：
  周一~周五 9:30–11:30 / 13:00–15:00），大盘指数（30s）、行情榜单（60s）、市场情绪（60s）、
  自选行情（15s）与个股详情弹窗报价（10s）全部改为仅交易中自动刷新；非交易时段不再重复
  请求，打开页面/弹窗时的一次拉取即为终值。定时器保持空转，跨开盘边界（如 09:15 打开
  面板）会在 09:30 自动进入轮询。7x24 快讯轮询与面板自选星标同步不受影响。

## [0.8.0] - 2026-09-10

### Added

- **大盘页新增「市场情绪」温度计卡**：大盘页新增独立情绪卡（置于指数卡之后）——左
  侧半圆分段仪表盘呈现综合情绪温度 0~100°（市场宽度 40% + 涨停强
  度 25% + 封板率 20% + 连板高度 15% 加权，单路数据缺失按剩余权重归一），五档色
  弧段（冰点绿→沸腾红）当前档位满亮、其余压暗，游标点随分数平滑转动，配大号分数
  与冰点→沸腾五档着色徽标（含解读 tooltip）；右侧为无框编辑式数据行（细分隔线代
  替灰格子）：上涨/下跌（附红绿占比微条）、涨停/跌停、炸板、封板率（≥70% 染红、
  <50% 染绿）、最高板。60 秒自动刷新，复用 localStorage 即写即显缓存，全量暗色
  主题适配。服务端 `/api/leekbox/sentiment` 响应补充 `date` 字段（涨停池数据日期）。

### Changed

- **行情页视觉重绘**：三个榜单页签改用与选股页同款的胶囊分段控件（并合并原先重复
  的两套 `.lkb-seg` 样式）；市场/榜单/板块筛选 chip 改为描边样式，悬停与选中反馈
  更清晰；榜单表格表头改小号加字距排版，行悬停出现左侧主题色指示条，股票榜前三名
  显示金/银/铜奖牌色排名（与选股页排名语言一致）；翻页/切榜时数据行错峰淡入（同
  键刷新不重播，不闪屏）；输入框聚焦光环、置顶区底部分隔线等细节统一。数据与交互
  逻辑不变。

### Removed

- **行情页市场情绪信息条**：顶部「上涨/下跌宽度条 + 涨停 / 跌停 / 炸板 / 全市场」
  单元格整块移除，情绪看板统一收敛到大盘页温度计卡；行情页连板梯队与涨停池列表
  保留，服务端 `/api/leekbox/sentiment` 不变。

### Fixed

- **涨跌家数不再显示假的 0**：夜间/源站异常时 `push2` clist 全部超时，
  `fetchEmBreadth` 此前会静默返回 `up:0, down:0` 被温度计照常渲染。现在首页两轮
  全失败直接抛错，`/sentiment` 路由降级为 `null`，前端显示"—"且情绪分自动按剩余
  权重归一；同时 clist 单次超时 5s→8s、镜像顺序调整（push2delay 提前）、失败后
  60 秒内快速失败，不再拖慢轮询。

## [0.7.5] - 2026-09-09

### Changed

- **行情页 UI 重构（报价板风格）**：市场情绪由六个同形胶囊改为信息条——新增涨跌
  家数宽度条（红绿占比一秒读出强弱，悬停显示具体家数），涨停/跌停/炸板/全市场改
  为大号等宽数字单元格；筛选行增加「市场 / 榜单 / 板块 / 排序」分组标签，板块文
  案精简；股票/板块/龙虎三张榜单的涨跌幅改为红绿色块单元格（一行一个主信号），
  股票榜新增跨页连续名次列；大盘指数卡片增加方向色条与涨跌箭头；全部带暗色主题
  适配。
- **行情页情绪数据提速**：服务端涨跌停池与全市场涨跌家数两路数据源由串行改为并
  发；涨跌家数分页抓取并发 8→14 页/批、单页超时 8s→5s（约 55 页批次从 7 轮降到
  4 轮）；去掉一次只为取全市场总数的冗余榜单请求（复用宽度数据自带 total）；宽
  度抓取失败降级为空值，不再拖垮整条情绪数据。客户端情绪数据写入 localStorage，
  重开面板先渲染上次数据再后台刷新（即写即显），不再长时间显示"—"。

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
