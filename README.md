# RiverLab Crypto Lab

RiverLab 是中文、Windows 优先的本地现货历史研究工具。Phase 5C-A 测试版为 **1.1.0-test.1**，支持单币种研究和多币种独立子账户组合。稳定基线为 PR #11 的实际合并提交 `c8ded9304785a06c713f5a830caf292bacbc918f`。

**仅供学习研究 · 不提供投资建议 · 历史表现不代表未来表现。** 不连接真实账户、不接收密钥、不处理真实资金。

## Windows 快速开始

使用测试包请先安装 Node.js 24 LTS，将内层 ZIP 完整解压，双击 `start-local.bat`。浏览器打开本地地址后保持控制台开启。退出和包校验见下方“下载 Windows 本地测试包”。

从源码运行需要 Git。在 PowerShell 运行：

```powershell
git clone https://github.com/meredithfyc1001/riverlab-crypto-lab.git
cd riverlab-crypto-lab
git switch feat/phase-5c-portfolio-backtest
npm ci
npm run dev
```

Edge/Chrome 打开终端提示的本机地址，默认 http://127.0.0.1:5173。首次安装依赖需要网络，页面运行无外部资源。Ctrl+C 停止服务。刷新保持 hash 页面，主题恢复默认深色。

## CSV 使用

打开“数据中心”，选择本地 CSV 或来源明确的内置样本，检查表头/分隔符和六项字段映射，选择时间单位并确认固定周期，再生成报告。无法可靠确定单位时必须选择，周期留空时不计算零缺失结论。

文件仅在浏览器内通过 Worker 解码/解析/校验，不上传，支持 UTF-8 CSV（含 BOM），最多 10 MiB / 50,000 行。报告只在当前数据中心页面会话保留；通过检查后，填写币种并确认警告，可选择“用于行情中心”或“保存已检查数据集”。有错误或待确认的数据不能截取好行用于研究。详见 [导入格式与质量口径](docs/data-import-format.md)。

历史样本为固定来源存档的 BTCUSDT 2024-10-28 小时线；毫秒/微秒合成样本与错误样本均明确标记。历史追溯范围、哈希及取样方式见 [样本说明](src/features/datasets/samples/README.md)。

## 多币种组合回测

在数据中心分别检查并保存 2～5 个不同交易对的数据集。从「回测中心」进入「组合回测」，填写统一报价货币、初始本金及各子账户权重。权重精确合计 100%；每个账户可选择自己的内置策略或已保存规则修订，并设置费用、滑点、止盈止损。交易对支持 BTC/USDT、BTC-USDT 或与明确报价币匹配的紧凑符号。

核对每项数据的原始范围、两端截取和所选 UTC 开盘区间，确认后运行。各子账户从共同区间独立冷启动。组合结果展示含现金的实际账户权重、按持仓市值计算的资产权重、组合与子账户权益曲线、买入持有基准、相关性及独立成交明细。

组合源快照合计最多 10,000 根，含截去部分；报告上限 32 MiB。保存后可重开或完整复现。换到新浏览器时，在组合页导入完整 JSON，核对重算结果后保存。CSV 用于汇总分析。JSON 备份包含用到的规则与原始行情，不依赖原配置中的其他本地库。[技术设计](docs/phase-5c-design.md) · [实现复核](docs/phase-5c-review.md)

## 图表、保存与备份

行情中心支持 K 线/成交量、滚轮缩放、拖动/按钮平移、UTC 十字准星读数。MA/EMA 叠加，RSI 独立区域；周期可调整。EMA 用首周期 SMA 初始化，RSI 用 Wilder 平滑；不足显示 NA，缺口后重新预热。数值口径与选型见 [Phase 1B 设计](docs/phase-1b-design.md)。

本地数据集可明确保存、选择打开和确认删除。IndexedDB 限于相同浏览器/用户配置/HTTP 来源，**不是永久可靠存储**；隐私模式、配额或清理可使其丢失。请用“导出当前数据 JSON”下载备份，恢复时导入 JSON、核对来源/范围/警告并确认恢复为新副本。备份上限20 MiB/50,000根（JSON 有额外元信息），CSV 上限不变；不含原 CSV，另行保留原文件。存储失败时内存数据仍可导出。

## 检查与构建

```powershell
npx playwright install chromium
npm run check
```

check 顺序执行格式、ESLint、Vitest、TypeScript strict、Vite 构建、生产包 Playwright。单独命令：format:check、lint、test、typecheck、build、test:e2e；npm run format 自动格式化。

Windows 已安装 Chrome/Edge 时可分别运行（先构建）：

