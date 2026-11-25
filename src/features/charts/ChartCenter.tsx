import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  ColorType,
  CrosshairMode,
} from 'lightweight-charts';
import type {
  IChartApi,
  LogicalRange,
  Time,
  UTCTimestamp,
  LineData,
  WhitespaceData,
} from 'lightweight-charts';
import { assertDataset } from '../../core/data/dataset';
import type { Dataset } from '../../core/data/dataset';
import { calculateIndicators, validPeriod } from '../../core/indicators';
import type { IndicatorPoint, Indicators } from '../../core/indicators';
import './charts.css';

const chartTime = (ms: number) => (ms / 1000) as UTCTimestamp;
const utc = (ms: number) =>
  new Date(ms).toISOString().replace('T', ' ').replace('Z', ' UTC');
const formatTime = (time: Time) =>
  typeof time === 'number' ? utc(Math.round(time * 1000)) : String(time);
const number = (v: number | null | undefined) =>
  v == null
    ? 'NA（样本不足）'
    : v !== 0 && (Math.abs(v) < 1e-6 || Math.abs(v) >= 1e12)
      ? v.toExponential(10)
      : v.toLocaleString('en-US', { maximumSignificantDigits: 15 });

function indicatorData(
  points: IndicatorPoint[],
  interval: number,
): (LineData<UTCTimestamp> | WhitespaceData<UTCTimestamp>)[] {
  const data: (LineData<UTCTimestamp> | WhitespaceData<UTCTimestamp>)[] = [];
  points.forEach((point, i) => {
    if (i && point.timestampUtcMs - points[i - 1].timestampUtcMs !== interval)
      data.push({ time: chartTime(points[i - 1].timestampUtcMs + interval) });
    data.push(
      point.value === null
        ? { time: chartTime(point.timestampUtcMs) }
        : { time: chartTime(point.timestampUtcMs), value: point.value },
    );
  });
  return data;
}
export function ChartCenter({
  dataset,
  theme,
}: {
  dataset: Dataset | null;
  theme: 'dark' | 'light';
}) {
  const [periods, setPeriods] = useState({ ma: 20, ema: 20, rsi: 14 });
  const [enabled, setEnabled] = useState({ ma: true, ema: true, rsi: true });
  const calculation = useMemo(() => {
    if (!dataset) return { error: '', indicators: null };
    try {
      assertDataset(dataset);
      if (!Object.values(periods).every(validPeriod))
        throw new Error(
          '指标周期必须是 1–50,000 的整数；空值或非法值不会沿用旧数值。',
        );
      return {
        error: '',
        indicators: calculateIndicators(
          dataset.candles,
          dataset.quality.intervalMs!,
          periods,
        ),
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : '数据无法显示',
        indicators: null,
      };
    }
  }, [dataset, periods]);
  return (
    <div className="chart-center">
      <section className="panel chart-controls">
        <h2>历史行情与指标</h2>
        <p className="muted">
          仅使用已检查的本地数据，时间统一
          UTC。滚轮缩放、拖动平移，移动指针读取时间/价格；触屏长按十字准星。
        </p>
        <div className="indicator-controls">
          {(['ma', 'ema', 'rsi'] as const).map((key) => (
            <div key={key}>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={enabled[key]}
                  onChange={(e) =>
                    setEnabled({ ...enabled, [key]: e.target.checked })
                  }
                />
                {key.toUpperCase()}
              </label>
              <label>
                {key.toUpperCase()} 周期
                <input
                  type="number"
                  min="1"
                  max="50000"
                  step="1"
                  value={Number.isNaN(periods[key]) ? '' : periods[key]}
                  onChange={(e) =>
                    setPeriods({
                      ...periods,
                      [key]:
                        e.target.value === '' ? NaN : Number(e.target.value),
                    })
                  }
                />
              </label>
            </div>
          ))}
        </div>
        <details>
          <summary>指标算法与缺口规则</summary>
          <p>
            MA 为收盘价简单平均。EMA 以首 N 根收盘价 SMA 初始化，α=2/(N+1)。RSI
            以首 N 个价格差的平均涨跌初始化，之后采用 Wilder
            平滑（α=1/N）；双零为50，只有上涨为100，只有下跌为0。RSI 至少需要
            N+1 根。所有指标仅使用当前及过去 K
            线；每个缺口后重新预热，样本不足为 NA。不存在策略信号。
          </p>
        </details>
      </section>
      {!dataset ? (
        <section className="panel">
          <h2>尚无可显示的数据</h2>
          <p>
            请在数据中心载入内置历史或人工合成样本，也可检查自己的 CSV
            并选择“用于行情中心”，或明确打开已保存的数据集。
          </p>
          <a className="text-link" href="#/datasets">
            前往数据中心
          </a>
        </section>
      ) : (
        <>
          <section className="panel dataset-facts">
            <h2>
              {dataset.symbol} · {dataset.name}
            </h2>
            <p>
              {dataset.source.label} · {dataset.candles.length.toLocaleString()}{' '}
              根 · 周期 {dataset.quality.intervalMs! / 1000} 秒
            </p>
            <p>{dataset.source.note}</p>
            <p className="muted">
              {dataset.quality.range
                ? `${utc(dataset.quality.range.startUtcMs)} 至 ${utc(dataset.quality.range.endUtcMs)}`
                : '范围未知'}
              。文件 SHA-256 仅证明身份，来源及首尾完整性未获证明。
            </p>
            <p className="import-warning">
              {dataset.quality.warningCount} 项原始警告；缺口{' '}
              {dataset.quality.gapCount} 处、缺失{' '}
              {dataset.quality.missingCandles}{' '}
              根，未填补。时间轴压缩长缺口，每处仅放一个空白位置，不按缺失数量扩展；指标断线并重新初始化。
            </p>
            <details>
              <summary>原始质量警告与文件身份</summary>
              <code className="file-hash">{dataset.file.sha256}</code>
              <p>
                {dataset.file.parserVersion} · 原时间单位{' '}
                {dataset.quality.timeUnit} → UTC 毫秒
              </p>
              {dataset.quality.issues.map((issue, i) => (
                <p key={i}>
                  {issue.code}：{issue.message}
                </p>
              ))}
            </details>
          </section>
          {calculation.error ? (
            <p role="alert" className="import-error">
              {calculation.error}
            </p>
          ) : (
            calculation.indicators && (
              <ChartView
                dataset={dataset}
                indicators={calculation.indicators}
                enabled={enabled}
                theme={theme}
              />
            )
          )}
        </>
      )}
    </div>
  );
}
function ChartView({
  dataset,
  indicators,
  enabled,
  theme,
}: {
  dataset: Dataset;
  indicators: Indicators;
  enabled: { ma: boolean; ema: boolean; rsi: boolean };
  theme: 'dark' | 'light';
}) {
  const container = useRef<HTMLDivElement>(null);
  const api = useRef<IChartApi | null>(null);
  const range = useRef<LogicalRange | null>(null);
  const [hover, setHover] = useState<{
    index: number;
    price: number | null;
  } | null>(null);
  const [visibleRange, setVisibleRange] = useState('');
  const [error, setError] = useState('');
  const [drawn, setDrawn] = useState<{
    indicators: Indicators;
    enabled: typeof enabled;
    theme: typeof theme;
  } | null>(null);
  const ready =
    drawn?.indicators === indicators &&
    drawn.enabled === enabled &&
    drawn.theme === theme;
  useEffect(() => {
    if (!container.current) return;
    let chart: IChartApi | null = null;
    let frame = 0;
    let disposed = false;
    const yieldToBrowser = () =>
      new Promise<void>((resolve) => setTimeout(resolve, 0));
    async function draw() {
      await yieldToBrowser();
      if (disposed || !container.current) return;
      setError('');
      try {
        const dark = theme === 'dark';
        chart = createChart(container.current, {
          autoSize: true,
          height: enabled.rsi ? 600 : 420,
          layout: {
            background: {
              type: ColorType.Solid,
              color: dark ? '#171c1f' : '#ffffff',
            },
            textColor: dark ? '#c4d3ce' : '#294839',
            attributionLogo: true,
          },
          grid: {
            vertLines: { color: dark ? '#242f30' : '#edf1ee' },
            horzLines: { color: dark ? '#242f30' : '#edf1ee' },
          },
          crosshair: { mode: CrosshairMode.Normal },
          localization: { locale: 'zh-CN', timeFormatter: formatTime },
          timeScale: {
            timeVisible: true,
            secondsVisible: true,
            tickMarkFormatter: (time: Time) =>
              typeof time === 'number'
                ? new Date(Math.round(time * 1000))
                    .toISOString()
                    .slice(5, 19)
                    .replace('T', ' ')
                : '',
          },
          rightPriceScale: { scaleMargins: { top: 0.08, bottom: 0.28 } },
        });
        api.current = chart;
        const minimumPrice = dataset.candles.reduce(
          (min, c) => Math.min(min, c.low),
          Infinity,
        );
        const minMove = Math.min(
          0.01,
          10 ** (Math.floor(Math.log10(minimumPrice)) - 6),
        );
        if (!minMove || !Number.isFinite(1 / minMove))
          throw new Error('价格量级超出图表可靠刻度范围，原始数据仍可备份');
        const priceFormat = {
          type: 'custom' as const,
          formatter: number,
          minMove,
        };
        const candles = chart.addSeries(CandlestickSeries, {
          priceFormat,
          upColor: '#28ad85',
          downColor: '#e3656f',
          borderVisible: false,
          wickUpColor: '#28ad85',
          wickDownColor: '#e3656f',
        });
        candles.setData(
          dataset.candles.map((c) => ({
            time: chartTime(c.timestampUtcMs),
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
          })),
        );
        await yieldToBrowser();
        if (disposed) return;
        const volume = chart.addSeries(HistogramSeries, {
          priceFormat: { type: 'volume' },
          priceScaleId: 'volume',
          lastValueVisible: false,
          priceLineVisible: false,
        });
        volume
          .priceScale()
          .applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
        volume.setData(
          dataset.candles.map((c) => ({
            time: chartTime(c.timestampUtcMs),
            value: c.volume,
            color: c.close >= c.open ? '#28ad8566' : '#e3656f66',
          })),
        );
        await yieldToBrowser();
        if (disposed) return;
        if (enabled.ma)
          chart
            .addSeries(LineSeries, {
              color: '#e3b95d',
              lineWidth: 2,
              title: 'MA',
              priceFormat,
              crosshairMarkerVisible: false,
            })
            .setData(indicatorData(indicators.ma, dataset.quality.intervalMs!));
        await yieldToBrowser();
        if (disposed) return;
        if (enabled.ema)
          chart
            .addSeries(LineSeries, {
              color: '#6d9eff',
              lineWidth: 2,
              title: 'EMA',
              priceFormat,
              crosshairMarkerVisible: false,
            })
            .setData(
              indicatorData(indicators.ema, dataset.quality.intervalMs!),
            );
        await yieldToBrowser();
        if (disposed) return;
        if (enabled.rsi) {
          const rsi = chart.addSeries(
            LineSeries,
            {
              color: '#b08af7',
              lineWidth: 2,
              title: 'RSI',
              priceFormat: {
                type: 'custom',
                formatter: (v: number) => v.toFixed(2),
                minMove: 0.01,
              },
              autoscaleInfoProvider: () => ({
                priceRange: { minValue: 0, maxValue: 100 },
              }),
            },
            1,
          );
          rsi.setData(
            indicatorData(indicators.rsi, dataset.quality.intervalMs!),
          );
          rsi.createPriceLine({
            price: 30,
            color: '#7e8990',
            lineWidth: 1,
            title: '30',
          });
          rsi.createPriceLine({
            price: 70,
            color: '#7e8990',
            lineWidth: 1,
            title: '70',
          });
          chart.panes()[0].setHeight(400);
          chart.panes()[1].setHeight(180);
        }
        if (range.current)
          chart.timeScale().setVisibleLogicalRange(range.current);
        else chart.timeScale().fitContent();
        chart.timeScale().subscribeVisibleLogicalRangeChange((next) => {
          range.current = next;
          setVisibleRange(
            next
              ? `${next.from.toFixed(2)} → ${next.to.toFixed(2)}`
              : '无可见范围',
          );
        });
        chart.subscribeCrosshairMove((event) => {
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(() => {
            if (typeof event.time !== 'number') {
              setHover(null);
              return;
            }
            const target = Math.round(event.time * 1000);
            let lo = 0,
              hi = dataset.candles.length - 1;
            while (lo <= hi) {
              const mid = (lo + hi) >>> 1;
              const ms = dataset.candles[mid].timestampUtcMs;
              if (ms === target) {
                setHover({
                  index: mid,
                  price:
                    event.point && event.paneIndex === 0
                      ? candles.coordinateToPrice(event.point.y)
                      : null,
                });
                return;
              }
              if (ms < target) lo = mid + 1;
              else hi = mid - 1;
            }
            setHover(null);
          });
        });
        setDrawn({ indicators, enabled, theme });
      } catch (failure) {
        if (disposed) return;
        const message = failure instanceof Error ? failure.message : '绘图失败';
        setError(
          `图表无法显示：${message}。数据未修复，请检查浏览器 Canvas 能力。`,
        );
      }
    }
    void draw();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      chart?.remove();
      api.current = null;
    };
  }, [dataset, indicators, enabled, theme]);
  const index = hover?.index ?? dataset.candles.length - 1;
  const c = dataset.candles[index];
  function zoom(factor: number) {
    const scale = api.current?.timeScale(),
      current = scale?.getVisibleLogicalRange();
    if (!scale || !current) return;
    const center = (current.from + current.to) / 2,
      half = ((current.to - current.from) * factor) / 2;
    scale.setVisibleLogicalRange({ from: center - half, to: center + half });
  }
  return (
    <section className="panel chart-panel" aria-label="OHLC 与成交量图表">
      {!ready && !error && (
        <p role="status">正在构建本地图表，各序列间让出浏览器以保持响应…</p>
      )}
      <div className="sample-actions">
        <button disabled={!ready} onClick={() => zoom(0.7)}>
          放大图表
        </button>
        <button disabled={!ready} onClick={() => zoom(1.4)}>
          缩小图表
        </button>
        <button
          disabled={!ready}
          onClick={() => api.current?.timeScale().fitContent()}
        >
          显示全部数据
        </button>
        <button
          disabled={!ready}
          onClick={() => {
            const scale = api.current?.timeScale(),
              r = scale?.getVisibleLogicalRange();
            if (r)
              scale?.setVisibleLogicalRange({
                from: r.from - (r.to - r.from) / 4,
                to: r.to - (r.to - r.from) / 4,
              });
          }}
        >
          向历史平移
        </button>
      </div>
      <p className="muted" data-testid="visible-range">
        可见位置：{visibleRange || '全部数据'}（滚轮、拖动或按钮操作）
      </p>
      <div
        className="chart-readout"
        aria-live="off"
        data-testid="chart-readout"
      >
        <strong>
          {hover ? '十字准星' : '末根数据'} · {utc(c.timestampUtcMs)}
        </strong>
        <span>
          开 {number(c.open)} · 高 {number(c.high)} · 低 {number(c.low)} · 收{' '}
          {number(c.close)} · 量 {number(c.volume)}
        </span>
        <span>
          价格读取：
          {hover?.price == null ? '移动指针至价格区域' : number(hover.price)}
        </span>
        <span>
          {enabled.ma && (
            <span data-testid="ma-value">
              MA {number(indicators.ma[index].value)} ·{' '}
            </span>
          )}
          {enabled.ema && (
            <span data-testid="ema-value">
              EMA {number(indicators.ema[index].value)} ·{' '}
            </span>
          )}
          {enabled.rsi && (
            <span data-testid="rsi-value">
              RSI {number(indicators.rsi[index].value)}
            </span>
          )}
        </span>
      </div>
      {error && (
        <p role="alert" className="import-error">
          {error}
        </p>
      )}
      <p className="muted">
        主区域：OHLC / 成交量
        {enabled.rsi ? '；下方独立区域：RSI（0–100，预热不足为空）' : ''}
      </p>
      <div
        ref={container}
        className="market-canvas"
        data-testid="market-canvas"
        data-ready={ready}
        role="img"
        aria-label="UTC 历史 OHLC K线、成交量及可选 RSI 独立区域"
        style={{ height: enabled.rsi ? 600 : 420 }}
      />
      <p className="muted">
        图表：
        <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
          TradingView Lightweight Charts™
        </a>{' '}
        · Apache-2.0 · 本地打包，无 CDN 依赖。Copyright (с) 2025 TradingView,
        Inc.。RSI 独立区域和主图共用 UTC 时间轴。
      </p>
    </section>
  );
}
