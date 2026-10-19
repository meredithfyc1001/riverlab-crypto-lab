# RiverLab Crypto Lab 进度

## 当前恢复入口（2026-10-19，Asia/Shanghai）

- 已同步并核对 main：6ffe6a3186699ae85a26331efa932c3bcec500a2，即 PR #1 实际合并提交。GitHub 显示 merged=true，合并时间北京时间 2026-10-19 17:57:48。
- 用户本轮明确确认 Phase 0 已验收、Windows Edge/Chrome 本地测试均通过，M0 通过。版本/逐项结果未提供，清单只更新总体状态。
- 当前授权 Phase 1，仅实施 **1A：CSV 导入/映射、UTC 毫秒、数据质量与来源样本**。从 main 建立 feat/phase-1a-csv-import，目标独立 PR #2，未修改 main。
- 已完整重读 AGENTS、plan、本文件和产品规划；先更新文档，再完成 1A 解析、UI/Worker、样本与报告。[PR #2](https://github.com/meredithfyc1001/riverlab-crypto-lab/pull/2) 已创建，open/draft，等待用户审查和 Phase 1A Windows 手工验收；不自动合并或推进 1B。
- 图表、技术指标、回测、真实账户/API Key/资金/交易、实时抓取不在本轮范围。
- 本轮 npm ci 通过。原文保留修正后完整 npm run check 通过：76 项 Vitest、7 项 E2E；最新 CI 结果见 PR #2 Checks（自动更新），此前初版三组 75/7 通过证据在下方保留。Phase 1A 用户 Windows 手工仍未测试。

## Phase 1A 实施与验证

- 文档先行提交 0cf370f：核实 PR #1 合并与用户总体验收，授权 1A，原规划全文不修改。
- core/data：严格 CSV、唯一字段映射、ms/us/带时区 ISO、UTC 整毫秒、重复/降序/缺口/数值/OHLC/格式检查、错误总数与有限明细、资源上限。不猜测周期/单位，不补价、不排序或去重原数据。
- 数据中心：实际 Worker 读取/哈希/校验，映射和确认界面、导入摘要/错误行/警告/缺口、来源身份、取消/旧结果失效；仅当前页面内存报告。
- 样本：固定上游提交的 BTCUSDT 2024-10-28 24 条历史记录（原 ZIP、CSV、哈希/变换/核验边界），合成 ms/us、人工错误样本分别标记。未获取原生 2025 微秒归档，不把合成测试当作真实微秒样本。
- npm ci 已执行通过（依赖和锁文件未修改）。首轮 74 项 Vitest 通过；扩展 ZIP 证据测试时发现 Node 测试类型缺失和 Vite 对静态 ZIP URL 的转换，已用独立 tsconfig.test 与 Node 路径读取修正，75 项完整复验通过。
- 第一轮生产包浏览器 5 通过/2 失败：均为时间单位精确 label 定位超时；改为同名 combobox 角色后，针对两项复验 2/2 通过，最终完整 E2E 7/7 通过，断言未删减。首轮证据暂存 work/phase-1a-initial-e2e-failure，失败事实在此归档。
- 初版完整命令 PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run check 已实际执行通过：格式、lint、6 文件/75 项 Vitest、独立核心/应用/测试类型检查、生产构建、7 项 E2E，0 失败/跳过。日志 work/phase-1a-final-check.log 为本机临时证据，CI 将独立保留报告。
- 平台：Linux、Node.js 24.19.0、Chromium 154.0.8037.57。E2E 包含真实 Worker/哈希、历史 24 行/UTC、微秒和歧义确认、手动映射/ISO 偏移、错误/重复/缺口、UTF-8/空/超限、旧结果失效、离线本机资源、390px。React 人工复核：无条件 Hook、事件内异步任务、旧任务 generation 失效、卸载终止、分页和有上限渲染、可访问 label/role。
- 初版构建：56 modules；Worker 11.54 kB，应用 JS 253.54 kB（gzip 80.83 kB），CSS 14.06 kB。原始规划 SHA256 仍为 0a3081d44d3557e6d0f1b1eda3378c2e83282b3c6677dcd45b88a3190b86f84b。22 条本地文档链接检查通过。

| 验收项目                              | 当前结果                                                      |
| ------------------------------------- | ------------------------------------------------------------- |
| Phase 0 用户 Windows Edge/Chrome 总体 | 通过（用户 2026-10-19 明确反馈）                              |
| Phase 0 逐项未提供证据                | 不补写，保留原清单记录                                        |
| Phase 1A 本机自动检查                 | 原文修正后通过：76 项 Vitest + 7 项 E2E + 类型/lint/格式/构建 |
| Phase 1A CI                           | 初版三组 75/7 通过；原文修正后的最终提交状态见 PR #2 Checks   |
| Phase 1A 用户 Windows 手工            | 未测试，不继承 Phase 0 成绩                                   |

遗留：仅当前页面内存报告、固定周期、有明确文件/明细上限；首尾完整与来源真实性不能自动证明；原生 2025 微秒/更多币种归档待后续真实样本补充。无 ZIP 导入、持久化、图表、指标、回测和交易能力。

## 原文保留修正与最终本机复验

收尾发现错误明细曾以解析后单元格重拼，丢失 CSV 原始引号/转义。现以原记录起止偏移保留原文片段（含记录内部 CRLF、引号、转义，不含终止换行），报告和界面使用该片段，不冒充重建文本。新增纯 TS 回归及实际 Worker/浏览器原文断言，原有物理行号与解析值断言保留。

原文修正后完整 npm run check 已执行通过：6 文件/76 项 Vitest、7 项 E2E、格式/lint/类型/构建，0 失败/跳过，日志 work/phase-1a-final-check-with-raw.log。新增 E2E 断言后一次格式检查未通过，重新格式化后完整复验通过；未删断言。最终 CSS 14.11 kB，其余构建量级不变。

修正代码与本节作为独立 fix 提交进入同一 PR #2；最终 CI 由 PR Checks 自动记录，下面旧 CI 只证明修正前初版。用户 Phase 1A Windows 手工验收仍未测试，等待审查，不自动合并。

## Phase 1A 初版 CI 与提交归档（原文修正前）

- 实现提交：9c19b17f392f5256c18fc59ec3d700ff9dd51287；文档先行提交 0cf370f。基线 main 仍为 6ffe6a3，已核对远端，未直接修改 main。
- [PR #2](https://github.com/meredithfyc1001/riverlab-crypto-lab/pull/2) open/draft，未合并、未发布；随后仅归档本文档，最新 Checks 以 PR 为准。
- [工程提交 CI](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39237660637) 三组 completed/success，已读实际日志，各 6 文件/75 项 Vitest、7 项 E2E，无失败/跳过；格式/lint/类型/构建亦通过。
- [Windows Edge](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39237660637/job/118010565150)、[Windows Chrome](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39237660637/job/118010565358)、[Ubuntu Chromium](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39237660637/job/118010565360)。具体 Windows/浏览器版本未采集，不补写。
- 额外用 Python 标准 zipfile 解压保留的来源 ZIP，逐字节比较应用 CSV：完全相同，共 24 行，SHA256 与 provenance 一致。该一次性核验不引入 Python 运行/测试依赖。
- 后续：用户按 docs/phase-1a-acceptance.md 验收并审查 PR #2，下一轮再安排 1B。Phase 0 用户通过不等于 Phase 1A 用户通过；原生 2025 微秒样本、持久化与完整 Phase 1 能力尚未验收。

当前验收状态：Phase 0 用户 Edge/Chrome 总体通过；Phase 1A 用户 Windows 未测试，逐项清单见 [Phase 1A 验收](docs/phase-1a-acceptance.md)。后续计划为 1A 审查/验收后再安排 1B 图表/基础指标/存储，不在本轮开发。

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
