# RiverLab Crypto Lab 执行计划

## Phase 6A 桌面技术验证

从已验收的 5E 功能树建立独立验证分支。先固化同输入的 50,000 根完整研究结果，再用同一生产资源验证桌面壳和 Edge。以原型独立目录内的 SQLite 验证读写、事务和备份冷恢复。Windows 候选同时交付安装器、应用 EXE、采集环境、制品摘要与测量；人工通过后再决定是否启动 6B。[八项技术决策](docs/phase-6a-architecture.md) · [验证规程与证据](docs/phase-6a-verification.md)

## Phase 5E 高级策略研究

从 PR #14 合并提交开展四库故障隔离、可复现的自定义规则参数搜索和训练选参的滚动验证。容量提高取决于全流程实测。Windows 最终 clean head 测试包承担 5D / 5E 联合实机验收。[技术设计与拆分](docs/phase-5e-design.md)

## Phase 5D 市场状态识别与表现归因

从 PR #13 实际合并提交开发。运行前锁定 N 根历史滚动收益及严格阈值，收盘标签延后一根归因于原实验。保留原回归、定点守恒与独立恢复；以完整三平台检查和最终 head 的 Windows 验包交付。[设计与边界](docs/phase-5d-design.md) · [验收单](docs/phase-5d-acceptance.md)

## Phase 5C-B 共享资金池与动态调仓

从已核实的 PR #12 合并提交启动。三个组合入口模式共享严格时间对齐，固定子账户与两种新账本可各自重现。先固定现金储备、九阶段事件、费用和精度、买入竞争、调仓偏差与无后继开盘规则，再开发纯 TypeScript 执行、Worker、报告与 UI。以独立整数参考、旧账本回归、生产浏览器边界测量、三平台全量 CI 及最终 clean head 的 Windows 双浏览器验包验收。[设计与验收标准](docs/phase-5c-b-design.md)

## Phase 5C-A 授权与验收（历史）

从 PR #11 已验收合并 SHA 建独立分支和 Draft PR。按[设计与风险分析](docs/phase-5c-design.md)实现多数据集对齐、18 位子账户分配、复用原成交内核、组合统计以及独立保存和完整恢复。保留 RC 的 473 项 Vitest、50 项 E2E 和独立参考，再追加组合测试、边界测量与 Windows 包验收。用户实机验收后决定合并。本轮仅涵盖虚拟子账户的历史回测。

## V1.0 RC 历史范围

PR #10 已合并到 `e27a728ac53dc7a3f6ad73fbcbd298f4527ccb54`（0.5.1-test）。按用户 2026-11-25 授权，从该 main 建立 `feat/v1-rc-hardening`，交付 `1.0.0-rc.1` 的独立 Draft PR。保留[原始规划](docs/product-plan-v0.1.md)及以下历史阶段记录。

1. 归档脱敏 Windows 实机结果。用三个原始实验 JSON 锁定 24 根 BTCUSDT 的策略、账本、曲线、统计和 runHash。
2. 分别审计完整依赖树和生产依赖，处理可兼容修复的公告，记录残余影响。在 50,000 根场景定位 Worker、计算和显示耗时。
3. 完善空库首次导入和实验文件恢复，评估按页加载，维持八页导航、离线静态资源、原数学契约和既有回归。
4. 全量检查、独立参考、真实 CI 日志与 Windows ZIP 双浏览器实测通过后，才交付绑定最终 head 的包。对用户实机验收另行登记；尾项为物理断网，继续 NOT TESTED。

[RC 设计](docs/rc-design.md) · [工程复核](docs/rc-review.md) · [验收清单](docs/rc-acceptance.md)

## 已交付基线与验收边界

- Phase0 PR#1与Phase1A PR#2已合并，用户明确确认Windows总体通过；未提供逐项/浏览器版本不补写。
- Phase1B PR#3已合并，CSV/UTC、质量检查、图表/指标、IndexedDB、备份恢复保留。用户Windows未执行。
- Phase2A PR#4已合并，下一根开盘成交、固定信号、18位BigInt、逐笔守恒与身份保留；三平台159/17通过。本机当时超时不改为通过；用户Windows未执行。
- Phase2B PR#5已合并，MA/RSI/突破、保守止盈止损及版本契约保留。最新run39284322892三组实际日志各256项Vitest/17项E2E通过，补充原排队事实；本机最终256/17通过。用户Windows未执行。
- 原失败、当时状态和合并SHA在[progress](progress.md)完整保留；已执行、未执行、未通过分开，CI不替代Windows用户实机签署。

