# 架构与可行性（Phase 2A）

已完整阅读原始规划 v0.1，参考 meredithfyc1001/riverlab-gto 的 AGENTS.md、package.json。迁移文档恢复、PR、验证如实记录和 Windows 优先验收流程，不复制扑克逻辑、数据或单 HTML 源码结构。新项目有独立 Git 历史。

React 19、TypeScript 5.9 strict、Vite 7 可满足浏览器本地研究工具的基础需求。Node.js 24 LTS，依赖与锁文件固定。构建目标 Chrome/Edge 120+ 只是语法目标，不代表已验证所有这些版本；实际平台写入 progress.md。

## 模块职责

| 目录                     | 职责                     | 当前交付                                         |
| ------------------------ | ------------------------ | ------------------------------------------------ |
| src/app                  | 路由、主题、装配         | 可运行界面，装配数据中心、行情中心及本地存储     |
| src/components           | 共用展示                 | 风险提示、只读示例表                             |
| src/features/datasets    | 数据中心与浏览器适配     | CSV/Worker/报告/来源、本地库操作界面             |
| src/features/charts      | 行情中心                 | OHLC/量、缩放/平移/十字准星、指标面板            |
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

依赖方向：app → features/components/core/shared/infrastructure；infrastructure → core 与浏览器适配 API（禁止被 core/shared 导入）；features → components/core/shared；components → core/shared；core → core/shared；shared 不依赖上层。兄弟功能模块不互相导入，由 app 装配，功能模块经 index.ts 暴露入口。核心跨域依赖须单向、通过公开契约；未来策略信号与执行分离，风险只读结果。

core 独立 TypeScript 配置不含 DOM，ESLint 禁止 React/UI 与浏览器全局。Phase 1A 新增解析和质量检查，未引入大型账本/事件接口；后续可按原规划细分指标、执行、组合与统计。测试独立 tsconfig.test.json 引用 Node 测试类型，不把它们引入 app/core 的全局类型环境。

## 运行与数据

八个 hash 入口无需服务器路径重写，刷新/前进/后退可用。默认深色，可切浅色；主题不持久化；数据集仅经明确操作读写 IndexedDB。未知 hash 回到工作台。无账户、密钥、网络行情或订单。

工作台保留 4 条固定合成示例；数据中心提供 CSV 导入与质量报告。时间规范化为 UTC 整毫秒，无法判断的单位/周期要求确认。历史存档、人工合成、错误测试与用户未核实来源分别标记，不把样本当作研究结果。无 CDN、远程字体、遥测、服务端或交易 SDK。

文件解码、SHA256、解析与检查在独立 Worker 中运行。core 是纯同步 TS，Worker 只是浏览器适配器；默认只发送报告与有上限预览；用户明确使用或保存后重新检查同哈希输入，才将完整已检查数组交给 app。换文件、取消和卸载终止 Worker，generation 标识拒绝迟到结果；任何配置改变使旧报告失效。支持 10 MiB / 50,000 行，45 秒超时；无 Worker 不退回主线程重计算，给出明确失败提示。

Phase 1B 增加纯 core/indicators（MA/EMA/Wilder RSI）和 core/data/dataset 契约；app 调用 infrastructure/dataset-store 原生 IndexedDB 与 JSON 备份，事务完成才成功。行情中心由 app 传入当前数据；列表仅加载摘要。原报告仍为会话内存，但可明确保存完整通过检查的数据集。浏览器存储不永久可靠，流式存储与无限文件未实现。详见 [设计与契约](phase-1b-design.md)。

Phase 2A 在 `core/backtests` 拆分类型、定点解析、配置、身份、开盘执行、账本审计与事件驱动；同步纯 TypeScript，独立无DOM编译。@noble/hashes 2.4.0 固定版本计算 SHA-256，不使用 Web Crypto 或 Node crypto。价格/资金/数量为18位BigInt定点，结果为十进制字符串；不读系统时钟/随机数/网络。测试在Node环境运行，并用独立Decimal参考和Node SHA-256核验。尚未接入UI/Worker/存储；正式策略与统计延后，细节见 [2A设计](phase-2a-design.md)。

## 可行性限制

Vite 开发、本机 HTTP 静态构建可行。单 HTML 的内联资源、Worker、存储和 file:// 限制需单独实现和验收。浏览器只放行本机资源的测试不代表完整离线发行包完成。

Vitest 验证纯数据约束和 React 页面行为，Playwright 验证生产包；Windows CI、Linux 云端和用户 Windows 实机分别记录。
