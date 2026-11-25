import { decimal, readUnits, SCALE } from '../../core/math';
import type { SharedPoolExperiment } from '../../core/shared-pool/report';
import { AlignmentTable } from './AlignmentTable';
import { modeLabels } from './modes';
import type { SharedPoolWorkbench } from './shared-model';
import { SharedPoolCurves } from './SharedPoolCurves';
import { SharedPoolLedger } from './SharedPoolLedger';
import { rejectionText } from './order-reason';

function percent(fraction: string) {
  const units = fraction.startsWith('-')
    ? -readUnits(fraction.slice(1))
    : readUnits(fraction);
  return decimal(100n * units) + '%';
}
const weight = (p: string | null) => (p === null ? 'NA · 权益为零' : p + '%');

export function SharedPoolResults({
  record,
  workbench: w,
  theme,
}: {
  record: SharedPoolExperiment;
  workbench: SharedPoolWorkbench;
  theme: 'dark' | 'light';
}) {
  const r = record.result;
  const final = r.curve.at(-1)!;
  const equity = readUnits(final.equity);
  const exposure =
    equity === 0n
      ? null
      : decimal((readUnits(final.marketValue) * 100n * SCALE) / equity);
  return (
    <>
      <section className="panel">
        <h2>共享资金池回测结果</h2>
        <p>
          <strong>{record.name}</strong> · {modeLabels[r.mode]} ·{' '}
          {r.alignment.quoteCurrency} · {w.saved ? '已保存' : '仅在内存'}
        </p>
        <dl className="portfolio-metrics">
          {[
            ['期末组合净值', final.equity],
            ['组合总收益率', percent(r.totalReturn)],
            ['最大收盘回撤', percent(r.maxDrawdown)],
            ['固定权重买入持有收益率', percent(r.benchmarkReturn)],
            ['初始共享现金', r.initialCash],
            ['期末共享现金', final.cash],
            ['期末持仓市值', final.marketValue],
            ['期末持仓风险暴露', weight(exposure)],
            ['组合净盈亏', r.netPnl],
            ['手续费合计', r.fees],
            ['成交笔数', String(r.fillCount)],
          ].map(([title, value]) => (
            <div key={title}>
              <dt>{title}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <p>
          组合 Hash <code>{record.payloadHash}</code>
        </p>
        <div className="portfolio-actions">
          <button disabled={w.busy || w.saved} onClick={w.save}>
            保存组合实验
          </button>
          <button disabled={w.busy} onClick={w.reproduce}>
            完整复现
          </button>
          <button disabled={w.busy} onClick={() => w.exportRecord('json')}>
            导出组合 JSON
          </button>
          <button disabled={w.busy} onClick={() => w.exportRecord('csv')}>
            导出明细 CSV
          </button>
        </div>
        <details>
          <summary>区间、执行规则与基准成本</summary>
          <AlignmentTable value={r.alignment} />
          <p>
            算法 {r.version} · 执行时钟 {r.executionVersion} · 价格转换{' '}
            {r.conversionVersion} · 报告 {record.format} v{record.schemaVersion}
          </p>
          {r.assumptions.map((text) => (
            <p key={text}>{text}</p>
          ))}
        </details>
        {r.benchmarkReasons.map((a) => (
          <p key={a.symbol}>
            买入持有基准 · {a.symbol} · {rejectionText(a.reason)}
          </p>
        ))}
      </section>
      <SharedPoolCurves result={r} theme={theme} />
      <section className="panel">
        <h3>期末权重与资产贡献</h3>
        <p>
          风险暴露按持仓市值占组合净值计算。各资产净盈亏等于累计卖出净收入减买入总支出，再加期末市值。金额单位为{' '}
          {r.alignment.quoteCurrency}。
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {[
                  '资产',
                  '目标权重',
                  '实际权重',
                  '期末数量',
                  '期末市值',
                  '累计买入支出（含费）',
                  '累计卖出收入（净额）',
                  '手续费',
                  '净盈亏贡献',
                ].map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.assets.map((a, i) => (
                <tr key={a.symbol}>
                  <th scope="row">{a.symbol}</th>
                  <td>{weight(a.weightPercent)}</td>
                  <td>{weight(final.weightsPercent[i])}</td>
                  {[
                    a.quantity,
                    a.marketValue,
                    a.buySpend,
                    a.sellProceeds,
                    a.fees,
                    a.netPnl,
                  ].map((v, k) => (
                    <td key={k}>{v}</td>
                  ))}
                </tr>
              ))}
              <tr>
                <th scope="row">共享现金</th>
                <td>{weight(r.cashWeightPercent)}</td>
                <td>{weight(final.cashWeightPercent)}</td>
                <td colSpan={6}>余额 {final.cash}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {r.mode === 'rebalance' && (
          <p>
            每次调仓以开盘已知价格估值。手续费、滑点、数量步长和最小成交额会留下偏差，详情见下方调仓记录。
          </p>
        )}
        <details>
          <summary>本次配置与策略版本</summary>
          {record.input.mode === 'rebalance' && (
            <p>再平衡周期 {record.input.rebalanceEvery} 根已完成 K 线。</p>
          )}
          {record.input.assets.map((asset) => (
            <div key={asset.dataset.id}>
              <h4>{asset.dataset.symbol}</h4>
              <p>
                手续费 {asset.costs.feeBps} bps · 买 / 卖滑点{' '}
                {asset.costs.buySlippageBps} / {asset.costs.sellSlippageBps} bps
                · 数量小数位 {asset.costs.quantityDecimals} · 最小成交额{' '}
                {asset.costs.minNotional}
              </p>
              {'strategy' in asset && (
                <p>
                  策略 <code>{JSON.stringify(asset.strategy)}</code>
                  {asset.ruleRecord && (
                    <>
                      {' '}
                      · {asset.ruleRecord.name} v
                      {asset.ruleRecord.rule.revision}
                    </>
                  )}{' '}
                  · 止损 {asset.risk.stopLossBps ?? '关闭'} / 止盈{' '}
                  {asset.risk.takeProfitBps ?? '关闭'}（bps）
                </p>
              )}
            </div>
          ))}
        </details>
      </section>
      <SharedPoolLedger result={r} />
    </>
  );
}
