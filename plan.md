# RiverLab Crypto Lab 执行计划

基线：[原始规划 v0.1](docs/product-plan-v0.1.md) 完整保留。2026-10-19 用户确认 Phase 0 验收和 Windows Edge/Chrome 本地测试通过，PR #1 已合并为 6ffe6a3186699ae85a26331efa932c3bcec500a2（北京时间 17:57:48）。M0 通过；具体浏览器版本和逐项结果未提供，不补写。

当前授权 **Phase 2A**。已同步 origin/main，核实 PR #3 merged=true，合并提交 3282475ecea8f0c42332eab8515e90b74cef6bde（UTC 2026-10-19 14:37:28）。Phase 1B 云端技术复核通过，用户 Windows 实机未执行。分支 feat/phase-2a-deterministic-backtest，目标独立待审 PR #4，不直接修改 main、不合并或发布。

## Phase 2 拆分与当前行动

- **2A（本轮）**：纯 TS 确定性事件/下一根开盘成交/BigInt 账本、固定信号与独立参考、可复现身份、质量阻断、全部回归和三平台 CI。
- **2B（建议，未授权实施）**：三正式策略、因果信号接口/参数验证、止盈止损及同根双触发/跳空规格与测试。
- **2C（建议，未授权实施）**：回测界面、收益/回撤/公平基准、NA 口径、实验保存/导出及用户全流程验收。
- 先设计审查→接口/精度/成交实现→独立固定参考和前缀因果性→独立自查→npm ci/check及CI→PR #4 待审。不把完成 2A 记为整个 M2 达标。
- 现货、单币种、仅多头、无杠杆，默认 1000 虚拟 USDT。输入须确认全部 K 线已完成，信号在收盘事件产生，仅下一根开盘成交；末根意图到期，无自动平仓。
- BigInt 18位定点；报价/手续费/数量精度、双边滑点、最小金额、全仓预算和拒单原因均可追溯。资金不足/持仓不足拒单，逐笔检查现金/持仓守恒。
- 数据必须通过 dataset-v1 重新校验；缺口一律阻断；成交忽略整根成交量（开盘时尚未知），明确无限流动性假设。保留来源、警告和完整性未知，不补价、不重排。
- Phase 0/1A/1B 导入、图表、指标、IndexedDB和备份恢复以及所有回归继续保留。没有真实账户/API Key/钱包/真实资金/实盘订单。
- 设计与精度细节见 [Phase 2A 设计](docs/phase-2a-design.md)，固定案例见 [验收清单](docs/phase-2a-acceptance.md)。

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

## 总路线（当前 Phase 2A）

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

Phase 2A 内核已完成，[PR #4](https://github.com/meredithfyc1001/riverlab-crypto-lab/pull/4) 保持Draft待审。工程提交三平台CI均159/17通过；本机超时与复验按progress如实记录。Phase2B建议先建立仅历史前缀的策略接口与参数校验，再实施三策略及止盈止损的跳空/同根双触发保守规则；Phase2C补公平基准/统计NA、回测界面和实验档案。用户1B Windows实机仍待执行，不以2A技术证据补签。
