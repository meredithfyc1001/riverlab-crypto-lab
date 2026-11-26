# Phase 6A Windows 桌面原型架构决策

评审对象为 Windows 11 x64 上的 Tauri 2、WebView2 与现有 React/TypeScript 工作台。功能基线采用 5E 提交 `18aefef26884e5a8a10fd36e4e985365ff223e5f`，含 5D 和高级策略研究。用户已确认 Chrome / Edge 联合实机验收。WebView2 是单独的运行环境，需在安装了对应构建的 Windows 上采集证据。[5E 源码](https://github.com/meredithfyc1001/riverlab-crypto-lab/tree/18aefef26884e5a8a10fd36e4e985365ff223e5f) · [既有验收场景](phase-5e-acceptance.md)

6A 授权范围为可隔离运行的技术原型。以下决策表中列明验证位置。原型测试使用仓库公开夹具、合成输入和原型专用 profile。用户浏览器配置、下载目录、浏览器旧库以及用户实际研究文件均不作为原型测试数据。6B 的文件导入、6C 的备份升级、6D 的正式安装和 6E 的发布各有独立验收。

| 决策                                    | 验证位置                           |
| --------------------------------------- | ---------------------------------- |
| [1 · WebView2 兼容面](#compatibility)   | 6A 真机逐项取证                    |
| [2 · Rust、React 与 Worker 协议](#ipc)  | 6A 壳与 Worker 原型，6B 持久化通道 |
| [3 · 浏览器与桌面数据架构](#storage)    | 6A 设计，6B 桌面库                 |
| [4 · 九库十七存储映射](#mapping)        | 5E 源码核查，6B 文件类型对账       |
| [5 · 身份与回放关联](#identity)         | 6A 冻结样本，6B 迁移复核           |
| [6 · 原子导入与回滚](#migration)        | 6B 暂存库故障注入                  |
| [7 · 更新信任与健康回滚](#updater)      | 6C 故障演练，6D 安装整合           |
| [8 · WebView2 缺失及版本策略](#runtime) | 6A 环境取证，6D 离线介质，6E 签发  |

<a name="compatibility"></a>

## 1. WebView2 中的 Worker、图表、IndexedDB 和 Blob

同一个生产 Vite 构建、同一数据、规则、UTC、种子和窗口序列，在 WebView2 与已验收的浏览器入口对照。桌面加载打包资源，持久化使用独立应用标识、固定 origin 和独立 WebView2 用户数据目录；协议、主机或应用标识发生变化须当作存储兼容性变更。Tauri capability 仅给本地可信窗口开放所需命令，Worker 按打包后的同源 URL 加载。记录启动边界、runtime 版本、CSP 拒绝和资源错误。[Vite 配置](../vite.config.ts) · [Tauri 配置](https://v2.tauri.app/reference/config/) · [WebView2 用户数据目录](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/user-data-folder)

| 兼容面                                    | 在实际桌面构建中采集的证据                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CSV Worker                                | 真实 `File` → Worker 读字节、原 CSV SHA-256、时间单位/错误行/质量报告、取消重试。覆盖 10 MiB / 50,000 行准入，超限阻断。[入口](../src/features/datasets/csv.worker.ts)                                                                                                                                                                                                       |
| 单币回测、Phase 3 研究、风险、回放 Worker | MA 和规则 V1/V2 的成交与权益全量比对。样本外/滚动窗口、固定种子 Monte Carlo、回放逐根与暂停恢复分别验；覆盖 Worker 查询实验或数据集。[实现](../src/infrastructure) · [冻结原件](../tests/unit/windows-baseline.test.ts)                                                                                                                                                      |
| 固定组合、共享资金池、市场状态 Worker     | 双/五资产、共享策略/再平衡、5D 四类来源。核对逐笔费用、状态收益守恒、来源 Hash、报告冷重开和错误隔离。[5D 验收](phase-5d-acceptance.md)                                                                                                                                                                                                                                      |
| 高级研究协调 Worker 与嵌套候选 Worker     | 父 Worker 从已构建资源起子 Worker。单线程与多线程比较各候选、折、锁定次序、runHash 和完整 result；满载期取消并立即重跑，不允许迟到结果写库或多出任务。请求最多四路，服从原快照和同时求值预算。[调度](../src/infrastructure/advanced-pool.ts) · [协调 Worker](../src/infrastructure/advanced.worker.ts)                                                                       |
| 图表                                      | 逐页验证本地 lightweight-charts Canvas 的行情/指标、回测权益与回撤、回放、固定/共享组合、市场状态，以及风险和高级研究的 SVG 图。查数据点、UTC 轴、交互、缩放/高 DPI、窗口缩放与重建、GPU 受限时的实际表现。[行情图](../src/features/charts/ChartCenter.tsx) · [风险图](../src/features/risk/RiskPlots.tsx) · [研究图](../src/features/advanced-research/AdvancedResults.tsx) |
| IndexedDB                                 | 在隔离测试 profile 内检验九库 schema、进程重启持久性、正文/摘要同事务、冲突、事务 abort、空间不足、损坏摘要/正文。记录级隔离与整库打不开分别呈现。Worker 内直接读写与 UI 读写都走生产入口。[事务适配](../src/infrastructure/local-database.ts) · [损坏库复核](phase-5d-library-review.md)                                                                                    |
| 文件与下载                                | `File` / `Blob`、严格 UTF-8、WebCrypto、结构化克隆、`URL.createObjectURL` 和下载链接要走到实际文件落盘。验证 JSON/CSV 文件名、中文路径、取消、重试、收到的字节与文件摘要、打开原 JSON 重算及对象 URL 释放。UI 的“已生成”提示不能作为落盘凭证。[原数据集出口](../src/app/useDatasetLibrary.ts) · [高级研究出口](../src/infrastructure/advanced-file.ts)                       |

十个 Worker 入口合计包括 CSV、backtest、research、risk、replay、portfolio、shared-pool、market-regime、advanced、advanced-candidate。使用桌面入口测可交互启动、进程组峰值内存、全量包和冷/热启动。单币 50,000 根、组合原始快照合计 10,000 根、高级研究 50,000 根/100,000 次根求值三组负载分别记录至少三次。沿用既有场景限时，例如 5D 满载运行、导出、恢复各 20 秒，主线程最长采样间隔和取消各 1,000 ms。并发新建任务比较 result，重开同一份档案比较原报告 Hash。历史 Hash、逐笔结果和冻结重导字节差异均为零才通过。机器清醒时另测最小化、后台、锁屏和恢复；系统睡眠单录暂停及唤醒后的状态。CI、原浏览器实机、WebView2 原型实机、物理断网分别记录。未执行的场景保持待验状态。[原始容量与门槛](phase-5e-capacity.md)

<a name="ipc"></a>

## 2. Rust、React、Worker 的边界和消息协议

| 所有者                       | 技术职责                                                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| React / Application Runtime  | 展示来源、进度、错误与导入差异，取得用户决定，向 Worker 发送结构化命令，向可信桌面壳请求具名能力                                                  |
| TypeScript 内核 / Web Worker | 沿用原引擎、18 位定点账本、信号、风险、数值统计、策略验证、版本化序列化和重算。Worker 管理输入快照、嵌套并发、终止及过期响应                      |
| Rust / Desktop Shell         | 每用户生命周期、窗口、受限 IPC 和诊断；后续代管本地服务、文件授权、SQLite 写事务、备份及更新。服务依进程生命周期启动/退出，无系统 Node.js 依赖    |
| 浏览器备用版                 | 同一 TS 内核、同一 Web Worker、原 IndexedDB 与 JSON/CSV 出口。Node 24 仍用于原 ZIP 静态服务及开发构建。[启动器](../scripts/local-test/server.mjs) |

**6B 持久化协议草案。** 沿用既有领域 Worker 消息，在 I/O 边界增加主窗口代理：回放 Worker 查行情、风险 Worker 查源实验、5D Worker 按类型查源实验、5E Worker 校验后保存报告。它们均经主窗口的限定命令与原生层通信。既有 Worker 的序号、预期 Hash、取消和所有验证条件继续生效。[回放](../src/infrastructure/replay.worker.ts) · [风险](../src/infrastructure/risk.worker.ts) · [5D](../src/infrastructure/market-regime.worker.ts) · [5E](../src/infrastructure/advanced.worker.ts)

- 握手交换协议主/次版本、能力位、数据格式读写范围和会话 ID。主版本不匹配时停止写入，展示断开的模块与错误。每次请求绑定 `protocolVersion`、`sessionId`、`requestId`、`operation` 和有类型的 payload。研究任务另有 `jobId`、单调递增的 `generation` 与取消标记。
- 操作白名单区分查询摘要、取回一份正文、暂存写入、提交、取消和健康检查。返回 `requestId`、状态及有类型数据，或稳定错误码和可重试性。至少区分版本不支持、拒绝授权、数据冲突、摘要不符、空间不足、事务中止、已取消和服务不可用。诊断使用关联 ID。文件访问通过用户选择后授予的单用途句柄，原生层校验调用窗口和操作，禁用通用 SQL、任意路径、shell 命令或来自远程网页的权限。[Tauri 权限模型](https://v2.tauri.app/security/capabilities/)
- 6B 对 256 MiB 实验单设通路。原生先查长度，按块传输二进制，每块有顺序号、确认和有限在途窗口，封尾核总长及 SHA-256。Worker 使用单份受限缓冲；UI 不展开报告树、不转 Base64。在最大合法文件测 JS 堆、服务 RSS 和取消后回收，超过预算返回可诊断错误。逻辑上同包任务只可从“已校验”转一次“已提交”，响应丢失按幂等键查询事务结果。取消在提交前生效，已提交的事务返回实际状态，迟到进度无法覆写新任务。
- 如 6B 拆分服务进程，Rust 绑定 `127.0.0.1:0`，向壳经受限父子通道返回实际端口与随机会话凭据，按实例、协议和 nonce 校验健康响应。可写方法须认证；发布资源 origin 和 WebView profile 独立于服务端口。服务支持显式停止和有界重启，日志省略凭据与档案内容。

<a name="storage"></a>

## 3. 浏览器 IndexedDB 与桌面 SQLite

6A 仅用原型隔离环境验证现有 Web 能力。桌面权威存储设计在 6B 启用。浏览器的既有数据库继续按用户、profile、scheme、host、port 隔离。两个发行版可通过显式选择的版本化文件交换，不自动读对方目录或双写。桌面根和浏览器 profile 独立，程序、用户数据、暂存、备份、日志和 WebView 缓存分别落盘。稳定版、Beta 和原型使用不同应用标识及根目录。首次 desktop 打开显示空库是正常状态。[旧备份契约](rc-backup.md) · [IndexedDB 来源约束](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)

每个活动数据代是一套完整 SQLite 数据；单个服务串行提交，读者绑定同一代/快照。连接启用外键，落盘使用经过断电演练的事务、日志与同步设置。建议表结构如下，表名属于后续实现建议。

| 表                                 | 键、列及写入约束                                                                                                                                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `records`                          | 主键 `(kind, original_id)`，含格式/schema/算法版本、原创建 UTC、原验证器接受的完整正文 UTF-8 BLOB、正文长度。业务 ID 用 TEXT；资金/数量以原十进制文本保存在正文中。仅接受经领域验证的记录 |
| `summaries`                        | 与 records 同复合主键并外键引用正文；按既有类型生成列表摘要，可索引名称、创建时间等。写入、撤销与正文同一事务。规则版本可直接按验证过的版本正文建立索引                                   |
| `identities`                       | 主键 `(kind, original_id, hash_role, scope)`，外键指向正文。保留 payload、record、run、rule、report、source、result、state 等不同语义，每个候选/窗口的值按范围区分                        |
| `dependencies`                     | 复合键含来源记录、关系、目标类型/原 ID 和预期 Hash。回放依赖为必需外部对象；风险、组合、市场状态、高级研究的嵌入快照为独立可重算来源。目标丢失不级联删除来源，未满足强依赖的候选留在暂存  |
| `archives`、`record_archives`      | 按输入文件 SHA-256 保存原字节、长度与格式，一个业务对象可关联多个原始文件表示。文件不同而报告身份相同仍保留各原件；Phase 3 的单独导出文件没有库主键时仅在档案目录按 SHA-256 编目          |
| `imports`、`import_items`、`audit` | 本次选择的文件清单、格式/计数、逐项校验/冲突、提交代、UTC 和结果；成功审计随事务提交。隔离输入和失败诊断有独立状态。库 schema、协议版本及最近健康代纳入服务元数据                         |

<a name="mapping"></a>

## 4. 九个 v1 数据库与十七个对象存储

下表使用完整数据库名。各 IndexedDB object store 以 `id` 为 keyPath。八库各有两个对象存储、规则库有一个，总计十七；对象存储布局版本与导出文件 schema 分开编号。例如共享资金池库布局 v1，报告 schema 为 2。此表定义从**已导出文件**生成桌面对象的类型映射。旧 UI 的 HTML、列表排序和临时状态不属于数据库。[共用数据库定义](../src/infrastructure/local-database.ts)

| 原数据库                                | 原 object store → 6B SQLite 目的地                                         | 输入与校验要点                                                                                                                                                                                       |
| --------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `riverlab-crypto-lab`                   | `datasets` → records(dataset)；`summaries` → summaries(dataset)            | `riverlab-dataset` v1，20 MiB，保留原 file SHA、K 线、质量与 dataset.id。[源码](../src/infrastructure/dataset-store.ts)                                                                              |
| `riverlab-crypto-lab-experiments`       | `experiments` → records(experiment)；`summaries` → summaries(experiment)   | `riverlab-experiment` v1，256 MiB，外壳与工作台正文分开，单币、MA 与规则历史格式由原验证器重算。[源码](../src/infrastructure/experiment-store.ts) · [入口](../src/infrastructure/experiment-file.ts) |
| `riverlab-crypto-lab-rules`             | `versions` → records(rule)，索引 familyId/revision                         | `riverlab-strategy-rule` v1，128 KiB，规则定义版本 V1/V2 与家族修订号各自保留。[源码](../src/infrastructure/rule-store.ts)                                                                           |
| `riverlab-crypto-lab-replays`           | `replays` → records(replay)；`summaries` → summaries(replay)               | `riverlab-replay` v1，10 MiB，保留操作、游标及 datasetId/sourceHash 强关联。[源码](../src/infrastructure/replay-store.ts)                                                                            |
| `riverlab-crypto-lab-risk`              | `studies` → records(risk)；`summaries` → summaries(risk)                   | `riverlab-risk-study` v1，25 MiB，含源实验复现输入、固定种子、采样模型与输出。[源码](../src/infrastructure/risk-store.ts)                                                                            |
| `riverlab-crypto-lab-portfolios`        | `experiments` → records(portfolio)；`summaries` → summaries(portfolio)     | `riverlab-portfolio-experiment` v1，32 MiB，固定子账户各资产及汇总复现。[源码](../src/infrastructure/portfolio-store.ts)                                                                             |
| `riverlab-crypto-lab-shared-pool`       | `experiments` → records(shared_pool)；`summaries` → summaries(shared_pool) | `riverlab-shared-pool-experiment` v2，32 MiB，同库涵盖策略共享与定期再平衡。[源码](../src/infrastructure/shared-pool-store.ts) · [报告](../src/core/shared-pool/report.ts)                           |
| `riverlab-crypto-lab-market-regime`     | `reports` → records(regime)；`summaries` → summaries(regime)               | `riverlab-market-regime` v1，32 MiB，核对源实验、分类与归因版本及重建 reportHash。[源码](../src/infrastructure/market-regime-store.ts)                                                               |
| `riverlab-crypto-lab-advanced-research` | `reports` → records(advanced)；`summaries` → summaries(advanced)           | `riverlab-advanced-research` v1，32 MiB，保留完整快照、规则、种子、折计划及结果。[源码](../src/infrastructure/advanced-store.ts)                                                                     |

用户选择的旧 JSON 通常只有正文或版本化外壳；摘要依原格式校验成功后派生，不能宣称已获取浏览器里的旧摘要、损坏条目或未导出的文件。界面列“已选文件/成功/相同/冲突/待依赖/未知格式”的数量，不估计未提供的数据。Phase 3 的 `riverlab-research` 文件（25 MiB）可由原 `verifyResearch` 重开；该类型没有第十个 IndexedDB 库。CSV 是交换行情或分析输出，单独导入 CSV 会产生新数据集，不能从成交摘要或 CSV 逆推出原报告身份。[Phase 3](../src/core/research/index.ts) · [原备份范围](rc-backup.md)

<a name="identity"></a>

## 5. 历史 ID、策略版本、实验 Hash 和回放关联

1. 保存原 `id`、`familyId@revision`、原 UTC 毫秒、名称、`elapsedMs`（存在时）、算法版本、资产顺序、种子、窗口、舍入规则、18 位定点值、原来源和警告。导入器的操作人/时间和本地索引另存。旧数据集界面的“恢复为新副本”会调用 `crypto.randomUUID()`；6B 的档案导入有独立入口，按文件中校验过的原 ID 建立强关联，同类型冲突不改名、不自动重编号。[数据集恢复](../src/app/useDatasetLibrary.ts) · [规则身份](../src/core/rule-library/index.ts)
2. 文件层计算原始字节 SHA-256。数据集备份的 `payloadSha256` 使用原 `JSON.stringify(dataset)` 的 UTF-8；内核 `contentHash` 使用原排序键、数组次序、非 ASCII 转义的规范流。回测的 `dataHash/signalHash/runHash` 与 `payloadHash`、组合的 `recordHash/payloadHash`、5D/5E 的 `reportHash` 依各自规则验证。保留原文件格式和规范结果两套证据；用户编辑过空白的原始档案也按输入字节原样保管。[规范流](../src/core/backtests/identity.ts) · [实验验证](../src/core/experiments/index.ts) · [5E 校验与重建](../src/core/advanced-research/report.ts)
3. 回放先按原 ID 找数据集，再核对原 CSV 的 `sourceFileSha256`，以原算法校验 `sourceHash`、游标与事件、`resultHash`、`stateHash`、`payloadHash`；由原 `ReplaySession.restore` 从已揭示前缀逐步重放，成功后保持暂停。缺少原数据集提示选择其旧 JSON，错 ID 即使币种、K 线相同也不能代配。风险报告、5D 与 5E 报告含可复现快照，可在空配置验证，源库记录缺失时保留原身份和来源说明。[回放恢复](../src/core/replay/index.ts) · [风险研究](../src/core/risk-analysis/studies.ts) · [5D 报告](../src/core/market-regime/report.ts)
4. 接受标准包括同一已保存档案的业务 Hash、逐笔成交、费用、权益曲线、汇总和由原导出器生成的冻结 JSON/CSV 字节相同。已有样本覆盖 Windows MA 2/4、规则 V1/V2、5C 固定/两种共享、5D 报告及 5E 滚动/种子；验证回放和旧数据集的强关联另列用例。新跑实验生成的新 ID、创建时间有业务意义，跨调度比较输入和完整计算结果；在原记录上比较身份。若本机时钟错误导致“收盘在未来”，报告机器时间问题并保留原时间字段。[冻结 Windows 试验](../tests/unit/windows-baseline.test.ts) · [组合历史回归](../tests/unit/portfolio-historical-report.test.ts) · [高级研究验收](phase-5e-acceptance.md)

<a name="migration"></a>

## 6. 文件导入的原子回滚与用户数据保护

**输入边界。** 后续迁移只接受用户通过原版正常导出并在系统文件选择器中主动选定的档案。桌面不枚举 Chrome、Edge 或任何旧 WebView profile，不读取或修改浏览器 IndexedDB、数据库目录或浏览器备份，不扫描下载目录。6A 仅操作程序提供的公开/合成夹具。新版本与旧版本均可独立启动。以下流程在 6B 使用副本验证后方可对用户开放。

| 步骤         | 可持久化操作                                                                                                                                                                      | 失败位置与结果                                                                                             |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 预检         | 对选定文件逐个登记大小和 SHA-256，限定数量、类型、逐项额度、工作内存和所需磁盘；显示作用范围和版本。严格 UTF-8 解码，所有类型走原验证器                                           | 错版本、文件变化、磁盘空间不足、无权读取或时钟错误返回逐项原因，保留输入文件与活动代                       |
| 冻结与暂存   | 建立桌面单写者屏障，等现有事务完成；先对活动数据代建可验证恢复点。由一致快照生成同卷候选代，记录父代序号和操作 ID。先暂存数据集/规则再检查回放，字段保持原样                      | 并发写或父代已变时重试预检。断电后恢复器凭日志找到候选代和原活动代，未完成候选不作为启动源                 |
| 逐项复核     | 完全相同的身份和正文重复导入幂等；同类型同 ID 但正文、重要元数据或依赖不同标冲突，保留原始字节。根据旧验证器重算 Hash，派生摘要，同笔写入正文、摘要、依赖及清单                   | 缺依赖、坏文件或冲突使本批停在预览，用户可另选文件组成新批次。失败批次不会显示为完成，也不会删除原件       |
| 提交与复开   | 用户核对逐项清单并确认；在原生事务中持久记录候选代为活动代、上一健康代和批次号，刷盘并在冷开后复核记录数、各类型 Hash、回放和重导。切换前再次核父代序号。只在持久提交成功后回成功 | 原子切换前失败继续原代。首启校验失败且写屏障仍在时，由恢复器切回上次健康代；按批次号恢复应答，防止重复插入 |
| 写屏障解开后 | 保管前一代、导入原件、已确认的历史恢复点及用户新建资料                                                                                                                            | 出现问题先封存最新代。用户预览两个状态并决定恢复或继续，禁止用旧快照静默覆盖新产生的研究                   |

隔离区记输入件摘要及失败步骤，只列用户提供的文件。检测未知档案、已损坏摘要和语义重算失败时保留原件；修复须用户独立发起。磁盘满、文件被独占、进程终止、断电、摘要篡改、重复确认、同 ID 异内容、并发写和中断后再次启动均是 6B 门槛。在 **源文件、原活动代、候选代** 分别采集前后摘要，验证零非授权写入。卸载、降级、更新和恢复器均不得自动删除用户数据或备份。

<a name="updater"></a>

## 7. 签名、备份、健康检查与版本回滚

6A 不启用线上更新。以下为 6C/6D 设计，Tauri updater 提供包签名校验、下载和安装接入。健康判定、数据备份、签名清单策略、应用/数据成对回滚和离线包都是 RiverLab 发行与恢复组件的职责。[Tauri updater](https://v2.tauri.app/plugin/updater/)

1. Stable 与 Beta 分别有发布渠道、数据目录、受信密钥和可接受的起始版本。签名发布清单绑定发布者、产品、架构、通道、单调版本序号、文件长度/SHA-256、兼容 Windows/WebView2/服务协议及数据读写 schema。在线采用 HTTPS，下载到临时文件并核清单、最终包摘要和 Tauri 签名。Windows 程序和安装器另做带时间戳的 Authenticode 签名。离线使用同一载荷与签名清单，信任来自已安装的公钥和 Windows 发布者策略。仅在显式恢复路径允许已知健康的旧版本，正常更新拒绝重放旧清单。[Windows 签名](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool)
2. 每日首个可运行时段自动备份，错过时下次启动补作；支持用户手动备份和更改目录，记录最近成功日期。升级前再建独立恢复点。原生使用 SQLite Online Backup API 对已提交状态取一致视图，附件按固定代的不可变清单纳入。配置、逐文件长度/SHA-256、清单版本、数据库 schema、审计截点同包。写临时文件、复读校验、验证后发布完整备份索引；支持多版本健康恢复点和用户固定保留点。目标未连接、空间不足或验证失败则暂停升级并可重试；未验证包不计入恢复点，升级不自动清理用户资料。[SQLite 备份](https://sqlite.org/backup.html) · [WAL](https://sqlite.org/wal.html)
3. 独立恢复器在当前版本运行时暂存候选程序，建立已验证的升级前备份。待活动任务完成或用户确认取消后，冻结写入。候选版本只对新数据代进行兼容性转换，保留旧程序及旧库。记录 `previous(version,generation)`、`candidate(version,generation)`、尝试次数和事务阶段，使恢复器断电重入时可确定进度。
4. 候选试启动实际打开窗口并渲染工作台、握手服务、打开候选库、执行 SQLite integrity_check 和 foreign_key_check、读取冻结报告、跑 Worker 金样，最后由应用及服务分别返回本轮 nonce 的健康回执。进程存在、HTTP 200 或窗口已创建均不能代表整套应用可用。[SQLite 结构与引用检查](https://sqlite.org/pragma.html#pragma_integrity_check)
5. 回执完整后原子公布新程序与数据代，才开放写入。超时、崩溃、签名错误、版本冲突或回执不匹配时记录失败并隔离该 build；在写屏障内恢复上个健康程序/数据对，启动时禁止无限循环重试。若新版本已开放写入，保管最新代，提示恢复影响并由用户决定；不把新 schema 交给不兼容旧程序。6C 用合成库在下载、验签、备份、转换、首启及解开写屏障后分别注入故障，6D 以真实安装器和离线介质重复验证。

<a name="runtime"></a>

## 8. WebView2 Runtime 缺失、版本不兼容与受限环境

普通 Windows 11 用户可复用已安装的受支持 Evergreen WebView2，桌面版运行无需预装 Node。上线前用最早通过本表所有硬门槛的 runtime，以及当前受支持 Evergreen，在 clean Win11 x64 真机/镜像分别建证。具体最低构建号必须来自实测并进入签名发布清单。原型若没有运行到 React 就失败，诊断须在原生启动路径采集，不能依赖页面 JS 显示错误；保留原型、系统和 runtime 版本、安装范围以及经脱敏的错误码。[Microsoft 分发与检测](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution) · [Tauri Windows 安装器](https://v2.tauri.app/distribute/windows-installer/)

| 检测结果                            | 用户前台行为与离线方案                                                                                                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 存在且在测试范围                    | 使用原生探测返回的实际 runtime 版本并尝试创建 WebView；再验证模块/嵌套 Worker、存储、WebCrypto、文件下载及图表。WebView2 与系统 Edge 浏览器独立检测                                                                 |
| 未安装                              | 提示“需要 WebView2 Runtime”、检测结果及下一步。6D 离线介质附微软对应架构签名的 Evergreen 独立安装程序，用户授权后安装，再探测并重试。纯在线 bootstrapper 无法完成断网首装；已安装 runtime 的直接启动 EXE 可单独测试 |
| 过旧或已知不兼容                    | 报告真实版本及已测试范围；提供签名离线 runtime/经批准的企业部署路径和现有浏览器版入口。若 runtime 版本较新，运行必要能力探针并记录版本；出现关键失败则停止启动对应研究能力，供诊断与复验                            |
| 企业策略阻止安装、运行或 UDF 不可写 | 提供原生可读错误、权限/空间和日志位置，让管理员按组织策略部署或授权应用专用目录。升级流程发现运行环境不满足时继续原健康版本。备用浏览器版按原 ZIP、BAT、Node 24 运行，使用用户原浏览器自行打开                      |
| 独立 EXE / 完整离线发布             | 发布说明区分带可执行文件的应用程序与含依赖的完整离线介质；签名信息、架构、所需 runtime、清单/包 SHA-256 分别列出。若评估 Fixed Version Runtime，另计发行尺寸、许可、引擎安全修复与维护成本，验证后另作发布决策      |

6A 完成判断取决于实机证据表，对尚未执行的 Windows、断网、runtime 缺失或企业策略场景逐项保留状态。若任一硬门槛失败，保留首轮记录与既有浏览器交付，定位壳/运行时差异并复测；另行评估 Electron 的相同输入和相同门槛。6B 至 6E 中描述的 SQL、导入、备份和更新行为只有在相应实现及故障演练通过后才能列为已交付功能。
