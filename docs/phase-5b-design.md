# Phase 5B 可视化规则策略 V1

2026-11-11 按 Issue #10 与用户明确授权启动。PR #9 已合并，基线 main 为 b0c9664fc5c37cf70686ca3735e317ad3c8a0a88。独立 feat/phase-5b-rule-editor；目标 Draft PR #10。GitHub 的 Issue/PR 共用编号，优先将现有 Issue #10 转为 Draft PR，保留任务正文。不合并、tag、Release 或部署，不开发网络行情、真实交易或脚本执行。

## DSL 与版本

StrategyRuleV1 是纯 JSON：schemaVersion=1、正整数 revision、buy/sell 两个组。每组 enabled、operator（AND/OR）、conditions（1..5）。条件有 enabled 与明确判别 kind：cross（MA/EMA、fastPeriod/slowPeriod、above/below）、price-ma（MA/EMA、period、gt/gte/lt/lte）、rsi（period、operator、threshold）、breakout（lookback、above/below）。没有嵌套组、隐式转换、任意代码或网络。所有对象逐层拒绝未知/缺少字段；布尔必须布尔，周期整数 1..50,000，快线小于慢线，RSI 有限数 0..100。启用的组至少一条启用条件，至少启用一侧。禁用条件仍验证，不能藏坏参数。

StrategyConfig 增加独立 kind=rules，配置内嵌规范化 rule；版本 causal-declarative-rules-v1。原三策略代码路径、STRATEGY_VERSION、引擎/转换/统计版本、账本和 hash 公式保持。新配置及 revision 自然进入原 manifest/runHash，实际信号进入 signalHash，原 dataHash 继续绑定完整输入。旧实验/研究/回放/风险报告不迁移、不覆盖，仍由原校验重算。未来 DSL 版本须新增显式解析器及迁移；V1 遇未知版本拒绝，禁止静默升级。

## 数值、因果与动作

逐根 onClose 只接收当前已完成 candle 冻结副本，无数据数组、未来索引或账户。运行实例独立保管历史窗口，验证连续时间、合法价格与最多 50k 根。MA 收盘均线使用 18 位整数滚动和，比较交叉相乘，不先舍入均线；cross 上一差 <=0 且当前 >0，或上一 >=0 且当前 <0；首次均线可用只建基线。price-ma 对当前收盘与含当前根的均线按显式符号比较，MA 至少 N 根。

EMA 复用 1B 定义：前 N 根收盘稳定 SMA 初始化，随后稳定凸组合 alpha=2/(N+1)；RSI 复用 1B/2B 的首 N 个差值均值及 Wilder，常量50、单涨100、单跌0。EMA/RSI 为 IEEE754 指标标量，无隐藏 epsilon，极接近阈值受舍入影响；不用于资金累计。EMA cross 至少 slow+1 根，RSI 至少 N+1 根。突破当前 close 严格大于此前 N 根 high 最大值/严格小于此前 N 根 low 最小值，等号不满足，当前根计算后才入队；至少 N+1 根。使用单调队列，避免 O(N×周期) 扫描。

每个条件输出 true/false/unknown。任一启用条件未预热则该组 unknown（即使 OR 另项为 true）；任一启用侧 unknown 则本根 hold/warmup，保留已知触发状态，不把 unknown 当 false。禁用侧恒 false。两侧均可判定后同时 true 一律 hold/conflict，消费两侧本根状态，无优先侧；须重新经历 false 后才可能触发。否则组从非 true 到 true 产生一次信号，持续 true 为 hold/repeat；交叉本身是一根脉冲。与旧 RSI/突破逐根重复信号不同，这是规则 V1 明确的保守边沿语义。保护退出或拒单后也不在持续 true 中自动重试。跨组不依赖顺序，组内顺序仅供解释；全部条件每根更新。

动作仍为 all：持仓买入/空仓卖出由原执行器拒绝，保持原原因和原始信号；不加仓、不做空。原保护优先、下一根开盘、费用/滑点/舍入与 stop-first 完全保留。末根信号到期无成交，末尾不强平。前缀追加未来数据后已有信号/成交/收盘快照必须不变；完整数据 hash 随完整输入变化属于正常行为。

## 编辑、持久化与入口

策略中心增加原生 fieldset/label 卡片编辑器：双侧启用、AND/OR、条件增删/复制/启用、参数、实时中文错误与解释；最多五条，深浅主题和390px。保存后再次编辑产生 revision+1，旧记录不可变；复制为新家族 v1。独立 IndexedDB 规则库，以不可变 id 保存每个版本与 familyId、名称、日期、内容 hash；事务 complete 才成功。同家族版本冲突拒绝，不覆盖。删除指定版本须确认，不影响已内嵌规则的实验。JSON 严格字段/版本/hash、最大128KiB；导入先预览，明确保存后才持久化。损坏/配额/abort 显式失败，内存草稿可导出。IndexedDB 不保证永久保存。

app 装配规则编辑与回测选用，features 不互相导入。回测中心选择已保存的具体规则版本并显示中文语义，原 Worker/runExperiment/runBacktest 完成计算与实验保存/复现。规则版本修改不改变已运行输入。Phase3 研究比较、网格与样本外暂不支持 rules，UI 明示，核心拒绝，绝不映射到三策略。历史回放保持手工模式；风险分析可使用经 verifyExperiment 重算通过的规则实验。

## 性能与验收

最多10条件、50k根；单调队列/环形均线窗口，每条件摊销 O(1)/根、O(周期) 状态。JSON大小与版本数有上限，不新增依赖。实际 Worker 50k 条件组合及结果绘图总预算20秒、主线程最大观察间隔1000ms，保留旧阈值；记录CPU/核数/OS/Node/浏览器/时长。报告全量，不以抽样代替计算。

保留旧354项单元/40项E2E及所有冻结参考，不删断言/跳过/放宽门槛。新增各条件/符号等号/AND/OR/双侧/预热/冲突/重复/无动作/末根/非法类型数字字段版本预算、每个历史前缀因果、独立 Python Decimal 指标和信号、相同配置结果/hash及旧版本隔离、存储失败与 JSON 往返。执行 npm ci、完整 npm run check、所有独立 Python 参考。Ubuntu Chromium/Windows Chrome/Edge 读取实际成功日志后，后置 Windows 中文空格 ZIP job 双浏览器实际 BAT 启动/规则创建→回测→保存→JSON→刷新重开→外部origin拦截→停止；成功才上传14天 artifact，完整最新headSHA、dirty=false、phase=5B、校验与有效期。Linux测试、Windows CI、用户实机/物理断网分列，历史 Edge 等待超时事实保留。
