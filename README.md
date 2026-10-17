# RiverLab Crypto Lab

中文、Windows 优先、离线优先的历史数据研究工具。当前为 **Phase 0 基础工程**：八页面入口、深浅主题、人工合成只读示例和自动检查。导入、图表、策略、回测、风险计算和回放均未开发。

**仅供学习研究 · 不提供投资建议 · 历史表现不代表未来表现。** 不连接真实账户、不接收密钥、不处理真实资金。

## Windows 快速开始

安装 Node.js 24 LTS 和 Git，在 PowerShell 运行：

```powershell
git clone https://github.com/meredithfyc1001/riverlab-crypto-lab.git
cd riverlab-crypto-lab
git switch feat/phase-0-foundation
npm ci
npm run dev
```

Edge/Chrome 打开终端提示的本机地址，默认 http://127.0.0.1:5173。首次安装依赖需要网络，页面运行无外部资源。Ctrl+C 停止服务。刷新保持 hash 页面，主题恢复默认深色。

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
- [data-import-format.md](docs/data-import-format.md)、[backtest-assumptions.md](docs/backtest-assumptions.md)：后续约束，尚未实现。

独立分支、待审 PR，用户 Windows 验收后再评审合并。
