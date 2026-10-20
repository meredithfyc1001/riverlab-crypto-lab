# RiverLab Crypto Lab 执行计划

基线：[原始规划 v0.1](docs/product-plan-v0.1.md)全文保留，用户当前明确指令优先。当前授权 **Phase 2C：回测工作台、统计、实验保存/导出与 Windows 本地测试包**（2026-10-20）。

PR #5 merged=true，main实际合并提交 `0ee6d8483bd6a5226a6d01a1d21b990b134bab46`。已从同步origin/main建立 `feat/phase-2c-backtest-workbench`，已创建独立Draft PR #6；允许提交/推送/建PR及CI artifact，不直接修改main，不自动合并、tag、正式Release或部署。用户下载测试后决定合并。

## 已交付基线与验收边界

- Phase0 PR#1与Phase1A PR#2已合并，用户明确确认Windows总体通过；未提供逐项/浏览器版本不补写。
- Phase1B PR#3已合并，CSV/UTC、质量检查、图表/指标、IndexedDB、备份恢复保留。用户Windows未执行。
- Phase2A PR#4已合并，下一根开盘成交、固定信号、18位BigInt、逐笔守恒与身份保留；三平台159/17通过。本机当时超时不改为通过；用户Windows未执行。
- Phase2B PR#5已合并，MA/RSI/突破、保守止盈止损及版本契约保留。最新run39284322892三组实际日志各256项Vitest/17项E2E通过，补充原排队事实；本机最终256/17通过。用户Windows未执行。
- 原失败、当时状态和合并SHA在[progress](progress.md)完整保留；已执行、未执行、未通过分开，CI不替代Windows用户实机签署。

## 本轮实施顺序与技术决策

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

Phase2C待审及Windows用户验收后评估M2。下一阶段建议仍先审查可靠性和用户问题，再独立授权Phase3策略比较/样本外研究。当前不开发参数优化、滚动测试、AI、实时行情、真实账户/APIKey/钱包/实盘、杠杆/保证金/强平、正式Release或公开部署。

M0/M1/M2/M3/M4/M5门槛继续以原规划为准；用户授权当前阶段不补签先前未测试项目。原规划SHA256应保持0a3081d44d3557e6d0f1b1eda3378c2e83282b3c6677dcd45b88a3190b86f84b。

## 当前技术交付状态

Phase2C工程a4198f2的三平台307/24质量与Windows ZIP Chrome/Edge实际验证已全部通过（run39372868072），原失败与修正完整保留于progress。PR #6继续Draft待审，Windows用户清单仍未执行。收尾文档/入口标签提交的实际head CI与14天artifact以PR交付说明为准，必须核对完整SHA，不自动合并。
