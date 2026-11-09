# RiverLab Crypto Lab

中文、Windows 优先、离线优先的历史数据研究工具。Phase 0/1A 已合并且用户总体验收通过；1B/2A/2B 已合并，但用户 Windows 实机尚未验收。**Phase 2C 已合并**（PR #6，实际提交 `33b1d6695ca1115efefce59132d96f8534c43e72`），已将三策略、保守风控与18位BigInt账本接入Worker回测工作台，包含纯TS统计、实验保存/重开、JSON/CSV与Windows本地测试ZIP。合并不代替用户Windows验收；本轮未收到新的实机反馈。CI和用户实机状态分列于progress，不自动合并。

**仅供学习研究 · 不提供投资建议 · 历史表现不代表未来表现。** 不连接真实账户、不接收密钥、不处理真实资金。

## Windows 快速开始

安装 Node.js 24 LTS 和 Git，在 PowerShell 运行：

```powershell
git clone https://github.com/meredithfyc1001/riverlab-crypto-lab.git
cd riverlab-crypto-lab
git switch main
npm ci
npm run dev
```

Edge/Chrome 打开终端提示的本机地址，默认 http://127.0.0.1:5173。首次安装依赖需要网络，页面运行无外部资源。Ctrl+C 停止服务。刷新保持 hash 页面，主题恢复默认深色。

## CSV 使用

打开“数据中心”，选择本地 CSV 或来源明确的内置样本，检查表头/分隔符和六项字段映射，选择时间单位并确认固定周期，再生成报告。无法可靠确定单位时必须选择，周期留空时不计算零缺失结论。

文件仅在浏览器内通过 Worker 解码/解析/校验，不上传，支持 UTF-8 CSV（含 BOM），最多 10 MiB / 50,000 行。报告只在当前数据中心页面会话保留；通过检查后，填写币种并确认警告，可选择“用于行情中心”或“保存已检查数据集”。有错误或待确认的数据不能截取好行用于研究。详见 [导入格式与质量口径](docs/data-import-format.md)。

历史样本为固定来源存档的 BTCUSDT 2024-10-28 小时线；毫秒/微秒合成样本与错误样本均明确标记。历史追溯范围、哈希及取样方式见 [样本说明](src/features/datasets/samples/README.md)。

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

当前配置和未保存结果只在网页会话保留，刷新后重置；已保存数据与实验刷新可见，需明确选择打开。IndexedDB隔离于浏览器/配置/HTTP来源和端口，**不保证永久保存**；配额/权限/事务失败明确提示，保留内存结果可导出。跨标签页列表变更需刷新。JSON需自己保管，后续算法版本可能需要保留旧测试包才能重算。实验JSON为完整报告和复现资料，本轮未提供实验JSON文件导入界面；原数据集JSON备份恢复保持可用。

## 下载 Windows 本地测试包

本次 [已验证测试包](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/42610440364/artifacts/13670985121) 对应主干合并SHA，保留至北京时间2026-11-23 19:41:32；后续请检查实际有效期。也可在 [合并后 main 的 Project quality 运行](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/42610440364) 底部 Artifacts 下载 `RiverLab-Crypto-Lab-Local-Test-<完整head SHA>`（登录有仓库访问权的GitHub账号）。保留14天，具体有效期见运行artifact元信息；排队/失败不产生可用测试ZIP。外层artifact含内层 `RiverLab-Crypto-Lab-Local-Test.zip`、ZIP校验和及Windows验证证据。核对build-info的完整SHA：本次主干包应为 `33b1d6695ca1115efefce59132d96f8534c43e72`。2026-10-20交付的旧artifact已过保留期，请使用新运行的产物；不要把旧提交包当作当前主干。

取出内层ZIP并全部解压到含中文/空格路径，系统先装Node.js24 LTS，双击 `start-local.bat`。无需npm ci/开发服务器，浏览器打开 `http://127.0.0.1:4173`，默认只监听回环。保持前台窗口，Enter、q再Enter或Ctrl+C停止，不留后台服务。端口占用明确退出，不自动切换存储来源；如手动使用其他端口，浏览器数据隔离。首次下载及安装Node需联网，包启动与核心功能无需外网。详见[包内说明](scripts/local-test/README-local-test.md)和[用户验收清单](docs/phase-2c-acceptance.md)。

开发者构建测试包：`npm run build` → `npm run package:local` → `npm run test:package`（本机Chromium可设置PLAYWRIGHT_CHROMIUM_EXECUTABLE）。产物在work/local-package，含dist、服务/BAT/说明、版本/提交SHA/dirty标记、逐文件SHA256，ZIP外另有SHA256。CI只打包clean head提交，三组check成功后Windows实际解压/启动Chrome与Edge验证全部成功才上传；不创建Release、不部署。本机dirty包仅供开发验证，不能冒充最终PR artifact。

## 文档

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

## Phase 3 策略研究（待审）

策略中心提供三策略固定参数比较及MA/RSI/突破敏感度网格；每格同时显示收益/回撤，不自动选优。可选择全区间、按时间样本内外拆分、滚动训练/测试。全部窗口独立本金、空仓、指标冷启动，测试严格晚于训练，不跨边界传递信号，不拼接独立收益。重复查看测试结果后调参会污染样本外证据。

先在数据中心保存已检查数据，再到策略中心选择，确认收盘和质量警告。配置统一本金/手续费/买卖滑点/保护，网格英文逗号列表；无效或重复单元阻止整批。每轴/组合最多25候选，最多20折/100次子运行/100万根求值。报告只在内存，刷新清除；JSON含原数据快照、参数、版本、口径、hash与统计，可重新导入校验重算（25MiB上限）；CSV为全部窗口比较摘要。原数据集/回测实验的IndexedDB保存约定不变。

见[设计](docs/phase-3-design.md)、[验收](docs/phase-3-acceptance.md)、[实际CI与下载状态](progress.md)。PR#7保持Draft，CI与Windows用户实机分别记录。此环境本机npm ci/check未执行；三平台CI结果须以实际日志为准。仅供学习研究，历史表现不代表未来表现。