## Phase 2C 工程方案与验收约定（保留）

1. 核对合并、完整文档/契约阅读、汇报方案、更新授权及[2C设计](docs/phase-2c-design.md)。
2. core/statistics只读原成交/收盘账本：收益、收盘回撤/持续、完整平仓周期胜率/利润因子、已实现/浮动对账、暴露区间上界、同成本买入持有、严格CAGR NA条件。独立固定参考核验，禁止Number金额累加。
3. core/experiments组合原内核/统计/完整数据快照和可复现报告。浏览器Worker运行/验证/导出；React只配置和展示。Lightweight Charts本地包全点曲线、表格分页。
4. 已保存数据选择与严格参数/质量门槛；原生IndexedDB事务适配器复用，实验独立库，complete才成功。保存/详情/重开/复现/确认删除与JSON/CSV，明确配额/损坏及刷新约定。
5. Node24内置模块前台静态服务、127.0.0.1-only、安全路径/扩展白名单、端口冲突/失败/中文空格路径/退出；ZIP只含dist与必要启动文件/说明/完整head SHA/版本/SHA256。
6. npm ci/check及三平台实际日志；Windows从ZIP解压后Chrome/Edge实际启动/运行/保存/导出/停止验证；三组质量及打包验收都成功后上传14天artifact，绑定PR head SHA。用户[验收表](docs/phase-2c-acceptance.md)待本人执行。

保留React+TypeScript strict+Vite、Node24 LTS、固定依赖/锁文件、hash导航、内存主题。核心不依赖React/DOM/存储/网络；app装配兄弟features，feature经index暴露入口。原CSV10MiB/50,000行及dataset-v1契约不变。

## 核心风险与验收标准

- 不改变2A/2B成交时序、费用/舍入、跳空和双触发stop-first；不限流动性等假设原样保留。未知根内时间不伪造，暴露用明确上界。
- 已实现+浮动严格等于总净盈亏，胜负只用完整平仓周期且含费用/滑点。无交易、分母零、年化不足不能伪造0/100%。每根收盘现金/市值/权益分明，基准同区间/本金/买入成本、不强制末尾平仓。
- 相同数据hash/算法/配置必须结果一致；保存报告含完整复现输入、参数、成本、风险、版本、实际信号、假设和统计。重开损坏/旧版本拒绝，不修复。
- 50,000根实际回测测量机器/浏览器/耗时/主线程响应；Worker隔离同步内核，不能删断言或任意放宽阈值。受限资源与全量结果克隆/绘图的限制如实记录。
- 全部0/1A/1B/2A/2B回归保留；历史占位页断言更新为实际功能，保留导航/风险/无账户/未选择不能运行约束。
- 阻断非本机origin后的数据加载、回测、图表、保存/重开和下载无外部请求；自动化origin拦截不等同用户物理断网，用户需实际测试。
- ZIP不含node_modules、缓存、密钥/.env、用户数据或不必要源码；包内build-info与SHA256可核查。WindowsCI启动/HTTP/核心资源/页面/停止均执行，排队不算通过。

```sh
npm ci
npm run check
npm run package:local
npm run test:package
```

check包含格式、lint、Vitest、独立core/app/test严格类型、生产构建与Playwright。Linux可显式设置PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium；Windows用E2E_BROWSER=chrome/msedge。具体成功/失败日志和最终CI见progress，不提前记绿灯。

## 后续路线与范围

Phase2C已合并；用户Windows实机结果尚未反馈，M2用户验收不因合并自动签署。Phase3现已授权，实施批次比较、有限敏感度网格、时间拆分和滚动验证；不开发自动优化器、AI、实时行情、真实账户/APIKey/钱包/实盘、杠杆/保证金/强平、正式Release或公开部署。

M0/M1/M2/M3/M4/M5门槛继续以原规划为准；用户授权当前阶段不补签先前未测试项目。原规划SHA256应保持0a3081d44d3557e6d0f1b1eda3378c2e83282b3c6677dcd45b88a3190b86f84b。

## Phase 2C 当时的技术交付状态

Phase 2C 最终工程 f4101bc 已随 PR #6 合并为 33b1d6695ca1115efefce59132d96f8534c43e72。旧 artifact 的 14 天保留期已结束。当前合并提交的 [main CI](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/42610440364) 三平台各 307 项 Vitest、24 项 E2E 已实际读取日志确认通过；Windows ZIP 的 Chrome/Edge 实际验证也已通过，新包对应完整 main 合并 SHA，保留至北京时间2026-11-23 19:41:32；下载与校验见 progress.md。用户清单待反馈，不把合并或 CI 成功等同于实机验收。

