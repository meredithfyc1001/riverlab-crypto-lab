# 架构与 Phase 0 可行性

已完整阅读原始规划 v0.1，参考 meredithfyc1001/riverlab-gto 的 AGENTS.md、package.json。迁移文档恢复、PR、验证如实记录和 Windows 优先验收流程，不复制扑克逻辑、数据或单 HTML 源码结构。新项目有独立 Git 历史。

React 19、TypeScript 5.9 strict、Vite 7 可满足浏览器本地研究工具的基础需求。Node.js 24 LTS，依赖与锁文件固定。构建目标 Chrome/Edge 120+ 只是语法目标，不代表已验证所有这些版本；实际平台写入 progress.md。

## 模块职责

| 目录                     | 职责                     | 当前交付                           |
| ------------------------ | ------------------------ | ---------------------------------- |
| src/app                  | 路由、主题、装配         | 可运行界面，无业务计算             |
| src/components           | 共用展示                 | 风险提示、只读示例表               |
| src/features/datasets    | 数据中心                 | 页面元信息，导入待实现             |
| src/features/charts      | 行情中心                 | 页面元信息，图表待实现             |
| src/features/strategies  | 策略中心                 | 页面元信息                         |
| src/features/backtests   | 回测中心                 | 页面元信息                         |
| src/features/risk        | 风险中心                 | 页面元信息                         |
| src/features/experiments | 实验中心                 | 页面元信息                         |
| src/features/replay      | 历史回放                 | 页面元信息                         |
| src/core/data            | 行情/来源模型、未来校验  | Candle/SyntheticDataset 类型与职责 |
| src/core/strategies      | 未来策略版本、参数、信号 | 职责声明，无算法                   |
| src/core/backtests       | 未来事件、模拟成交、账本 | 职责声明，无引擎                   |
| src/core/risk            | 未来风险指标与口径       | 职责声明，无计算                   |
| src/shared               | 不依赖上层的共用契约     | 模块边界类型                       |

依赖方向：app → features/components/core/shared；features → components/core/shared；components → core/shared；core → core/shared；shared 不依赖上层。兄弟功能模块不互相导入，由 app 装配，功能模块经 index.ts 暴露入口。核心跨域依赖须单向、通过公开契约；未来策略信号与执行分离，风险只读结果。

core 独立 TypeScript 配置不含 DOM，ESLint 禁止 React/UI 与浏览器全局。Phase 0 不预建大型账本/事件接口，避免冻结未经验证的 Phase 2 模型；后续可按原规划细分指标、执行、组合与统计。

## 运行与数据

八个 hash 入口无需服务器路径重写，刷新/前进/后退可用。默认深色，可切浅色；主题不持久化，不读写存储。未知 hash 回到工作台。无账户、密钥、网络行情或订单。

4 条固定 DEMO/USDT 人工合成 OHLCV 仅用于展示和工程烟测，不是真实行情、导入器、图表或研究结果。UTC 毫秒，显示 UTC。无 CDN、远程字体、遥测、服务端或交易 SDK。

后续考虑 IndexedDB 配合显式文件导入/导出，检测拒写、配额、清理与隐私模式，失败不能显示成功。大文件流式/Worker、decimal/整数账本在对应阶段独立选型；当前不宣称存储容量回退与金额精度已验证。

## 可行性限制

Vite 开发、本机 HTTP 静态构建可行。单 HTML 的内联资源、Worker、存储和 file:// 限制需单独实现和验收。浏览器只放行本机资源的测试不代表完整离线发行包完成。

Vitest 验证纯数据约束和 React 页面行为，Playwright 验证生产包；Windows CI、Linux 云端和用户 Windows 实机分别记录。
