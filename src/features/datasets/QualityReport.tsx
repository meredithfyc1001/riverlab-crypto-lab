import { useState } from 'react';
import type { ReportView } from './worker-types';

const utc = (timestamp: number) =>
  new Date(timestamp).toISOString().replace('T', ' ').replace('Z', ' UTC');
export function QualityReport({ report }: { report: ReportView }) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(report.issues.length / 25));
  const current = Math.min(page, pageCount - 1);
  const status =
    report.status === 'has-errors'
      ? '存在阻断错误'
      : report.status === 'needs-confirmation'
        ? '需要确认参数'
        : '检查完成（仅文件内）';
  return (
    <section className="panel import-report" aria-labelledby="quality-title">
      <div className="section-heading">
        <h2 id="quality-title">数据质量报告</h2>
        <span
          className={`badge ${report.status === 'reviewed' ? '' : 'badge-amber'}`}
        >
          {status}
        </span>
      </div>
      <div className="quality-stats">
        <div>
          数据记录<strong>{report.totalRows}</strong>
        </div>
        <div>
          有效候选行<strong>{report.validRows}</strong>
        </div>
        <div>
          错误行<strong>{report.invalidRows}</strong>
        </div>
        <div>
          待解析行<strong>{report.pendingRows}</strong>
        </div>
        <div>
          重复行（含首次）<strong>{report.duplicateRows}</strong>
        </div>
        <div>
          缺失 K 线
          <strong>
            {report.intervalMs === null ||
            report.issueCounts.INTERVAL_MISMATCH ||
            report.issueCounts.INSUFFICIENT_ROWS
              ? '无法确定'
              : report.missingCandles}
          </strong>
        </div>
      </div>
      <dl className="report-facts">
        <div>
          <dt>时间规范化</dt>
          <dd>
            {report.timeUnit
              ? `${report.timeUnit} → UTC 毫秒`
              : '无法判定，需要确认'}
          </dd>
        </div>
        <div>
          <dt>已确认周期</dt>
          <dd>
            {report.intervalMs === null
              ? '未确认，不作零缺失判断'
              : `${report.intervalMs / 1000} 秒（固定周期）`}
          </dd>
        </div>
        <div>
          <dt>可解析时间范围</dt>
          <dd>
            {report.range
              ? `${utc(report.range.startUtcMs)} 至 ${utc(report.range.endUtcMs)}`
              : '无有效范围'}
          </dd>
        </div>
        <div>
          <dt>错误 / 警告 / 空白行</dt>
          <dd>
            {report.errorCount} / {report.warningCount} / {report.blankLines}
          </dd>
        </div>
      </dl>
      <p className="muted">
        候选行仅用于预览，未保存为数据集。不会自动去重、排序、补价格或修复错误。首尾完整性和来源真实性不能由本文件自行证明。
      </p>
      <h3>错误行与警告</h3>
      {report.issueDetailsTruncated && (
        <p className="import-warning">
          共 {report.errorCount + report.warningCount} 条问题，仅保留前 1,000
          条明细；总数未截断。请拆分文件查看其余问题。
        </p>
      )}
      <div
        className="table-scroll"
        role="region"
        aria-label="错误与警告明细"
        tabIndex={0}
      >
        <table className="issue-table">
          <caption className="sr-only">
            CSV 质量问题，行号为原始物理行起点
          </caption>
          <thead>
            <tr>
              <th scope="col">级别 / 行号</th>
              <th scope="col">问题</th>
              <th scope="col">原始内容（最多 240 字符）</th>
            </tr>
          </thead>
          <tbody>
            {report.issues
              .slice(current * 25, current * 25 + 25)
              .map((issue, index) => (
                <tr key={`${current}-${index}`}>
                  <th scope="row">
                    {issue.severity === 'error' ? '错误' : '警告'} /{' '}
                    {issue.line ?? '文件'}
                  </th>
                  <td>
                    <code>{issue.code}</code>
                    <p>{issue.message}</p>
                  </td>
                  <td>{issue.raw ?? '—'}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <div className="report-pagination">
        <button
          type="button"
          disabled={current === 0}
          onClick={() => setPage(current - 1)}
        >
          上一页问题
        </button>
        <span>
          {current + 1} / {pageCount}
        </span>
        <button
          type="button"
          disabled={current + 1 >= pageCount}
          onClick={() => setPage(current + 1)}
        >
          下一页问题
        </button>
      </div>
      {report.gapCount > 0 && (
        <details>
          <summary>
            缺失区间：{report.gapCount} 个，共 {report.missingCandles} 根
          </summary>
          <p className="muted">
            显示前 {Math.min(report.gaps.length, 100)}{' '}
            个区间；两端时间点之间按确认周期计算，不推测缺口成因。
          </p>
          <ul className="gap-list">
            {report.gaps.slice(0, 100).map((gap) => (
              <li key={gap.afterUtcMs}>
                {utc(gap.afterUtcMs)} → {utc(gap.beforeUtcMs)}：缺{' '}
                {gap.missingCount} 根
              </li>
            ))}
          </ul>
        </details>
      )}
      {report.preview.length > 0 && (
        <details>
          <summary>UTC 规范化候选预览（最多 20 行）</summary>
          <div
            className="table-scroll"
            role="region"
            aria-label="规范化候选预览"
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  {[
                    '原始行',
                    '时间（UTC）',
                    '开盘',
                    '最高',
                    '最低',
                    '收盘',
                    '成交量',
                  ].map((label) => (
                    <th scope="col" key={label}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.preview.map(({ line, candle }) => (
                  <tr key={line}>
                    <th scope="row">{line}</th>
                    <td>{utc(candle.timestampUtcMs)}</td>
                    <td>{candle.open}</td>
                    <td>{candle.high}</td>
                    <td>{candle.low}</td>
                    <td>{candle.close}</td>
                    <td>{candle.volume}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}
