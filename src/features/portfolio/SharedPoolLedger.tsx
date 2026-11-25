import { useMemo, useState, type ReactNode } from 'react';
import type { SharedPoolResult } from '../../core/shared-pool/types';

import { rejectionText } from './order-reason';

const phases = {
  'protection-open': '开盘保护退出',
  sell: '开盘卖出',
  buy: '开盘买入',
  'protection-after-buys': '买入后的保护处理',
};

const blank = '—';
const PAGE_SIZE = 15;
const utc = (time: number) => new Date(time).toISOString();

function LedgerTable<T>({
  title,
  rows,
  headers,
  render,
}: {
  title: string;
  rows: readonly T[];
  headers: string[];
  render: (row: T, index: number) => ReactNode;
}) {
  const [page, setPage] = useState(0);
  const pages = Math.ceil(rows.length / PAGE_SIZE);
  return (
    <section className="panel">
      <h3>{title}</h3>
      {rows.length ? (
        <>
          <div className="table-scroll">
            <table aria-label={title}>
              <thead>
                <tr>
                  {headers.map((h) => (
                    <th key={h} scope="col">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows
                  .slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
                  .map(render)}
              </tbody>
            </table>
          </div>
          <div className="portfolio-actions">
            <small>
              共 {rows.length} 条 · 第 {page + 1} / {pages} 页
            </small>
            {pages > 1 && (
              <>
                <button
                  aria-label={title + '上一页'}
                  disabled={page === 0}
                  onClick={() => setPage(page - 1)}
                >
                  上一页
                </button>
                <button
                  aria-label={title + '下一页'}
                  disabled={page + 1 >= pages}
                  onClick={() => setPage(page + 1)}
                >
                  下一页
                </button>
              </>
            )}
          </div>
        </>
      ) : (
        <p>本区间无记录。</p>
      )}
    </section>
  );
}

export function SharedPoolLedger({ result: r }: { result: SharedPoolResult }) {
  const failures = useMemo(() => {
    const byBar = new Map<number, Map<string, string>>();
    for (const order of r.orders)
      if (order.rejection) {
        const perAsset = byBar.get(order.barIndex) ?? new Map<string, string>();
        perAsset.set(order.symbol, rejectionText(order.rejection));
        byBar.set(order.barIndex, perAsset);
      }
    return byBar;
  }, [r.orders]);
  const targets = [
    ...r.assets.map((a) => ({ symbol: a.symbol, weight: a.weightPercent })),
    { symbol: '现金', weight: r.cashWeightPercent },
  ];
  return (
    <>
      <LedgerTable
        title="多资产订单与成交"
        rows={r.orders}
        headers={[
          '序号',
          '开盘时间 UTC',
          '交易对',
          '阶段',
          '方向',
          '状态',
          '触发原因',
          '拒单原因',
          '申请预算',
          '批准预算',
          '未用预算',
          '参考价',
          '成交价',
          '成交量',
          '成交额',
          '手续费',
          '成交前共享现金',
          '成交后共享现金',
          '成交前持仓',
          '成交后持仓',
        ]}
        render={(o) => (
          <tr key={o.sequence}>
            <td>{o.sequence}</td>
            <td>{utc(o.barOpenUtcMs)}</td>
            <th scope="row">{o.symbol}</th>
            <td>{phases[o.phase]}</td>
            <td>{o.side === 'buy' ? '买入' : '卖出'}</td>
            <td>{o.status === 'filled' ? '成交' : '拒单'}</td>
            <td>
              {o.trigger
                ? (o.trigger.kind === 'stop-loss' ? '止损' : '止盈') +
                  (o.trigger.assumption === 'ambiguous-stop-first'
                    ? ' · 双触发先止损'
                    : '')
                : o.reason}
            </td>
            <td>{o.rejection ? rejectionText(o.rejection) : blank}</td>
            {[
              o.requestedBudget,
              o.approvedBudget,
              o.unusedBudget,
              o.referencePrice,
              o.price,
              o.quantity,
              o.notional,
              o.fee,
              o.cashBefore,
              o.cashAfter,
              o.quantityBefore,
              o.quantityAfter,
            ].map((v, i) => (
              <td key={i}>{v ?? blank}</td>
            ))}
          </tr>
        )}
      />
      <LedgerTable
        title="开盘资金分配"
        rows={r.allocations}
        headers={[
          '开盘时间 UTC',
          '卖出后权益',
          '买入前共享现金',
          '目标现金储备',
          '可分配现金',
          '申请合计',
          '批准合计',
          '实际支出（含费）',
          '买入后共享现金',
        ]}
        render={(a) => (
          <tr key={a.barIndex}>
            <td>
              {utc(
                r.alignment.startUtcMs + a.barIndex * r.alignment.intervalMs,
              )}
            </td>
            {[
              a.openEquity,
              a.cashBeforeBuys,
              a.reserve,
              a.capacity,
              a.requested,
              a.approved,
              a.spent,
              a.cashAfterBuys,
            ].map((v, i) => (
              <td key={i}>{v}</td>
            ))}
          </tr>
        )}
      />
      {r.mode === 'rebalance' && (
        <LedgerTable
          title="调仓记录与剩余偏差"
          rows={r.rebalances}
          headers={[
            '调仓开盘 UTC',
            '交易对 / 现金',
            '目标 %',
            '调仓前 %',
            '调仓后 %',
            '偏差（百分点）',
            '未成交原因',
          ]}
          render={(b) =>
            targets.map((a, i) => (
              <tr key={b.barIndex + ':' + a.symbol}>
                {i === 0 && (
                  <td rowSpan={targets.length}>{utc(b.barOpenUtcMs)}</td>
                )}
                <th scope="row">{a.symbol}</th>
                <td>{a.weight}</td>
                <td>{b.beforePercent[i] ?? 'NA'}</td>
                <td>{b.afterPercent[i] ?? 'NA'}</td>
                <td>{b.deviationPercent[i] ?? 'NA'}</td>
                <td>{failures.get(b.barIndex)?.get(a.symbol) ?? blank}</td>
              </tr>
            ))
          }
        />
      )}
      <LedgerTable
        title="收盘决策"
        rows={r.decisions}
        headers={['收盘时间 UTC', '交易对', '决策', '原因']}
        render={(d) => (
          <tr key={d.barIndex + ':' + d.symbol}>
            <td>{utc(d.closeUtcMs)}</td>
            <td>{d.symbol ?? '组合'}</td>
            <td>
              {
                {
                  buy: '买入',
                  sell: '卖出',
                  hold: '持有',
                  rebalance: '安排调仓',
                }[d.action]
              }
            </td>
            <td>{d.reason}</td>
          </tr>
        )}
      />
    </>
  );
}