```powershell
npm run build
$env:E2E_BROWSER = "chrome"
npm run test:e2e
$env:E2E_BROWSER = "msedge"
npm run test:e2e
Remove-Item Env:E2E_BROWSER
```

Linux：`npx playwright install --with-deps chromium`。受管环境已装系统 Chromium 时可运行：

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run check
```

CI 在 Ubuntu Chromium、Windows Chrome、Windows Edge 上运行相同检查并保留浏览器报告。配置存在不等于通过，实际结果以 PR 和 progress.md 为准。

## 生产包与离线方式

```powershell
npm run build
npm run preview -- --port 4173 --strictPort
```

Edge/Chrome 打开 http://127.0.0.1:4173。可断开外部网络后刷新和操作，本机服务须保持运行。dist 是标准静态包，无远程字体、CDN、遥测或 API。

**不要双击 dist/index.html。** ES module 包经本机 HTTP 运行；没有单 HTML、PWA或嵌入Node的安装器。本轮ZIP包含生产静态包、Node内置模块HTTP服务与BAT启动器，见下方说明。vite preview仍用于开发验收。

## Phase 2C 回测与实验

在数据中心明确保存通过检查的数据，然后进入回测中心选择。显示来源、币种、周期、UTC范围与质量警告；缺口/损坏/重复/未确认/未收盘数据阻断，不截取有效子集或修复。选择MA交叉、RSI阈值或历史high/low突破，严格校验参数；默认1000虚拟USDT，可配置双边费/滑点、数量精度、最小额及止盈止损。24根真实样本不足默认MA慢30，可用快2慢4做流程测试，不能据此宣称策略有效。

原核心在Worker执行，支持取消；显示全部收盘权益/买入持有与回撤点、分页成交账本、拒单/取消/到期与保护原因。现金/持仓市值/总权益与已实现/浮动盈亏分列。胜率与利润因子只用完整平仓周期，手续费和滑点已扣；未完成仓位不计胜负。CAGR需至少365天/252根且首末权益>0，其余NA与原因；暴露为K线区间上界，不冒充精确根内时长。完整口径见[2C设计](docs/phase-2c-design.md)。

“保存回测实验”明确写入IndexedDB；实验中心可打开、复现、确认删除。保存数据快照、身份/hash、完整配置/实际信号、版本、假设与统计；重开在Worker校验并重算比对，损坏/不支持版本拒绝。删除实验不改原数据；数据集被删后实验内嵌快照仍可重开。JSON含完整复现数据和配置，CSV为逐笔成交；均附研究警告。报告校验和不能认证来源。

当前配置和未保存结果只在网页会话保留，刷新后重置；已保存数据与实验刷新可见，需明确选择打开。IndexedDB隔离于浏览器/配置/HTTP来源和端口，**不保证永久保存**；配额/权限/事务失败明确提示，保留内存结果可导出。跨标签页列表变更需刷新。JSON需自己保管，后续算法版本可能需要保留旧测试包才能重算。在实验中心选择实验 JSON，等候 Worker 校验和重算，核对预览中的标识，再确认保存。重名与原记录同 ID 的区别、每种备份所需资料见[备份与恢复](docs/rc-backup.md)。

## 下载 Windows 本地测试包

在 [Phase 5C-A Draft PR](https://github.com/meredithfyc1001/riverlab-crypto-lab/pulls?q=is%3Apr+head%3Afeat%2Fphase-5c-portfolio-backtest) 的交付说明中核对完整 head SHA、Windows 内层 ZIP 的 SHA-256、下载链接及到期时间。GitHub Actions 仅在三平台检查和 Windows ZIP 双浏览器验证成功后上传 `RiverLab-Crypto-Lab-Local-Test-<完整head SHA>`，保留 14 天。下载私库制品需要具有访问权的 GitHub 账号。

取出内层ZIP并全部解压到含中文/空格路径，系统先装Node.js24 LTS，双击 `start-local.bat`。无需npm ci/开发服务器，浏览器打开 `http://127.0.0.1:4173`，默认只监听回环。保持前台窗口，Enter、q再Enter或Ctrl+C停止，不留后台服务。端口占用明确退出，不自动切换存储来源；如手动使用其他端口，浏览器数据隔离。首次下载及安装Node需联网，包启动与核心功能无需外网。详见[包内说明](scripts/local-test/README-local-test.md)和[组合 Windows 验收清单](docs/phase-5c-acceptance.md)。

