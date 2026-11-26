import { chartColors } from '../../shared/chart-colors';
import { useEffect, useRef, useState } from 'react';
import { CandlestickSeries, ColorType, createChart } from 'lightweight-charts';
import type {
  IPrimitivePaneView,
  Logical,
  Time,
  UTCTimestamp,
} from 'lightweight-charts';
import type { Candle } from '../../core/data';
import type {
  RegimeParams,
  RegimeResult,
} from '../../core/market-regime/model';
import { REGIMES } from '../../core/market-regime/model';
import { colors, stateNames, utc, type Theme } from './presentation';

export function RegimeChart({
  candles,
  result,
  params,
  theme,
}: {
  candles: readonly Candle[];
  result: RegimeResult;
  params: RegimeParams;
  theme: Theme;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [selected, select] = useState(candles.length - 1);
  const { labels, runs } = result;
  const first = candles[0].timestampUtcMs;
  const interval = (runs[0].endUtcMs - runs[0].startUtcMs) / runs[0].bars;
  const candle = candles[selected];
  const base = candles[selected - params.lookback];
  const effective = selected ? labels[selected - 1] : 'UNKNOWN';
  const next = labels[selected];
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let chart: ReturnType<typeof createChart> | undefined;
    const frame = requestAnimationFrame(() => {
      try {
        setError('');
        const palette = chartColors[theme];
        const api = createChart(element, {
          autoSize: true,
          layout: {
            background: {
              type: ColorType.Solid,
              color: palette.panel,
            },
            textColor: palette.text,
          },
          grid: {
            vertLines: { visible: false },
            horzLines: { color: theme === 'dark' ? '#30383a' : '#e3e9e5' },
          },
          timeScale: { timeVisible: true, secondsVisible: true },
          localization: {
            timeFormatter: (t: Time) =>
              typeof t === 'number' ? utc(t * 1000) : String(t),
          },
        });
        chart = api;
        const series = api.addSeries(CandlestickSeries, {
          upColor: palette.up,
          downColor: palette.down,
          borderVisible: false,
          wickUpColor: palette.up,
          wickDownColor: palette.down,
        });
        series.setData(
          candles.map((c) => ({
            time: (c.timestampUtcMs / 1000) as UTCTimestamp,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
          })),
        );
        const scale = api.timeScale();
        const bands: IPrimitivePaneView[] = [
          {
            zOrder: () => 'bottom',
            renderer: () => ({
              draw(target) {
                const range = scale.getVisibleLogicalRange();
                // Lightweight Charts maps integer candle centres to pixels.
                const origin = scale.logicalToCoordinate(0 as Logical);
                const adjacent = scale.logicalToCoordinate(1 as Logical);
                if (!range || origin === null || adjacent === null) return;
                const step = adjacent - origin;
                target.useMediaCoordinateSpace(({ context, mediaSize }) => {
                  // Find the first run intersecting the visible left edge.
                  const leftTime = first + (range.from - 0.5) * interval;
                  let lo = 0,
                    hi = runs.length;
                  while (lo < hi) {
                    const mid = Math.floor((lo + hi) / 2);
                    if (runs[mid].endUtcMs <= leftTime) lo = mid + 1;
                    else hi = mid;
                  }
                  for (let i = lo; i < runs.length; i++) {
                    const run = runs[i];
                    const left = (run.startUtcMs - first) / interval - 0.5;
                    if (left > range.to + 0.5) break;
                    const color = colors[theme][run.state];
                    const x = origin + left * step;
                    const width = run.bars * step;
                    context.fillStyle = color + '38';
                    context.fillRect(x, 0, width, mediaSize.height);
                    // Match the legend at full contrast while leaving candles
                    // visible through the body of each interval.
                    context.fillStyle = color;
                    context.fillRect(x, mediaSize.height - 4, width, 4);
                  }
                });
              },
            }),
          },
        ];
        series.attachPrimitive({ paneViews: () => bands });
        if (candles.length < 120) scale.fitContent();
        else
          scale.setVisibleLogicalRange({
            from: candles.length - 120,
            to: candles.length,
          });
        api.subscribeClick(({ time }) => {
          if (typeof time !== 'number') return;
          const index = Math.round((time * 1000 - first) / interval);
          if (index >= 0 && index < candles.length) select(index);
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Canvas 无法绘制');
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      chart?.remove();
    };
  }, [candles, runs, theme, first, interval]);
  return (
    <section className="panel">
      <h2>参考资产 K 线与生效状态</h2>
      <p>
        背景标记每根开盘时已知的状态。红绿蜡烛表示该根价格涨跌。拖动或缩放时间轴，点击蜡烛可查看判断依据。
      </p>
      <div className="regime-legend">
        {REGIMES.map((s) => (
          <span key={s}>
            <i style={{ background: colors[theme][s] }} />
            {stateNames[s]} {s}
          </span>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      <div
        ref={host}
        className="regime-chart"
        role="img"
        aria-label="历史 K 线与上一收盘市场状态区间叠加图"
      />
      <small>
        TradingView Lightweight Charts™ · Apache-2.0 · Copyright (с) 2025
        TradingView, Inc.
      </small>
      <div className="regime-bar">
        <label>
          查看第几根 K 线{' '}
          <input
            type="number"
            min="1"
            max={candles.length}
            value={selected + 1}
            onChange={(e) => {
              const n = e.currentTarget.valueAsNumber;
              if (Number.isInteger(n) && n >= 1 && n <= candles.length)
                select(n - 1);
            }}
          />
        </label>
        <div>
          <p>
            本根归因状态{' '}
            <b>
              {stateNames[effective]} · {effective}
            </b>
            。UTC 开盘 {utc(candle.timestampUtcMs)}，收盘{' '}
            {utc(candle.timestampUtcMs + interval)}。
          </p>
          <p>
            收盘新标签{' '}
            <b>
              {stateNames[next]} · {next}
            </b>
            ，最早用于下一根。
            {base ? (
              <>
                当前收盘 {candle.close}，{params.lookback} 根前收盘 {base.close}
                。滚动收益按（当前收盘 − 此前收盘）÷ 此前收盘比较。
              </>
            ) : (
              <>
                当前收盘 {candle.close}，回看需 {params.lookback + 1}{' '}
                根已收盘行情，目前有 {selected + 1} 根。
              </>
            )}
          </p>
        </div>
      </div>
    </section>
  );
}
