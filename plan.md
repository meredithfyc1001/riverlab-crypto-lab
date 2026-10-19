# RiverLab Crypto Lab 执行计划

基线：已完整阅读用户附件 [规划 v0.1，2026-10-18](docs/product-plan-v0.1.md)，原文完整保留。当前仅授权 **Phase 0**。独立仓库 meredithfyc1001/riverlab-crypto-lab，分支 feat/phase-0-foundation，向 main 提交一个待审 PR。

## 技术决策

中文、Windows Edge/Chrome 优先、浏览器可用、离线优先的历史数据研究工具，仅研究与模拟。未来模拟默认 1000 虚拟 USDT；本阶段没有虚拟账户或资金逻辑。

- React + TypeScript strict + Vite，Node.js 24 LTS，固定依赖与锁文件。
- 默认深色、可切浅色；八页面 hash 导航，无需服务器路径回退。刷新后主题回到深色，当前无偏好持久化。
- 核心为纯 TypeScript，UI 与计算分离。Phase 0 仅声明模块边界，不实现算法。
- Vitest + Testing Library 验证数据约束和页面集成；Playwright 验证生产包；CI 覆盖 Linux Chromium、Windows Chrome/Edge。
- 静态包无外部运行资源，经本机 HTTP 提供。单 HTML、PWA、桌面封装、安装包另设验收。
- 图表库、IndexedDB/文件回退、Worker/流式导入与账本精度在相应阶段选型，本阶段不引入。

可行性与限制见 [architecture.md](docs/architecture.md)、[offline-release.md](docs/offline-release.md)。

## Phase 0 拆解与验收命令

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

## 后续路线（未启动）

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
- 2026-10-18：按用户要求仅做 Phase 0；采用独立仓库及指定的新技术栈，沿用 GTO 文档与 PR 节奏。hash 导航、内存主题、只读合成示例、本机 HTTP 为本轮实施选择。
