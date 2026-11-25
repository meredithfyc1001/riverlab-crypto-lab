import { useState } from 'react';
import type { Metric } from '../../core/statistics';
import { decimal, readUnits } from '../../core/math';
import type { PortfolioChild } from '../../core/portfolio';
import type { PortfolioExperiment } from '../../core/portfolio/report';
import type { PortfolioWorkbench } from './model';
import { PortfolioCurves } from './PortfolioCurves';
import { AlignmentTable } from './AlignmentTable';

function metric(value: Metric, percent = false) {
  if (value.value === null) return 'NA · ' + value.reason;
  if (!percent) return value.value;
  const negative = value.value.startsWith('-');
  const units = readUnits(negative ? value.value.slice(1) : value.value);
  return decimal(units * (negative ? -100n : 100n)) + '%';
}
function ChildDetails({ asset }: { asset: PortfolioChild }) {
  const [page, setPage] = useState(0);
  const { fills, manifest } = asset.result;
  const pageSize = 20;
  return (
    <details>
      <summary>
        {asset.symbol} · {fills.length} 笔成交
      </summary>
      <p>
        初始本金 {asset.initialCash} · 期末现金 {asset.result.final.cash} ·
        期末持仓量 {asset.result.final.position.quantity} · 期末市值{' '}
        {asset.result.final.marketValue}
      </p>
      <p>
        手续费 {manifest.config.feeBps} bps，买入滑点{' '}
        {manifest.config.buySlippageBps} bps，卖出滑点{' '}
        {manifest.config.sellSlippageBps} bps，数量精度{' '}
        {manifest.config.quantityDecimals} 位，最小成交额{' '}
        {manifest.config.minNotional}。止损{' '}
        {manifest.risk.stopLossBps ?? '关闭'}，止盈{' '}
        {manifest.risk.takeProfitBps ?? '关闭'}（bps）。
      </p>
      <p>
        交易规则 {manifest.strategy?.version} · 引擎 {manifest.algorithmVersion}{' '}
        · 运行 Hash <code>{manifest.runHash}</code>
      </p>
      <p>
        策略参数 <code>{JSON.stringify(manifest.strategy?.config)}</code>
      </p>
      {fills.length > 0 ? (
        <>
          <div className="table-scroll">
            <table>
              <caption>{asset.symbol} 独立交易明细</caption>
              <thead>
                <tr>
                  {[
                    '序号',
                    'UTC 成交时间',
                    '方向',
                    '成交价',
                    '成交量',
                    '成交额',
                    '手续费',
                    '成交后现金',
                    '成交后持仓',
                    '触发原因',
                  ].map((key) => (
                    <th key={key}>{key}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {fills
                  .slice(page * pageSize, (page + 1) * pageSize)
                  .map((fill) => (
                    <tr key={fill.sequence}>
                      <td>{fill.sequence}</td>
                      <td>
                        {fill.timestampUtcMs === null
                          ? '根内，时间未知'
                          : new Date(fill.timestampUtcMs).toISOString()}
                      </td>
                      <td>{fill.side === 'buy' ? '买入' : '卖出'}</td>
                      <td>{fill.price}</td>
                      <td>{fill.quantity}</td>
                      <td>{fill.notional}</td>
                      <td>{fill.fee}</td>
                      <td>{fill.after.cash}</td>
                      <td>{fill.after.position.quantity}</td>
                      <td>{fill.reason}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {fills.length > pageSize && (
            <div className="portfolio-actions">
              <button disabled={page === 0} onClick={() => setPage(page - 1)}>
                上一页
              </button>
              <span>
                {page + 1} / {Math.ceil(fills.length / pageSize)}
              </span>
              <button
                disabled={(page + 1) * pageSize >= fills.length}
                onClick={() => setPage(page + 1)}
              >
                下一页
              </button>
            </div>
          )}
        </>
      ) : (
        <p>本区间无成交。</p>
      )}
    </details>
  );
}
export function PortfolioResults({
  record,
  workbench: w,
  theme,
}: {
  record: PortfolioExperiment;
  workbench: PortfolioWorkbench;
  theme: 'dark' | 'light';
}) {
  const r = record.result;
  const final = r.curve.at(-1)!;
  return (
    <>
      <section className="panel">
        <h2>组合回测结果</h2>
        <p>
          <strong>{record.name}</strong> · {r.quoteCurrency} ·{' '}
          {w.saved ? '已保存' : '仅在内存'}
        </p>
        <dl className="portfolio-metrics">
          {[
            ['期末组合净值', final.equity],
            ['组合总收益率', metric(r.totalReturn, true)],
            ['组合最大回撤', metric(r.maxDrawdown, true)],
            ['买入持有收益率', metric(r.benchmarkReturn, true)],
            ['初始本金', r.initialCash],
            ['期末现金', final.cash],
            ['期末持仓市值', final.marketValue],
            ['组合净盈亏', r.netPnl],
            ['组合手续费', r.fees],
            ['总成交笔数', String(r.fillCount)],
          ].map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
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
            导出汇总 CSV
          </button>
        </div>
        <details>
          <summary>本次运行区间与基准成本假设</summary>
          <AlignmentTable value={r.alignment} />
          {r.assumptions.map((text) => (
            <p key={text}>{text}</p>
          ))}
        </details>
      </section>
      <PortfolioCurves result={r} theme={theme} />
      <section className="panel">
        <h3>各币种权重与贡献</h3>
        <p>
          期末子账户占比包含该账户现金和持仓。期末持仓占比仅计算该币种的持仓市值，两项均以期末组合净值为分母。贡献金额单位为{' '}
          {r.quoteCurrency}。
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {[
                  '交易对',
                  '配置权重',
                  '初始分配额',
                  '期末子账户净值',
                  '期末子账户占比',
                  '期末持仓占比',
                  '净盈亏贡献',
                  '占组合本金',
                  '手续费贡献',
                  '占组合手续费',
                ].map((k) => (
                  <th key={k}>{k}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.assets.map((a) => (
                <tr key={a.symbol}>
                  <th>{a.symbol}</th>
                  <td>{a.weightPercent}%</td>
                  <td>{a.initialCash}</td>
                  <td>{a.result.final.equity}</td>
                  <td>{metric(a.equityWeight, true)}</td>
                  <td>{metric(a.holdingWeight, true)}</td>
                  <td>{a.netPnl}</td>
                  <td>{metric(a.returnContribution, true)}</td>
                  <td>{a.fees}</td>
                  <td>{metric(a.feeShare, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <h3>资产收益相关性矩阵</h3>
        <p>
          基于相同 UTC 时间戳的相邻收盘价简单收益，Pearson 相关系数，共{' '}
          {r.correlationSamples} 项收益样本。
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>交易对</th>
                {r.assets.map((a) => (
                  <th key={a.symbol}>{a.symbol}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.correlations.map((row, i) => (
                <tr key={r.assets[i].symbol}>
                  <th>{r.assets[i].symbol}</th>
                  {row.map((m, j) => (
                    <td key={r.assets[j].symbol}>{metric(m)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <h3>子账户交易明细</h3>
        {r.assets.map((a) => (
          <ChildDetails key={a.symbol} asset={a} />
        ))}
      </section>
    </>
  );
}
