import type { Candle } from '../data';
import { MAX_DATA_ROWS } from '../data/csv-types';
import { BPS, decimal, integerSqrt, parseDecimal, readUnits } from '../math';
import { fraction } from '../statistics';

export const REGIME_MODEL_VERSION = 'historical-close-return-bps-v1';
export const REGIME_ATTRIBUTION_VERSION = 'previous-close-equity-v1';
export const REGIMES = ['BULL', 'BEAR', 'SIDEWAYS', 'UNKNOWN'] as const;
export type Regime = (typeof REGIMES)[number];
export interface RegimeParams {
  lookback: number;
  thresholdBps: number;
}
export const DEFAULT_REGIME_PARAMS: Readonly<RegimeParams> = Object.freeze({
  lookback: 20,
  thresholdBps: 500,
});

/** Supplied by the adapter for the replayed source ledger. */
export interface RegimeLedgerBar {
  closeUtcMs: number;
  equity: string;
  realizedDelta: string;
  unrealizedDelta: string;
  fills: number;
  fees: string;
  exposed: boolean;
}
export interface RegimeSeries {
  candles: readonly Candle[];
  intervalMs: number;
  completedThroughUtcMs: number;
  initialCash: string;
  netPnl: string;
  bars: readonly RegimeLedgerBar[];
}

export interface RegimeRun {
  state: Regime;
  startUtcMs: number;
  endUtcMs: number;
  bars: number;
  startEquity: string;
  endEquity: string;
  netPnl: string;
  returnFraction: string | null;
}
export interface ReturnDistribution {
  count: number;
  min: string | null;
  median: string | null;
  max: string | null;
  mean: string | null;
  volatility: string | null;
}
export interface RegimeSummary {
  state: Regime;
  bars: number;
  durationMs: number;
  timeFraction: string;
  occurrences: number;
  netPnl: string;
  realizedDelta: string;
  unrealizedDelta: string;
  fills: number;
  fees: string;
  exposedMs: number;
  exposureFraction: string | null;
  periodReturns: ReturnDistribution;
  assetReturns: ReturnDistribution;
}
export interface RegimeResult {
  /** Label first knowable at the close of each corresponding candle. */
  labels: Regime[];
  /** Contiguous effective attribution periods, always on the original account. */
  runs: RegimeRun[];
  summaries: RegimeSummary[];
  switches: number;
  netPnl: string;
}

export function assertRegimeParams(params: RegimeParams): void {
  if (
    !params ||
    typeof params !== 'object' ||
    Object.getPrototypeOf(params) !== Object.prototype ||
    Object.keys(params).length !== 2 ||
    !Object.hasOwn(params, 'lookback') ||
    !Object.hasOwn(params, 'thresholdBps') ||
    !Number.isInteger(params.lookback) ||
    params.lookback < 1 ||
    params.lookback > MAX_DATA_ROWS ||
    !Number.isInteger(params.thresholdBps) ||
    params.thresholdBps < 1 ||
    params.thresholdBps > 10000
  )
    throw new Error(
      '回看周期须为 1–50,000 根，趋势阈值须为 1–10,000 个整数基点。',
    );
}

/** The only model inputs are completed closes, time, and locked parameters. */
export function classifyRegimes(
  candles: readonly Pick<Candle, 'timestampUtcMs' | 'close'>[],
  intervalMs: number,
  completedThroughUtcMs: number,
  params: RegimeParams,
): Regime[] {
  assertRegimeParams(params);
  if (
    !Array.isArray(candles) ||
    !candles.length ||
    candles.length > MAX_DATA_ROWS ||
    !Number.isSafeInteger(intervalMs) ||
    intervalMs <= 0 ||
    !Number.isSafeInteger(completedThroughUtcMs) ||
    completedThroughUtcMs < 0
  )
    throw new Error('行情数量、周期或收盘确认时间无效。');
  const { lookback, thresholdBps } = params;
  const threshold = BigInt(thresholdBps);
  const past: bigint[] = [];
  const labels: Regime[] = [];
  for (const [i, candle] of candles.entries()) {
    const openTime = candle.timestampUtcMs;
    if (
      !Number.isSafeInteger(openTime) ||
      openTime < 0 ||
      openTime + intervalMs > completedThroughUtcMs ||
      (i > 0 && openTime - candles[i - 1].timestampUtcMs !== intervalMs)
    )
      throw new Error('行情未完成、有缺口或 UTC 时间错位，无法计算市场状态。');
    const close = parseDecimal(String(candle.close));
    if (close <= 0n) throw new Error('状态识别需要正的已完成收盘价。');
    const slot = i % lookback;
    let label: Regime = 'UNKNOWN';
    if (i >= lookback) {
      const base = past[slot];
      const difference = (close - base) * BPS;
      const boundary = base * threshold;
      if (difference > boundary) label = 'BULL';
      else if (difference < -boundary) label = 'BEAR';
      else label = 'SIDEWAYS';
    }
    labels.push(label);
    past[slot] = close;
  }
  return labels;
}

