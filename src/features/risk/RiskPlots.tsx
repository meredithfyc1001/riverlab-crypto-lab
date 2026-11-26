import { useState } from 'react';
import type { Simulation } from '../../core/risk-analysis';
import { readUnits, decimal } from '../../core/math';
export function RiskPlots({ simulation: s }: { simulation: Simulation }) {
  const [traces, setTraces] = useState(false);
  const values = s.bands.flatMap((b) => [readUnits(b.p05), readUnits(b.p95)]);
  if (traces)
    s.traces.forEach((t) =>
      t.points.forEach((p) => values.push(readUnits(p.equity))),
    );
  const min = values.reduce((a, b) => (a < b ? a : b)),
    max = values.reduce((a, b) => (a > b ? a : b)),
    span = max - min;
  const x = (step: number) => 40 + (step / s.settings.steps) * 600;
  const y = (value: string) =>
    span === 0n
      ? 170
      : 30 + Number(((max - readUnits(value)) * 2800n) / span) / 10;
  const line = (key: 'p05' | 'p50' | 'p95') =>
    s.bands.map((b) => x(b.step) + ',' + y(b[key])).join(' ');
  const area = s.bands
    .map((b) => x(b.step) + ',' + y(b.p95))
    .concat([...s.bands].reverse().map((b) => x(b.step) + ',' + y(b.p05)))
    .join(' ');
  const maxCount = Math.max(...s.histogram.map((b) => b.count));
  return (
    <section className="panel risk-panel" data-testid="risk-plots">
      <h3>模拟样本权益分位带与终值分布</h3>
      <p>
        显示 {s.bands.length} 个步位置，全部 {s.settings.steps}{' '}
        步均参与统计。5/50/95分位带是模拟样本分位，非未来置信区间。横轴是重采样步，不是未来日期。
      </p>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={traces}
          onChange={(e) => setTraces(e.target.checked)}
        />
        显示首5条示例路径（不是分位路径）
      </label>
      <svg
        viewBox="0 0 680 350"
        role="img"
        aria-label="重采样权益5、50、95分位带"
      >
        <line x1="40" y1="310" x2="640" y2="310" stroke="currentColor" />
        <polygon points={area} fill="var(--risk-band)" opacity=".22" />
        <polyline
          points={line('p05')}
          fill="none"
          stroke="var(--risk-band)"
          strokeWidth="1.5"
        />
        <polyline
          points={line('p50')}
          fill="none"
          stroke="var(--risk-median)"
          strokeWidth="2.5"
        />
        <polyline
          points={line('p95')}
          fill="none"
          stroke="var(--risk-band)"
          strokeWidth="1.5"
        />
        {traces &&
          s.traces.map((t) => (
            <polyline
              key={t.path}
              points={t.points
                .map((p) => x(p.step) + ',' + y(p.equity))
                .join(' ')}
              fill="none"
              stroke="var(--muted)"
            >
              <title>示例路径{t.path}</title>
            </polyline>
          ))}
        <text x="40" y="335">
          0步
        </text>
        <text x="550" y="335">
          {s.settings.steps}步
        </text>
      </svg>
      <p>
        纵轴范围 {min === max ? '单值 ' : ''}
        {decimal(min)} 至 {decimal(max)}{' '}
        USDT（坐标近似，完整18位值见表格/JSON）。绿色为中位数。
      </p>
      <svg viewBox="0 0 680 230" role="img" aria-label="重采样最终权益直方图">
        {s.histogram.map((b, i) => {
          const width = 600 / s.histogram.length,
            h = (b.count / maxCount) * 170;
          return (
            <g key={i}>
              <rect
                x={40 + i * width}
                y={190 - h}
                width={Math.max(1, width - 3)}
                height={h}
                fill="var(--risk-band)"
              />
              <title>
                {b.lower} 至 {b.upper} USDT：{b.count}条路径
              </title>
              <text x={40 + i * width} y={Math.max(14, 183 - h)}>
                {b.count}
              </text>
            </g>
          );
        })}
        <text x="40" y="218">
          低终值
        </text>
        <text x="575" y="218">
          高终值
        </text>
      </svg>
      <p>
        共{s.settings.paths}
        条路径；直方图每组为左闭右开，末组含最大值；等值分布为单组。精确金额区间与计数如下。
      </p>
      <div className="risk-scroll">
        <table aria-label="最终权益直方图明细">
          <thead>
            <tr>
              <th>下界 USDT</th>
              <th>上界 USDT</th>
              <th>路径数</th>
            </tr>
          </thead>
          <tbody>
            {s.histogram.map((b, i) => (
              <tr key={i}>
                <td>{b.lower}</td>
                <td>{b.upper}</td>
                <td>{b.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
