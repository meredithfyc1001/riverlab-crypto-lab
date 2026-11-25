import { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, LineSeries } from 'lightweight-charts';
import type { IChartApi, Time, UTCTimestamp } from 'lightweight-charts';
import type { PoolPoint, SharedPoolResult } from '../../core/shared-pool/types';

const colors = [
  '#38aa8b',
  '#e4a248',
  '#779fe9',
  '#cf80d3',
  '#cf7979',
  '#8ba3ad',
];
const views = {
  equity: '组合净值与买入持有',
  drawdown: '组合回撤',
  weights: '资产与现金权重',
  contributions: '资产净盈亏贡献',
};
type View = keyof typeof views;

export function SharedPoolCurves({
  result,
  theme,
}: {
  result: SharedPoolResult;
  theme: 'dark' | 'light';
}) {
  const [view, setView] = useState<View>('equity');
  const [error, setError] = useState('');
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!element.current) return;
    const container = element.current;
    let chart: IChartApi | undefined;
    const frame = requestAnimationFrame(() => {
      try {
        setError('');
        const next = createChart(container, {
          autoSize: true,
          layout: {
            background: {
              type: ColorType.Solid,
              color: theme === 'dark' ? '#171c1f' : '#ffffff',
            },
            textColor: theme === 'dark' ? '#c4d3ce' : '#294839',
          },
          localization: {
            timeFormatter: (time: Time) =>
              typeof time === 'number'
                ? new Date(time * 1000).toISOString()
                : String(time),
          },
          timeScale: { timeVisible: true, secondsVisible: true },
        });
        chart = next;
        function series(
          title: string,
          color: string,
          value: (point: PoolPoint) => number | null,
        ) {
          next.addSeries(LineSeries, { title, color, lineWidth: 2 }).setData(
            result.curve.map((point) => {
              const time = (point.timestampUtcMs / 1000) as UTCTimestamp;
              const y = value(point);
              return y === null ? { time } : { time, value: y };
            }),
          );
        }
        switch (view) {
          case 'equity':
            series('组合净值', colors[0], (p) => Number(p.equity));
            series('固定权重买入持有', colors[2], (p) =>
              Number(p.benchmarkEquity),
            );
            break;
          case 'drawdown':
            series('回撤 %', colors[4], (p) => Number(p.drawdown) * 100);
            break;
          case 'weights':
            result.assets.forEach((asset, i) =>
              series(asset.symbol, colors[i], (p) =>
                p.weightsPercent[i] === null
                  ? null
                  : Number(p.weightsPercent[i]),
              ),
            );
            series('现金', colors[5], (p) =>
              p.cashWeightPercent === null ? null : Number(p.cashWeightPercent),
            );
            break;
          case 'contributions':
            result.assets.forEach((asset, i) =>
              series(asset.symbol, colors[i], (p) =>
                Number(p.contributions[i]),
              ),
            );
            break;
        }
        next.timeScale().fitContent();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Canvas 无法绘制');
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      chart?.remove();
    };
  }, [result, theme, view]);
  const unit =
    view === 'drawdown' || view === 'weights'
      ? '%'
      : result.alignment.quoteCurrency;
  return (
    <section className="panel">
      <h3>组合曲线</h3>
      <label>
        显示曲线
        <select
          aria-label="显示曲线"
          value={view}
          onChange={(e) => setView(e.target.value as View)}
        >
          {Object.entries(views).map(([key, title]) => (
            <option key={key} value={key}>
              {title}
            </option>
          ))}
        </select>
      </label>
      <p>
        横轴为 UTC 时间，纵轴单位为 {unit}
        。包含初始本金及每根收盘，可缩放查看。图中数值为绘图近似值。
      </p>
      {error && <p role="alert">曲线显示失败。{error}</p>}
      <div
        ref={element}
        className="portfolio-chart"
        role="img"
        aria-label={views[view] + '曲线'}
      />
      <small>
        TradingView Lightweight Charts™ · Apache-2.0 · Copyright (с) 2025
        TradingView, Inc.
      </small>
    </section>
  );
}
