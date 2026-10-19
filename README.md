# RiverLab Crypto Lab

中文、Windows 优先、离线优先的历史数据研究工具。Phase 0/1A 已合并并由用户总体验收；Phase 1B 已合并、云端技术复核通过，用户 Windows 实机未执行。当前 **Phase 2A** 增加纯 TypeScript 确定性成交内核和虚拟账本，固定信号用于测试，尚无回测 UI 或正式策略。保留 CSV/UTC/质量、OHLC/成交量、MA/EMA/RSI、IndexedDB 与 JSON 备份恢复。

**仅供学习研究 · 不提供投资建议 · 历史表现不代表未来表现。** 不连接真实账户、不接收密钥、不处理真实资金。

## Windows 快速开始

安装 Node.js 24 LTS 和 Git，在 PowerShell 运行：

```powershell
git clone https://github.com/meredithfyc1001/riverlab-crypto-lab.git
cd riverlab-crypto-lab
git switch feat/phase-1b-charts-storage
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

**不要双击 dist/index.html。** ES module 包经本机 HTTP 运行；未提供单 HTML、PWA、离线安装器或无 Node 发行包。vite preview 仅用于本机验收。后续方案见 [offline-release.md](docs/offline-release.md)。

## 文档

- [AGENTS.md](AGENTS.md)：开发约束与恢复流程。
- [plan.md](plan.md)：范围、路线与验收；[原始规划](docs/product-plan-v0.1.md) 保留附件全文。
- [progress.md](progress.md)：停点、实际验证和遗留问题。
- [architecture.md](docs/architecture.md)：可行性与边界；[testing-checklist.md](docs/testing-checklist.md)：Windows 实测清单。
- [Phase 1B Windows 验收](docs/phase-1b-acceptance.md)：用户手工清单，尚待执行。
- [data-import-format.md](docs/data-import-format.md)：CSV 支持范围与不确定性；[backtest-assumptions.md](docs/backtest-assumptions.md)：模拟约束与未实现项。
- [Phase 2A 设计](docs/phase-2a-design.md)和[固定案例验收](docs/phase-2a-acceptance.md)：成交模型、18位定点精度、可复现身份与测试命令。

独立分支、待审 PR，用户 Windows 验收后再评审合并。
