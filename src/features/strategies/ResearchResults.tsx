import { useState } from 'react';
import type { ResearchReport, ResearchRow } from '../../core/research';
import type { Metric } from '../../core/statistics';

function metric(m: Metric, percent = false) {
  return m.value === null ? 'NA：' + m.reason : percent ? (Number(m.value) * 100).toFixed(2) + '%' : m.value;
}
const windowKey = (row: ResearchRow) => row.window.fold + ':' + row.window.role;
const labels = { full: '全区间', train: '训练', test: '测试（样本外）' };
export function ResearchResults({ report, onExport }: { report: ResearchReport; onExport: (format: 'json' | 'csv') => void }) {
  const [chosen, setChosen] = useState('');
  const [selected, setSelected] = useState(0);
  const windows = report.rows.filter((r, i, all) => all.findIndex(x => windowKey(x) === windowKey(r)) === i);
  const key = chosen || windowKey(report.rows[0]);
  const rows = report.rows.filter(r => windowKey(r) === key);
  const first = rows[0];
  const kinds = new Set(rows.map(r => r.strategy.kind));
  const a = (r: ResearchRow) => r.strategy.kind === 'ma' ? r.strategy.fastPeriod : r.strategy.kind === 'rsi' ? r.strategy.lower : r.strategy.lookback;
  const b = (r: ResearchRow) => r.strategy.kind === 'ma' ? r.strategy.slowPeriod : r.strategy.kind === 'rsi' ? r.strategy.upper : 0;
  const axisA = [...new Set(rows.map(a))], axisB = [...new Set(rows.map(b))];
  const focused = rows[selected] ?? first;
  const evaluatedEnd = Math.max(...report.rows.map(r => r.window.end));
  const unused = report.input.dataset.candles.length - evaluatedEnd;
  return <section className="panel research-results" data-testid="research-results">
    <h2>策略研究结果</h2>
    <p role="note">过拟合警告：多次试参会扩大偶然胜出的机会。查看测试结果后改参数，原测试区间就不再是独立证据。此处没有显著性检验、自动优胜者或未来收益承诺。</p>
    <p>{report.rows.length} 次独立子运行 · {report.input.candidates.length} 个候选 · 未评估尾部 {unused} 根。独立窗口不拼接收益、不复利。</p>
    <p>本次锁定本金 {report.input.config!.initialCash} USDT；双边费 {report.input.config!.feeBps} bps；买/卖滑点 {report.input.config!.buySlippageBps}/{report.input.config!.sellSlippageBps} bps；止损/止盈 {report.input.risk?.stopLossBps ?? '关闭'}/{report.input.risk?.takeProfitBps ?? '关闭'} bps。</p>
    <label>结果窗口<select value={key} onChange={e => { setChosen(e.target.value); setSelected(0); }}>{windows.map(r => <option value={windowKey(r)} key={windowKey(r)}>第 {r.window.fold + 1} 折 · {labels[r.window.role]} · [{r.window.start}, {r.window.end})</option>)}</select></label>
    <p>{new Date(first.startUtcMs).toISOString()} 至 {new Date(first.endUtcMs).toISOString()} · UTC，末根收盘。</p>
    {kinds.size === 1 && <div className="research-scroll">
      <table aria-label="参数敏感度热力图"><caption>参数敏感度：每格收益率 / 最大回撤；蓝色为非负收益、橙色为负收益，深浅只描述收益幅度。不自动排序或选优。</caption>
        <thead><tr><th scope="col">{first.strategy.kind === 'ma' ? '快线 / 慢线' : first.strategy.kind === 'rsi' ? '下 / 上阈值' : '回看周期'}</th>{axisB.map(y => <th key={y} scope="col">{first.strategy.kind === 'breakout' ? '收益 / 回撤' : y}</th>)}</tr></thead>
        <tbody>{axisA.map(x => <tr key={x}><th scope="row">{x}</th>{axisB.map(y => { const r = rows.find(r => a(r) === x && b(r) === y); const value = Number(r?.statistics.totalReturn.value ?? 0); return <td key={y} style={{ backgroundColor: r?.statistics.totalReturn.value === null ? undefined : value >= 0 ? 'rgb(40 120 180 / ' + Math.min(0.65, 0.12 + Math.abs(value)) + ')' : 'rgb(210 110 40 / ' + Math.min(0.65, 0.12 + Math.abs(value)) + ')' }}>{r ? <button onClick={() => setSelected(rows.indexOf(r))}>{metric(r.statistics.totalReturn, true)} / {metric(r.statistics.maxDrawdown, true)}</button> : '未配置'}</td>; })}</tr>)}</tbody>
      </table>
    </div>}
    <div className="research-scroll"><table aria-label="收益回撤比较">
      <caption>相同窗口、成本和本金；费用含在净盈亏中，滑点含在成交价中。胜负仅已完成交易，未平仓浮盈不计胜率。</caption>
      <thead><tr>{['候选 / 参数','净盈亏 USDT','收益率','最大回撤','完成交易','胜率','利润因子','买入持有收益','年化'].map(t => <th key={t} scope="col">{t}</th>)}</tr></thead>
      <tbody>{rows.map((r, index) => <tr key={r.candidate}><th scope="row"><button onClick={() => setSelected(index)}>候选 {r.candidate + 1} · {JSON.stringify(r.strategy)}</button>{r.warning && <p>{r.warning}</p>}</th><td>{r.statistics.netPnl}</td><td>{metric(r.statistics.totalReturn, true)}</td><td>{metric(r.statistics.maxDrawdown, true)}</td><td>{r.statistics.completedTradeCount}</td><td>{metric(r.statistics.winRate, true)}</td><td>{metric(r.statistics.profitFactor)}</td><td>{metric(r.statistics.benchmark.return, true)}</td><td>{metric(r.statistics.annualizedReturn, true)}</td></tr>)}</tbody>
    </table></div>
    <details open><summary>候选 {focused.candidate + 1} 账本与口径</summary>
      <p>现金 {focused.final.cash}；持仓数量 {focused.final.position.quantity}；持仓市值 {focused.final.marketValue}；权益 {focused.final.equity} USDT。</p>
      <p>已实现 {focused.statistics.realizedPnl}；未平仓浮动 {focused.statistics.unrealizedPnl}；手续费 {focused.statistics.fees} USDT。预热至少 {focused.warmupBars} 根；完成交易数 {focused.statistics.completedTradeCount}。</p>
      <p>回撤最长持续 {focused.statistics.maxDrawdownDurationMs} ms；暴露上界 {focused.statistics.exposedMs} ms。</p>
      <p>{focused.statistics.benchmark.assumption}</p>
      <p>子运行哈希 <code>{focused.runHash}</code>；区间数据哈希 <code>{focused.dataHash}</code></p>
      <p>原始数据快照哈希 <code>{report.sourceHash}</code>；研究报告哈希 <code>{report.payloadHash}</code></p>
    </details>
    <details><summary>算法版本、假设与完整指标定义</summary><p>{JSON.stringify(report.versions)}</p>{[...report.assumptions,...report.definitions].map((text, i) => <p key={i}>{text}</p>)}</details>
    <button onClick={() => onExport('json')}>导出研究 JSON</button>{' '}<button onClick={() => onExport('csv')}>导出比较 CSV</button>
    <p>{report.disclaimer}。</p>
  </section>;
}
