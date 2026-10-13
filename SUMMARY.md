# 量化因子选股功能集成总结

## 项目概述

成功将 aiwuchuan.com 的量化因子选股系统逆向工程并集成到 dsh-leekbox 的选股 tab 中。

## 完成的工作

### 1. 后端实现

#### 1.1 技术指标扩展 (lib/indicators.js)
新增 5 个技术指标计算函数：
- `trueRange()` - 真实波幅
- `atr()` - 平均真实波幅 (ATR)
- `tdSequence()` - TD序列计数
- `candlePatterns()` - K线形态识别
- `vwap()` - 成交量加权平均价

#### 1.2 量化因子系统 (lib/signals.js)
- 定义 30+ 个量化因子，分为 8 个分组
- 实现 `computeQuantFactors()` 计算所有因子
- 实现 `evaluateFactorCondition()` 评估条件
- 实现 `matchesFactorPreset()` 匹配预设策略
- 新增 `FACTOR_BOOL_KEYS` 区分布尔因子和数值因子
- 新增 `countFactorHits()` 和 `hitFactorKeys()` 辅助函数

#### 1.3 筛选引擎 (lib/screener.js)
- 扩展 `buildResultRow()` 支持 factor 模式
- 实现预设组合匹配逻辑
- 实现必选因子验证
- 实现因子得分计算（仅计算布尔因子）

#### 1.4 参数验证 (lib/screener-validate.js)
- 新增 factor 模式参数验证
- 支持 `factorPresets`、`factorRequire`、`minFactorPresets`、`minFactorScore`

#### 1.5 缓存优化 (lib/screener-cache.js)
- 更新缓存键以包含因子模式参数

### 2. 前端实现

#### 2.1 UI 组件 (src/client/screener-tab.js)
- 新增「量化因子」模式切换按钮
- 实现预设组合选择面板
- 实现因子分组选择面板
- 实现因子得分阈值设置
- 更新结果表格显示命中因子
- 实现离线兜底数据

### 3. 测试验证

所有现有测试通过：
- ✅ 指标数学等价测试
- ✅ 选股缓存测试
- ✅ 元数据单一来源测试
- ✅ 客户端 bundle 契约测试
- ✅ 端到端路由测试
- ✅ 交易日历测试
- ✅ 缓存/单飞/写接口加固测试

## 技术亮点

### 1. 因子分类体系
- **价格位置** (price): 均线突破类因子
- **动量指标** (momentum): RSI、MACD、KDJ 等
- **波动率** (volatility): ATR、布林带等
- **成交量** (volume): 放量、缩量等
- **形态识别** (pattern): K线形态
- **TD序列** (td): DeMark 序列计数
- **VWAP** (vwap): 成交量加权平均价
- **数值因子** (numeric): 用于条件 DSL

### 2. 预设组合策略
- 趋势跟踪: MA20+MA60+MACD金叉+放量
- 超卖反弹: RSI超卖+长下影+早晨之星
- 突破形态: 布林收口+放量+MA20突破
- 均值回归: 贴近MA20+低ATR+缩量
- 强势动量: RSI超买+放量+MA5+MA10+MA20

### 3. 条件 DSL 设计
借鉴 aiwuchuan.com 的设计：
- 支持简单条件：`{field, op, value}`
- 支持列间比较：`{field, op: "col_gt", value: "ema_26"}`
- 支持滚动窗口：`{type: "rolling_*", window, op, value}`

### 4. 评分机制
- 仅计算布尔型因子的命中数
- 数值因子不参与评分（避免误判）
- 支持设置最低因子得分阈值

## 文件清单

### 修改的文件
1. `lib/indicators.js` - 新增 5 个技术指标函数
2. `lib/signals.js` - 新增量化因子系统
3. `lib/screener.js` - 扩展筛选引擎支持 factor 模式
4. `lib/screener-validate.js` - 新增 factor 模式参数验证
5. `lib/screener-cache.js` - 更新缓存键
6. `src/client/screener-tab.js` - 新增量化因子 UI

### 生成的文件
1. `lib/client.js` - 重新构建的客户端 bundle (189.9kb)
2. `QUANT_FACTOR_INTEGRATION.md` - 集成报告

## 使用方法

### 启动服务
```bash
cd D:\code\tst-pl\dsh-leekbox
npm run build
npm start
```

### 使用量化因子选股
1. 打开浏览器访问 http://127.0.0.1:7890
2. 点击左侧「选股」tab
3. 点击「量化因子」模式按钮
4. 选择预设组合（可选）
5. 勾选必选因子（可选）
6. 设置因子得分阈值（可选）
7. 点击「开始选股」

## 后续优化建议

1. **条件 DSL 完善** - 实现数值因子的条件筛选 UI
2. **因子权重** - 支持为不同因子设置权重
3. **因子组合保存** - 支持保存用户自定义的因子组合
4. **因子回测** - 支持对因子组合进行历史回测
5. **因子相关性分析** - 分析因子之间的相关性

## 参考文档

- [逆向分析报告.md](file:///D:/code/tst-pl/aiwuchuan_re/逆向分析报告.md) - aiwuchuan.com 逆向分析
- [实现模板.ts](file:///D:/code/tst-pl/aiwuchuan_re/实现模板.ts) - TypeScript 实现模板
- [QUANT_FACTOR_INTEGRATION.md](file:///D:/code/tst-pl/dsh-leekbox/QUANT_FACTOR_INTEGRATION.md) - 详细集成报告

## 总结

成功完成量化因子选股功能的集成，新增 30+ 个量化因子、8 个分组、5 个预设组合。前端 UI 支持因子选择和预设组合选择，后端实现了完整的筛选逻辑。所有测试通过，功能可用。
