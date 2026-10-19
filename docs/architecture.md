# 架构与可行性（Phase 1A）

已完整阅读原始规划 v0.1，参考 meredithfyc1001/riverlab-gto 的 AGENTS.md、package.json。迁移文档恢复、PR、验证如实记录和 Windows 优先验收流程，不复制扑克逻辑、数据或单 HTML 源码结构。新项目有独立 Git 历史。

React 19、TypeScript 5.9 strict、Vite 7 可满足浏览器本地研究工具的基础需求。Node.js 24 LTS，依赖与锁文件固定。构建目标 Chrome/Edge 120+ 只是语法目标，不代表已验证所有这些版本；实际平台写入 progress.md。

## 模块职责

| 目录                     | 职责                     | 当前交付                                         |
| ------------------------ | ------------------------ | ------------------------------------------------ |
| src/app                  | 路由、主题、装配         | 可运行界面，无业务计算                           |
| src/components           | 共用展示                 | 风险提示、只读示例表                             |
| src/features/datasets    | 数据中心与浏览器适配     | CSV 文件选择/映射/确认、Worker、报告、来源身份   |
| src/features/charts      | 行情中心                 | 页面元信息，图表待实现                           |
| src/features/strategies  | 策略中心                 | 页面元信息                                       |
| src/features/backtests   | 回测中心                 | 页面元信息                                       |
| src/features/risk        | 风险中心                 | 页面元信息                                       |
| src/features/experiments | 实验中心                 | 页面元信息                                       |
| src/features/replay      | 历史回放                 | 页面元信息                                       |
| src/core/data            | 纯 TS 解析与质量         | 严格 CSV、时间单位/UTC、OHLCV/重复/缺口/行级报告 |
| src/core/strategies      | 未来策略版本、参数、信号 | 职责声明，无算法                                 |
| src/core/backtests       | 未来事件、模拟成交、账本 | 职责声明，无引擎                                 |
| src/core/risk            | 未来风险指标与口径       | 职责声明，无计算                                 |
| src/shared               | 不依赖上层的共用契约     | 模块边界类型                                     |

依赖方向：app → features/components/core/shared；features → components/core/shared；components → core/shared；core → core/shared；shared 不依赖上层。兄弟功能模块不互相导入，由 app 装配，功能模块经 index.ts 暴露入口。核心跨域依赖须单向、通过公开契约；未来策略信号与执行分离，风险只读结果。

core 独立 TypeScript 配置不含 DOM，ESLint 禁止 React/UI 与浏览器全局。Phase 1A 新增解析和质量检查，未引入大型账本/事件接口；后续可按原规划细分指标、执行、组合与统计。测试独立 tsconfig.test.json 引用 Node 测试类型，不把它们引入 app/core 的全局类型环境。

## 运行与数据

八个 hash 入口无需服务器路径重写，刷新/前进/后退可用。默认深色，可切浅色；主题不持久化，不读写存储。未知 hash 回到工作台。无账户、密钥、网络行情或订单。

工作台保留 4 条固定合成示例；数据中心提供 CSV 导入与质量报告。时间规范化为 UTC 整毫秒，无法判断的单位/周期要求确认。历史存档、人工合成、错误测试与用户未核实来源分别标记，不把样本当作研究结果。无 CDN、远程字体、遥测、服务端或交易 SDK。

文件解码、SHA256、解析与检查在独立 Worker 中运行。core 是纯同步 TS，Worker 只是浏览器适配器；结果只发送报告与有上限预览，完整候选数组不发送 UI。换文件、取消和卸载终止 Worker，generation 标识拒绝迟到结果；任何配置改变使旧报告失效。支持 10 MiB / 50,000 行，45 秒超时；无 Worker 不退回主线程重计算，给出明确失败提示。

后续考虑 IndexedDB 配合文件导出，检测拒写、配额和隐私模式，失败不能显示成功。当前报告只保留在数据中心页面会话，未持久化；流式存储、decimal/整数账本、无限文件均未实现。

## 可行性限制

Vite 开发、本机 HTTP 静态构建可行。单 HTML 的内联资源、Worker、存储和 file:// 限制需单独实现和验收。浏览器只放行本机资源的测试不代表完整离线发行包完成。

Vitest 验证纯数据约束和 React 页面行为，Playwright 验证生产包；Windows CI、Linux 云端和用户 Windows 实机分别记录。
