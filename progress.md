# RiverLab Crypto Lab 进度

## Phase 6C-A 浏览器完整导出

2026-11-27 核对远端。#17 仍是 Draft，head 为 `80c367a`，base 为 `feat/phase-5e-advanced-research` 上 #16 的实际合并点 `5a75f34`。其四组浏览器作业与 Ubuntu/macOS Rust 通过，Windows 浏览器 ZIP 作业失败，安装态作业跳过。6C-A 从 #17 的 head 派生并以该分支为 PR base。6A 第三轮和 6E Windows 用户实机保持待测。[6B 工作流](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/45788772852)

真实 Chromium 合成验证已完成九库十七 store 的完整导出及独立 Python 复读。用新浏览器上下文重建后逐项比较主键、正文、摘要和共享引用；重复导出的稳定指纹为 `da5a03bb410c69b46803e712fe4f715f7d80974f790f9965247d7a6e40d54fae`。早期实现拒绝了合法的共享对象引用，在原实验 signals 与高级研究的 fold/window 上暴露；V1 现保存非循环引用的类型化路径并验证读回。现有 11 组独立数值参考和 Linux 原生 27 项回归通过。不同操作系统及最终提交 SHA 的质量、制品摘要和待验项目见 [Draft PR #18](https://github.com/meredithfyc1001/riverlab-crypto-lab/pull/18)。[完整格式](docs/phase-6c-a-snapshot.md) · [Windows 清单](docs/phase-6c-a-acceptance.md)

清洁构建的 Linux Chromium 全量 E2E 曾有两项失败。149,197 字节的合成包小于 256 KiB 输出缓冲，首次目标写入延后至九库只读事务完成；旧标签页已能提交写入或申请升级。现于全部事务仍覆盖共同屏障时发送布局并等待目标确认，再读取各库的记录。

## Phase 6B 桌面本地服务

Git fetch 与 GitHub PR 元数据已交叉核实。main 停在 `10a5d88`，PR #16 于北京时间 2026-11-26 16:34 合入 `feat/phase-5e-advanced-research`，实际提交 `5a75f34` 包含最新 main。在该合并点建立独立分支 `feat/phase-6b-local-service`。第三轮 Windows 11 用户实机复测仍为 **NOT TESTED**。[设计](docs/phase-6b-design.md) · [Windows 清单](docs/phase-6b-acceptance.md)

Linux 开发验证覆盖了真实 SQLite 写满后的事务回滚、两个并发连接争抢同一 ID，以及子进程直接退出后的 WAL 恢复。曾在重启测试中遇到文件锁释放延迟；连接关闭后显式解锁，回归通过。256 MiB 精确边界的 Rust DAO 专项使用合成 JSON，重开后校验 SHA-256，额外一个字节被拒绝。十一组独立数值参考在本机通过。

在隔离 Chromium 154 中，保存并重开的人工合成行情得到 9 笔成交，费用为 `9.28719551797935`，最终权益为 `1209.64074296063065`。6A 的 50,000 根固定研究仍得到完整结果摘要 `e3fb4410dc0bac12ca6dc1d108d4a6ae2f56107a47fc20bbda789469cbaf5d6b`。工作树并行开发时，首轮本机 E2E 有三个桌面构建在容量夹具落盘前启动而失败；最终提交以 clean checkout 重跑。候选 `dfe3f95` 在四个浏览器作业均发现回测 Worker 取消测试仍在注销之后读取事件回调。现改为先捕获已排队的回调，再断言注销及迟到消息无法覆盖新任务。各平台运行、下载及逐文件 SHA-256 以 [Draft PR #17](https://github.com/meredithfyc1001/riverlab-crypto-lab/pull/17) 对应提交的记录为准。

首版 macOS Chromium 的 trace 显示高级研究表单在分包切换前选中了策略中心的同名控件；组合测试在第二份行情仍由 Worker 准备时看到了第一份的成功提示。用例现限定到目标表单，并在导航前等待指定币种出现于库中。Windows Chrome 的旧研究用例实测运行 3342 ms，最大主线程间隔 46.1 ms；第二次运行的启动点击直到约 2.3 秒后才交还驱动，届时取消按钮已消失。改为同时等待本次运行的取消控件及启动点击。性能门槛、取消后的结果断言均保留。

精确 256 MiB 的合成合法 JSON 在 Linux Chromium 经临时 stdio 适配器进入实际 Rust 服务与 SQLite，8 MiB 确认后取消、同 ID 重试和完整重开均通过。含测试转发耗时 171.49 秒，Rust RSS 峰值 792,876 KiB，结束时 7,488 KiB。Windows Tauri 传输的测量见同提交 CI。[本机容量原始记录](docs/phase-6b-linux-capacity.json)

## Phase 6A Windows 验证原型

### PR #16 · Windows 11 首轮实机反馈

Windows 11 25H2（26200.9457）在提交 `121e2fb8` 上记录两项 FAIL。桌面技术验证页与 Edge 同页的深色文字对比度为 1.25:1。系统下载目录存在同名报告时，安装版两次完成计算却均未交付文件；移开同名文件后，三组桌面与 Edge 配对均通过。原始日志、截图、性能和 SHA-256 清单由首轮验收机保留。基线在修改前复现了同一低对比度及下载回调拒绝同名的条件。[实机结论、基线失败日志及第二轮验收单](docs/phase-6a-verification.md#首轮-windows-11-实机验收与第二轮复测附录)

首轮 50,000 根数值一致性和 SQLite 合成库验证通过。该轮卸载后保留数据为 BLOCKED，物理断网为 NOT TESTED。[Draft PR #16](https://github.com/meredithfyc1001/riverlab-crypto-lab/pull/16)

### PR #16 · Windows 11 第二轮实机与第三轮修复

第二轮在 `326f9694a29150725dfeea8118bbf63ef2ec7f83` 完成。首轮的深色技术验证页和同名下载通过复测，新的 FAIL 是数据、策略、回测和风险四张工作台卡片的实际描边仅 1.3819∶1（项目门槛 3∶1）。两种桌面形式均实测拒写、目录缺失及恢复重试；第二轮实机用独立空目录的 NTFS 删除等待状态产生真实错误 5。浏览器把保存交给系统管理器，Chrome、Edge 均观测到拒写导致下载取消，恢复目录后重新请求并完成。Windows 错误 32/33 在生产桌面上的提示仍为 BLOCKED，独占同名成品时会自动编号并保存；对临时文件的外部故障夹具先遇到了共享冲突。[两轮实机记录与第三轮复测条件](docs/phase-6a-verification.md#第二轮-windows-11-实机结果)

已复查原 5E 运行的五份官方制品及相关本机归档，旧任务当次下载的原始文件直接核对仍为 BLOCKED。使用 `18aefef2` 的原容量场景重新生成并恢复完整 JSON，逐字段核对第二轮的 19 份完整导出，固定输入、计划、各折结果均一致。另用四个环境的底层 Worker 核对逐笔输出与权益曲线。修复候选的质量作业将本次容量导出及读回回执保存在各平台制品中。独立的 253 字节下载故障夹具只验证文件保存路径。托管 Windows CI 在新建临时目录上用 `icacls` 实际拒绝写入并恢复，复核重试文件及原件完整性。[历史 5E 参照、摘要及复核范围](docs/phase-6a-verification.md#历史-5e-原件与可复现参照)

修复开发期间，系统 Chrome 和 Edge 各自通过深浅主题两项卡片专项。深/浅主题的外侧描边分别为 6.870336∶1 / 5.619931∶1，悬停和按下状态的内侧描边分别为 5.726492∶1 / 5.607180∶1。[可重跑的像素专项](tests/e2e/path-card-contrast.spec.ts)

Windows 本地 Vitest 默认并发首跑 673/674。失败项是 `tests/integration/app.test.tsx` 的回测深链接场景，等待“回测配置”超时。保持原断言及时间门槛，用 `npx vitest run --maxWorkers=2` 重新执行全部用例，48 个文件、674/674 通过。系统 Chrome 158.0.8127.37 运行 `node scripts/profile-capacity.mjs`，独立读回 4,401,149 字节的重算导出；完整输入和结果摘要与 5E 参照一致。

第二轮合并建议为保留 Draft。第三轮用户 Windows 11 实机验收为 **NOT TESTED**，卸载、物理断网及历史 IndexedDB 迁移没有新增实测结论。发布包需绑定修复后的提交，托管 CI 运行链接、实际断言数量和 Windows 实机记录按各自提交归档。[CI 与第三轮签收条件](docs/phase-6a-verification.md#托管-ci-与第三轮实机签收)

### 原型构建与 Windows CI 历史

已从 `feat/phase-5e-advanced-research` 的联合验收提交建立独立分支。桌面模式单独构建页面和真实 Worker 验证入口；浏览器的生产构建沿用原入口。原版 5E Linux Chromium 实测的完整计算结果指纹为 `e3fb4410dc0bac12ca6dc1d108d4a6ae2f56107a47fc20bbda789469cbaf5d6b`。SQLite 的锁定依赖测试在 Linux 通过 2 项。Windows runner 的发布包、计时和进程树内存以同次流水线制品为准，Windows 用户实机签收另列。[验证报告与交付说明](docs/phase-6a-verification.md)

Windows 首轮在 `06ce35e` 构建出 EXE 和 NSIS，并通过 2 项原生 SQLite 测试。安装后校验报告独立 EXE 与安装副本摘要不符，GUI 自动化尚未执行。此原型没有 updater；后续构建关闭 CLI 的 bundle 类型二进制修补，并直接读取实际交付文件和安装后文件计算摘要。保留字节一致的门槛。[首轮作业](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/45747082913/job/139665641004)

第二轮 `7ee85b6` 验证独立 EXE 与安装目录字节一致，PATH 中没有 Node 的松散 EXE 产生可响应窗口、加载 WebView2 后正常退出。系统 Edge 完成页面及 50,000 根计算；WebView2 远程调试连接三次超时，该轮桌面页面和数值比对未通过。后续在同一 EXE 的新建测试配置内运行固定验收流程，用原生回执、磁盘下载 SHA 与外部进程树采样验证。普通启动不启用自动验收。[第二轮作业](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/45748146765/job/139669126545)

第三轮 `9bc294c` 的原生验收走通中文工作台、SQLite 及已保存回放；50,000 根在 WebView2 157.0.4341.46 的候选子 Worker 报通信错误，同机 Edge 完成。现有错误信息无法确定底层原因。桌面改由页面按调度预算创建同源模块候选，使用 MessagePort 直连两个 Worker。浏览器保留既有嵌套方式，TS 策略和数值内核保持 5E 原版。后续以实际候选通信、同一完整结果 SHA 和落盘下载复验。[第三轮作业](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/45749871344/job/139674791014)

## Phase 5E 高级策略研究

PR #14 于 2026-11-25 11:45:05 UTC 合并，最终 5D 功能提交为 `b37094a91614916a35e13bd15c99d9d5270a9081`。合并后 main 的四项作业全部通过。已据此新建分支 `feat/phase-5e-advanced-research`。用户决定 5D 和 5E 共用最终 Windows 测试包，5D 实机和物理断网继续为 **NOT TESTED**。[合并后 CI](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/45607331060) · [技术设计](docs/phase-5e-design.md) · [联合验收清单](docs/phase-5e-acceptance.md)

独立 Python 的 48 根滚动样本在第 1 折选周期 1，样本外 −4.2%；第 2 折选周期 2，样本外 +9.6%。对两折分别替换测试价格后，原折训练排名和参数选择不变。旧十组参考和新增第十一组在 Node 24 / Linux 开发环境逐一核验通过。完整依赖及生产依赖审计均为零公告。

首轮本机完整检查通过 667 项 Vitest，在 E2E 源码的 ES2022 类型检查发现 DOM NodeList 展开问题。已改用 Array.from，补入规则库容量边界用例，保留原计时与测试门槛。三项高级研究专项 E2E 已用 Linux Chromium 生产构建验证，四个旧库也完成真实浏览器故障注入与原数据对照。满载 5E 使用 50,000 根行情、100,000 根次求值时，串行 8.09 秒、两 Worker 5.46 秒，同一输入结果一致；对应报告空配置恢复 4.00 秒。单币与组合生产上限维持 50,000 / 10,000 根。最终提交的全量检查、三平台作业、Windows 两份证据、ZIP 和有效期随 Draft PR 更新。[测量与独立扩容方案](docs/phase-5e-capacity.md) · [Phase 5E PR](https://github.com/meredithfyc1001/riverlab-crypto-lab/pulls?q=is%3Apr+head%3Afeat%2Fphase-5e-advanced-research)

候选提交 `33b11bee29b3216363930beb69b627e7cca65826` 通过 668 项 Vitest。本机生产浏览器回归发现两处历史交互问题。数据集库被拒读取后再导入损坏备份，两个独立警告同时占用原来的一处错误区域。另一次在同名行情先后保存后进入回放，按数据库主键排列的列表可能将旧行情排在本次新增行情之后。复核保留原 E2E 断言，合并同一面板的诊断并恢复保存后的列表顺序。[候选提交 CI](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/45610908683)

## Phase 5D 报告库可用性补丁

原 Draft PR #14 的 `e580125d8adf15d1aca947ec8b500ad6a8e77952` 已复现两处故障。只损坏一个共享摘要时，旧联合列表无法返回其他四条来源；只损坏一个 5D 摘要时，另两份报告能按 ID 重算并逐字节导出，列表却报错。已在同一分支修正 5D 的逐条摘要校验与各库错误呈现。测试使用隔离数据库，修复后八份正文与修复前联合 Hash 一致。依赖树及生产依赖审计各零公告，全部独立 Python 参考通过。补丁提交绑定的三平台检查、Windows 双浏览器验证、新包摘要及下载有效期在 PR 正文更新；新版用户实机待验收，物理断网 NOT TESTED。[故障复核](docs/phase-5d-library-review.md) · [新版 Windows 验收单](docs/phase-5d-acceptance.md) · [Draft PR #14](https://github.com/meredithfyc1001/riverlab-crypto-lab/pull/14)

## Phase 5D 市场状态研究与策略表现归因

PR #13 于北京时间 2026-11-25 16:53:06 合并至 `06635d3dc385b4645b21cfbda1edd68f23e3de89`。合并后 main 的 Ubuntu Chromium、Windows Chrome、Windows Edge 和 Windows 双浏览器 ZIP 作业全部通过。已从该提交建立独立分支，当前交付版本为 `1.2.0-test.1`。[合并后 CI](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/45580223667) · [设计](docs/phase-5d-design.md)

5C-B 的 Chrome 与 Edge 用户实机各七组 PASS，最终产品项零 FAIL、零 BLOCKED。Chrome 首次 10,001 根用例准备失败，新配置重测正确触发原始根数上限。实机基线分别归档数值、历史兼容、保存与冷恢复。物理断网为 **NOT TESTED**。[用户证据核查范围及结果](docs/phase-5d-windows-baseline.md)

本机 npm ci 和完整/生产审计通过，各为零公告。已执行所有独立 Python 参考及 5D Decimal 参考。Linux Chromium 完成四组满载研究、取消、导出和空配置恢复。首次全量 check 在新增 E2E 文件格式处停止，格式化后的全量检查通过 41 个文件 / 624 项 Vitest、58 项 Linux Chromium E2E。[工程复核与实测数据](docs/phase-5d-review.md) · [Windows 实机验收单](docs/phase-5d-acceptance.md)

## Phase 5C-B 共享资金池与动态调仓

已 fetch 最新 main，核实 PR #12 于北京时间 2026-11-25 15:04:32 合并为 `fd4de40c32623eab3eb16555fc0df723d6e22357`，版本 `1.1.0-test.1`。合并后四项 CI 均成功。独立分支 `feat/phase-5c-b-shared-pool` 从该提交开始，先固定技术设计。[基线 CI](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/45565316180) · [资金与时钟设计](docs/phase-5c-b-design.md)

用户提供的 5C-A 实机报告覆盖 12 组，11 PASS、0 FAIL、0 BLOCKED、1 NOT TESTED。物理断网暂缓。证据清单的 337 项 SHA-256 均匹配。[逐组实机结果与性能波动](docs/phase-5c-b-windows-baseline.md)

开发快照上，本机 Node 24.19.0 安装 260 个锁定依赖，全依赖及生产依赖审计均 0 条公告。八组既有参考和新增的十场景整数参考通过。首轮完整 check 通过 568 项 Vitest 及 54 项 Linux Chromium E2E；随后复核补入极小止损价及乱序重签报告两个回归。浏览器专项首次因运行模式控件选择器超时，改用无歧义的 combobox 可访问名称后 2/2 通过。满载的四种 Worker 场景均从空配置恢复。关键数值、修复、实测与旧版兼容性见[实现复核](docs/phase-5c-b-review.md)。最终提交对应的本机结果、三平台运行、Windows 双浏览器日志和 ZIP 身份见 [Draft PR #13](https://github.com/meredithfyc1001/riverlab-crypto-lab/pull/13)。5C-B 用户实机待测，物理断网 NOT TESTED。

## Phase 5C-A 多币种组合回测（2026-11-25）

已同步 main，核实 PR #11 实际合并 SHA 为 `c8ded9304785a06c713f5a830caf292bacbc918f`。从该提交创建 `feat/phase-5c-portfolio-backtest`，技术设计先行。读取用户提供的 RC Windows 实机报告并归档零 FAIL、零 BLOCKED、物理断网 NOT TESTED，以及 8.498 秒首次恢复和重复句号两项观察。[RC 实机复测](docs/phase-5c-rc-baseline.md)

两至五资产共同时钟、独立固定点账本、组合买持和相关性、规则快照、组合持久化与异机恢复已接入。单币种运行版本与原实验数据格式保留。初次浏览器专项发现自定义规则下拉的标签同时匹配两个控件，已给三个选择器明确可访问名称。独立 Python 参考均通过；初次数值专项中对旧信号记录嵌套层级的断言已纠正。[设计](docs/phase-5c-design.md) · [实现复核与容量](docs/phase-5c-review.md) · [Windows 实机清单](docs/phase-5c-acceptance.md)

本机首轮完整检查 516 项 Vitest、51 项 E2E 全部通过。随后增加归零权益与五资产页面验证。组合专项 E2E 2/2、十一个数值测试及 Linux 解压包 18 项检查通过。首个 CI 快照的三平台独立参考通过，格式检查发现 AllocationEditor.tsx 需格式化，ZIP 跳过，已修正后重新提交。最终 head 的完整结果、Windows 内层 ZIP 摘要及准确到期时间见 [Draft PR #12](https://github.com/meredithfyc1001/riverlab-crypto-lab/pull/12)。此为当时的待测状态，后续实机结果见上方 Phase 5C-B 基线。

## V1.0 RC 开发与验证（2026-11-25）

从 GitHub fetch 最新 main，确认 PR #10 已于 2026-11-16 合并。基线为 `e27a728ac53dc7a3f6ad73fbcbd298f4527ccb54`，候选分支为 `feat/v1-rc-hardening`。Windows 旧版实机六项 PASS，已测产品 FAIL 为 0，Edge 仅有历史 CI，用户暂缓物理断网。归档已过滤主机名、私人路径与现场截图。[Windows 明细及回归](docs/v1-rc-windows-baseline.md)

三个实验原件与现场 ZIP 中对应文件的字节一致。本机使用原件重算，MA 2/4、规则 V1/V2 的全部成交、25 点权益、统计及 runHash 均通过。八组独立 Python 数值参考全部通过。原锁文件复现 9 个中危包（1 条开发工具公告），生产为 0；兼容升级后全量与生产审计各为 0。[审计与原始输出](docs/rc-dependency-audit.md)

开发和 CI 失败记录如下，旧快照的包不得作 RC 验收包。

| 提交      | 已执行的检查                                                 | 失败点及处理                                                                                                                                                                                                                                                                     |
| --------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `829d16d` | 三平台各 462 项 Vitest 和 45 项 E2E 成功                     | Windows ZIP 的 Chrome 作业解压后找不到 SHA256SUMS，尚未启动 BAT，Edge 包测试和上传跳过。改用 Windows 自带 tar.exe 传递路径参数、保留退出信息并明确核对解压目录。[Windows 作业](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/45547167241/job/138981961007) |
| `d55ca92` | 三平台各 468 项 Vitest 成功、48/49 项 E2E 成功，实验恢复通过 | 配额测试读到原始 `full`，五秒内无法获得“空间不足”提示，三组质量失败，ZIP 跳过。修正错误传递；原配额与拒绝存储用例本机复测 2/2。[失败运行](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/45547503972)                                                       |

Windows 中文路径的下一次验证给出了明确原因。功能提交 `333d9da` 上三平台检查全过，Windows 的 tar.exe 却把中文目的路径转成问号并报告 could not chdir，Chrome 包启动前即终止，Edge 和上传跳过。改由 PowerShell 7 通过环境变量向 .NET ZipFile 提供 Unicode 路径，解压过程以异常中止，并在同一进程及 Node 验证清单。BAT 启动、浏览器流程及中文空格路径保持原检查。[Windows 解压失败日志](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/45548374961/job/138985525161)

50,000 根压力抽样曾出现主线程间隔 1052ms。改用兼容的规范字节编码，保留全账本和全部点；同程序 3+3 次测得完整报告 Hash 中位数 1259→928ms，RC 全流程中位 3696ms、最大 4437ms、主线程最大 410ms。初次完整检查发现控制字符正则不符合 lint，改为匹配允许的可打印 ASCII；新增性能脚本的格式问题随后修正。[分段实测、异常与内存](docs/rc-performance.md)

本机前两次完整 check 各 472/49 通过。提交 `684c5ce` 在第三次完整运行中再次捕获原 5B 的五秒等待失败，472 项 Vitest 成功，E2E 48/49。浏览器 trace 显示断言开始约 4567ms 后 Worker 已交付结果，结果页和图表的首次分包请求分别耗时约 8/31ms。失败快照显示整页回退到“正在载入回测中心”。页面改为在选择数据后并行预载结果及图表，已完成的表单和状态继续显示，只有待载入的结果区显示等待提示。另复用 18 位定点值的规范字符串，保持原 5 秒成功提示和原全点曲线断言。分段证据见[性能记录](docs/rc-performance.md)。

同一提交 `684c5ce` 的三平台 CI 各通过 472/49 及全部独立参考；Unicode 修复后的 Windows ZIP 已在 Chrome 157.0.8103.79、Edge 157.0.4341.60 实际解压、启动、恢复原件、校验全 JSON 和停止服务，两浏览器各 17 项成功、零外部请求/页面错误。它是定位问题期间的快照。最新候选的 ZIP 按新 head 重新验证后才交付。[Windows 包作业](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/45549334210/job/138988366674)

本轮 Linux 实装 260 个依赖包，完整 check 通过 472 项 Vitest、49 项 Playwright；独立数值参考全通过。功能提交 `333d9da` 的 clean Linux ZIP 通过 17 项检查，Linux 直接启动 Node，首访 JS 294.67 kB（gzip 94.90 kB）。[本机验收明细](docs/rc-acceptance.md)

修复后功能提交 `333d9da` 已在三平台各通过 472/49、八组参考和三次分段测量。六项用户旧版实机通过记录保持原边界。[三平台日志](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/45548374961)

整合后的本地全量 check 已通过 473 项 Vitest、50 项 E2E，包括结果分包延迟用例与定点输出缓存淘汰。真实 50k 十条件专项连续五次通过。本地 ZIP 的额外复测中，端口占用反例已按预期退出，但 Linux 测试脚本随后向已退出子进程写 Enter，引起 EPIPE。已把失败窗口的 Enter 限于需要 pause 的 Windows BAT，继续校验两平台的失败退出码、正常服务的 Enter 停止与端口释放。

最终提交的三平台作业、Windows ZIP 下载、内层 SHA-256 和到期时间在 [Draft PR #11](https://github.com/meredithfyc1001/riverlab-crypto-lab/pull/11) 的交付说明维护；逐次检查按对应提交登记。用户 RC 实机及物理断网待实测。[设计](docs/rc-design.md) · [复核](docs/rc-review.md) · [用户清单](docs/rc-acceptance.md)

## Phase 5B 当时的恢复入口（2026-11-11）

用户明确授权按Issue#10完整开发。已完整读取任务、AGENTS/plan/progress、原规划及2B/2C/3/4/5A契约。GitHub确认PR#9于UTC11:55:09合并，main=b0c9664fc5c37cf70686ca3735e317ad3c8a0a88；已fetch/pull同步，从干净工作区建立feat/phase-5b-rule-editor。首次沙箱Git代理连接失败，经受支持权限重试成功；GH CLI读取Actions返回Forbidden，改用现有GitHub连接器读取，不修改网络/凭据。

main最新CI run43015906736四作业实际success；已读取Ubuntu130506784972、Edge130506785350、Chrome130506785437完整日志，各354项Vitest/40项E2E、npm ci/check和5个独立参考成功；WindowsZIP130509235260双浏览器中文空格/BAT/旧功能/风险/保存导出/停止成功。这是基线证据，不是5B测试。Issue记录的此前单独Edge性能等待消息超时保留，不以本次main成功抹除，不代填用户Windows实机。

已汇报DSL、预热/冲突/重复、指标精度、旧报告兼容与Windows包风险，先写[设计](docs/phase-5b-design.md)。本轮无真实交易/下单/联网行情。目标Draft PR#10，用户验收前不合并/发布/部署；历史未测事实保持。5B测试尚待实际执行。

## Phase 5B 功能快照三平台与Windows包实际通过

已将Issue#10转换为[Draft PR#10](https://github.com/meredithfyc1001/riverlab-crypto-lab/pull/10)，原始任务在docs/phase-5b-task.md保留，工作分支feat/phase-5b-rule-editor，main仍b0c9664，无合并/Release/部署。功能快照fe17089fa09564f3bdcb3715115fc0851db53f56的[run43023800278](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/43023800278)四作业全部success，已读取实际完整日志。Ubuntu130533288421、Chrome130533288780、Edge130533288225各npm ci/check、457项Vitest/45项E2E、全部8个独立Python参考成功；原354/40回归保留，无删断言/跳过/阈值放宽。

| 平台            | 浏览器        | 50k/10条件 ms | 最大主线程间隔 ms |
| --------------- | ------------- | ------------: | ----------------: |
| Ubuntu Chromium | 156.0.8078.4  |          3197 |             319.8 |
| Windows Chrome  | 156.0.8078.80 |          2635 |             238.5 |
| Windows Edge    | 156.0.4314.58 |          3365 |             411.4 |

Node24.22.2/2逻辑核；Ubuntu Linux7.0.0-1019-azure/Xeon8370C，Windows10.0.26100，Chrome EPYC9V74、Edge EPYC7763。全部为人工合成数据，含规则/账本/统计/hash/Worker传输/全点绘图，20秒/1000ms门槛保持，不是所有机器保证。[结构化CI证据](docs/phase-5b-ci-evidence.json)。

WindowsZIP job130536125279实际双浏览器中文空格路径Expand-Archive/BAT前台127.0.0.1启动、旧回测/研究/风险/回放、新自定义规则创建→回测→保存实验/JSON→刷新重开重算→规则JSON导入、0外部请求/0页面错误、穿越/Host/POST拒绝、端口占用/缺dist预期失败及Enter停止释放端口全部通过。Chrome156.0.8078.80、Edge156.0.4314.58。build-info完整SHA为fe17089、phase=5B、version=0.5.1-test、dirty=false均实际校验。快照内层822640bytes，SHA256=6af4b3b7eeeffcb03b701f2e9eabba18ce50c0666464ce6d87970762b37f8943；快照artifact13857355262有效至UTC2026-11-25 12:57:31。**此为功能快照；最终下载必须用PR#10正文绑定最新head的成功包，不用旧快照替代。**

本机Linux完整check退出0：25文件/457项Vitest、45项E2E、格式/lint/strict核心/应用/测试/生产构建全部通过。[原日志](docs/phase-5b-evidence/local-full-check-success.log)。50k/10条件4434ms、最大411.7ms；旧2C 50k5000ms到全点图亦通过。Intel Xeon8573C/3可见核/cgroup2CPU，Node24.19.0/Chromium154.0.8037.57；最初性能失败不抹除。全部独立参考成功。[本机证据](docs/phase-5b-local-evidence.json)。

收尾复核将同类型同周期MA/EMA在每个已完成timestamp只计算一次，各条件交叉历史独立；不改变数值/预热/规则语义。新增2项MA/EMA重复条件等价测试，93项规则专项、严格构建与本机ZIP通过；后续完整测试与CI须对最新提交执行。Linux开发ZIP实际新规则/保存刷新/导出/停止全部通过、0外部请求/0页面错误，包含此工作树改动但build-info明确dirty=true、源fe17089，BAT未在Linux执行，不冒充最终下载或Windows实机。

React Best Practices复核：无条件Hooks，generation阻止迟到导入覆盖新草稿，Worker任务取消/世代清理，原生label/fieldset/键盘，最多10条件与100版本、结果分页；domain计算在core，app装配feature，兄弟模块未互相导入。390px深浅截图已查看，修正原生控件未统一样式后无横向溢出。无新依赖，默认Vite主包570.7kB/gzip186.6kB体积提示保留，不调高阈值。

最终提交的实际完整SHA、三平台CI/WindowsZIP及14天有效下载以PR#10正文维护，收尾提交仍运行原全部检查。Windows用户实机/物理断网/真实磁盘耗尽/受管策略均待本人执行，验收表不代签。保持Draft等待用户明确验收，不自动合并/发布/部署。

## Phase 5B 实现与首次验证

已实现纯TS规则V1、双侧最多5条件AND/OR、MA/EMA/RSI/排除当前根突破，未知预热/冲突hold/边沿单次触发，接入原回测；不可变家族版本、独立IndexedDB、严格JSON、可视化卡片/深浅/390px/键盘。Phase3规则明确拒绝，旧实验/风险可嵌入规则复现。原成交/保护/统计/旧策略版本及hash公式不变。设计、任务原文归档、验收及复核文档齐全。

npm ci259包成功；首轮新增89项规则/5项存储通过，43组独立Decimal100及所有旧参考通过；额外风险来源复现/任意JSON编码等价/转换边界/原生digest回退继续补测。初次TS类型遗漏、React lint生命周期/时钟纯度及ES2023方法不符合项目ES2022均已修正，日志在docs/phase-5b-evidence。原规划SHA不变。

首轮4项浏览器专项全通过，50k/10条件5336ms、最大413.9ms。首次完整check449项单元通过，但浏览器43通过/2失败：2C及5B50k回测原5秒成功消息等待。trace显示结果随后出现，不改变等待/性能阈值。原生编码/字段缓存没有明确收益已撤回；整份canonicalJson的native SHA字符串路径更慢，失败与误跑旧dist不计为新实现验证。最终提取原编码字节块供Worker原生SHA使用，保留核心同步流式hash回退与等价断言；纯数值转换有界4096memo，算式/精度/价格边界不变，单独验证5000无关值前后不影响。最终完整check、WindowsZIP与CI尚须实际执行后归档，不提前记通过。

## Phase 5A 待审时历史记录（2026-11-09，PR#9现已合并）

PR#8已于北京时间22:17:32合并，实际main为7644abf2323dd461240e4e5f430dc406851c3746。用户“好了，下一步”同意推进，未提供Windows逐项或版本，不补签。Phase5原为候选集合，已异步征询优先级，暂按推荐默认风险Monte Carlo重采样，不写成用户明确逐项选择。已核对原规划与源实验/统计契约，建立干净独立feat/phase-5a-research-tools，目标Draft PR#9。

初次sandbox git fetch代理失败，受支持权限重试同步main成功。当前主干push CI run42633245806四作业均success；已读取三组实际质量日志129214642323/129214642611/129214642618，均338项单元/35项E2E通过，不把它当新阶段通过。已汇报设计、方法/成本/分位限制、Worker和验收标准，不修改旧交易真值或主干，不自动合并/发布/部署。

## Phase 5A 工程三平台日志复核（功能快照）

功能提交7595580147ae88dbfe71320b2075b9dc1f86af33的[run42639724622](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/42639724622)三组质量作业已全部success，已逐一读取实际完整日志：Ubuntu129237277267、Windows Chrome129237277692、Windows Edge129237278233各npm ci/check、354项Vitest/40项E2E、5个独立参考全部通过，原338/35保留，无失败/跳过/阈值放宽。

| 平台            | 实际浏览器    | 50k源+200万步 ms | 主线程最大间隔 ms |
| --------------- | ------------- | ---------------- | ----------------- |
| Ubuntu Chromium | 156.0.8078.4  | 6585             | 46.7              |
| Windows Chrome  | 156.0.8078.80 | 6961             | 75.2              |
| Windows Edge    | 156.0.4314.58 | 4188             | 49.4              |

三组Node24.22.2/2逻辑核；Ubuntu Linux7.0.0-1019-azure/EPYC7763，Windows10.0.26100，Chrome EPYC7763、Edge EPYC9V45。方法为人工合成MA源校验后IID净权益比例重采样，不是无限规模或未来表现保证；详细字段见[CI证据](docs/phase-5a-ci-evidence.json)。

WindowsZIP作业129240266846已success并读取完整日志，Chrome156.0.8078.80与Edge156.0.4314.58实际中文空格路径解压/BAT前台127.0.0.1启动、资源/旧回测/研究/逐根回放、新风险模拟/分位图/保存刷新重开/JSON/CSV、穿越/Host/POST拒绝、端口冲突/缺dist预期失败、Enter停止与端口释放全部通过，双浏览器0外部请求/0页面错误。功能快照artifact13685855616绑定7595580、dirty=false，内层778500bytes/SHA256 0db328ca2b32984dc49ac33a37dad791c1973d2b594b15933d64673632dbf1e6；此快照仍含修正前2C阶段标签，留作历史证据，不作为最终推荐下载。

打包复核发现旧脚本build-info阶段仍写2C，已修正为5A并新增阶段/版本与根package一致的断言，日志/证据同时输出phase/version/dirty。修正后本机lint及完整ZIP smoke再通过，源SHA7595580、dirty=true，仅开发包；最终下载必须是修正后最新head三组检查与WindowsZIP实际成功的包。绑定当前完整SHA的链接/校验/14天到期时间由PR#9说明维护，不用功能快照冒充后续head。用户Windows实机/物理断网/真实磁盘耗尽仍待反馈，不补签。

## Phase 5A 本机工程验证

- 实现纯core/risk-analysis（PCG32官方stream54、IID/连续区块、18位BigInt逐步floor、分位/频率/回撤/直方图）、专用Worker、风险页面、独立IndexedDB报告保存/重开/删除、完整JSON和全路径CSV；JSON内嵌源复现输入，源实验和原数据删除后仍能重算。原成交/保护/策略/统计/版本未修改，不重复扣费，不把浮动算完成交易胜负或把重采样当可成交回测。
- npm ci --offline --cache work/npm-cache受支持权限成功259包，固定依赖未改；版本0.5.0-test。初始沙箱网络git fetch失败，受支持权限同步成功，main保持7644abf。
- 首轮新增核心测试10通过/1失败，舍入归零测试原样本同时产生巨大上涨因子而正确触发整批金额越界；改成单调极小权益参考避免混测，另保留独立溢出断言，未放宽资金上限。初期typecheck发现测试数组字面量推断及Promise类型引用，改正类型；未删除断言/跳过测试。后续源输入快照明确深复制，避免外部引用改变报告。
- 最终完整npm run check退出0：20文件/354项Vitest、40项生产包E2E全部通过，338/35原回归保留；格式/lint/strict core/app/test类型/生产构建均通过。独立Python统计/2B/研究/回放/风险五个--check全部通过，PCG官方向量、Decimal100/Fraction固定参考准确。日志work/phase-5a-local-check-final.log；复核损坏摘要日期上界、防止任务中切换源，取消按钮只用于Worker任务，检查后重跑同一完整命令。
- Linux6.18.57/Node24.19.0/Chromium154.0.8037.57/AMD EPYC9V74，3可见逻辑核、cgroup2CPU。50k实际MA源+200万IID步最终6125ms，最大主线程观察间隔66.6ms，20秒/1000ms原门槛保留；首次专项6111/65.9ms、首次完整6070/75.8ms均记录。全部步骤参与统计，至多101显示位置；不是任意机器/行情规模保证。结构化[本机证据](docs/phase-5a-local-evidence.json)。
- 两种方法UI、源校验/成本/浮动/hash、分位/频率/图形、390px/浅色、保存刷新重开/JSON导入内存未保存/删除、JSON/CSV、原实验与数据清除后独立恢复、常量/坏报告/预算与取消均实际通过。外网origin拦截且0意外请求；不冒充物理断网。配额/abort/损坏双store事务由fake-indexeddb单元测试验证，真实磁盘耗尽未测。
- 最终本机ZIP smoke退出0：实际解压中文空格路径，仅Node前台127.0.0.1HTTP启动；原回测/研究/回放和新增风险源检查/分位图/保存刷新重开/JSON/CSV下载均通过，0外部请求/0页面错误，路径穿越/Host/POST拒绝、端口占用和缺dist预期失败、Enter停止释放端口。已查看package-chromium-risk.png确认结果与图形，证据work/phase-5a-local-package-final.log。Linux没有执行BAT；开发包dirty=true、SHA是基线，不能当PR下载包或Windows通过。
- React Best Practices复核：无条件Hooks、generation拒绝迟到结果、Worker完成/取消清理，原生label/fieldset/表格，结果分页20、图形坐标与金额计算分离，feature公开入口/兄弟模块不互相导入，未增加依赖。主JS约553kB/gzip181kB有默认Vite体积提示，未调高阈值；当前性能通过。
- 原规划SHA256仍0a3081d44d3557e6d0f1b1eda3378c2e83282b3c6677dcd45b88a3190b86f84b，git diff --check通过。已创建独立Draft PR#9并读取功能快照三平台CI与WindowsZIP；绑定最新head的下载/过期时间由PR#9说明维护，排队不记通过。用户Windows/物理断网/真实磁盘与受管策略仍待本人反馈，不补签历史未测。

## Phase 4 实施时记录（2026-11-09，现已合并）

已通过GitHub确认PR#7于北京时间20:29:18合并为d60ef1c3491492247a4a1cb5a67c05cb58e33703，main一致。用户要求继续下一步，本轮启动原规划Phase4历史回放，独立feat/phase-4-historical-replay、目标Draft PR#8，不改main或自动合并。Phase3最终CI run42616308619三组317项Vitest/30项E2E与WindowsZIP全部实际通过，已在PR#7归档，旧316快照保留历史；用户Windows验收仍待反馈。

本机环境已恢复，初始work分支干净；首次沙箱git fetch代理不可连，受支持网络权限重试成功并基于origin/main建立开发分支。npm ci沙箱EPERM代理连接失败，受支持权限重试259包成功，Node24.19.0/Linux；缓存位于work/npm-cache，无凭据输出或代理修改。已阅读最新文档/原规划与接口，已汇报设计、风险和验收；共享会话/回放/保存恢复已完成并经本机338/35验证；PR#8已创建，三平台实际结果在下方分列。

## Phase 4 工程三平台与WindowsZIP验证通过（用户未验收）

已验证功能提交1edb8f167cb012e223d9841e5f6b7e02571ae259：[run42623772196](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/42623772196)四作业completed/success，已实际读取三组质量及Windows包完整日志。Ubuntu129182210379、Windows Chrome129182210211、Edge129182210357各npm ci/check、338项Vitest/35项E2E全部通过，格式/lint/core-app-test严格类型/生产构建及4个Python参考均通过，原317/30全部保留。JSON导入内存待保存、IndexedDB重开已保存的新增断言也通过。没有删除业务断言/跳过测试/放宽阈值。

| 平台            | 实际浏览器    | 50k推进 ms | 恢复 ms | 最大主线程间隔 ms |
| --------------- | ------------- | ---------- | ------- | ----------------- |
| Ubuntu Chromium | 156.0.8078.4  | 860        | 1409    | 239.4             |
| Windows Chrome  | 156.0.8078.80 | 1062       | 1573    | 273.6             |
| Windows Edge    | 156.0.4314.58 | 1095       | 1789    | 272.4             |

三组Node24.22.2/2逻辑核；Ubuntu7.0.0-1016-aws/Xeon6975P-C，Windows10.0.26100/EPYC9V74。样本为人工合成、一次手工买入，回放与恢复均实际执行50k；只代表这些机器和此样本。完整结构化数据见[CI证据](docs/phase-4-ci-evidence.json)，本机旧/新全部性能事实保留，不选择性删去较慢值。

WindowsZIP job129183964790实际执行BAT前台启动、中文空格路径解压、127.0.0.1监听/HTTP/核心资源、旧回测与研究、新逐根回放/下一开盘虚拟成交/日记/保存刷新重开/JSON和CSV、路径穿越/Host/POST拒绝、端口占用与缺dist预期失败、Enter停止并释放端口；Chrome156.0.8078.80和Edge156.0.4314.58均0外部请求/0页面错误，全部通过。已验证[功能快照ZIP artifact13677432481](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/42623772196/artifacts/13677432481)属于完整1edb8f1提交、dirty=false，内层710252bytes，SHA256为921ce5c36728fa50f3f88a9d14eaebc1015849297a45b89b9e25209c8ac6b581，14天至北京时间2026-11-23 21:19:42。

随后仅归档本节/验收/证据文档，最终提交仍须自动执行相同完整CI与WindowsZIP。**最新实际head、当前下载链接及有效期以PR#8交付说明为准；上面的归档包不冒充后续head。** PR#8继续open/draft，main仍d60ef1c，无自动合并/tag/Release/公开部署。用户Windows/物理断网/真实磁盘耗尽/断电/全部受管策略仍未验收，清单不补签。建议先下载最终head包实际测试并反馈，再决定合并；Phase5候选需另行确定优先级。

## Phase 4 本机工程验证

- npm ci经受支持权限成功259包，依赖/完整性未改变，根项目版本0.4.0-test；初始沙箱EPERM连接代理失败事实保留。Git fetch沙箱代理失败后受支持权限成功，main未直接改写。
- 共享执行会话保留原交易循环；137项旧内核/策略/保护专项通过。四组冻结的合并前引擎完整输出hash完全相同；独立Python Decimal手工订单参考逐根验证费用、余额、权益、已实现/浮动。初期typecheck发现未使用import、lint发现hash监听依赖，已修正，未改变门槛。
- 新回放核心15项、存储6项均通过。首次4项真实浏览器专项通过，50k推进996ms/恢复1634ms/最大主线程325.7ms；后续补充配额与原数据删除后恢复测试。
- 首次完整check中338项Vitest/格式/lint/strict类型/生产构建通过，但未指定系统Chromium路径，35个浏览器用例均在browserType.launch前因默认浏览器不存在失败，没有业务断言通过；不是用户Windows或浏览器流程成功。后按README显式PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium重跑完整npm run check，退出0：18文件/338项Vitest、35项E2E全部通过，原317/30保留，无失败/跳过。
- 本机Linux6.18.57、Node24.19.0、Chromium154.0.8037.57、AMD EPYC9V74，系统暴露3逻辑核、cgroup配额2CPU。最新50k实际顺序回放推进975ms、恢复1592ms、主线程最大220.3ms，沿用20秒/1000ms门槛；原2C、3性能也通过。完整原日志位于work/phase-4-local-check-fixed.log，结构化证据见docs/phase-4-local-evidence.json，不冒充跨平台证据。
- 四个独立Python参考--check实际通过；原规划SHA256保持0a3081d44d3557e6d0f1b1eda3378c2e83282b3c6677dcd45b88a3190b86f84b。git diff --check与全仓Prettier通过。
- 本地dirty开发ZIP通过中文空格路径实际Node前台HTTP/资源/旧回测+研究+新回放、虚拟下一开盘成交、日记、保存刷新重开、JSON/CSV、0外部请求/0页面错误、穿越/Host/POST拒绝、端口冲突/缺dist预期失败、Enter停止并释放端口。首次默认沙箱打包git子进程EPERM，受支持权限重试成功；没有修改打包脚本门槛。Linux未执行BAT，dirty=true且源SHA是基线，不能当作当前PR下载包；WindowsCI仍须真实执行。已查看package-chromium.png确认布局和已播放两根图表；390px及主题断言通过。
- React Best Practices复核：稳定hash监听/暂停回调、Worker生命周期和generation、单个在途请求、无条件Hooks、只向feature传已知前缀、增量合并、无行情变化复用数组、图表清理/分序列让出浏览器、订单表最近100/日记分页、原生label/表格名。域计算均在core，兄弟feature未互相导入；未引入新依赖。主JS约532kB/gzip174kB有原默认Vite体积提示，未调高阈值。
- 当前将提交独立Draft PR#8；三平台CI/WindowsZIP/绑定head下载尚待这个实际提交执行，不预记通过。所有Windows用户实机/物理断网清单待本人反馈。状态JSON恢复依赖原保存数据集，已在UI/README/设计明确；不声称独立行情备份或防作弊系统。

## Phase 4 首轮跨平台CI与测试就绪修正

PR#8已创建open/draft，工程提交92e9dd148cf1d26e899e212c18092edcc326585a；main保持d60ef1c，不合并/发布。[run42622323705](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/42622323705)已读取三组完整实际日志：Windows Chrome129177342866、Edge129177342925均338项Vitest/35项E2E通过；Ubuntu129177343222为338项Vitest通过、33项E2E通过/2项失败，均在回放测试helper的selectOption超时。helper在hash页面渲染前读取option数量可得到0并传入index=-1，随后选项出现仍等待这个无效索引；修正为先等待下拉框可见和SYNTHETIC选项就绪，再按明确value选择，不改业务断言、超时、阈值或生产逻辑。WindowsZIP后置作业129179611220按规则skipped，未上传测试ZIP，不能记Windows包通过。

本轮首CI50k回放实测：Ubuntu推进965ms/恢复1449ms/最大主线程228.9ms；Windows Chrome1296/1912/334.4ms；Edge955/1455/216.4ms。三组性能门槛均通过；浏览器/硬件完整数据在Actions实际日志和artifact。就绪修正后本机5项回放E2E再次全部通过，50k推进950ms/恢复1581ms/最大主线程204.3ms；typecheck/lint也通过。修正后的完整CI必须对新head重新运行，最终下载和有效期统一在PR#8交付说明维护。最后复核区分JSON文件恢复与IndexedDB重开：只有后者或明确保存才标浏览器已保存，JSON恢复仍为内存待保存；新增实际浏览器状态断言，避免刷新约定误导；修正后build/typecheck/lint和5项实际回放E2E全部通过，50k推进1059ms/恢复1606ms/最大主线程257.1ms。用户Windows清单仍待本人反馈。

## Phase 3 待审时历史记录（2026-11-09，现已合并）

用户明确授权“启动 Phase 3 设计与开发”。main仍为PR#6合并33b1d669；PR#7独立分支交付，不自动合并、Release或部署。原规划/成交/策略/风险/统计/18位账本均未修改。新增core/research、专用Worker、策略中心比较/网格/split/rolling、JSON校验重算与CSV摘要；窗口独立重置，不自动选优、不拼接收益。见[设计](docs/phase-3-design.md)和[验收清单](docs/phase-3-acceptance.md)。

已验证实现快照85e933affc06c906fb8b0de402c4d63ddad8aa25：[run42614794507](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/42614794507)四作业completed/success，已实际读取三组质量及WindowsZIP完整日志。每平台npm ci、format/lint、316项Vitest、严格core/app/test类型、生产构建、30项E2E全部通过，原307/24回归保留。三个独立Python参考也通过。

| 平台            | 浏览器        | CPU / 逻辑核                        | 50k三策略墙钟ms | 主线程最大观察间隔ms |
| --------------- | ------------- | ----------------------------------- | --------------- | -------------------- |
| Ubuntu Chromium | 156.0.8078.4  | AMD EPYC 7763 64-Core Processor / 2 | 7214            | 134.8                |
| Windows Chrome  | 156.0.8078.80 | AMD EPYC 7763 64-Core Processor / 2 | 4752            | 171.4                |
| Windows Edge    | 156.0.4314.58 | AMD EPYC 9V74 80-Core Processor / 2 | 4121            | 141.3                |

Node24.22.2；Ubuntu内核7.0.0-1019-azure，Windows10.0.26100。阈值20秒/1000ms均通过；只代表这些CI机器及50k人工合成样本，不承诺所有资源预算组合耗时。完整机器/版本/限制见[证据JSON](docs/phase-3-evidence.json)。生产主JS约501kB（gzip164kB）有Vite默认体积提示，未提高告警阈值；现有性能门槛全部通过。

WindowsZIP job129153773186：Chrome156.0.8078.80、Edge156.0.4314.58，真实中文空格路径解压、BAT前台127.0.0.1启动、HTTP/Worker/图表、旧回测保存重开/导出、新研究批次和JSON/CSV、无外部origin请求/无页面错误、路径穿越/Host/POST拒绝、端口冲突与缺dist失败、Enter停止释放端口均通过。归档包artifact13672092574属于85e933a，内层630576bytes，SHA256为0871376b7e3c7e2222b876aa5cd2ed5e008b1a51b2edcbf85014acef1e9187c2，至北京时间2026-11-23 20:17:07。它是已验证快照；之后补上JSON导入“完成时间不能晚于当前时间”的入口校验及测试，并归档记录，最新PR提交必须重新完整CI。**下载以PR#7说明绑定当前完整headSHA的最新成功artifact为准，不把此归档包当最新。**

失败保留：run42614089752（8321a96）14个新增文件格式失败，独立Decimal通过；按只读诊断提交Prettier结果。run42614354882（8a83342）三组316项测试通过，严格类型因报告literal拓宽及测试直接修改readonly Candle失败；改为类型化报告payload与替换完整Candle对象，原断言未删除/跳过，未放宽阈值。run42614794507修正后完整成功。最后归档run42616047702（6dae708）仅新证据JSON短数组和进度表格格式失败，按同一只读诊断格式化后重新提交，未更改检查门槛。最后导入时间校验增加1项核心测试，预期317项，以后续实际CI为准。

当前云执行环境配置失败，exec_command实际不可用；本机npm ci/check未执行，不把GitHubCI写成本机执行。通过GitHub树/提交API仅写独立分支，读取真实CI日志；内容只读的格式诊断不修改checkout或绕过check。Windows用户实机/物理断网待反馈，合并和CI都不补签此前验收。

后续先由用户下载最终当前head包、按清单在Windows常规浏览器验证和反馈，再决定合并。按原规划下一阶段为Phase4历史回放，范围须单独确认。

## Phase 2C 合并后交接记录（2026-11-09，随后用户已授权Phase3）

- 已通过 GitHub 核实 PR #6 merged=true，合并提交为 `33b1d6695ca1115efefce59132d96f8534c43e72`，合并时间北京时间 2026-11-09 19:36:50；main 当前正是此提交。下方“Draft 待审”等文字属于当时的历史记录。
- 本轮用户要求继续；先完成合并状态、下载包与 Windows 验收交接。当时向用户询问Phase3范围；用户随后明确授权“启动 Phase 3 设计与开发”，见当前Phase3记录。
- 2026-10-20 的 artifact 已于 2026-11-03 到期，旧运行 artifact 列表现为空。合并已自动触发 [main CI run 42610440364](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/42610440364)，无需重复触发或修改代码以重建旧包。
- Ubuntu Chromium：job 129137160598，已读日志确认 307 项 Vitest、24 项 E2E 全部通过；50,000 根 2764ms，最大主线程间隔 219.2ms；Intel(R) Xeon(R) 6975P-C / 2 逻辑核，浏览器 156.0.8078.4。
- Windows Chrome：job 129137160463，已读日志确认 307 项 Vitest、24 项 E2E 全部通过；50,000 根 2677ms，最大主线程间隔 231.3ms；AMD EPYC 9V45 96-Core Processor / 2 逻辑核，浏览器 156.0.8078.80。
- Windows Edge：job 129137160153，已读日志确认 307 项 Vitest、24 项 E2E 全部通过；50,000 根 3574ms，最大主线程间隔 317.9ms；INTEL(R) XEON(R) PLATINUM 8573C / 2 逻辑核，浏览器 156.0.4314.58。
- Windows ZIP job 129138532233 已 completed/success，已读完整日志：Node v24.22.2，Windows Chrome 156.0.8078.80 / Edge 156.0.4314.58，真实解压到中文空格路径、BAT前台启动、HTTP资源/回测/保存重开/JSON与CSV、0外部请求/0页面错误、路径/方法/Host拒绝、端口占用/缺dist失败和Enter退出均成功。
- [新的 main ZIP artifact](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/42610440364/artifacts/13670985121) 已生成，完整SHA为 `33b1d6695ca1115efefce59132d96f8534c43e72`，expired=false，保留14天，至北京时间2026-11-23 19:41:32。内层ZIP 569520 bytes，SHA-256：`5c223439630cf093899c545f76f4a36beda393a3e001f5bd8748a11e211c9b99`。外层含内层ZIP、校验清单及双浏览器证据；不创建正式Release。
- 当前执行环境显示启动失败；shell 实际返回“No usable execution environment”，因此本轮本机 npm ci/check 未执行，也未读取或改写用户本地工作区。通过 GitHub 连接以已确认 main 的不可变内容创建独立文档分支，初始交接提交范围仅Markdown，随后明确授权Phase3功能开发；CI与此前本机结果分列。
- PR #6 的合并不证明用户 Windows 验收通过。本轮未收到逐项结果或版本，清单标为待反馈；历史“未测试/未执行”保留当时事实，不补签。
- 本轮不直接修改 main，不自动合并文档 PR，不创建正式 Release 或公开部署；18 位账本、成交时序、策略/统计版本和所有回归保持原样。

## Phase 2C 历史恢复入口（2026-10-20）

- 初始工作区干净。已 fetch main，GitHub确认PR #5 merged=true，实际合并SHA为0ee6d8483bd6a5226a6d01a1d21b990b134bab46；从该提交建立feat/phase-2c-backtest-workbench。已创建Draft PR #6，不修改main或自动合并。
- 完整阅读AGENTS、plan、progress、README、原始规划、2A/2B设计和现有数据/策略/成交/账本/存储接口。已向用户汇报实施计划、选型、风险及验收标准。
- 2B最终CI run39284322892：已实际读取Ubuntu Chromium118165850327、Windows Chrome118165850402、Windows Edge118165850114日志，各256项Vitest/17项E2E通过，npm ci/check成功。这补充旧排队记录；不替代用户1B/2A/2B Windows未测事实。
- 初次git fetch因沙箱无法连proxy失败，受支持network权限后成功；未修改代理。2C测试尚在实施，不预记通过。

## Phase 2C 实施与验证事实

- 已实现core/statistics、core/experiments、Worker运行/校验/导出、React配置/结果/实验、复用IndexedDB事务适配器的独立实验库、Node24回环静态服务/BAT/ZIP与三平台后置打包CI。原成交规则/策略版本未改；identity只有ASCII字节填充的等价性能优化，SHA保持一致。
- npm ci首次259包通过；新增统计首轮10通过/8失败，因年化测试修改共享fixture解析配置，改为复制后复验18/18通过。实验首轮3通过/10失败：质量issue的optional undefined不是规范JSON；在报告边界明确JSON快照后31/31通过，未删断言。新增精度余数后合计288项（原256+32）。
- 初期typecheck失败（图表callback隐式any，Testing Library不支持exact选项）、lint失败（导出非组件函数/捕获错误cause/ref清理警告）均按严格规则修正。原日志保留。一次工作流文件名误写quality.yml未找到，已改实际ci.yml；不影响现有workflow。首次打包在沙箱内execFileSync git报EPERM，受支持network执行后通过，未改代理或凭据。
- 第一次浏览器命令在构建尚未完成时启动，随后中止（退出130，未记通过）。策略选择getByLabel精确定位超时，改为combobox角色，MA专项1/1通过；首次专项grep锚点不匹配为0项执行，不记通过。
- 三策略/存储异常4项通过时，50,000根默认5秒等待未通过；独立剖析：引擎1585ms、统计271ms、JSON393ms、38,603,435字节报告哈希3647ms。改ASCII字节填充避免字符迭代临时数组后哈希1008ms、原报告SHA完全相同。浏览器原阈值复验通过3851ms/最大定时器间隔321.6ms，没有放宽断言或超时。
- 初次完整check：288项Vitest通过、23项E2E通过/1项失败，保护事件断言误选图表内部layout table；已给账本与事件表明确可访问名，保留原内容断言。截图复核发现结果容器横向溢出，修正grid min-width/容器宽度/表格滚动，增加已打开结果在390px和浅色主题下的断言；没有隐藏全页面溢出。
- 布局修正后完整check退出0：14文件/288项Vitest、24项E2E（原17+7）、格式/lint/独立core/app/test严格类型与生产构建全部通过，无失败或跳过。50,000根实际MA策略8331笔成交的全点结果就绪3743ms，最大主线程定时器间隔285.1ms；Linux6.18.55、Node24.19.0、Chromium154.0.8037.57、AMD EPYC9V74，cgroup配额2CPU。测试的Desktop Chrome UA为模拟值，不将Windows UA视为Windows系统证据。
- 代码复核又纠正根项目版本更新误触的yocto-queue锁文件版本元信息（实际tarball与integrity未改、恢复0.1.0）；所有依赖精确版本不变。极小/极大图表刻度改科学计数避免长数值标签。随后重新执行最终npm ci/check，最终日志/CI状态在后续归档补充。
- 本机Linux开发dirty ZIP解压到中文空格路径、文件SHA、HTTP资源/实际Worker与图表、保存刷新重开/JSON/CSV、外部origin拦截（0请求）、路径穿越/POST/Host拒绝、端口占用失败、Enter退出释放端口、缺dist失败均通过。该包build-info明确dirty=true、基线SHA，仅开发证据，不冒充最终PR artifact；Linux未执行BAT，Windows实际BAT/Expand-Archive/Chrome/Edge由CI单列。
- 用户1B/2A/2B/2C Windows实机均未执行；2C新[验收清单](docs/phase-2c-acceptance.md)保持待签。无物理网卡断网、真实磁盘耗尽/断电/全部受管策略验证，origin拦截与异常注入不伪装成此类测试。限50,000根，完整报告可数十MB，Worker不消除全部克隆/绘图内存成本；浏览器存储不可靠，请JSON备份。

## Phase 2C 最终本机工程验证

- 最终 `npm ci --cache work/npm-cache` 和 `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run check` 均退出0；288项Vitest、24项E2E及格式/lint/严格类型/构建全部通过，无失败/跳过。原256项核心/集成与17项浏览器回归保留（占位页断言升级为已实现功能，风险/无账户约束保留）。[最终原日志](docs/phase-2c-evidence/local-final-check.log)、[npm ci](docs/phase-2c-evidence/npm-ci.log)。
- 最终50,000根实际回测3775ms，主线程定时器最大间隔292.3ms；机器/浏览器同上。原5秒结果等待、20秒就绪预算、1秒主线程间隔阈值全部保留。数据为人工合成，不是行情速度/无限数据保证；未测浏览器总进程内存峰值。
- 独立Python Decimal90统计与2B Decimal100策略/风控参考均执行--check通过；原规划SHA与全部本地文档链接检查通过。依赖锁仅根项目版本0.2.0-test更新，依赖版本/完整性不改。
- 最终dirty开发ZIP与Linux smoke退出0，[原日志](docs/phase-2c-evidence/local-package-smoke.log)明确BAT未在Linux执行；1280px截图宽1280，结果页不再撑宽。服务原子退出与端口重绑、穿越/Host/方法拒绝、0外部请求/0页面错误及导出均已实际验证。
- 历次失败和性能剖析原日志在[证据目录](docs/phase-2c-evidence)，不把中止/0项/失败记为通过。设计边界与复核见[实现复核](docs/phase-2c-review.md)。
- 工程将提交独立Draft PR #6，三平台与Windows ZIP CI尚待这个实际提交运行，未提前声明通过；最终下载artifact须与PR实际head SHA一致。用户Windows实机未验收，待本人按清单下载执行，不自动合并。

## Phase 2C 首次跨平台CI与性能修正

- [PR #6](https://github.com/meredithfyc1001/riverlab-crypto-lab/pull/6)已创建，open/draft；工程提交10ae07aeaa9a7938fe7931e281c3f1e1d68542e9，main仍为0ee6d8483bd6a5226a6d01a1d21b990b134bab46，未合并/发布/部署。该提交clean本机ZIP已验证SHA身份、dirty=false并通过Linux烟测。
- 首轮[CI run39371336286](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39371336286)：已读取三组实际日志。Ubuntu Chromium job118459651304成功，288/24通过，50,000根4207ms/最大间隔330ms；Windows Chrome118459651465、Edge118459651046均288项Vitest通过、23项E2E通过/1项失败，唯一失败均为50,000根回测的默认5000ms结果等待。不是排队或用户验收成功。ZIP后置job118460470469按规则skipped，未上传ZIP。Windows两组[原始失败日志](docs/phase-2c-evidence)保留。
- 继续优化而不放宽任何等待/性能阈值：SHA对相同规范JSON分块计算，加入Unicode/64KiB边界/非JSON输入的Node SHA等价测试；报告只规范化必要元信息并复制行情，避免对整份账本重复stringify/parse，保留完整结果和运行输入快照。新增输入快照隔离回归，307项Vitest和24项E2E在本机完整通过；50,000根3348ms/最大间隔196.6ms。继续将基准每根市值直接按既定18位floor规则计算，保留派生权益上限，避免五个不用的快照字符串格式化后再解析。
- 上述优化不删测试、不截断/降采样、不放宽阈值，不改成交/保护规则或hash定义。将对实际新提交重新运行三平台并验证Windows ZIP，尚未预记为通过。

性能修正后最终本机完整check退出0：15文件/307项Vitest、24项E2E全部通过，无失败/跳过；50,000根3430ms/最大主线程间隔251.3ms，[原日志](docs/phase-2c-evidence/local-performance-fixed-check.log)。Windows需实际新CI确认，尚未宣称通过。

## Phase 2C 三平台307/24通过与Windows ZIP启动修正

- 性能修正提交3106d0e796c8116af5762e3a9e41ecd81d26d2df的[run39372297528](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39372297528)三平台质量job全部success。已逐一读取[Ubuntu118462640422](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39372297528/job/118462640422)、[Chrome118462640513](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39372297528/job/118462640513)、[Edge118462640624](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39372297528/job/118462640624)完整日志，各307项Vitest、24项E2E，npm ci/check与独立参考全部通过，无测试失败/跳过。文本日志保存在docs/phase-2c-evidence/ci-*-quality.log。

| 实际平台          | 浏览器实际版本       | CPU                | 50,000根结果+图表就绪ms | 最大主线程间隔ms |
| ----------------- | -------------------- | ------------------ | ----------------------: | ---------------: |
| Ubuntu Linux6.17  | Chromium156.0.8078.4 | EPYC7763 / 2逻辑核 |                    5103 |            418.1 |
| Windows10.0.26100 | Chrome155.0.8059.40  | EPYC7763 / 2逻辑核 |                    5233 |            462.7 |
| Windows10.0.26100 | Edge154.0.4258.62    | EPYC9V74 / 2逻辑核 |                    3654 |            292.9 |

总耗时包含控件设置/Worker传输/全点绘图，结果消息的原5秒等待和总20秒预算、主线程1秒阈值均通过，未改测试阈值。仅人工合成样本，不是用户机器保证。

- 后置Windows ZIP job118463697212实际build/打包成功、dirty=false且SHA为3106d0e；真实Expand-Archive之后，Chrome测试在10秒启动READY等待处失败，未上传artifact。完整[失败日志](docs/phase-2c-evidence/ci-windows-package-initial-failure.log)保存。该失败不能记为Windows包启动成功。
- 复核CI通过cmd调用BAT时，增加windowsVerbatimArguments以保留既定外层/路径引号，避免Node对含中文空格的cmd命令再次转义；并转发子进程启动日志以保留失败原因。不修改用户BAT、原服务、等待阈值或断言。此修改提交后，全部质量与Windows ZIP仍需实际新CI核验；当前最终状态及下载以[PR #6 Checks](https://github.com/meredithfyc1001/riverlab-crypto-lab/pull/6/checks)及PR交付说明为准，不提前记成功。用户Windows实机仍未测试。

## Phase 2C 交付技术验证通过（Windows用户未验收）

- 提交a4198f2e6c7c3c265fa1abf8c6e612f476561fcf的[CI run39372868072](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39372868072)四个job全部success。已读取三个质量job原始日志：Ubuntu118464406857、Windows Chrome118464406686、Windows Edge118464406775，各307项Vitest/24项E2E及npm ci/check/独立参考全部通过。50,000根到全点曲线就绪分别4675/4796/2896ms，主线程最大间隔355.6/385.9/256.8ms，原阈值保留。
- 已读取Windows ZIP job118465250033完整日志：[原日志](docs/phase-2c-evidence/ci-windows-package-success.log)。Node24.21.0、Chrome155.0.8059.40/Edge154.0.4258.62，实际Expand-Archive到含中文空格路径，经BAT前台启动127.0.0.1，检查实际监听地址、HTTP/核心资源/Worker回测/曲线、保存刷新重开/JSON/CSV、0外部请求/0页面错误、端口占用/缺dist失败、Enter退出和端口重绑均成功。cmd引用修正已由此实际Windows日志确认。
- 该验证包[artifact12242343011](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39372868072/artifacts/12242343011)绑定完整a4198f2 SHA，expired=false；有效期14天，至北京时间2026-11-03 13:08:10。内层ZIP SHA256为ab3919216e7d388b3e04030e29ea39bfa746f2374a6606f9f596578a0683a1f6，569357 bytes。原始校验清单及双浏览器证据在artifact内。此记录对应这个实际提交，不冒充后续head。
- 收尾仅归档上述事实、明确报告/恢复边界并修正首页回测入口残留“待开发”标签；不改策略/成交/统计计算。收尾提交仍执行相同完整CI和Windows ZIP；最新head的下载链接/有效期与实际检查结果统一在[PR #6交付说明](https://github.com/meredithfyc1001/riverlab-crypto-lab/pull/6)维护，避免将旧SHA的包当成最终产物。
- 工作区独立分支、main保持0ee6d8483bd6a5226a6d01a1d21b990b134bab46；无合并/tag/Release/公开部署。用户Windows实机、物理断网、真实配额耗尽/断电/全部受管环境尚未验收。当前建议先下载按清单实测，再决定是否合并；Phase3仍需另行授权。

## Phase 2B 历史恢复入口：Phase 2B（2026-10-19）

- 初始 work 分支干净；已 fetch origin/main，核实 PR #4 merged=true，实际合并 a7b57cbecf7b25cd50da6647426e99ca6738dfa5，UTC 15:49:17。从该提交建立 feat/phase-2b-strategies-risk；[PR #5](https://github.com/meredithfyc1001/riverlab-crypto-lab/pull/5)已创建，open/draft，工程提交509164f5c2aa27ec4083a45696a27ff5ad8b8f3f；不修改main、不合并/发布/部署。
- 重新读取最终 CI run 39277844255 的三个job：Ubuntu Chromium 118146578981、Windows Chrome 118146578936、Windows Edge 118146578753，均completed/success，npm ci/check步骤成功；随后已重新读取三个job原始日志，逐一确认每组159项Vitest及17项E2E通过，无失败/跳过。
- 2A Codex本机完整check未通过：旧UI 5000ms及浏览器30s超时、一次浏览器中止；原日志路径/数量/失败事实在下文完整保留。Windows用户1B/2A未测试，2B亦未测试，不以CI替代。
- 已阅读AGENTS、plan、progress、Phase2A设计/自查、原规划相关条款及回测/账本/指标/数据契约与测试。先更新2B设计，随后只交付三策略与风控执行内核。
- 本轮首次沙箱git fetch无法连接proxy:8080；使用受支持network权限后成功，未改代理或读取凭据。2B npm ci与check事实将逐项补充，尚不声明通过。

## Phase 2B 实施与真实验证

- npm ci --cache work/npm-cache：通过，259 packages，Node24.19.0/Linux；锁文件与依赖未改。日志work/phase-2b-npm-ci.log。
- 新增递进策略接口、MA交叉/RSI阈值/历史high-low突破、合法参数和long/flat执行；保护从实际滑点entry设置，已有仓开盘风控优先、根内双触发明确stop-first。未知根内时间为null并保留区间，绝不编造先后。
- 延续18位BigInt、双边成本/数量舍入/最小名义额/逐笔守恒；抽出core/math叶模块，已逐字节核对与2A原算术相同，backtests/decimal保留兼容导出。策略/风险不反向依赖回测。无UI、依赖、原数据/指标/存储/回归断言/测试阈值或CI配置更改。
- 首次类型检查失败：重复kind默认键及旧fixture返回联合类型导致TS2783/TS2345。修正默认展开和fixture精确固定信号返回类型，原测试断言不变。原日志[initial-typecheck.log](docs/phase-2b-evidence/initial-typecheck.log)随仓库保存。
- 独立Python参考脚本首轮遇到全零sum变成int、除法得到float，触发TypeError，未生成JSON；随后的策略测试套件因此缺少JSON、0项运行（[initial-strategies.log](docs/phase-2b-evidence/initial-strategies.log)）。把独立脚本零种子改成Decimal后成功，参考不来自TS输出。实际python3 tests/reference/phase2b_reference.py --check通过：100位Decimal、18组策略/5组风控固定案例；日志work/phase-2b-reference-check.log。
- 原2A专项40/40、新增首轮93/93通过；加入3组完整引擎逐前缀因果测试后，首次完整PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run check通过：12文件/255项Vitest、17项E2E、格式/lint/strict类型/构建全通过，0失败/跳过，日志work/phase-2b-full-check.log。该记录为下述激活边界修正之前，不冒充最终代码验证。
- 自查发现新仓买滑点很大、stop已高于open时，原稿按更好的stop退出会高估结果。新增回归先复现44通过/1失败（[activation-before.log](docs/phase-2b-evidence/activation-before.log)）；随后新仓保护激活立即检查open并按已知open退出。同根两笔开盘事件明确保持先买后保护顺序；没有改断言/阈值。修正后三核心文件137/137通过，日志work/phase-2b-activation-fixed.log。
- 修正后最终完整check退出0：12文件/256项Vitest（原159全部保留，新增97项）、17项E2E、格式/lint/核心+应用+测试strict类型/构建全部通过，无失败/跳过。本机Linux、Node24.19.0、Chromium154.0.8037.57，[完整原日志](docs/phase-2b-evidence/local-final-check.log)随仓库保存。2B这次通过不覆盖2A当时本机超时事实，也不等于Windows用户测试。
- [PR #5](https://github.com/meredithfyc1001/riverlab-crypto-lab/pull/5)已创建，open/draft，未合并/发布/部署。工程提交509164f5c2aa27ec4083a45696a27ff5ad8b8f3f的[CI run 39283091782](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39283091782)于UTC16:08:19触发；持续轮询至UTC16:17后仍是queued，三个job均未开始、steps为空，conclusion=null。这不是测试通过或失败，也不称为测试超时；尚无2B跨平台通过证据。原始工具状态快照随[ci-status.json](docs/phase-2b-evidence/ci-status.json)保存。
- 排队job：[Ubuntu Chromium 118161397623](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39283091782/job/118161397623)、[Windows Edge 118161397975](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39283091782/job/118161397975)、[Windows Chrome 118161398163](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39283091782/job/118161398163)。没有重跑/取消队列、改runner矩阵或放宽测试。收尾仅文档归档提交，最新状态见[PR Checks](https://github.com/meredithfyc1001/riverlab-crypto-lab/pull/5/checks)；后续须等runner实际执行后读取日志归档，不能用本机或2A旧CI替代。
- 最终设计/边界与剩余风险见[2B设计](docs/phase-2b-design.md)及[实现后自查](docs/phase-2b-review.md)；用户[Windows清单](docs/phase-2b-acceptance.md)全部保持未签署。RSI仍为IEEE754指标，接近阈值有舍入边界；资金无Number累加。无限流动性/原Number精度/同步内核限制保留，不宣称整个M2完成。
- 本地文档相对链接51条核对无损坏；原规划SHA256仍为0a3081d44d3557e6d0f1b1eda3378c2e83282b3c6677dcd45b88a3190b86f84b。生产UI构建仍70 modules、JS453.56kB/gzip148.08kB、Worker11.77kB、CSS16.26kB；内核没有UI入口，不把旧UI E2E当成策略面板验收。

## Phase 2A 历史记录（保留当时状态，PR #4现已合并）

## Phase 2A 历史恢复入口：Phase 2A（2026-10-19）

- 已 fetch origin/main 并核实 GitHub PR #3 merged=true；合并 SHA 3282475ecea8f0c42332eab8515e90b74cef6bde，UTC 14:37:28。初始 work 分支干净；从 origin/main 建立 feat/phase-2a-deterministic-backtest，目标独立 PR #4，不直接修改 main。
- Phase 1B 云端技术复核通过；用户 Windows 实机尚未执行，不伪造验收。已重新读取 CI run 39269144185 三个 job：Ubuntu Chromium / Windows Chrome / Windows Edge 均 success，npm ci/check 步骤均成功。
- 已完整阅读 AGENTS、plan、本文件、原始产品规划、Phase 1 数据/保存契约及代码，先审查设计再实施；保留旧功能、测试、失败事实和用户验收边界。下方均为历史时间点记录。
- 本轮完成 2A 内核/固定信号/虚拟账本，工程提交 fd9aed7edb151e4a705dd30a3ed125d9374ef841。正式策略、止盈止损、收益面板在 2B/2C；不宣称整个M2完成。
- [PR #4](https://github.com/meredithfyc1001/riverlab-crypto-lab/pull/4) 已创建，open/draft，待审，未合并/发布/部署。工程提交三平台CI均成功（下节实际日志）；本机常规浏览器受到超时影响，保留失败；相同提交的临时内存目录复验也有旧UI测试超时，详见下节。本机完整check不标记通过。

## Phase 2A 实施与验证

- 新增 core/backtests 的事件/执行/定点/配置/身份/账本审计模块；不改原 UI、CSV、图表、指标、存储或备份逻辑。SHA-256 使用固定 @noble/hashes 2.4.0，锁文件只增加该依赖，无新交易/联网能力。
- npm ci --cache work/npm-cache 已通过，259 packages，日志 work/phase-2a-npm-ci.log。最初沙箱 Git fetch 无法连代理，使用受支持 network 权限后成功；没有更换代理或读取凭据。
- 首轮类型检查发现测试直接写 readonly volume，已改为替换测试副本。随后 typecheck/lint 通过。首轮38项核心测试因共享 tests/setup.ts 在 Node 环境访问 window 而全部标记失败；另缺口测试截止时间先触发未完成根，已将截止时间覆盖缺口末根。只给共享清理增加 Node 判断，浏览器原清理与断言不变；失败日志 work/phase-2a-first-unit.log 保留。
- 设计/字段独立自查发现初稿按执行根的整根 volume=0 拒单会偷看开盘时尚未知的成交量，已移除：执行函数仅接收 open，H/L/C/volume 均不参与成交；明确无限流动性/忽略成交量假设（包括零量），加入改变 volume 不影响成交回归。没有用未来高低价裁剪滑点价格。
- 首次完整check因新写自查文档未格式化而停在format:check，未进入后续测试；随后格式化，失败日志 work/phase-2a-full-check.log 保留，完整复验使用新日志。
- 修复后 Node 核心专项39/39通过，日志 work/phase-2a-unit-fixed.log；随后新增派生数值上限回归，需随完整检查复验。派生现金/数量/市值/权益小于10^78，超限阻断整次运行，不裁剪或返回部分结果。
- 完整复验格式/lint通过，159项中156通过、数据中心3项5000ms超时，未进入构建/E2E（work/phase-2a-final-check.log）。未修改实现/断言/超时；同一数据中心文件独立复验4/4通过、测试部分4.19秒（work/phase-2a-dataset-recheck.log）。已确认 src/app/features/infrastructure/data/indicators 与原集成/E2E文件均无变化，随后完整重跑。
- 已实际执行 Python Decimal 80位独立直接公式，buy/sell/totalFees 与固定JSON完全一致；不调用 TS 内核生成参考。原产品规划 SHA256 仍为 0a3081d44d3557e6d0f1b1eda3378c2e83282b3c6677dcd45b88a3190b86f84b。

## Phase 2A 工程提交CI与本机边界

- 工程提交 fd9aed7edb151e4a705dd30a3ed125d9374ef841 的 [CI run 39275693273](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39275693273) completed/success。已读取三组实际日志，每组 **10文件/159项Vitest +17项E2E全部通过**，无失败/跳过；npm ci、格式/lint、独立core/app/test严格类型与构建全部通过。
- [Ubuntu Chromium](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39275693273/job/118139304755)、[Windows Chrome](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39275693273/job/118139304507)、[Windows Edge](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39275693273/job/118139304143)。原0/1A/1B共119项Vitest及全部17项E2E保留，新增40项内核测试。
- 本机再次完整重跑：159/159测试、格式/lint、严格类型和生产构建通过；E2E在30秒整项期限出现旧CSV/图表/存储案例超时。trace显示等待UI操作时用尽总期限，没有数值/账本断言失败。出现多项超时后中止剩余浏览器运行，报告为3通过/4失败/10未运行，退出130；不记作完整通过（work/phase-2a-complete-check.log及test-results/）。没有改断言、默认超时或生产功能。
- 本机 Linux / Node24.19.0 / Chromium154.0.8037.57，CPU额度2核。工作区overlayfs与CI表现差异尚未归因，不将推测写成结论。为排查文件系统影响，git archive同一fd9aed7到/tmp内存目录并复制npm ci恢复的依赖，执行原npm run check：格式/lint通过，158/159通过、旧数据中心1项5000ms超时，未进入构建/E2E（exit1）。迁到tmpfs未消除问题，不能确认文件系统为根因；不继续放宽检查或重复运行。临时路径 work/phase-2a-tmp-check-path.txt，日志 work/phase-2a-tmp-check.log。
- 本轮成功的完整 `npm ci` / `npm run check` 证据为上述三个独立CI runner；本机只确认159项测试/类型/构建曾全部通过，不能把中止的浏览器套件记作17项通过。最终文档提交最新CI以PR Checks为准。
- 设计/成交模型/精度/固定案例和实现后自查见 [2A设计](docs/phase-2a-design.md)、[清单](docs/phase-2a-acceptance.md)、[自查](docs/phase-2a-review.md)。独立Decimal直接公式、Node SHA-256对照及历史前缀验证已执行通过。
- 尚无正式策略、止盈止损/双触发、收益/基准/回撤面板、实验持久化/导出、Worker执行适配或浏览器内核大数据性能承诺。来源Number精度不能恢复；开盘模型忽略流动性/成交量/市场冲击；截止时间是调用方声明。完整M2在后续验收。
- Phase1B用户Windows实机仍未测试；Phase2A也没有用户手工验收结果。CI与云端证据不代替用户机器。下方均保留历史时间点的事实。

## Phase 1 历史记录

## 最新技术验收复核（2026-10-19）

用户要求协助验收，并明确暂时不能在Windows上运行，先获取复核结果。基线4515782和三组旧CI已核实，重新npm ci及119/16完整检查通过；新人工样本发现保存长名称后的390px横向溢出（实测489px），未沿用旧绿灯作无条件通过。已限制select宽度并允许长标题换行，新增回归修正前失败、修正后完整119项Vitest/17项E2E及格式/lint/类型/构建通过。随后加强78字符无空格币种，构建及针对回归1/1通过。

独立7根人工样本的MA3=106、EMA3=105.708333333333、Wilder RSI3=82.8947368421053，与手算参考一致；UTC转换、保存/导出/关闭页面重开/删除/显式恢复通过，外部请求与页面异常均0。50,000根合成重开图表910ms、缩放114ms、定时器最大间隔262.8ms；完整结果/失败事实/未测范围见 [技术验收复核](docs/phase-1b-agent-acceptance.md)。当前修改仍在PR #3，不改main，不代替Windows用户实机签署。新增回归后的最终跨平台状态以PR Checks为准；下方119/16与117/16保留为之前版本历史。

## 当前恢复入口：Phase 1B（2026-10-19）

- GitHub PR #2 merged=true，实际合并 c17c0a4ba4084bad06e572da48d3da1fb5cf4720，UTC 10:44:13。已 fetch origin/main 并从该提交创建 feat/phase-1b-charts-storage；初始工作区干净，不直接修改 main。
- 用户明确确认 Phase 1A Windows 验收通过。仅记录总体通过，不补写未提供的逐项结果/版本。下方旧记录是各时间点历史，不代表最新状态。
- 已阅读 AGENTS、plan、本文件、原规划和 1A 数据接口。先更新授权/计划，随后实施 1B，目标 PR #3 待审；无 Phase 2、交易、Release 或部署。
- 已完成：本地打包 Lightweight Charts 5.2.1、OHLC/量/交互、纯 TS MA/EMA/Wilder RSI、IndexedDB 显式保存/打开/删除、JSON 备份校验/显式恢复、新数据契约与 app 装配。1A 核心解析和质量逻辑未改，上限保持。
- npm ci 已成功；数值边界修正后完整 npm run check 通过 **9文件/119项 Vitest、16项 E2E**，格式/lint/严格类型/构建全通过，无失败/跳过。日志 work/phase-1b-numeric-final-check.log（本机临时证据）。持久浏览器测试使用 work/ 短路径避免 Windows 嵌套路径问题。修正后的跨平台最终结果/日志见 PR #3 Checks；下方117项CI归档仅为修正前版本。
- 27 条本地文档链接与原规划 SHA256 核对通过。[PR #3](https://github.com/meredithfyc1001/riverlab-crypto-lab/pull/3) 已创建，open/draft，待用户审查；工程提交3ac1469三组CI全部通过（下节证据）；随后数值边界修正见专项记录，最新提交状态见 PR Checks。Phase 1B 用户 Windows 手工未测试，清单见 docs/phase-1b-acceptance.md。不得用 1A 用户通过替代本轮验收。

## Phase 1B 实施和测试事实

- 文档先行提交 8e8c38a，完整阅读原规划，核实 PR #2 合并与 1A 用户总体验收；不补写浏览器版本或逐项通过。
- MA：N 根收盘价 SMA；EMA 首 N 根 SMA 初始化，α=2/(N+1)；RSI 首 N 个差值初始化后 Wilder，α=1/N，常量50/单涨100/单跌0。独立 Decimal 60位闭式参考逐点核验、历史前缀不变、缺口重置、样本不足 NA。
- 图表：UTC 毫秒转秒仅在适配边界，支持亚秒读数；MA/EMA 叠加、RSI 独立面板；缺口提示并最多一个空白位置，不扩展假行情；深浅/390px/缩放/平移/十字准星。极小价格采用科学计数，超出可靠刻度范围明确失败。
- 存储：原生 IndexedDB 两 store 原子事务，complete 后成功；拒写/配额/abort/同步异常不假成功。重新打开校验结构/价格/UTC/质量；备份20 MiB独立格式上限，CSV仍10 MiB/50,000根；恢复前校验并再次确认为新副本。保存全部已检查记录和警告，无错误子集；不保存原 CSV。
- 首轮新增指标测试 111/112 通过，一处手填 EMA 种子期望值错误（独立参考已经通过），核算首14根均值后改为45.114285714285714；修正事务闭包的 TypeScript 可空检查后复验全部通过。
- 首轮 1B 浏览器4/7：指针停留自动进入十字准星，末根断言需先移开；一条手填末根价格修为原 CSV 的69962.21；恢复状态 locator不唯一。随后MA断言错误匹配EMA子串，改为独立指标节点；删除失败测试停留数据中心却期待行情空状态，改为明确进入行情。保留功能断言，修正后完整16/16通过，未跳过。
- 第一轮 50,000 根人工合成：CSV 1,600,036 bytes；同步连续构建图表约3,041ms，10ms定时器最大间隔2,749.8ms。按序列分段让出浏览器后复验降至约310–596ms；不降采样/不截断。
- 完整检查中的 50,000 根实测（Linux Node24.19.0 / Chromium154.0.8037.57）：检查预览484ms，质量报告361ms，重新检查+保存971ms，重新打开+图表就绪1594ms，缩放304ms；JSON4,401,567bytes，导出377ms，恢复预检165ms，明确恢复495ms。四时点 CDP 观测最大 JS 堆252,986,748 bytes（约241.3MiB，非进程总内存或精确峰值），定时器最大间隔407.1ms。性能受机器负载影响；完整输出随测试 artifact保存。
- 实际浏览器覆盖：关闭持久配置浏览器进程后重启并恢复；阻断全部非本机 origin 后导入/保存/重开/图表/导出/恢复，无外部请求；两个数据集选择；损坏已存记录拒绝；删除失败保留记录；实际 Worker/哈希/亚秒/原1A/壳测试均保留。配额/拒写通过异常注入验证，不冒充实际填满磁盘或全部隐私模式测试。
- 边界修正前生产代码复验 117/16 全通过；50,000根：预览523ms、报告341ms、准备+保存532ms、重开+图表895ms、缩放129ms、JSON导出359ms、预检146ms、恢复525ms；最大观测 JS 堆256,907,272bytes（约245.0MiB），定时器最大间隔243.6ms。与上轮数值均为实际记录，不选择性隐去较慢结果。当时构建70 modules、Worker11.77kB、应用JS452.93kB（gzip147.85kB）、CSS16.19kB；没有外部运行依赖。
- 人工 React 复核：无条件 Hooks、纯计算 memo、feature props 经 app、异步失败显式状态、Worker generation/终止、图表取消/移除/分帧事件、稳定 dataset id、输入可访问 label、事务完成后列表更新。四项 ESLint API 探针拒绝 core→infrastructure、core→indexedDB、shared→infrastructure、feature→兄弟模块，全部符合预期。

遗留与下一步：浏览器存储并非永久可靠；同源/配置隔离，跨标签页列表无实时同步需刷新；单序列绘图、JSON和克隆仍在主线程，非无限/流式方案。未实测用户 Windows、真实磁盘耗尽、断电、所有受管/隐私策略、移动触屏、file://、单 HTML/PWA/安装器；原生2025微秒归档仍未补充。先执行 Phase 1B Windows 清单并审查 PR #3；通过后另行授权 Phase 2 事件/账本/回测设计，本轮不开发。

## 收尾数值边界修正（仍在 PR #3）

三组初版 CI 通过后，人工复核发现极大有限价格离开滚动 MA 窗口时减法更新会丢失小值，EMA周期1也可能因相减抵消归零。先新增两项回归实际复现（18通过/2失败，work/phase-1b-numeric-regression-before.log），再将 MA 改为双栈聚合均值（摊销 O(n)、额外 O(N) 内存），EMA/初始化使用以较小端点为基准的凸组合。定义、初始化、因果性和缺口规则不变；原1A质量约定不变，没有丢弃或修复行情。该修正后已完整复验：119项 Vitest、16项 E2E及格式/lint/类型/构建全通过。50,000根：预览524ms、报告441ms、准备保存565ms、重开图表991ms、缩放102ms、导出420ms、备份预检131ms、恢复574ms，最大观测JS堆256,444,160bytes，定时器最大间隔273.7ms。构建JS453.56kB/gzip148.08kB，CSS16.19kB，Worker11.77kB。最终CI以PR Checks为准，下方117项证据仅为修正前版本。

## Phase 1B 工程提交 CI 归档

- 工程提交 **3ac1469f2f90c88957a2f32471d7b2bd29608644**；[CI run 39242981786](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39242981786) completed/success。已读取三组实际日志，各9文件/117项 Vitest、16项 E2E，0失败/跳过，npm ci、格式/lint/类型/构建通过。
- [Ubuntu Chromium](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39242981786/job/118028005532)、[Windows Chrome](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39242981786/job/118028005377)、[Windows Edge](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39242981786/job/118028005247)。Windows CI 不是用户实机手工验收，具体浏览器版本未采集，不补写。
- 三组均实际执行浏览器进程关闭/同配置重开、外网 origin 阻断、原1A回归、图表/指标、IndexedDB、JSON恢复和50,000根合成性能测试。报告及性能 JSON 由 workflow artifact 保存14天。

| 平台            | 重开+图表就绪 ms | 缩放 ms | 备份预检/恢复 ms | 定时器最大间隔 ms | 四时点最大观测JS堆 bytes |
| --------------- | ---------------: | ------: | ---------------: | ----------------: | -----------------------: |
| Ubuntu Chromium |              827 |      75 |        148 / 415 |             270.3 |                217061820 |
| Windows Chrome  |              647 |      72 |         84 / 621 |             183.6 |                261459008 |
| Windows Edge    |              978 |     163 |        223 / 665 |             316.2 |                245772928 |

规模相同：50,000根，CSV1,600,036bytes、JSON4,401,567bytes。并非性能保证或真实行情测量，堆值不是进程总内存/精确峰值。完整各阶段耗时随日志保留。

PR #3 保持 open/draft；远端 main 仍为 c17c0a4ba4084bad06e572da48d3da1fb5cf4720，未直接修改。随后仅归档本文档/计划，最新文档提交 CI 以 [PR Checks](https://github.com/meredithfyc1001/riverlab-crypto-lab/pull/3/checks) 为准；不自动合并、Release 或部署。下一行动：用户按独立 Phase 1B 清单验收并审查；Phase 2 未启动。

## Phase 1A 与 Phase 0 历史归档（以下保留当时事实）

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

## 2026-11-09 Phase 3 启动时记录

用户明确回复“启动 Phase 3 设计与开发”，替代此前范围待定状态。基线main33b1d669不变，继续独立分支PR#7并按最终实现重写描述；禁止自动合并。设计/授权/验收清单已更新，新增纯TS研究、Worker、策略UI和确定复现报告、独立Decimal参考及时间隔离/离线/性能测试。原307/24回归保留。

本轮云执行环境配置失败，exec_command不可用，本机npm ci/check未执行。使用GitHub树/提交API仅写独立分支并由CI实际执行；启动时新CI尚待结果；后续实际结果已归档于当前恢复入口。格式失败后只读Prettier诊断不修改checkout，修正必须提交后重新完整检查。

## 2026-11-27 · Phase 6B 合并准备复查

在独立临时库中复核 `80c367a`，发现旧检查会接受应用标识和版本相同、实际缺少复合主键或外键的文件，导致冲突 ID 和孤立摘要未被报告。现使用 SQLite 元数据核实两表、列、索引、排序规则和级联外键；保存与删除在写事务内复核结构。完整性检查和备份验证在一致快照中逐行核对正文、摘要与原始 ID，规则版本额外核对完整正文。新增合成回归覆盖上述异常和正常 v1 兼容性。Linux 原版 27 项 Rust 测试已通过，Windows 原生验证待执行。
