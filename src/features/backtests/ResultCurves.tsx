import { chartColors } from '../../shared/chart-colors';
import { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, LineSeries } from 'lightweight-charts';
import type { IChartApi, UTCTimestamp, Time } from 'lightweight-charts';
import type { Statistics } from '../../core/statistics';

const chartNumber = new Intl.NumberFormat('en-US', {
  maximumSignificantDigits: 10,
});
const formatChartPrice = (value: number) =>
  value !== 0 && (Math.abs(value) < 1e-6 || Math.abs(value) >= 1e12)
    ? value.toExponential(6)
    : chartNumber.format(value);

export function ResultCurves({
  statistics,
  theme,
}: {
  statistics: Statistics;
  theme: 'dark' | 'light';
}) {
  const element = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let chart: IChartApi | undefined,
      disposed = false;
    const pause = () => new Promise<void>((r) => setTimeout(r, 0));
    async function draw() {
      await pause();
      if (disposed || !element.current) return;
      setReady(false);
      setError('');
      try {
        const palette = chartColors[theme];
        chart = createChart(element.current, {
          autoSize: true,
          height: 500,
          layout: {
            background: {
              type: ColorType.Solid,
              color: palette.panel,
            },
            textColor: palette.text,
            attributionLogo: true,
          },
          localization: {
            timeFormatter: (t: Time) =>
              typeof t === 'number'
                ? new Date(t * 1000).toISOString()
                : String(t),
          },
          timeScale: { timeVisible: true, secondsVisible: true },
        });
        const points = statistics.curve;
        const series = [
          {
            title: '策略权益 USDT',
            color: palette.up,
            pane: 0,
            value: (p: (typeof points)[number]) => Number(p.equity),
          },
          {
            title: '买入持有 USDT',
            color: palette.blue,
            pane: 0,
            value: (p: (typeof points)[number]) =>
              p.benchmarkEquity === null ? null : Number(p.benchmarkEquity),
          },
          {
            title: '收盘回撤 %',
            color: palette.down,
            pane: 1,
            value: (p: (typeof points)[number]) =>
              p.drawdown.value === null ? null : Number(p.drawdown.value) * 100,
          },
        ];
        for (const s of series) {
          if (disposed) return;
          chart
            .addSeries(
              LineSeries,
              {
                title: s.title,
                color: s.color,
                priceFormat: {
                  type: 'custom',
                  minMove: 1e-8,
                  formatter: formatChartPrice,
                },
              },
              s.pane,
            )
            .setData(
              points.map((p) => {
                const value = s.value(p);
                return value === null
                  ? { time: (p.timestampUtcMs / 1000) as UTCTimestamp }
                  : {
                      time: (p.timestampUtcMs / 1000) as UTCTimestamp,
                      value,
                    };
              }),
            );
          await pause();
        }
        if (disposed) return;
        chart.timeScale().fitContent();
        setReady(true);
      } catch (e) {
        if (!disposed)
          setError(
            `图表无法显示：${e instanceof Error ? e.message : 'Canvas错误'}。精确结果仍在表格与导出报告中。`,
          );
      }
    }
    void draw();
    return () => {
      disposed = true;
      chart?.remove();
    };
  }, [statistics, theme]);
  return (
    <section className="panel">
      <h3>净值曲线与回撤曲线</h3>
      <p>
        上方：策略权益/买入持有（USDT）；下方：收盘回撤（%）。滚轮缩放、拖动平移；全部{' '}
        {statistics.curve.length} 点（含初始锚点），仅绘制转换为近似数值。
      </p>
      {!ready && !error && <p role="status">正在绘制结果曲线…</p>}
      {error && <p role="alert">{error}</p>}
      <div
        ref={element}
        data-testid="result-curves"
        data-ready={ready}
        role="img"
        aria-label="策略权益、买入持有及收盘回撤曲线"
        style={{ height: 500 }}
      />
      <p className="muted">
        TradingView Lightweight Charts™ · Apache-2.0 · Copyright (с) 2025
        TradingView, Inc. · 本地打包。收盘曲线不代表根内风险。
      </p>
    </section>
  );
}
