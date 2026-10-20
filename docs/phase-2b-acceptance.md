# Phase 2B Windows 验收清单

当前用户Windows实机：**未测试**。Ubuntu/Windows CI、Codex Linux本机及用户实机分开记录；1B/2A未测试事实继续保留。2B只提供内核，页面没有策略/止盈止损操作入口；不要求通过尚未开发的面板验收。

## 环境与自动验证

在Chrome/Edge已安装的Windows PowerShell，Node24 LTS、Git可用：

```powershell
git fetch origin
git switch feat/phase-2b-strategies-risk
git pull --ff-only
node --version
npm ci
$env:E2E_BROWSER = "chrome"
npm run check
$env:E2E_BROWSER = "msedge"
npm run check
Remove-Item Env:E2E_BROWSER
```

记录提交SHA、Windows版本、Node/浏览器版本、完整命令/退出码和日志；失败保留playwright-report、test-results的trace/screenshot及终端输出，不修改断言或超时。各完整check应运行全部Vitest（含原159项及2B新增）和17项旧生产包E2E，无失败/跳过。具体最终数量以progress及提交CI为准。

- [ ] Chrome完整check：未测试。
- [ ] Edge完整check：未测试。
- [ ] 同一提交重复执行核心三文件测试，无失败，固定参考和身份一致：未测试。

```powershell
npx vitest run tests/unit/backtest.test.ts tests/unit/strategies.test.ts tests/unit/protection.test.ts
```

## 内核固定案例审查

- [ ] 三策略参考：人工上涨/下跌/横盘/转折/跳变/极端价格固定序列一致；追加未来数据后每个已有信号/成交/快照不变。
- [ ] MA等号/首次可用、RSI0/50/100阈值、突破窗口排除当前根及旧极值退出。
- [ ] 无效参数、空/异常/不足数据、未完成根和缺口均有明确拒绝或warmup，无静默修复。
- [ ] 双触发成交含ambiguous-stop-first；根内时间为null和明确区间，不能当成已知先后。
- [ ] 开盘跳空优先保护，待执行买/卖取消；没有重复清仓或同根再买。
- [ ] 新仓滑点使止损已可触发时按已知open立即退出；部分卖后余仓仍受保护；保护拒单只在下一根重试。
- [ ] 独立Decimal固定案例：买入2、entry101、费用0.505、stop90.9、take121.2；保护退出结果如下表。
- [ ] 逐笔现金/持仓/累计手续费及assertLedger通过；无成本、资金或仓位的Number累加。

| 情况                | 卖出参考 | 滑点后价 | 卖手续费 | 最终虚拟USDT |
| ------------------- | -------: | -------: | -------: | -----------: |
| 单触发止损/双触发   |     90.9 |  90.7182 | 0.453591 |   978.477809 |
| 单触发止盈/向上跳空 |    121.2 | 120.9576 | 0.604788 |  1038.805412 |
| 向下跳空至80        |       80 |    79.84 |   0.3992 |     956.7758 |

参数：初始1000、买滑点100bps、卖滑点20bps、双边手续费25bps、止损1000bps、止盈2000bps。参考JSON和独立脚本分别在tests/fixtures/phase2b-reference.json与tests/reference/phase2b_reference.py，全部人工合成而非真实行情。

## 旧功能手工回归与签署

- [ ] 按 [1B清单](phase-1b-acceptance.md) 检查CSV/UTC/质量、图表/指标、IndexedDB保存重开、JSON备份恢复、390px和本机HTTP断外网运行；用户1B仍未测试。
- [ ] 确认风险提示存在，没有真实账户/钱包/交易接口，没有完整收益面板或优化/AI入口。
- [ ] 记录实际通过/失败/未测试项、操作者及时间；PR #5保持待审，不自动合并、发布或部署。

结论：尚未签署。CI不代替用户实机，2B内核完成不代表完整M2。
