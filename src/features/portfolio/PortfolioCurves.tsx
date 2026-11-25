import { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, LineSeries } from 'lightweight-charts';
import type { UTCTimestamp, Time, IChartApi } from 'lightweight-charts';
import type { PortfolioResult } from '../../core/portfolio';

const colors = ['#30af88', '#dfa750', '#638ee7', '#c484db', '#cf7678'];
const chartTime = (ms: number) => (ms / 1000) as UTCTimestamp;
export function PortfolioCurves({
  result,
  theme,
}: {
  result: PortfolioResult;
  theme: 'dark' | 'light';
}) {
  const element = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!element.current) return;
    const container = element.current;
    let chart: IChartApi | undefined;
    const frame = window.requestAnimationFrame(() => {
      try {
        setError('');
        const next = createChart(container, {
          autoSize: true,
          height: 490,
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
        next
          .addSeries(LineSeries, {
            title: '组合',
            color: '#28ad85',
            lineWidth: 3,
          })
          .setData(
            result.curve.map((p) => ({
              time: chartTime(p.timestampUtcMs),
              value: Number(p.equity),
            })),
          );
        if (!result.benchmarkReason)
          next
            .addSeries(LineSeries, {
              title: '买入持有',
              color: '#729bdd',
              lineStyle: 2,
            })
            .setData(
              result.curve.map((p) => ({
                time: chartTime(p.timestampUtcMs),
                value: Number(p.benchmarkEquity),
              })),
            );
        result.assets.forEach((asset, index) => {
          next
            .addSeries(
              LineSeries,
              { title: asset.symbol, color: colors[index], lineWidth: 2 },
              1,
            )
            .setData(
              asset.statistics.curve.map((p) => ({
                time: chartTime(p.timestampUtcMs),
                value: Number(p.equity),
              })),
            );
        });
        next.timeScale().fitContent();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Canvas 无法绘制');
      }
    });
    return () => {
      window.cancelAnimationFrame(frame);
      chart?.remove();
    };
  }, [result, theme]);
  return (
    <section className="panel">
      <h3>组合与子账户净值曲线</h3>
      <p>
        上图为组合和买入持有基准，下图为各子账户，单位均为{' '}
        {result.quoteCurrency}。可缩放和平移，图中数值为绘图近似值。
      </p>
      {error && <p role="alert">曲线显示失败。{error}</p>}
      <div
        className="portfolio-chart"
        ref={element}
        role="img"
        aria-label="组合、基准及各子账户净值曲线"
      />
      <small>
        TradingView Lightweight Charts™ · Apache-2.0 · Copyright (с) 2025
        TradingView, Inc.
      </small>
    </section>
  );
}
