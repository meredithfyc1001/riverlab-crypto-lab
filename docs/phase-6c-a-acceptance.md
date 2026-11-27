# Phase 6C-A · Windows 浏览器测试包验收

使用 Windows 11 x64 普通用户、Chrome 或 Edge、Node.js 24 和一次性测试 profile。验收材料仅限合成数据或仓库冻结样本。正式用户环境的完整迁移、桌面 SQLite 导入和 Windows 用户总验收不在本轮。6E 将合并 6B 至 6D 后的用户实机证据，6A 第三轮继续按原表登记。

1. 记录源 commit、Windows/浏览器/Node 版本、测试账户及可用空间。将 Windows 浏览器 ZIP 解压至含中文与空格的目录，用 PowerShell `Get-FileHash -Algorithm SHA256` 核对 ZIP 外部摘要，再按包根 README 复核成员 SHA。确认 `build-info.json` 的 phase 为 `Phase 6C-A`、dirty 为 false。
2. 双击 `start-snapshot.bat`，打开 `http://127.0.0.1:4173/export.html`。仅在隔离 profile 测试。检查 origin 与原合成库一致。端口、浏览器或 profile 变化都会改变存储范围。在从未建库的 profile 运行，记录实际缺库诊断；再次独立枚举，确认没有新建空库。
3. 在已备好九库合成数据的独立 profile 执行完整导出。在另一个标签页发起普通保存，核对屏障与导出回执；同一份报告不能同时包含写入两侧的正文与摘要。旧版客户端写较早时应观察到写在切面之前完成，或在对应只读事务结束后生效。全量封存必须能够核对九库、十七 store 及每个原键。
4. 保存文件、.sha256 和回执。用 PowerShell 对**实际下载的快照**算 SHA-256，然后用包内 Python 只读工具进行独立解码核验。再次导出同一数据，比较两次内容指纹。合成样本的历史策略修订、逐笔交易和各类业务 Hash 见对应验证回执。
5. 只在一次性测试 profile/输入副本上，分别演练少一库、损坏一个原摘要、取消导出、读取失败和截断副本。禁发完整快照，旧库或已保存文件可照常重读；独立工具对改错 SHA/截断的文件返回非零。记录具体问题所在库、store、阶段。
6. 大库使用支持系统保存选择器的 Chromium 浏览器。记录输出字节数、耗时、取消反馈与最终磁盘文件。使用下载回退时，在下载结束后自行核对文件摘要；浏览器页面只能确认已准备的数据和下载请求。
7. 每个场景记录实际结果、SHA、环境与 PASS / FAIL / BLOCKED / NOT TESTED。6C-A 的测试恢复工具仅在自动化生成的空库逐项重建，无面向日常用户的还原按钮。

仓库自动化会直接用九域领域引擎和冻结 JSON 创建全库原件，导出后另外建立空浏览器上下文，核对 17 个 store 的元数据、主键、字段和历史 Hash。全量夹具、原件与重建清单、浏览器及独立校验器回执归档在同提交 CI 的 6C-A 证据中。实机只签实际执行项目。

## 独立文件校验命令

在已解压的 Windows 测试包目录，用 PowerShell 传入旁边回执给出的外部 SHA。以下路径换成该次合成导出的实际路径。

```powershell
$archive = '.\synthetic-full.riverlab-migration'
$expected = (Get-Content -Encoding utf8 -LiteralPath "$archive.sha256" -Raw).Trim().Split(' ')[0]
(Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant() -eq $expected
python .\acceptance\reference\verify_bundle.py $archive --sha256 $expected
```

需同时核对 PowerShell 输出为 True、Python 退出码为 0 和回执中的记录数与内容指纹。单独向工具传入另一个已知错误的摘要应得到非零退出码。

独立读取器仅需 Python 3 标准库。默认只打印整包字节数、SHA-256、总行数与稳定内容指纹。它分帧核对完整包，在内存中解析当前一条记录；大型实验需要相应的单行解析内存和临时磁盘空间。遇到成员、源布局、计数、键、保真描述或共同切面证据错误时，退出码为 1；全部验证成功为 0。

- `--manifest NEW.json` 将原库、store、原键、角色、两类字节数和摘要写入新的核对清单。清单含原键，应与合成档案一同管理。
- `--decode-dir NEW_DIRECTORY` 在新建的测试目录输出已核验的 `manifest.json` 和按行号配对的 `*.projection.json`、`*.clone.json`。按清单查找对应的行。克隆描述保留原对象的可选 undefined 字段、键序和重复引用。此命令仅写测试文件；已有目标会被拒绝。
- `--check-frozen-rule` 适用于含冻结合成修订 `phase-5e-breakout@1` 的验收包。Python 重新计算其规则和完整修订的两个历史 Hash。普通快照使用基础验证；其他报告的策略、账本与风险数值由各自的领域复算和独立基准覆盖。