开发者构建测试包：`npm run build` → `npm run package:local` → `npm run test:package`（本机Chromium可设置PLAYWRIGHT_CHROMIUM_EXECUTABLE）。产物在work/local-package，含dist、服务/BAT/说明、版本/提交SHA/dirty标记、逐文件SHA256，ZIP外另有SHA256。CI只打包clean head提交，三组check成功后Windows实际解压/启动Chrome与Edge验证全部成功才上传；不创建Release、不部署。本机dirty包仅供开发验证，不能冒充最终PR artifact。

## 文档

- [RC 设计](docs/rc-design.md)、[工程复核](docs/rc-review.md)、[Windows 验收清单](docs/rc-acceptance.md)。
- [首次导入](docs/data-import-format.md)、[六类 JSON 备份与恢复](docs/rc-backup.md)。

- [Phase 2C设计](docs/phase-2c-design.md)、[实现复核](docs/phase-2c-review.md)、[Windows用户验收](docs/phase-2c-acceptance.md)及[原始测试证据](docs/phase-2c-evidence)。

- [AGENTS.md](AGENTS.md)：开发约束与恢复流程。
- [plan.md](plan.md)：范围、路线与验收；[原始规划](docs/product-plan-v0.1.md) 保留附件全文。
- [progress.md](progress.md)：停点、实际验证和遗留问题。
- [architecture.md](docs/architecture.md)：可行性与边界；[testing-checklist.md](docs/testing-checklist.md)：Windows 实测清单。
- [Phase 1B Windows 验收](docs/phase-1b-acceptance.md)：用户手工清单，尚待执行。
- [data-import-format.md](docs/data-import-format.md)：CSV 支持范围与不确定性；[backtest-assumptions.md](docs/backtest-assumptions.md)：模拟约束与未实现项。
- [Phase 2A 设计](docs/phase-2a-design.md)和[固定案例验收](docs/phase-2a-acceptance.md)：成交模型、18位定点精度、可复现身份与测试命令。

- [Phase 2B 设计](docs/phase-2b-design.md)、[代码自查](docs/phase-2b-review.md)与[Windows清单](docs/phase-2b-acceptance.md)：三策略、保护单、跳空/双触发优先级和真实测试边界。

Phase 2C 已合并。后续改动继续使用独立分支和待审 PR；用户 Windows 结果、CI 与云端验证分别记录。

## Phase 3 策略研究（已合并）

策略中心提供三策略固定参数比较及MA/RSI/突破敏感度网格；每格同时显示收益/回撤，不自动选优。可选择全区间、按时间样本内外拆分、滚动训练/测试。全部窗口独立本金、空仓、指标冷启动，测试严格晚于训练，不跨边界传递信号，不拼接独立收益。重复查看测试结果后调参会污染样本外证据。

先在数据中心保存已检查数据，再到策略中心选择，确认收盘和质量警告。配置统一本金/手续费/买卖滑点/保护，网格英文逗号列表；无效或重复单元阻止整批。每轴/组合最多25候选，最多20折/100次子运行/100万根求值。报告只在内存，刷新清除；JSON含原数据快照、参数、版本、口径、hash与统计，可重新导入校验重算（25MiB上限）；CSV为全部窗口比较摘要。原数据集/回测实验的IndexedDB保存约定不变。

见[设计](docs/phase-3-design.md)、[验收](docs/phase-3-acceptance.md)、[实际CI与下载状态](progress.md)。PR#7最终三平台317项Vitest/30项E2E及WindowsZIP通过并已合并；当时云环境不可用，本机未执行，不能等同用户Windows实机验收。本轮环境已恢复，Phase4本机与CI记录分列。仅供学习研究，历史表现不代表未来表现。

## Phase 4 历史回放（已合并）

先在数据中心保存无缺口且已确认的数据；到“历史回放”选择数据、虚拟本金（默认1000）、手续费/买卖滑点与可选止盈止损并确认收盘。开始只揭示首根收盘；“排队虚拟买入/卖出”不会立即改变余额，下一次推进才在下根开盘执行。每根最多一笔，数量支持all或固定币数量，不透支；保护规则沿用原回测，根内双触发止损优先，末尾不强平。

支持单步、自动播放/暂停、显式快进、日记、现金/持仓/权益与净值/回撤。回放组件与Worker响应仅含已播放OHLCV；未播放行情不画图、不进入CSV或状态JSON。其他页面或原CSV可看到行情，因此这不是防作弊系统。

保存回放状态后刷新需明确打开，恢复保持暂停；未保存状态刷新清除。保存与JSON只含原数据集身份/hash、配置、游标、决策、日记及重算校验，不含行情，**必须保留原保存数据集且身份/hash一致**。原数据删除、ID变化或损坏时明确拒绝，不自动替换；状态JSON不是独立行情备份。当前排队单恢复后只在下一根执行一次。快照采用独立IndexedDB库，不覆盖原数据集/回测实验；浏览器存储不保证永久可靠，请实际下载JSON并保管原CSV/数据集备份。

