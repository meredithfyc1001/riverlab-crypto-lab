# RiverLab Crypto Lab 工作指令

作用于整个独立仓库。当前仅授权 **Phase 0：基础工程**。先读 [progress.md](progress.md) 的恢复入口，再读 [plan.md](plan.md) 和相关专题。附件全文保存在 [原始规划 v0.1](docs/product-plan-v0.1.md)。用户当前明确指令优先。

## 范围与研发节奏

- 沿用 riverlab-gto 的文档、独立分支、PR 和分阶段验收方式，不复制其业务代码、数据、策略或历史进度。
- Phase 0 仅含 React + TypeScript + Vite、中文主题和导航、模块边界、合成数据展示、自动检查与文档。
- CSV/ZIP 导入、K 线图、指标、策略算法、回测引擎、风险计算、实验保存、回放均未实现。未得到后续阶段授权前不要开发。
- 禁止真实账户、API Key、私钥、助记词、充值提现、真实订单或资金处理。未来网络数据能力必须独立评估和授权。
- 每个阶段使用独立 PR。本轮已授权提交、推送和建 PR；不自动合并、创建 tag、Release 或部署。用户 Windows 实测后再评审合并。
- 不擅自改变路线、删减需求或将建议写为已确认。正常范围内实现与修复无需反复确认。

## 工程约束

- app 装配功能模块；features 经自己的 index.ts 暴露入口，兄弟功能模块不相互导入；components 只负责展示；shared 不依赖上层。
- core 为独立纯 TypeScript，禁止 React、DOM、浏览器存储和网络依赖。独立 tsconfig.core.json 不包含 DOM；ESLint 约束导入方向。
- 数据、策略、回测、风险相互分工，UI 不拥有计算真值。本阶段核心仅含职责声明和展示样例所需类型，不预建大型引擎。
- TypeScript strict，直接依赖固定版本并提交 package-lock.json。Node.js 24 LTS，用 npm ci 恢复依赖。
- 示例必须明确标为“人工合成数据”，不能冒充真实行情、实测收益或投资建议。所有页面显示三条规划要求的风险提示。
- 时间契约为 UTC 毫秒，显示明确标注 UTC。未来导入要检测或指定毫秒/微秒，不能把 2025 年起现货公开归档统一按毫秒处理。
- 未来账本需明确整数/十进制精度、舍入和成交模型；当前不实现金额运算或回测结果。
- 不加载远程字体、CDN、遥测或交易服务。Vite 静态包经本机 HTTP 运行；不能声称可直接 file:// 打开。
- 不改其他项目或清理用户已有内容。先检查 git status；临时文件放 work/。

## 验收与记录

1. 执行 npm run check：格式、lint、Vitest、严格类型检查、生产构建、生产包 Playwright 烟测。
2. 缺浏览器时按 README 安装或显式选择系统 Chromium；Windows 优先测试 chrome 和 msedge。
3. 更新 progress.md：命令、实际平台、成功/失败/未测、环境限制、停点和下一行动。修复后保留失败事实，不伪造证据。
4. Linux Chromium、Windows CI 和用户 Windows 实机结果分开记录。仅本机资源的 HTTP 测试不等于 file://、单文件或完整离线发行验收。
5. M0 需要 CI 绿灯、文档存在、Windows 运行通过。证据不齐时保持待验收；不自动推进 Phase 1。

plan 保存约定，progress 保存事实，docs 保存专题。新会话从工程文件恢复，不依赖聊天摘要。
