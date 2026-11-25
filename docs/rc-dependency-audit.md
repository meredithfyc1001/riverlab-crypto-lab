# V1.0 RC 依赖安全审计

2026-11-25 在 Linux x64、Node.js 24.19.0、npm 11.9.0 下使用 npm 官方 registry 的在线公告库。基线为 `main` 的 `e27a728ac53dc7a3f6ad73fbcbd298f4527ccb54`。在基线使用 `npm ci` 还原原锁文件。每次审计均以相应的 `package-lock.json` 为准。

| 检查                          | 0.5.1-test           | 1.0.0-rc.1  |
| ----------------------------- | -------------------- | ----------- |
| `npm audit --json`            | 9 个中危包，退出码 1 | 0，退出码 0 |
| `npm audit --omit=dev --json` | 0，退出码 0          | 0，退出码 0 |
| 高危或严重                    | 0                    | 0           |

两次全树与两次生产树的 JSON 原样存档。文件的 `.log` 后缀用于保留 npm 的原始输出格式。[基线全量](rc-audit-evidence/before-all.json.log) · [基线生产](rc-audit-evidence/before-prod.json.log) · [RC 全量](rc-audit-evidence/after-all.json.log) · [RC 生产](rc-audit-evidence/after-prod.json.log)

## 公告与影响范围

逐一读取 2026-11-16 基线 push CI 日志，Ubuntu Chromium、Windows Chrome、Windows Edge 和 Windows ZIP 四个作业的 `npm ci` 均记录 `9 moderate severity vulnerabilities`。[基线 CI #43](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/43822875434)

本次在原锁文件上复现相同计数。按公告去重后有 1 条，`GHSA-g3hv-75wg-m249`（CWE-405）。受影响的 `minimatch` 版本为 `>=7.0.0 <11.0.1`。在处理不可信的 glob 模式时，匹配器可能消耗过多计算或内存。开发者或 CI 的 lint 工具读取仓库配置时会用到它。发行 ZIP 的本地 Node 服务使用内置模块，浏览器使用预构建静态文件。应用导入的 CSV 和实验 JSON 不进入 lint 管线。生产依赖审计在修复前后均为 0。[上游公告](https://github.com/advisories/GHSA-g3hv-75wg-m249)

| 基线中危包                                                          | 依赖类型         | 基线锁定 → RC 锁定 | 被计入的原因                                      |
| ------------------------------------------------------------------- | ---------------- | ------------------ | ------------------------------------------------- |
| `eslint`                                                            | 直接开发         | 10.13.0 → 10.15.0  | 依赖 `minimatch`                                  |
| `typescript-eslint`                                                 | 直接开发         | 8.71.2 → 8.73.0    | 依赖同版 parser、plugin、utils、typescript-estree |
| `@eslint/config-array`                                              | 间接开发         | 0.23.5 → 0.23.6    | 依赖 `minimatch`                                  |
| `@typescript-eslint/typescript-estree`                              | 间接开发         | 8.71.2 → 8.73.0    | 依赖 `minimatch`                                  |
| `@typescript-eslint/parser`、`@typescript-eslint/utils`             | 间接开发，2 个包 | 8.71.2 → 8.73.0    | 依赖 typescript-estree                            |
| `@typescript-eslint/type-utils`、`@typescript-eslint/eslint-plugin` | 间接开发，2 个包 | 8.71.2 → 8.73.0    | 通过 typescript-estree、type-utils 或 utils 传播  |
| `minimatch`                                                         | 间接开发         | 10.2.6 → 11.0.9    | 公告涉及的匹配器，11.0.1 起修复                   |

## 兼容修复与复查

在现有主版本内将两项直接开发依赖固定为 `eslint@10.15.0` 和 `typescript-eslint@8.73.0`。前者的声明接受 `minimatch@^11.0.5`，后者的 typescript-estree 从 8.73.0 起接受 `^11.0.1`。npm 也给出 `typescript-eslint@8.74.0`，8.73.0 已满足修复需要。`npm ls minimatch --all` 确认全部路径共享 11.0.9。使用正常的版本解析，无强制修复或手写传递依赖覆盖。四项直接生产依赖及其锁定版本保持原值。

RC 锁文件已在空目录通过 `npm ci`，安装 260 个包。`npm audit` 文本输出为 `found 0 vulnerabilities`。当前没有遗留的已知 npm 公告。结果适用于上述日期和锁文件，更新锁文件或公告库后可重复执行 `npm ci`、`npm audit --json`、`npm audit --omit=dev --json` 与 `npm run check`。完整回归以及各平台实际执行状态见 [progress.md](../progress.md)。
