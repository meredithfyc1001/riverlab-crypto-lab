# Phase 6C-B Windows 隔离迁移验收清单

仅在专用 Windows 测试账户使用本包自带的 RLIDB001 合成样本。一套资料对应一个源码提交。将 ZIP、外部 SHA-256、Git 完整 SHA、系统版本、Python/Node/SQLite 版本、可用空间、实测结果和错误原文一并登记。每一项按实际执行填 PASS、FAIL、BLOCKED 或 NOT TESTED。

## 本次测试包

此包包含离线 Python 迁移工具、Node 24 冷读与复算程序、SQLite v1 建表文件、独立验证器和合成样本。请安装 Node 24 和 Python 3.11 以上，并确认 Python 的 sqlite3 支持 STRICT 表（SQLite 3.37 以上）。解压到有写权限、含中文和空格的测试目录。Windows MSVC 安装器、独立 EXE 和 WebView2 桌面验证另行记录。

1. 用 PowerShell 的 `Get-FileHash -Algorithm SHA256` 核对下载的 ZIP 外部摘要。对照包内版本信息和成员清单。验收前记录合成快照摘要，以及原工作数据源可用状态。本阶段实验只打开选定的合成文件。
2. 从普通用户账户双击包内 `run-isolated.cmd`。程序核对回执，在系统临时目录创建全新的候选目录并打印其路径。每次重试都会创建新目录。使用源码命令显式指定已经存在的输出目录时，应看到拒绝信息。
3. 打开 `candidate.json`，核对范围 `isolated-test-candidate`，并重新计算 `research.sqlite` 和报告文件摘要。按 `reconciliation.json` 分别核对九库、十七个实际 store、每个原键及投影、克隆描述的原始 SHA。规则只来自 `versions`，每个原版本在 SQLite 有一份正文和一份相同的列表项。
4. 核对 `recomputation.json` 的每条记录、源关系及完整重算结果。重点检查两个规则版本及其历史实验、逐笔成交/手续费、逐点权益与资金账本、回放状态、市场标签、参数搜索和样本外结果。对于有完整内嵌输入但原库已没有单独记录的历史来源，按报告的关系类型登记。
5. 结束上一次进程后独立核验同一快照、候选库及其摘要。对照 `reference.json` 和从独立备份重开的 `recovery.json`。在一次性测试目录中演练错误 SHA、截断、锁、权限、写满、取消和强制退出，记录阶段、原文、源文件摘要、是否生成 READY 及新目录重试结果。
6. 在服务可用时，以一次性目录中的候选副本执行 Rust Repository 读回、备份及恢复核验。记录 Windows 的锁释放、ACL 和重解析点行为。在单独的 Windows 原生作业验证 MSVC 编译、Rust、NSIS 安装和 WebView2 冷启动。
7. 正式桌面库切换及切换回滚另行验收。切换前需重新备份原库，校验候选库与所有回执，检查服务健康与旧数据源可用性，并取得用户明确确认。此测试包只提供隔离候选操作。

## 联合验收登记

| 项目                                                           | 本轮状态                               | 后续登记                            |
| -------------------------------------------------------------- | -------------------------------------- | ----------------------------------- |
| Windows 托管 MSVC、原生 Rust、安装后 WebView2                  | BLOCKED，GitHub Actions 付款或支出限额 | 账户所有者核实计费后，重跑对应 head |
| Windows 本机文件锁、ACL、目录权限、安装器、独立 EXE 和桌面重开 | NOT TESTED                             | 6B/6C/6D 联合验收                   |
| Windows 隔离迁移测试包的实际运行                               | NOT TESTED                             | 6B/6C/6D 联合验收                   |
| 6A 尚未完成的 Windows 第三轮回归                               | NOT TESTED                             | 纳入联合清单，沿用 6A 原表          |
| 物理断网                                                       | NOT TESTED                             | 用户实际断网后登记                  |
| 用户总验收                                                     | 待 6E                                  | 汇总联合验收及现场证据              |
