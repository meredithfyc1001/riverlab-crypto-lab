# Phase 6C-A 浏览器完整快照

## 适用范围

源是当前浏览器 profile、当前 origin 的九个 RiverLab IndexedDB v1 数据库。八个数据库各有正文和独立摘要，规则库只有 versions。所有 17 个对象存储使用内联字符串主键 `id`，无自增或二级索引。以下桌面列仅标明 6B 已有的同类型落点。本阶段的工作台是浏览器只读导出入口。[6B 实际布局](https://github.com/meredithfyc1001/riverlab-crypto-lab/blob/80c367ac429ee86d9287b00527fdffcfe6b23008/src/infrastructure/repository.ts#L8)

| 浏览器数据库                            | Object store  | 原行或派生字段                                       | 桌面 kind / 目标                                    |
| --------------------------------------- | ------------- | ---------------------------------------------------- | --------------------------------------------------- |
| `riverlab-crypto-lab`                   | `datasets`    | `Dataset`                                            | `dataset` → records.body                            |
| `riverlab-crypto-lab`                   | `summaries`   | `DatasetSummary`，去掉正文的 candles                 | `dataset` → summaries.summary                       |
| `riverlab-crypto-lab-experiments`       | `experiments` | `Experiment`                                         | `experiment` → records.body                         |
| `riverlab-crypto-lab-experiments`       | `summaries`   | `ExperimentSummary`                                  | `experiment` → summaries.summary                    |
| `riverlab-crypto-lab-rules`             | `versions`    | `RuleRecord`，列表逐条验证完整正文                   | `rule` → records.body，同一原文 → summaries.summary |
| `riverlab-crypto-lab-replays`           | `replays`     | `ReplayCheckpoint`                                   | `replay` → records.body                             |
| `riverlab-crypto-lab-replays`           | `summaries`   | `ReplaySummary`                                      | `replay` → summaries.summary                        |
| `riverlab-crypto-lab-risk`              | `studies`     | `RiskStudy`                                          | `risk` → records.body                               |
| `riverlab-crypto-lab-risk`              | `summaries`   | `RiskSummary`                                        | `risk` → summaries.summary                          |
| `riverlab-crypto-lab-portfolios`        | `experiments` | `PortfolioExperiment`，报告 schema 1                 | `portfolio` → records.body                          |
| `riverlab-crypto-lab-portfolios`        | `summaries`   | `PortfolioSummary`                                   | `portfolio` → summaries.summary                     |
| `riverlab-crypto-lab-shared-pool`       | `experiments` | `SharedPoolExperiment`，报告 schema 2，数据库仍为 v1 | `shared_pool` → records.body                        |
| `riverlab-crypto-lab-shared-pool`       | `summaries`   | `PortfolioSummary`，复用固定组合的摘要生成函数       | `shared_pool` → summaries.summary                   |
| `riverlab-crypto-lab-market-regime`     | `reports`     | `RegimeReport`                                       | `regime` → records.body                             |
| `riverlab-crypto-lab-market-regime`     | `summaries`   | `RegimeSummary`                                      | `regime` → summaries.summary                        |
| `riverlab-crypto-lab-advanced-research` | `reports`     | `AdvancedReport`                                     | `advanced` → records.body                           |
| `riverlab-crypto-lab-advanced-research` | `summaries`   | `AdvancedSummary`                                    | `advanced` → summaries.summary                      |

## 切面与身份

导出使用独立页面。用户主动开始后，读者核对真实库、版本和存储布局，从所有对象存储游标读取实际主键、正文和原摘要。只有九库的事务都已固定视图且同时存活，才允许封存完整快照。新页面和 Worker 的业务写路径遵守同源写入锁；不遵守该锁的旧页面仍受 IndexedDB 本身的重叠事务调度约束。缺库、权限失败、版本改变、孤儿摘要、内容损坏或取消都应保留源库并拒发完整成品。

历史业务 Hash 保留原算法。文件 SHA-256 用于识别导出的具体字节；稳定内容指纹用于比较数据相同的两次快照。源档案是结构化克隆值，原始 CSV 或历史下载文件的字节只在另有原件时可验证。还原测试仅在新建的隔离数据库运行。此阶段没有生产导入、恢复、备份调度或 SQLite 写入入口。

## RLIDB001 字节格式

文件扩展名为 `.riverlab-migration`。前八个字节是 ASCII `RLIDB001`。其后每帧由一字节类型、八字节无符号大端载荷长度和该长度的载荷组成。元数据用严格 UTF-8 JSON。归档范围包含实际 IDB 值、主键和所有原摘要，没有 SQLite 页或 SQL。独立校验器直接读文件，核对导出回执，检查截断、未知类型、成员数量、相对顺序和尾部多余数据。

| 帧             | 内容                                                                                                                                                                                                                                                       |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01             | 版本、浏览器 origin 和开始时间                                                                                                                                                                                                                             |
| 10（十六进制） | 9 库按上表顺序，每库的名称、kind、v1、各 store 的角色、keyPath、自增、索引及记录数                                                                                                                                                                         |
| 02             | 行的真实库、store、角色、键类型、游标键、值内 ID。每个 store 按 IndexedDB 原主键次序读取                                                                                                                                                                   |
| 03、04         | 一行的 JSON 投影字节块和保真描述字节块。投影保留原属性/数组顺序。明确支持的可选自有属性若为 `undefined`，描述记录其路径、父对象完整键序及显式 undefined 所在键。非循环的共享对象/数组以 aliases 保存原位置和同一行内首次出现的目标路径，重建时恢复同一引用 |
| 05             | 两种表示各自的 UTF-8 字节数与 SHA-256                                                                                                                                                                                                                      |
| FF             | 全库计数、稳定内容指纹及源端实际事务回执。此后必须到达 EOF                                                                                                                                                                                                 |

稳定内容指纹流以 ASCII `RLIDB001/content/v1` 加一个 NUL 开头，依次纳入 10、02、05 三类帧的完整原始字节。05 中的两个摘要绑定实际值和保真描述。物理整包 SHA-256 覆盖从 magic 至 FF 的所有字节，通过独立回执或 .sha256 提供。不同时间导出相同值时，应比较内容指纹及逐项对账结果。文件时间不同，物理整包摘要也可以不同。用户选择的所有输入和输出文件均留在本机。

每个元数据帧或数据块上限 1 MiB，单条正文投影上限 256 MiB，摘要 20 MiB，单行保真描述 20 MiB。值无法无损表示时拒发完整快照。原始记录的业务 Hash 按对应历史算法验证。当前格式支持已知的 Dataset 可选元数据差异；循环或无效的共享引用、未知结构、非有限数、负零、稀疏数组和其他未定义的克隆表示均报告错误。文件 SHA 证实本次字节的一致性，使用者仍需从可信渠道取得外部回执。[历史领域协议](phase-6b-design.md)

## 可重复的证据

冻结的九域合成库每个 store 有一条源行。标准 Chromium 导出与独立 Python 读取器均给出 9 个库、17 个 store、17 条源行及内容指纹 `da5a03bb410c69b46803e712fe4f715f7d80974f790f9965247d7a6e40d54fae`。该值用于复核合成样本。真实用户数据会有自己的计数、业务 Hash 和内容指纹。[真实浏览器测试](../tests/e2e/phase-6c-a.spec.ts) · [固定 SHA-256 的独立规则参考](../scripts/phase6c/verify_bundle.py)

每个数据库的回执给出首次已执行读请求的序号、共同屏障序号、屏障后读请求序号及事务完成序号。独立读取器要求所有首次读 < 共同屏障 < 所有屏障后读 < 所有完成，且序号互异。源端在事务请求回调内保持下一个只读请求，随后在相同事务中执行 count、cursor 与回放数据集的依赖读取。超时、版本变化、请求失败或任一事务提前结束均无法写出有效封尾。导出的回执能校验记录的时序约束；它本身不是外部签名。[源端事务](../src/infrastructure/snapshot-source.ts)

对合法长度的合成 JSON 投影，容量工具以独立 Node SHA-256 和流式 writer 核对恰好 268,435,456 字节，下一字节越界即拒绝。其投影 SHA-256 为 `fe69274e481c7432a30f9f05208ef1f2f5331abfe8706aa62a97c87e185a40bf`。这项测试只测编码边界；真实领域复杂度、历史规则身份和完整恢复由独立测试覆盖。[容量工具](../scripts/profile-snapshot-codec.mjs)
