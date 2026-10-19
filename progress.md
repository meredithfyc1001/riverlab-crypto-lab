# RiverLab Crypto Lab 进度

## 当前恢复入口（2026-10-19，Asia/Shanghai）

- 已同步并核对 main：6ffe6a3186699ae85a26331efa932c3bcec500a2，即 PR #1 实际合并提交。GitHub 显示 merged=true，合并时间北京时间 2026-10-19 17:57:48。
- 用户本轮明确确认 Phase 0 已验收、Windows Edge/Chrome 本地测试均通过，M0 通过。版本/逐项结果未提供，清单只更新总体状态。
- 当前授权 Phase 1，仅实施 **1A：CSV 导入/映射、UTC 毫秒、数据质量与来源样本**。从 main 建立 feat/phase-1a-csv-import，目标独立 PR #2，未修改 main。
- 已完整重读 AGENTS、plan、本文件和产品规划。先更新文档，下一行动是实现纯 TS CSV 数据契约与解析测试，再接 UI/Worker 和报告。
- 图表、技术指标、回测、真实账户/API Key/资金/交易、实时抓取不在本轮范围。
- 本轮 npm ci、npm run check、Windows CI/用户测试：均待执行，后续据实更新。

## Phase 0 历史归档（保留当时事实，已由上述最新状态覆盖）

- 日期：2026-10-18（Asia/Shanghai），Phase 0 工程已实现，本机及三组 CI 全通过；等待用户 Windows 手工验收，M0 尚未最终验收。
- 独立仓库 meredithfyc1001/riverlab-crypto-lab；main 基线 3867029fe4bc23290b4a616c1bed6ae6b700d4a0；分支 feat/phase-0-foundation。
- 完整阅读附件 v0.1，原文 docs/product-plan-v0.1.md；参考 GTO 的 AGENTS/脚本，无业务复用。
- [PR #1](https://github.com/meredithfyc1001/riverlab-crypto-lab/pull/1) 已创建，open/draft，未合并、未发布。工程提交 85f55c3ac1e2d5f5d4618650eeb625cdd995a71a。
- 下一行动：按 Windows 清单手工验收后评审 PR。Phase 1 及后续均未启动。

## 本轮改动

React/TypeScript/Vite、中文八入口、深浅主题、4 条明确标识的合成只读示例、永久风险提示；纯 TS 数据/策略/回测/风险边界；格式/lint/类型/Vitest/Playwright 与 Linux/Windows CI；开发、规划、离线/验收文档。

## 验证账本

| 项目                   | 状态                 | 证据/备注                                             |
| ---------------------- | -------------------- | ----------------------------------------------------- |
| 依赖安装               | 通过                 | npm install 后再用 npm ci 重装成功，锁文件可复现      |
| 首轮 lint              | 通过                 | npm run lint                                          |
| 首轮 Vitest            | 通过                 | 3 文件、11 测试                                       |
| 首轮类型检查           | 失败已修复、复验通过 | E2E 配置补 DOM lib；core 独立无 DOM 检查通过          |
| npm run check          | 通过                 | 格式、lint、11 项 Vitest、类型、构建、2 项 E2E 全通过 |
| 开发启动               | 通过                 | Vite 5173 启动，浏览器中文工作台/导航/键盘跳转通过    |
| 生产包 Linux Chromium  | 通过                 | Chromium 154.0.8037.57，1440×1000 与 390×844          |
| Ubuntu CI Chromium     | 通过                 | 首轮 workflow 39055867895，11 项 Vitest + 2 项 E2E    |
| Windows CI Chrome/Edge | 两组均通过           | 同一 workflow，两组均为完整 npm run check             |
| 用户 Windows 实机      | 未测试               | docs/testing-checklist.md                             |

生产包 E2E 验证八入口、刷新、后退、深浅主题、合成样例、各页风险提示、仅本机 HTTP 请求、无页面或控制台错误、窄屏无页面溢出。另执行 5 项 ESLint API 边界探针：拒绝 core→React、core→window、feature→兄弟模块、shared→core；允许 feature→core 公共类型，全部通过。人工查看工作台截图，布局与标识正常。

本地构建：40 modules，HTML 0.72 kB，CSS 10.25 kB，JS 232.70 kB（gzip 73.28 kB）。附件原文 SHA256：0a3081d44d3557e6d0f1b1eda3378c2e83282b3c6677dcd45b88a3190b86f84b，与保存原件一致。

## CI 归档

工程提交 85f55c3 的 [首轮 CI](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39055867895) 三组均 completed/success，已核对实际日志，每组均为 3 文件/11 项 Vitest 与 2 项生产包 E2E，无失败/跳过测试。

- [Windows Edge](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39055867895/job/117463593468)
- [Windows Chrome](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39055867895/job/117463593642)
- [Ubuntu Chromium](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39055867895/job/117463593692)

本次随后仅归档文档；最新提交的自动检查以 PR Checks 为准。Windows CI 是真实 Windows runner 自动化证据，不代替用户机器的手工验收；未获取实际浏览器版本，不补写版本号。浏览器报告由 CI artifact 保存 14 天。

## 环境与遗留

初始代理不可连；使用受支持的网络权限后 npm/Git 恢复。初次 npm 安装触及不可写的默认缓存，已将缓存放到项目 work/。未输出密钥。

首轮 E2E 的本机服务因沙箱网络权限无法启动，使用受支持网络权限后完整通过。Linux 检查显式使用系统 Chromium，不将其描述为 Windows 原生测试。GH CLI 登录检查未能确认有效认证；Git 和 GitHub connector 分别用于推送和 PR。

没有真实数据导入、图表、业务计算或存储，没有账户/资金连接。静态包经本机 HTTP；单 HTML、file:// 和离线安装器未实施。Windows 用户验收待完成，M0 尚未通过。

建议先完成 Windows 两浏览器手工验收和 PR 评审，再由用户启动 Phase 1，优先真实 CSV 样本、毫秒/微秒识别、无效行和缺口报告。
