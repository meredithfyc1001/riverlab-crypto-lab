# RiverLab Crypto Lab 执行计划

基线：[原始规划 v0.1](docs/product-plan-v0.1.md) 完整保留。2026-10-19 用户确认 Phase 0 验收和 Windows Edge/Chrome 本地测试通过，PR #1 已合并为 6ffe6a3186699ae85a26331efa932c3bcec500a2（北京时间 17:57:48）。M0 通过；具体浏览器版本和逐项结果未提供，不补写。

当前授权 **Phase 1B**。Phase 1A 用户 Windows 验收通过，PR #2 已由 GitHub 核实合并为 c17c0a4ba4084bad06e572da48d3da1fb5cf4720（UTC 2026-10-19 10:44:13）。从同步的 origin/main 建立 feat/phase-1b-charts-storage，目标独立待审 PR #3，不直接修改 main。

## Phase 1 拆分与当前行动

- **1A（已合并、用户总体验收通过）**：CSV、映射、UTC、质量报告、来源样本。逐项 Windows 版本/证据未提供，不推断。
- **1B（本轮）**：K 线/成交量/缩放/平移/十字准星、MA/EMA/RSI、IndexedDB 保存/重开/删除、JSON 备份恢复、数据流程、性能/离线和跨平台验证。
- 实施顺序：同步核实合并并更新文档 → 纯 TS 指标/数据契约 → 图表/数据交接 → 本地存储/恢复 → 固定参考、浏览器/性能/断网/重开验证 → npm ci / check / 三组 CI → PR #3 待审。
- 保留 1A 单位/周期确认及完整性未知提示；不得排序、去重、补价或忽略错误。阻断错误的数据不用于图表或保存；警告须显式确认，完整保留数据范围与限制。
- CSV 上限保持 10 MiB / 50,000 行 / 64 列。解析继续 Worker；图表和指标 O(n)，只保留当前数据集，列表不读取全部 K 线。
- EMA 首个 N 个收盘价 SMA 初始化，alpha=2/(N+1)；RSI 以 N 个差值平均涨跌初始化，再用 Wilder 平滑。缺口重置指标，样本不足 NA；常量 RSI=50，单向上涨/下跌为100/0。
- 不开发策略信号、回测、账户、API Key、资金、交易、实时抓取或 Phase 2，不发布或部署。

## 技术决策

中文、Windows Edge/Chrome 优先、浏览器可用、离线优先的历史数据研究工具，仅研究与模拟。未来模拟默认 1000 虚拟 USDT；本阶段没有虚拟账户或资金逻辑。

- React + TypeScript strict + Vite，Node.js 24 LTS，固定依赖与锁文件。
- 默认深色、可切浅色；八页面 hash 导航，无需服务器路径回退。刷新后主题回到深色，当前无偏好持久化。
- 核心为纯 TypeScript，UI 与计算分离。Phase 1A 在 core/data 实现解析与质量检查，新增 core/indicators 计算与 dataset-v1 契约，策略/回测/风险边界保持。
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

## 总路线（当前 Phase 1B）

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

Phase 1B 已实现接口和限制详见 [设计与契约](docs/phase-1b-design.md)，用户验收见 [Windows 清单](docs/phase-1b-acceptance.md)。下一行动为本机完整检查、三组 CI 和 PR #3 审查；Phase 2 仍需用户后续明确授权。
