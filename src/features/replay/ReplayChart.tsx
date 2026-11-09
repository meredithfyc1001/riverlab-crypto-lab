import { useEffect, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  LineSeries,
  createChart,
} from 'lightweight-charts';
import type { IChartApi, UTCTimestamp, Time } from 'lightweight-charts';
import type { Candle } from '../../core/data';
import type { ReplayView } from '../../core/replay';

export function ReplayChart({
  candles,
  curve,
  theme,
}: {
  candles: Candle[];
  curve: ReplayView['curve'];
  theme: 'dark' | 'light';
}) {
  const element = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let chart: IChartApi | undefined,
      disposed = false;
    async function draw() {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (disposed || !element.current) return;
      setReady(false);
      setError('');
      try {
        chart = createChart(element.current, {
          autoSize: true,
          height: 640,
          layout: {
            background: {
              type: ColorType.Solid,
              color: theme === 'dark' ? '#171c1f' : '#ffffff',
            },
            textColor: theme === 'dark' ? '#c4d3ce' : '#294839',
            attributionLogo: true,
          },
          timeScale: { timeVisible: true, secondsVisible: true },
          localization: {
            timeFormatter: (t: Time) =>
              typeof t === 'number'
                ? new Date(t * 1000).toISOString()
                : String(t),
          },
        });
        const minimum = candles[0].low;
        const minMove = Math.min(
          0.01,
          10 ** (Math.floor(Math.log10(minimum)) - 6),
        );
        if (!minMove || !Number.isFinite(1 / minMove))
          throw new Error('价格量级超出可靠图表刻度，精确账本仍可查看。');
        const format = {
          type: 'custom' as const,
          minMove,
          formatter: (v: number) =>
            v !== 0 && (Math.abs(v) < 1e-6 || Math.abs(v) >= 1e12)
              ? v.toExponential(6)
              : v.toLocaleString('en-US', { maximumSignificantDigits: 10 }),
        };
        chart
          .addSeries(
            CandlestickSeries,
            {
              upColor: '#28ad85',
              downColor: '#e3656f',
              borderVisible: false,
              wickUpColor: '#28ad85',
              wickDownColor: '#e3656f',
              priceFormat: format,
            },
            0,
          )
          .setData(
            candles.map((c) => ({
              time: (c.timestampUtcMs / 1000) as UTCTimestamp,
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
            })),
          );
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (disposed) return;
        chart
          .addSeries(
            LineSeries,
            { title: '已知权益 USDT', color: '#28ad85', priceFormat: format },
            1,
          )
          .setData(
            curve.map((p) => ({
              time: (p.timestampUtcMs / 1000) as UTCTimestamp,
              value: Number(p.equity),
            })),
          );
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (disposed) return;
        chart
          .addSeries(LineSeries, { title: '已知回撤 %', color: '#e3656f' }, 2)
          .setData(
            curve.map((p) =>
              p.drawdown.value === null
                ? { time: (p.timestampUtcMs / 1000) as UTCTimestamp }
                : {
                    time: (p.timestampUtcMs / 1000) as UTCTimestamp,
                    value: Number(p.drawdown.value) * 100,
                  },
            ),
          );
        chart.timeScale().fitContent();
        setReady(true);
      } catch (e) {
        if (!disposed)
          setError(
            e instanceof Error
              ? e.message
              : '回放图表无法绘制；精确账本仍可用。',
          );
      }
    }
    void draw();
    return () => {
      disposed = true;
      chart?.remove();
    };
  }, [candles, curve, theme]);
  return (
    <section className="panel replay-chart">
      <h3>已播放行情、净值与回撤</h3>
      <p>
        仅 {candles.length} 根已揭示K线，权益 {curve.length}{' '}
        点（含初始锚点）。可缩放和平移；图形为近似数值，账本保留18位精度。
      </p>
      {!ready && !error && <p role="status">正在绘制已知前缀…</p>}
      {error && <p role="alert">{error}</p>}
      <div
        ref={element}
        data-testid="replay-chart"
        data-ready={ready}
        data-candles={candles.length}
        data-last-close={candles.at(-1)?.close}
        role="img"
        aria-label="仅已播放行情、收盘权益和回撤图"
        style={{ height: 640 }}
      />
      <p>
        TradingView Lightweight Charts™ · Apache-2.0 · Copyright (с) 2025
        TradingView, Inc. · 本地打包。收盘回撤不代表根内风险。
      </p>
    </section>
  );
}
