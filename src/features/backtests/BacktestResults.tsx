import { useState } from 'react';
import type { Experiment } from '../../core/experiments';
import type { Metric } from '../../core/statistics';
import { decimal, readUnits } from '../../core/math';
import { ResultCurves } from './ResultCurves';
import { utc } from './format';
const percentage = (v: string) => {
  const negative = v.startsWith('-');
  return `${decimal(readUnits(negative ? v.slice(1) : v) * (negative ? -100n : 100n))}%`;
};
const metric = (m: Metric, percent = false) =>
  m.value === null
    ? `NA（${m.reason}）`
    : percent
      ? percentage(m.value)
      : m.value;
const reasons: Record<string, string> = {
  'rules-warmup': '规则预热不足，不可判定',
  'rules-conflict': '买卖规则同根冲突，保持不动',
  'rules-repeat': '条件持续满足，不重复触发',
  'rules-no-match': '规则未满足',
  'rules-buy': '买入规则重新满足',
  'rules-sell': '卖出规则重新满足',
  'no-next-candle': '无下一根K线，订单到期',
  'risk-priority': '开盘风控优先，取消待执行信号',
  'position-already-open': '已有持仓，禁止加仓',
  'position-already-flat': '当前空仓，不能卖出',
  'insufficient-cash': '现金不足',
  'insufficient-position': '持仓不足',
  'below-min-notional': '低于最小名义额',
  'zero-quantity': '数量舍入后为零',
  'zero-notional': '名义额为零',
  'price-underflow': '价格低于18位精度',
  'stop-loss': '止损',
  'take-profit': '止盈',
};
export function BacktestResults({
  record,
  theme,
  busy,
  saved,
  onSave,
  onExport,
  onReproduce,
}: {
  record: Experiment;
  theme: 'dark' | 'light';
  busy: boolean;
  saved: boolean;
  onSave: () => void;
  onExport: (format: 'json' | 'csv') => void;
  onReproduce: () => void;
}) {
  const [fillPage, setFillPage] = useState(0),
    [orderPage, setOrderPage] = useState(0);
  const { result: r, statistics: s, dataset: d } = record.payload;
  const m = r.manifest;
  const outcomes = r.orders.filter((o) => o.status !== 'filled');
  const metrics: [string, string][] = [
    ['总净盈亏 USDT', s.netPnl],
    ['总收益率', metric(s.totalReturn, true)],
    ['最大回撤', metric(s.maxDrawdown, true)],
    ['最大回撤处金额 USDT', s.maxDrawdownAmount],
    ['最长回撤持续时间', `${s.maxDrawdownDurationMs / 1000} 秒`],
    ['当前未恢复回撤时间', `${s.ongoingDrawdownMs / 1000} 秒`],
    ['已完成交易数', String(s.completedTrades.length)],
    ['胜率', metric(s.winRate, true)],
    ['利润因子', metric(s.profitFactor)],
    [
      '持仓暴露区间上界',
      `${s.exposedMs / 1000} 秒 · ${percentage(s.exposureFraction)}`,
    ],
    ['年化收益', metric(s.annualizedReturn, true)],
    ['买入持有收益率', metric(s.benchmark.return, true)],
    ['已实现盈亏 USDT', s.realizedPnl],
    ['未平仓浮动盈亏 USDT', s.unrealizedPnl],
    ['累计成交手续费 USDT', s.fees],
    ['现金余额 USDT', r.final.cash],
    ['持仓数量', r.final.position.quantity],
    ['剩余持仓成本 USDT', s.remainingCostBasis],
    ['持仓市值 USDT', r.final.marketValue],
    ['总权益 USDT', r.final.equity],
    ['买入持有终值 USDT', metric(s.benchmark.finalEquity)],
    ['买入持有买入费用 USDT', s.benchmark.fee],
  ];
  return (
    <div className="backtest-results" aria-label="回测结果">
      <section className="panel">
        <h2>回测结果 · {record.name}</h2>
        <p>
          {d.source.label} · {d.symbol} · {utc(s.curve[0].timestampUtcMs)} 至{' '}
          {utc(s.curve.at(-1)!.timestampUtcMs)} · 周期 {m.intervalMs / 1000} 秒
        </p>
        <p>
          运行时间 {utc(record.createdUtcMs)}；Worker核心计算{' '}
          {record.elapsedMs.toFixed(1)} ms；
          {saved ? '实验已保存，请另行备份' : '结果仅在内存，刷新会丢失'}。
        </p>
        <div className="sample-actions">
          <button disabled={busy || saved} onClick={onSave}>
            保存回测实验
          </button>
          <button disabled={busy} onClick={() => onExport('json')}>
            导出实验 JSON
          </button>
          <button disabled={busy} onClick={() => onExport('csv')}>
            导出交易 CSV
          </button>
          <button disabled={busy} onClick={onReproduce}>
            复现本实验
          </button>
        </div>
        <dl className="result-metrics">
          {metrics.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd data-metric={label}>{value}</dd>
            </div>
          ))}
        </dl>
        <p>{s.benchmark.assumption}</p>
        <p>
          滑点已进入买卖名义额，费用单独扣除；已实现 + 浮动 =
          总净盈亏。胜负仅使用已完成周期，均已扣手续费与实际滑点。
        </p>
        {r.fills.length === 0 && (
          <p className="import-warning">
            没有成交；可能为策略预热不足、没有满足信号或订单被拒绝，请查看事件记录。不据此认定策略有效。
          </p>
        )}
        <details>
          <summary>指标定义、舍入和不足样本规则</summary>
          {record.payload.definitions.map((t) => (
            <p key={t}>{t}</p>
          ))}
        </details>
        <details>
          <summary>完整运行配置、版本、哈希与假设</summary>
          <p>
            数据集身份：{d.id}；文件：{d.file.name}
          </p>
          <p>
            数据来源：{d.source.note}；质量警告 {d.quality.warningCount}，缺口{' '}
            {d.quality.gapCount}
          </p>
          {d.quality.issues.map((q, i) => (
            <p key={i}>
              {q.code}：{q.message}
            </p>
          ))}
          <pre>
            {JSON.stringify(
              {
                datasetId: d.id,
                payloadHash: record.payloadHash,
                statisticsVersion: s.version,
                ...m,
                signals: `${m.signals.length} 条实际信号保存在完整JSON报告`,
              },
              null,
              2,
            )}
          </pre>
        </details>
      </section>
      <ResultCurves statistics={s} theme={theme} />
      <section className="panel">
        <h3>交易记录与逐笔账本（{r.fills.length} 笔成交）</h3>
        <p>
          每页50笔；根内精确时间未知，展示UTC区间与保守假设。表中权益按该笔参考价估值，末权益按末收盘价估值。
        </p>
        <Pager page={fillPage} count={r.fills.length} setPage={setFillPage} />
        <div className="table-scroll">
          <table aria-label="逐笔成交账本">
            <thead>
              <tr>
                {[
                  '序号/方向',
                  'UTC时间/区间',
                  '原因/假设',
                  '参考价/成交价',
                  '数量/名义额',
                  '手续费',
                  '成交后现金',
                  '成交后持仓/市值',
                  '成交后权益',
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.fills.slice(fillPage * 50, fillPage * 50 + 50).map((f) => (
                <tr key={f.sequence}>
                  <td>
                    {f.sequence} · {f.side === 'buy' ? '买入' : '卖出'}
                  </td>
                  <td>
                    {f.timestampUtcMs === null
                      ? `${utc(f.trigger!.barOpenUtcMs)} 至 ${utc(f.trigger!.barCloseUtcMs)}（根内时间未知）`
                      : utc(f.timestampUtcMs)}
                  </td>
                  <td>
                    {reasons[f.reason] ?? f.reason}
                    {f.trigger && <small>{f.trigger.assumption}</small>}
                  </td>
                  <td>
                    {f.referencePrice}
                    <br />
                    {f.price}
                  </td>
                  <td>
                    {f.quantity}
                    <br />
                    {f.notional}
                  </td>
                  <td>{f.fee}</td>
                  <td>{f.after.cash}</td>
                  <td>
                    {f.after.position.quantity}
                    <br />
                    {f.after.marketValue}
                  </td>
                  <td>{f.after.equity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!r.fills.length && <p>尚无成交记录。</p>}
      </section>
      <section className="panel">
        <h3>拒绝、取消与到期事件（{outcomes.length}）</h3>
        <Pager
          page={orderPage}
          count={outcomes.length}
          setPage={setOrderPage}
        />
        <div className="table-scroll">
          <table aria-label="未成交订单事件">
            <thead>
              <tr>
                <th>订单/目标K线</th>
                <th>状态</th>
                <th>原因</th>
                <th>原信号/触发</th>
              </tr>
            </thead>
            <tbody>
              {outcomes.slice(orderPage * 50, orderPage * 50 + 50).map((o) => (
                <tr key={o.intent.id}>
                  <td>
                    {o.intent.id} · {o.intent.targetCandleIndex}
                  </td>
                  <td>
                    {
                      {
                        rejected: '被拒绝',
                        cancelled: '已取消',
                        expired: '已到期',
                        filled: '成交',
                      }[o.status]
                    }
                  </td>
                  <td>{reasons[o.reason ?? ''] ?? o.reason}</td>
                  <td>
                    {o.intent.reason} {o.intent.trigger?.assumption}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!outcomes.length && <p>无拒绝、取消或到期事件。</p>}
      </section>
      <p>{record.payload.disclaimer} · 不提供投资建议。</p>
    </div>
  );
}
function Pager({
  page,
  count,
  setPage,
}: {
  page: number;
  count: number;
  setPage: (p: number) => void;
}) {
  return (
    <div className="sample-actions">
      <button disabled={page === 0} onClick={() => setPage(page - 1)}>
        上一页
      </button>
      <span>
        第 {page + 1} / {Math.max(1, Math.ceil(count / 50))} 页
      </span>
      <button
        disabled={(page + 1) * 50 >= count}
        onClick={() => setPage(page + 1)}
      >
        下一页
      </button>
    </div>
  );
}
