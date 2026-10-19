# RiverLab Crypto Lab

中文、Windows 优先、离线优先的历史数据研究工具。Phase 0 已验收并合并；当前为 **Phase 1A 数据导入**：CSV 字段映射、毫秒/微秒与 UTC 规范化、错误/重复/缺口报告、来源明确的历史/合成/错误样本。图表、指标、回测和回放尚未开发。

**仅供学习研究 · 不提供投资建议 · 历史表现不代表未来表现。** 不连接真实账户、不接收密钥、不处理真实资金。

## Windows 快速开始

安装 Node.js 24 LTS 和 Git，在 PowerShell 运行：

```powershell
git clone https://github.com/meredithfyc1001/riverlab-crypto-lab.git
cd riverlab-crypto-lab
git switch feat/phase-1a-csv-import
npm ci
npm run dev
```

Edge/Chrome 打开终端提示的本机地址，默认 http://127.0.0.1:5173。首次安装依赖需要网络，页面运行无外部资源。Ctrl+C 停止服务。刷新保持 hash 页面，主题恢复默认深色。

## CSV 使用

打开“数据中心”，选择本地 CSV 或来源明确的内置样本，检查表头/分隔符和六项字段映射，选择时间单位并确认固定周期，再生成报告。无法可靠确定单位时必须选择，周期留空时不计算零缺失结论。

文件仅在浏览器内通过 Worker 解码/解析/校验，不上传，支持 UTF-8 CSV（含 BOM），最多 10 MiB / 50,000 行。报告只在当前数据中心页面会话保留，离开页面或刷新后需重新导入；尚未提供数据持久化。详见 [导入格式与质量口径](docs/data-import-format.md)。

历史样本为固定来源存档的 BTCUSDT 2024-10-28 小时线；毫秒/微秒合成样本与错误样本均明确标记。历史追溯范围、哈希及取样方式见 [样本说明](src/features/datasets/samples/README.md)。

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
- [data-import-format.md](docs/data-import-format.md)：本轮已实现的 CSV 支持范围与不确定性；[backtest-assumptions.md](docs/backtest-assumptions.md)：尚未实现的回测约束。

独立分支、待审 PR，用户 Windows 验收后再评审合并。