## Phase 3 实施顺序（历史，PR#7现已合并）

1. 确认用户授权与已合并main，完整设计时间隔离/成本/样本/预算/复现契约。
2. 纯TS研究编排、独立Decimal固定参考及时间隔离测试。
3. 专用Worker、三策略与参数网格UI、窗口收益/回撤比较、完整JSON重算与CSV。
4. 全部旧回归加新离线/性能流程；Windows ZIP补测研究。npm ci/check由三平台真实CI执行，本机环境失败记未执行。
5. 当时读取实际CI日志与headSHA ZIP、记录有效期，PR#7保持Draft；用户后续已合并，不补签Windows实机验收。

Phase3已验证实现85e933a三平台各316/30与WindowsZIP双浏览器全部通过；最后JSON导入当前时间门槛增加1项测试后需重新完整CI，最新结果/绑定head下载在PR#7说明。失败事实、机器/耗时与环境未执行边界在progress归档。

## Phase 4 实施记录（历史，PR#8已合并）

用户在PR#7合并后要求继续下一步，按原规划启动[Phase4设计](docs/phase-4-design.md)：共享逐根成交会话→无未来数据Worker→回放/虚拟买卖/日记/风险UI→独立库保存与动作重算恢复→固定参考及全部旧回归→本机check/三平台CI/WindowsZIP→Draft PR#8待用户反馈。Phase3最终head2db9e5c的run42616308619三平台317/30与WindowsZIP均通过，见PR#7实际日志记录；用户Windows反馈不因合并自动补签。

Phase4本机完整check已通过338项Vitest/35项E2E，原317/30全部保留；独立Decimal与合并前引擎hash参考通过。Linux dirty开发ZIP烟测通过，BAT未在Linux执行。功能提交1edb8f1的run42623772196四作业已实际成功，三平台各338/35与WindowsZIP双浏览器均通过；后续仅归档证据文档，最新head检查和下载由PR#8交付说明维护，用户Windows验收仍待本人反馈。

## Phase 5A 实施记录（历史，PR#9已合并）

用户“好了，下一步”同意推进；原Phase5多候选，已征询偏好，默认推荐先实施[可复现Monte Carlo风险分析](docs/phase-5a-design.md)。独立分支feat/phase-5a-research-tools、Draft PR#9。先固定数学/随机/舍入口径与独立Python参考，再core/Worker/UI/独立库报告，保留338/35全部旧回归，执行本机和三平台CI、WindowsZIP，不自动合并或宣称M5正式发布通过。

本机354项单元/40项浏览器、5个数值参考和Linux开发ZIP已完成；功能快照7595580三平台实际日志亦354/40全部成功，详细见progress。功能快照WindowsZIP也实际通过；打包phase标签修正后最新head必须重新完整CI/WindowsZIP，交付状态与当前SHA下载以Draft PR#9说明为准。用户Windows实机仍待本人反馈。

## Phase 5B 实施记录（PR #10 已合并）

用户明确授权完整执行Issue#10，先汇报并固定[设计](docs/phase-5b-design.md)，再实现纯TS流式规则、不可变版本/严格JSON和独立IndexedDB、可视化编辑及原回测接入。Phase3规则暂不可用且严格拒绝，旧引擎/报告/hash保持。保留354/40全部回归，新增因果/独立参考/确定复现/存储及50k Worker测试。执行npm ci/check和所有Python参考，读取三平台实际日志；后置Windows中文空格路径BAT/Chrome+Edge测试成功后上传绑定最终headSHA的14天ZIP。目标Draft PR#10（将现有Issue转为PR以保留编号），等待用户验收，不合并/发布/部署。

Phase5B工程已实现，Issue#10已转换为[Draft PR#10](https://github.com/meredithfyc1001/riverlab-crypto-lab/pull/10)，原任务全文[归档](docs/phase-5b-task.md)。功能快照fe17089三平台各457项Vitest/45项E2E及Windows中文空格BAT/Chrome+Edge ZIP全部实际成功；本机完整457/45与Linux开发ZIP通过。后续同周期MA/EMA逐根复用及2项额外等价测试已通过93项策略专项/构建/本机ZIP，仍须随最终提交重新完整CI。归档快照不冒充最终head，最新实际完整SHA、CI和ZIP下载由PR#10维护；用户Windows/物理断网仍待本人反馈，不自动合并/Release/部署。