const RETURN_SCALE = 10n ** 12n;
const toFraction = (scaled: bigint) => decimal(scaled * 10n ** 6n);
function distribution(values: bigint[]): ReturnDistribution {
  const count = values.length;
  if (!count)
    return {
      count,
      min: null,
      median: null,
      max: null,
      mean: null,
      volatility: null,
    };
  values.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  let sum = 0n;
  let sumSquares = 0n;
  for (const value of values) {
    sum += value;
    sumSquares += value * value;
  }
  const n = BigInt(count);
  const middle = Math.floor(count / 2);
  const median =
    count % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2n;
  return {
    count,
    min: toFraction(values[0]),
    max: toFraction(values[count - 1]),
    mean: toFraction(sum / n),
    median: toFraction(median),
    volatility:
      count < 2
        ? null
        : toFraction(integerSqrt(n * sumSquares - sum * sum) / n),
  };
}
function signedAmount(value: string) {
  return value.startsWith('-') ? -readUnits(value.slice(1)) : readUnits(value);
}
function bucket(state: Regime) {
  return {
    state,
    bars: 0,
    occurrences: 0,
    exposedMs: 0,
    fills: 0,
    netPnl: 0n,
    realizedDelta: 0n,
    unrealizedDelta: 0n,
    fees: 0n,
    periodReturns: [] as bigint[],
    assetReturns: [] as bigint[],
  };
}

export function analyzeRegimes(
  input: RegimeSeries,
  params: RegimeParams,
): RegimeResult {
  const { candles, intervalMs, bars } = input;
  const labels = classifyRegimes(
    candles,
    intervalMs,
    input.completedThroughUtcMs,
    params,
  );
  if (bars.length !== candles.length)
    throw new Error('行情与权益账本长度不一致。');
  const groups = {
    BULL: bucket('BULL'),
    BEAR: bucket('BEAR'),
    SIDEWAYS: bucket('SIDEWAYS'),
    UNKNOWN: bucket('UNKNOWN'),
  };
  const runs: RegimeRun[] = [];
  const initial = readUnits(input.initialCash);
  let previousEquity = initial;
  let previousPrice = parseDecimal(String(candles[0].open));
  if (previousPrice <= 0n) throw new Error('首根开盘价必须为正。');
  let runStartEquity = initial;

  for (const [i, bar] of bars.entries()) {
    const candle = candles[i];
    if (candle.timestampUtcMs + intervalMs !== bar.closeUtcMs)
      throw new Error('行情与权益收盘时刻错位。');
    const state = i > 0 ? labels[i - 1] : 'UNKNOWN';
    const group = groups[state];
    const equity = readUnits(bar.equity);
    const delta = equity - previousEquity;
    const realized = signedAmount(bar.realizedDelta);
    const unrealized = signedAmount(bar.unrealizedDelta);
    if (delta !== realized + unrealized)
      throw new Error('逐根权益变化与已实现、浮动盈亏变化不守恒。');
    if (
      !Number.isSafeInteger(bar.fills) ||
      bar.fills < 0 ||
      typeof bar.exposed !== 'boolean'
    )
      throw new Error('成交数量或持仓暴露无效。');
    group.bars++;
    group.netPnl += delta;
    group.realizedDelta += realized;
    group.unrealizedDelta += unrealized;
    group.fills += bar.fills;
    group.fees += readUnits(bar.fees);
    if (bar.exposed) group.exposedMs += intervalMs;
    if (previousEquity > 0n)
      group.periodReturns.push((delta * RETURN_SCALE) / previousEquity);
    const price = parseDecimal(String(candle.close));
    group.assetReturns.push(
      ((price - previousPrice) * RETURN_SCALE) / previousPrice,
    );

    if (runs.at(-1)?.state !== state) {
      group.occurrences++;
      runStartEquity = previousEquity;
      runs.push({
        state,
        startUtcMs: candle.timestampUtcMs,
        endUtcMs: bar.closeUtcMs,
        bars: 0,
        startEquity: decimal(previousEquity),
        endEquity: bar.equity,
        netPnl: '0',
        returnFraction: null,
      });
    }
    const run = runs[runs.length - 1];
    run.bars++;
    run.endUtcMs = bar.closeUtcMs;
    run.endEquity = bar.equity;
    run.netPnl = decimal(equity - runStartEquity);
    run.returnFraction =
      runStartEquity > 0n
        ? fraction(equity - runStartEquity, runStartEquity)
        : null;
    previousEquity = equity;
    previousPrice = price;
  }

  const expected = signedAmount(input.netPnl);
  if (
    previousEquity - initial !== expected ||
    Object.values(groups).reduce((sum, g) => sum + g.netPnl, 0n) !== expected
  )
    throw new Error('市场状态贡献之和与原实验总净盈亏不守恒。');
  const summaries = REGIMES.map((state): RegimeSummary => {
    const g = groups[state];
    const durationMs = g.bars * intervalMs;
    return {
      state,
      bars: g.bars,
      durationMs,
      timeFraction: fraction(BigInt(g.bars), BigInt(bars.length)),
      occurrences: g.occurrences,
      netPnl: decimal(g.netPnl),
      realizedDelta: decimal(g.realizedDelta),
      unrealizedDelta: decimal(g.unrealizedDelta),
      fills: g.fills,
      fees: decimal(g.fees),
      exposedMs: g.exposedMs,
      exposureFraction: durationMs
        ? fraction(BigInt(g.exposedMs), BigInt(durationMs))
        : null,
      periodReturns: distribution(g.periodReturns),
      assetReturns: distribution(g.assetReturns),
    };
  });
  return {
    labels,
    runs,
    summaries,
    switches: runs.length - 1,
    netPnl: decimal(expected),
  };
}
