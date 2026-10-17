import type { SyntheticDataset } from '../core/data';

export function SyntheticPreview({ dataset }: { dataset: SyntheticDataset }) {
  return (
    <section className="panel sample-panel" aria-labelledby="sample-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">LOCAL EXAMPLE</span>
          <h2 id="sample-title">只读示例</h2>
        </div>
        <span className="badge badge-amber">人工合成数据</span>
      </div>
      <p className="sample-label">
        {dataset.label} <span>· 1 小时 · UTC</span>
      </p>
      <p className="muted" id="sample-disclaimer">
        {dataset.disclaimer}
      </p>
      <div
        className="table-scroll"
        role="region"
        aria-label="人工合成行情示例"
        tabIndex={0}
      >
        <table aria-describedby="sample-disclaimer">
          <caption className="sr-only">
            4 条固定人工合成 OHLCV 数据，时间为 UTC
          </caption>
          <thead>
            <tr>
              <th scope="col">时间（UTC）</th>
              <th scope="col">开盘</th>
              <th scope="col">最高</th>
              <th scope="col">最低</th>
              <th scope="col">收盘</th>
              <th scope="col">成交量</th>
            </tr>
          </thead>
          <tbody>
            {dataset.candles.map((candle) => (
              <tr key={candle.timestampUtcMs}>
                <th scope="row">
                  {new Date(candle.timestampUtcMs)
                    .toISOString()
                    .slice(0, 16)
                    .replace('T', ' ')}
                </th>
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
    </section>
  );
}