上限50,000根、1,000次手工决策、1,000条日记、每条2,000字符、JSON10MiB；成交与日记CSV只导出已播放事件。所有模拟成本已扣，浮盈不算完成交易胜负；短样本年化NA。按[设计](docs/phase-4-design.md)及[Windows清单](docs/phase-4-acceptance.md)验收，CI与用户实机分别记录。ZIP无需npm ci，Node24LTS预装。仅供学习研究，历史表现不代表未来表现。

Phase4功能提交1edb8f1已通过三平台各338项Vitest/35项E2E与WindowsZIP双浏览器实测，见[CI证据快照](docs/phase-4-ci-evidence.json)及progress；最终提交下载使用PR#8说明绑定当前head的链接。用户Windows实机/物理断网尚待反馈，不以CI补签。

## Phase 5A Monte Carlo 风险分析（已合并）

在回测中心保存正式MA/RSI/突破实验，风险中心选择源实验，Worker先校验并重算。检查原策略/本金/费/滑点/保护、已实现/浮动和数据hash，再选择IID或连续区块、固定uint32种子、路径数/步数及初始本金比例阈值。源至少20根，权益严格为正且有变化；不足、坏源、含0或常量权益不生成假0%风险。

模型对已扣历史成本的逐根净权益比例重采样，资金每步18位BigInt向下舍入。分位带、终值/回撤、亏损/阈值次数和频率是模型内情景，不是未来置信区间、真实亏损概率、盈利承诺或自动最佳策略。原浮动盈亏明确包含；不重新撮合、不重算费用/保护或真实资金约束。0/路径数只是本次未观察到，增加路径不能消除样本与参数选择偏差。

支持保存/重开/删除、全部路径摘要CSV和完整JSON，导入后重建源实验并重采样逐项比对。源复现输入已内嵌，原数据或实验删除后仍可恢复；原记录不覆盖。JSON导入仅在内存、仍需明确保存；刷新未保存结果清除，保存列表需主动打开。浏览器存储不是永久备份，JSON25MiB上限，含数据快照需自行保管。

路径20–2000、步数1–50,000、总路径×步数最多200万，区块最长min(源长度,1000)，seed0–4294967295，阈值1–99%。默认500路径/100步/seed42/50%阈值。图中最多101个位置和首5条示例路径仅作展示，全部步骤参与统计；不生成未来UTC或年化。见[方法与边界](docs/phase-5a-design.md)、[验收清单](docs/phase-5a-acceptance.md)。仅供学习研究，历史表现不代表未来表现。

## 规则策略编辑器（Phase 5B 已合并）

1. 在策略中心新建规则：买入/卖出分别启用，选择AND或OR，各1–5条条件，可复制/删除/禁用。条件支持MA/EMA交叉、收盘与MA/EMA比较、Wilder RSI显式阈值与等号、前N根high/low突破（当前根不入窗口）。表单实时校验并解释。
2. 保存具体版本后在回测中心选择“自定义规则 V1”及版本，再选择已保存数据/成本/保护并确认收盘。结果、逐笔账本、实验保存/JSON/CSV/刷新重开/复现仍走原Worker和18位资金引擎。旧三策略与报告不改版本/hash。
3. 未预热为不可判定，OR也不绕过未知项；双侧同根满足hold/conflict。条件持续满足只触发一次，须先false再true；与旧RSI/突破重复信号语义不同。保护退出或拒单后不自动重试，已持仓买/空仓卖由原执行器拒绝。收盘信号下一开盘，末根不成交。
4. 保存后的修改生成同一家族新版本，复制为新策略从v1开始。旧版本不可覆盖，删除前确认；旧实验内嵌完整规则，删除规则不影响复现。JSON128KiB内、严格字段/版本/hash，导入仅内存，需明确保存；同家族同版本冲突拒绝。每库最多100版本，IndexedDB不是永久备份。
5. EMA/RSI仍为IEEE754指标标量，极近阈值受舍入影响；MA比较用18位整数，资金全程BigInt。Phase3网格/样本外研究暂不支持规则，UI提示且核心拒绝。规则按子账户执行现货多头历史模拟，没有用户脚本、真实下单或联网行情。

[设计](docs/phase-5b-design.md) · [验收清单](docs/phase-5b-acceptance.md) · [实施与测试](docs/phase-5b-review.md)。
