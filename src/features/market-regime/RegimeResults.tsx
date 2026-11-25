import { useMemo, useState } from 'react';
import {
  regimeCandles,
  type RegimeReport,
} from '../../core/market-regime/report';
import type { RegimeSummary } from '../../core/market-regime/model';
import { RegimeChart } from './RegimeChart';
import {
  duration,
  percentage,
  stateNames,
  utc,
  type Theme,
} from './presentation';
const perPage = 20;

function DistributionTable({
  rows,
  field,
  caption,
}: {
  rows: RegimeSummary[];
  field: 'assetReturns' | 'periodReturns';
  caption: string;
}) {
  return (
    <div
      className="regime-scroll"
      tabIndex={0}
      role="region"
      aria-label={caption}
    >
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {['状态', '有效根数', '最小', '中位数', '最大', '均值', '波动'].map(
              (text) => (
                <th key={text}>{text}</th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const d = row[field];
            return (
              <tr key={row.state}>
                <th>{stateNames[row.state]}</th>
                <td>{d.count}</td>
                {[d.min, d.median, d.max, d.mean, d.volatility].map((v, i) => (
                  <td key={i}>{percentage(v)}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
export function RegimeResults({
  report,
  theme,
}: {
  report: RegimeReport;
  theme: Theme;
}) {
  const { params, result, reference } = report;
  const candles = useMemo(() => regimeCandles(report), [report]);
  const [page, setPage] = useState(0);
  const pageCount = Math.ceil(result.runs.length / perPage);
  return (
    <>
      <section className="panel">
        <h2>市场状态归因结果</h2>
        <h3>{report.name}</h3>
        <p>
          原实验「{report.source.name}」 ·{' '}
          {report.source.kind === 'single'
            ? report.source.input.dataset.symbol
            : report.source.kind === 'portfolio'
              ? '固定子账户组合'
              : report.source.input.mode === 'rebalance'
                ? '定期再平衡组合'
                : '策略共享资金池'}
          。
        </p>
        <details>
          <summary>原实验身份与版本</summary>
          <p>
            原实验 ID <code>{report.source.id}</code>，创建于{' '}
            {utc(report.source.createdUtcMs)}。
          </p>
          <p>
            原实验 payloadHash <code>{report.source.payloadHash}</code>
          </p>
          <p>
            模型 <code>{report.modelVersion}</code> · 归因算法{' '}
            <code>{report.algorithmVersion}</code> · 报告格式 v
            {report.schemaVersion}
          </p>
        </details>
        <p>
          本次参数为回看 <b>{params.lookback} 根</b>、对称阈值{' '}
          <b>{params.thresholdBps / 100}%</b>
          。超过正阈值为上涨，低于负阈值为下跌，含等号的中间区间为震荡。历史不足时为未知。
        </p>
        <div className="regime-facts">
          <div>
            <span>原实验总净盈亏</span>
            <b>{result.netPnl}</b>
          </div>
          <div>
            <span>归因 K 线</span>
            <b>{candles.length}</b>
          </div>
          <div>
            <span>状态切换</span>
            <b>{result.switches} 次</b>
          </div>
          {reference && (
            <div>
              <span>组合参考资产</span>
              <b>{reference}</b>
            </div>
          )}
        </div>
        <p>
          相邻收盘权益差按上一收盘的标签记账，首段从原始本金起算。下表中的净盈亏贡献之和等于原实验总净盈亏。
        </p>
        <div
          className="regime-scroll"
          role="region"
          aria-label="各状态归因"
          tabIndex={0}
        >
          <table>
            <caption>各状态归因</caption>
            <thead>
              <tr>
                {[
                  '状态',
                  '期间数',
                  '出现次数',
                  '时间占比',
                  '持续时间',
                  '净盈亏贡献',
                  '已实现变化',
                  '浮动变化',
                  '成交笔数',
                  '手续费',
                  '暴露时长上界',
                  '暴露占比',
                ].map((s) => (
                  <th key={s}>{s}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.summaries.map((r) => (
                <tr key={r.state}>
                  <th>
                    {stateNames[r.state]} · {r.state}
                  </th>
                  <td>{r.bars}</td>
                  <td>{r.occurrences}</td>
                  <td>{percentage(r.timeFraction)}</td>
                  <td>{duration(r.durationMs)}</td>
                  <td>{r.netPnl}</td>
                  <td>{r.realizedDelta}</td>
                  <td>{r.unrealizedDelta}</td>
                  <td>{r.fills}</td>
                  <td>{r.fees}</td>
                  <td>{duration(r.exposedMs)}</td>
                  <td>{percentage(r.exposureFraction)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          收益包含原实验的交易成本。持仓跨状态连续计价，根内持仓以整根时长上界计，组合按至少一个资产有暴露计一次。
        </p>
        <p>
          报告 SHA-256{' '}
          <code data-testid="regime-report-hash">{report.reportHash}</code>
        </p>
      </section>
      <RegimeChart
        candles={candles}
        result={result}
        params={params}
        theme={theme}
      />
      <section className="panel">
        <h2>逐根收益分布</h2>
        <p>
          权益收益按本根权益变化除以前一权益；参考资产收益按相邻收盘计算，首根使用开盘至收盘。波动为各状态单根收益的总体标准差，至少需要两项有效观测。空值显示为「—」。
        </p>
        <DistributionTable
          rows={result.summaries}
          field="periodReturns"
          caption="原实验权益收益"
        />
        <DistributionTable
          rows={result.summaries}
          field="assetReturns"
          caption="参考资产价格收益"
        />
      </section>
      <section className="panel">
        <h2>连续市场状态区间</h2>
        <p>
          UTC 区间含起点，止于末根收盘。区间收益使用同一原账户在区间两端的权益。
        </p>
        <div
          className="regime-scroll"
          role="region"
          aria-label="连续市场状态区间明细"
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                {[
                  '生效状态',
                  '开始 UTC',
                  '结束 UTC',
                  '根数',
                  '期初权益',
                  '期末权益',
                  '净盈亏',
                  '区间收益',
                ].map((s) => (
                  <th key={s}>{s}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.runs
                .slice(page * perPage, (page + 1) * perPage)
                .map((r) => (
                  <tr key={r.startUtcMs}>
                    <th>
                      {stateNames[r.state]} · {r.state}
                    </th>
                    <td>{utc(r.startUtcMs)}</td>
                    <td>{utc(r.endUtcMs)}</td>
                    <td>{r.bars}</td>
                    <td>{r.startEquity}</td>
                    <td>{r.endEquity}</td>
                    <td>{r.netPnl}</td>
                    <td>{percentage(r.returnFraction)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {pageCount > 1 && (
          <div className="regime-actions">
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              上一页区间
            </button>
            <span>
              {page + 1} / {pageCount}
            </span>
            <button
              disabled={page + 1 >= pageCount}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页区间
            </button>
          </div>
        )}
      </section>
    </>
  );
}
