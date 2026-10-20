# RiverLab Crypto Lab 执行计划

基线：[原始规划 v0.1](docs/product-plan-v0.1.md) 完整保留。2026-10-19 用户确认 Phase 0 验收和 Windows Edge/Chrome 本地测试通过，PR #1 已合并为 6ffe6a3186699ae85a26331efa932c3bcec500a2（北京时间 17:57:48）。M0 通过；具体浏览器版本和逐项结果未提供，不补写。

当前授权 **Phase 2B**。已 fetch origin/main，核实 PR #4 merged=true，实际合并 a7b57cbecf7b25cd50da6647426e99ca6738dfa5（UTC 2026-10-19 15:49:17）。分支 feat/phase-2b-strategies-risk，[PR #5](https://github.com/meredithfyc1001/riverlab-crypto-lab/pull/5)已创建并保持Draft待审；不修改 main、不合并、发布或部署。

## Phase 2 拆分与当前行动

- **2A 已合并**：确定性事件/下一根开盘成交/BigInt 账本、固定信号参考、可复现身份和数据质量阻断。最终 CI run 39277844255 三平台 npm ci/check 成功，每组159项Vitest及17项E2E；本机超时记录保留，完整check不记通过。Windows用户1B/2A未测试。
- **2B（本轮）**：只接收当前已完成单根K线的递进策略接口；MA交叉、RSI阈值、价格突破；严格参数校验；止盈止损、跳空、双触发保守假设、明确优先级；独立参考/前缀/账本/异常数据测试。
- **2C（未授权实施）**：回测界面、收益/回撤/公平基准、NA口径、实验保存/导出及全流程验收。2B不代表整个M2完成。
- 先设计→纯TS实现→独立参考与自查→npm ci/check及Ubuntu Chromium、Windows Chrome/Edge CI→PR #5待审。不开发参数优化、AI或实盘交易。
- 延续现货、单币种、多头、无杠杆、默认1000虚拟USDT、18位定点、手续费/双边滑点/数量舍入/最小名义额/逐笔守恒。信号收盘生成、下一根开盘成交；止盈止损是已持仓的保护订单，触发后允许在根内退出。
- 缺口、未完成/异常数据一律阻断，不排序、去重、补价。忽略整根量并假定无限流动性；保留来源、警告和Number转换边界。Phase0/1全部功能和测试保留。
- [2B设计](docs/phase-2b-design.md) 定义策略、价格模型、优先级与时间证据；[2A设计](docs/phase-2a-design.md) 保留原阶段规格。

## 技术决策

中文、Windows Edge/Chrome 优先、浏览器可用、离线优先的历史数据研究工具，仅研究与模拟。模拟默认 1000 虚拟 USDT；2A 仅提供计算内核，不增加交易连接。

- React + TypeScript strict + Vite，Node.js 24 LTS，固定依赖与锁文件。
- 默认深色、可切浅色；八页面 hash 导航，无需服务器路径回退。刷新后主题回到深色，当前无偏好持久化。
- 核心为纯 TypeScript，UI 与计算分离。Phase 1A 在 core/data 实现解析与质量检查，新增 core/indicators 计算与 dataset-v1 契约，2A 在 core/backtests 分离事件、执行、账本与身份；正式策略/风险统计延后。
- Vitest + Testing Library 验证数据约束和页面集成；Playwright 验证生产包；CI 覆盖 Linux Chromium、Windows Chrome/Edge。
- 静态包无外部运行资源，经本机 HTTP 提供。单 HTML、PWA、桌面封装、安装包另设验收。
- 浏览器 Worker 解析；Lightweight Charts 5.2.1（本地固定版本、Canvas、内建交互、多面板，保留许可标识）；IndexedDB 原生事务适配器（成功只在 complete 后返回），不使用 localStorage 保存行情。JSON 备份不是持久存储保证。具体版本、许可与限制记录专题。

可行性与限制见 [architecture.md](docs/architecture.md)、[offline-release.md](docs/offline-release.md)。

## Phase 0 已完成拆解（历史）与通用验收命令

1. 核对独立仓库，完整阅读原计划，参考旧 GTO 的 AGENTS 和开发脚本；不复用业务源码。
2. 建立工程、中文深浅主题、工作台和七个占位页。
3. 用 4 条明确标注的固定合成 OHLCV 展示只读示例；不实现导入、图表或计算。
4. 建立数据、策略、回测、风险目录、公开入口、依赖约束和文档。
5. 配置格式、lint、类型、Vitest、生产包 E2E 与 CI 三个系统/浏览器组合。
6. 验证开发启动、构建运行，记录实际结果与未测项，提交独立 PR。

```sh
npm ci
npm run dev -- --port 5173 --strictPort
npm run check
```

check 包含格式、lint、单元/页面集成测试、严格类型、构建和生产包浏览器烟测。Windows PowerShell 与浏览器准备见 [README](README.md)。

**M0 = CI 绿灯 + 文档存在 + Windows 运行通过。** Linux 自测不替代 Windows 用户实测。即使 M0 达标，Phase 1 也需用户明确启动。

## 总路线（当前 Phase 2B）

| 阶段    | 范围                                                            | 推进前提          |
| ------- | --------------------------------------------------------------- | ----------------- |
| Phase 1 | CSV、时间单位、质量报告、K 线、基础指标与数据重开               | M0 达标且用户授权 |
| Phase 2 | 现货多头单币种无杠杆回测、三策略、虚拟本金、成本/账本/基准/报告 | M1 数据可用       |
| Phase 3 | 比较、参数敏感度、样本外/滚动测试、过拟合提示                   | M2 可信回测       |
| Phase 4 | 逐根回放、虚拟买卖、日记、保存/恢复                             | M3 研究工具       |
| Phase 5 | 独立确认高级研究与单文件等候选                                  | 对应验收通过      |

后续遵循原规划的无未来函数、下一根开盘模拟成交、保守双触发假设、逐笔对账、可复现身份与不足样本 NA 口径。完整要求以原计划第 4–6 节为准。

## 风险与决策记录

- Windows 原生行为与受管策略须实际平台证据确认；CI、云端和用户实测分列。
- 模块静态包通常不能直接 file:// 运行。本机 HTTP 先验收，单文件发布单独实施。
- Phase 0 不证明任何策略有效，不验证真实数据导入；后续使用真实/错误样本独立验收。
- 附件法律与平台规则引用不是本轮已核验法律结论；联网或发布/服务范围变化前另行核查。
- 2026-10-18：历史 Phase 0 决策：独立仓库、新技术栈、GTO 文档/PR 节奏、hash 导航、内存主题、只读示例、本机 HTTP。
- 2026-10-19：用户确认 Phase 0 已验收合并，授权 Phase 1，仅本轮 1A；按上节拆分实施，不提前开发 1B。

- 2026-10-19：用户确认 1A Windows 验收、PR #2 合并并正式授权 1B；分支实施、PR #3 待审。

Phase 1B 接口和限制详见 [设计与契约](docs/phase-1b-design.md)，用户验收见 [Windows 清单](docs/phase-1b-acceptance.md)。PR #3 已合并，云端技术复核通过，Windows 用户实机未测试；2A 授权不代表补签此验收。

Phase 2A 已合并，最终CI及本机失败事实见 progress。当前实施2B，2C与完整M2后续独立授权；用户Windows未测试的阶段不以CI补签。

2B内核和本机验证已交付：256项Vitest及17项E2E完整通过。三平台CI已触发，当前runner队列未启动，不能记为通过；真实状态和失败原证据见progress。下一行动是核对PR #5实际CI日志及执行Windows用户清单，不自动推进2C。
