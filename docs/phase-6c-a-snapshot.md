# Phase 6C-A 浏览器完整快照

## 适用范围

源是当前浏览器 profile、当前 origin 的九个 RiverLab IndexedDB v1 数据库。八个数据库各有正文和独立摘要，规则库只有 versions。所有 17 个对象存储使用内联字符串主键 `id`，无自增或二级索引。以下桌面列仅标明 6B 已有的同类型落点。本阶段的工作台是浏览器只读导出入口。[6B 实际布局](https://github.com/meredithfyc1001/riverlab-crypto-lab/blob/80c367ac429ee86d9287b00527fdffcfe6b23008/src/infrastructure/repository.ts#L8)

| 浏览器数据库 | Object store | 原行或派生字段 | 桌面 kind / 目标 |
| --- | --- | --- | --- |
| `riverlab-crypto-lab` | `datasets` | `Dataset` | `dataset` → records.body |
| `riverlab-crypto-lab` | `summaries` | `DatasetSummary`，去掉正文的 candles | `dataset` → summaries.summary |
| `riverlab-crypto-lab-experiments` | `experiments` | `Experiment` | `experiment` → records.body |
| `riverlab-crypto-lab-experiments` | `summaries` | `ExperimentSummary` | `experiment` → summaries.summary |
| `riverlab-crypto-lab-rules` | `versions` | `RuleRecord`，列表逐条验证完整正文 | `rule` → records.body，同一原文 → summaries.summary |
| `riverlab-crypto-lab-replays` | `replays` | `ReplayCheckpoint` | `replay` → records.body |
| `riverlab-crypto-lab-replays` | `summaries` | `ReplaySummary` | `replay` → summaries.summary |
| `riverlab-crypto-lab-risk` | `studies` | `RiskStudy` | `risk` → records.body |
| `riverlab-crypto-lab-risk` | `summaries` | `RiskSummary` | `risk` → summaries.summary |
| `riverlab-crypto-lab-portfolios` | `experiments` | `PortfolioExperiment`，报告 schema 1 | `portfolio` → records.body |
| `riverlab-crypto-lab-portfolios` | `summaries` | `PortfolioSummary` | `portfolio` → summaries.summary |
| `riverlab-crypto-lab-shared-pool` | `experiments` | `SharedPoolExperiment`，报告 schema 2，数据库仍为 v1 | `shared_pool` → records.body |
| `riverlab-crypto-lab-shared-pool` | `summaries` | `PortfolioSummary`，复用固定组合的摘要生成函数 | `shared_pool` → summaries.summary |
| `riverlab-crypto-lab-market-regime` | `reports` | `RegimeReport` | `regime` → records.body |
| `riverlab-crypto-lab-market-regime` | `summaries` | `RegimeSummary` | `regime` → summaries.summary |
| `riverlab-crypto-lab-advanced-research` | `reports` | `AdvancedReport` | `advanced` → records.body |
| `riverlab-crypto-lab-advanced-research` | `summaries` | `AdvancedSummary` | `advanced` → summaries.summary |

## 切面与身份

导出使用独立页面。用户主动开始后，读者核对真实库、版本和存储布局，从所有对象存储游标读取实际主键、正文和原摘要。只有九库的事务都已固定视图且同时存活，才允许封存完整快照。新页面和 Worker 的业务写路径遵守同源写入锁；不遵守该锁的旧页面仍受 IndexedDB 本身的重叠事务调度约束。缺库、权限失败、版本改变、孤儿摘要、内容损坏或取消都应保留源库并拒发完整成品。

历史业务 Hash 保留原算法。文件 SHA-256 用于识别导出的具体字节；稳定内容指纹用于比较数据相同的两次快照。源档案是结构化克隆值，原始 CSV 或历史下载文件的字节只在另有原件时可验证。还原测试仅在新建的隔离数据库运行。此阶段没有生产导入、恢复、备份调度或 SQLite 写入入口。
