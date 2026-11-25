import type { AlignmentPreview } from '../../core/portfolio/alignment';
const utc = (value: number) => new Date(value).toISOString();
const showRange = (range: { startUtcMs: number; endUtcMs: number } | null) =>
  range ? utc(range.startUtcMs) + ' — ' + utc(range.endUtcMs) : '无';

export function AlignmentTable({ value }: { value: AlignmentPreview }) {
  return (
    <div>
      <p>
        可用交集 {utc(value.commonStartUtcMs)} — {utc(value.commonEndUtcMs)}
        。本次每个交易对 {value.barCount} 根，周期 {value.intervalMs}{' '}
        毫秒。以下边界均为 UTC 开盘时间，包含首尾。
      </p>
      <div className="table-scroll">
        <table>
          <caption>数据覆盖与本次截取</caption>
          <thead>
            <tr>
              <th>交易对</th>
              <th>原始范围</th>
              <th>截去前段</th>
              <th>截去后段</th>
            </tr>
          </thead>
          <tbody>
            {value.assets.map((asset) => (
              <tr key={asset.symbol}>
                <th>{asset.symbol}</th>
                <td>
                  {utc(asset.sourceStartUtcMs)} — {utc(asset.sourceEndUtcMs)}
                </td>
                <td>
                  {asset.beforeCount} 根 · {showRange(asset.beforeRange)}
                </td>
                <td>
                  {asset.afterCount} 根 · {showRange(asset.afterRange)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
