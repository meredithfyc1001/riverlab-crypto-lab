# Phase 6C-B 隔离 SQLite 候选库

本阶段将明确选定的合成 RLIDB001 文件迁入新的候选目录。输入还包括从可信回执取得的 SHA-256。程序没有发现浏览器 profile、连接日常 IndexedDB 或激活桌面数据源的步骤。源码检出使用锁定的 Node 24 依赖、Python 3.11 以上及支持 STRICT 表的 SQLite。

```sh
npm ci
python scripts/phase6c/migrate_candidate.py synthetic.riverlab-migration --sha256 EXPECTED_SHA256 --candidate-dir NEW_DIRECTORY
python scripts/phase6c/verify_candidate.py synthetic.riverlab-migration NEW_DIRECTORY/research.sqlite --sha256 EXPECTED_SHA256 --report NEW_REFERENCE.json
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo run --locked --manifest-path src-tauri/Cargo.toml --example verify_migration -- NEW_DIRECTORY/research.sqlite NEW_DIRECTORY/reference.json
```

目标的父目录须已存在。每次使用一个尚不存在的输出目录，包括失败后的重试。命令行对任何输入使用相同的验证规则。测试和交付包只使用冻结样本及隔离生成的快照。

## 输入、事务与冷读

1. 读取外部整包摘要，调用 6C-A 的正式读取器检查文件头、各帧类型和长度、源布局、逐行封尾、键与 ID、成员唯一性、关联正文/摘要的键集、内容指纹、九库共同读取屏障和 EOF。
2. 新建临时 SQLite 文件，使用 6B 与迁移程序共享的 v1 表定义。正文、原摘要、由原规则正文得到的 SQLite 列表项和迁移保真描述使用同一事务提交。源内容一律绑定为 SQL 参数。ID 或内容冲突会终止迁移。
3. 关闭写连接，冷读 SQLite 原始字节。逐行比对键、角色、投影 SHA、描述 SHA 及完整字节。八个数据库各有原正文与原摘要；策略规则只有原正文。额外的 `migration_members` 表按 kind、原 ID 和源角色保存克隆描述及两个原始摘要，支持恢复显式 undefined、自有键序和同一行内共享引用。
4. 独立 Node 进程以只读方式打开候选库，重建源结构，并复用正式领域引擎重算。回放从候选库读取所引用数据集。含有完整内嵌来源的报告按其保存版本及输入重算。原库存在同 ID 而内容冲突时报告明细。报告分别列出库内关联、自包含的历史输入以及缺失依赖。
5. 独立 Python 从快照重新解码，与候选逐行校验字节、业务身份和数值项目。另做在线备份并对恢复副本执行核验。最后复查源文件摘要，封存候选文件与各报告的 SHA-256，并最后发布 `candidate.json`。READY 的适用范围是该 SHA 绑定的隔离候选库。
6. 工作进程异常退出后，原目录可保留日志或未发布的临时 SQLite 文件。该目录不可复用。另选新目录从同一受信快照重新迁移。失败报告和故障演练分别记录事务回滚、提交后丢弃候选、进程中断后 SQLite 恢复，以及重试结果。

## 证据

| 文件                  | 可核查的结果                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| `reconciliation.json` | 十七个源 store，逐键的源与 SQLite 正文、摘要或克隆描述 SHA，来源计数与两张 SQLite 业务表分别计数 |
| `recomputation.json`  | 历史原始业务 Hash、配置、依赖、逐字段与全对象复算结果                                            |
| `reference.json`      | 独立 Python 对源文件与冷读库的对照及数值核验范围                                                 |
| `recovery.json`       | 候选在线备份副本的独立核验                                                                       |
| `candidate.json`      | 输入 SHA 与内容指纹、候选文件及各报告摘要、阶段耗时和 READY 范围                                 |
| `failure.json`        | 可捕获失败的阶段、错误、事务结果、源文件摘要与重试方式                                           |

合成快照包括可分别识别的规则修订 1 和 2 及使用它们的历史实验。仓库原 6C-A 单版本冻结样本也参与回归。桌面服务通过 `structured-read-v1` 协商读取迁移后的克隆描述。普通 get、list 与 Worker 在同次读取中获取原投影和描述并还原该行，原始字节接口继续返回投影。使用该协议打开候选副本可验证读取结果。正式切换另需用户确认。用户在 6B/6C/6D 完成后进行联合实机验收，6E 进行总验收。[Windows 清单](phase-6c-b-acceptance.md) · [原始格式与完整映射](phase-6c-a-snapshot.md)

[逐项性能和容量测量](phase-6c-b-performance.md)
