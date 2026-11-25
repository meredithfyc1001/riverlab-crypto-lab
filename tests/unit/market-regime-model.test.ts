import { describe, expect, it } from 'vitest';
import type { Candle } from '../../src/core/data';
import {
  analyzeRegimes,
  assertRegimeParams,
  classifyRegimes,
} from '../../src/core/market-regime/model';
import type {
  RegimeParams,
  RegimeSeries,
} from '../../src/core/market-regime/model';

const start = Date.UTC(2026, 0, 1);
const hour = 3_600_000;
const params = { lookback: 1, thresholdBps: 500 };

function candles(closes: number[]): Candle[] {
  return closes.map((close, i) => ({
    open: close,
    high: close,
    low: close,
    close,
    volume: 0,
    timestampUtcMs: start + i * hour,
  }));
}
function classify(values: number[], p = params) {
  return classifyRegimes(
    candles(values),
    hour,
    start + hour * values.length,
    p,
  );
}
function series(): RegimeSeries {
  // The sideways period's equity gain includes realization of earlier
  // appreciation plus a reduction of floating P&L on the same holding.
  const prices = candles([100, 110, 110, 90, 100, 100]);
  return {
    intervalMs: hour,
    completedThroughUtcMs: start + hour * prices.length,
    initialCash: '10',
    netPnl: '0.000000000000000001',
    candles: prices,
    bars: [
      {
        equity: '10',
        realizedDelta: '0',
        unrealizedDelta: '0',
        fills: 0,
        fees: '0',
        exposed: false,
      },
      {
        equity: '8',
        realizedDelta: '0',
        unrealizedDelta: '-2',
        fills: 1,
        fees: '0.5',
        exposed: true,
      },
      {
        equity: '12',
        realizedDelta: '0',
        unrealizedDelta: '4',
        fills: 0,
        fees: '0',
        exposed: true,
      },
      {
        equity: '13',
        realizedDelta: '3',
        unrealizedDelta: '-2',
        fills: 1,
        fees: '0.2',
        exposed: true,
      },
      {
        equity: '10',
        realizedDelta: '0',
        unrealizedDelta: '-3',
        fills: 1,
        fees: '0.3',
        exposed: true,
      },
      {
        equity: '10.000000000000000001',
        realizedDelta: '0',
        unrealizedDelta: '0.000000000000000001',
        fills: 0,
        fees: '0',
        exposed: true,
      },
    ].map((bar, i) => ({ ...bar, closeUtcMs: start + (i + 1) * hour })),
  };
}

describe('historical close return labels', () => {
  it.each([
    [105, 'SIDEWAYS'],
    [95, 'SIDEWAYS'],
    [100, 'SIDEWAYS'],
    [105.000000000001, 'BULL'],
    [94.999999999999, 'BEAR'],
  ])(
    'classifies an exact integer-bps boundary at 100 → %s',
    (last, expected) => {
      expect(classify([100, Number(last)])).toEqual(['UNKNOWN', expected]);
    },
  );
  it('compares fixed18 price changes before rounding a displayed return', () => {
    expect(classify([1e-15, 1.05e-15, 1.104e-15])).toEqual([
      'UNKNOWN',
      'SIDEWAYS',
      'BULL',
    ]);
  });
  it('requires N+1 closes and uses the close precisely N bars ago', () => {
    const p = { lookback: 3, thresholdBps: 500 };
    expect(classify([10, 100, 100], p)).toEqual([
      'UNKNOWN',
      'UNKNOWN',
      'UNKNOWN',
    ]);
    expect(classify([10, 100, 100, 50, 80], p)).toEqual([
      'UNKNOWN',
      'UNKNOWN',
      'UNKNOWN',
      'BULL',
      'BEAR',
    ]);
  });
  it('preserves every prefix when an extreme future and frequent switches are appended', () => {
    const prices = [100, 110, 90, 110, 90, 110, 90, 1e6, 1e-12];
    const labels = classify(prices);
    expect(labels).toEqual([
      'UNKNOWN',
      'BULL',
      'BEAR',
      'BULL',
      'BEAR',
      'BULL',
      'BEAR',
      'BULL',
      'BEAR',
    ]);
    for (let length = 1; length <= prices.length; length++) {
      expect(classify(prices.slice(0, length))).toEqual(
        labels.slice(0, length),
      );
    }
  });
  it.each([0, -hour, hour + 1, hour * 2])(
    'rejects a duplicate, reverse, misaligned or missing bar (%s)',
    (gap) => {
      const tape = candles([100, 105, 110]);
      tape[1] = { ...tape[1], timestampUtcMs: start + gap };
      expect(() =>
        classifyRegimes(tape, hour, start + 4 * hour, params),
      ).toThrow(/缺口|错位/);
    },
  );
  it('reads only timestamps and completed close prices for classification', () => {
    const tape = candles([100, 110]).map(
      (candle) =>
        new Proxy(candle, {
          get(target, property: keyof Candle) {
            if (property !== 'timestampUtcMs' && property !== 'close')
              throw new Error('unexpected access: ' + property);
            return target[property];
          },
        }),
    );
    expect(classifyRegimes(tape, hour, start + 2 * hour, params)).toEqual([
      'UNKNOWN',
      'BULL',
    ]);
  });
  it('rejects unconfirmed bars and invalid source price precision', () => {
    expect(() =>
      classifyRegimes(candles([1, 2]), hour, start + 2 * hour - 1, params),
    ).toThrow(/未完成/);
    expect(() => classify([1e-19])).toThrow();
    expect(() => classify([0])).toThrow(/收盘价/);
  });
  it.each([
    { lookback: 0, thresholdBps: 1 },
    { lookback: 50001, thresholdBps: 1 },
    { lookback: 1.5, thresholdBps: 1 },
    { lookback: 1, thresholdBps: 0 },
    { lookback: 1, thresholdBps: 1.1 },
    { lookback: 1, thresholdBps: 10001 },
    { lookback: '1', thresholdBps: 1 },
    { lookback: 1, thresholdBps: 2, extra: 'auto' },
  ])('rejects invalid or unspecified parameter semantics: %o', (p) => {
    expect(() => assertRegimeParams(p as RegimeParams)).toThrow();
  });
});

describe('attribution on continuous source equity', () => {
  it('shifts the label at close by exactly one bar, including fills, fees and time', () => {
    const r = analyzeRegimes(series(), params);
    expect(r.labels).toEqual([
      'UNKNOWN',
      'BULL',
      'SIDEWAYS',
      'BEAR',
      'BULL',
      'SIDEWAYS',
    ]);
    expect(
      r.summaries.map((g) => [
        g.state,
        g.bars,
        g.occurrences,
        g.netPnl,
        g.realizedDelta,
        g.unrealizedDelta,
        g.fills,
        g.fees,
        g.exposedMs,
      ]),
    ).toEqual([
      [
        'BULL',
        2,
        2,
        '4.000000000000000001',
        '0',
        '4.000000000000000001',
        0,
        '0',
        2 * hour,
      ],
      ['BEAR', 1, 1, '-3', '0', '-3', 1, '0.3', hour],
      ['SIDEWAYS', 1, 1, '1', '3', '-2', 1, '0.2', hour],
      ['UNKNOWN', 2, 1, '-2', '0', '-2', 1, '0.5', hour],
    ]);
    expect(r.netPnl).toBe('0.000000000000000001');
    expect(r.switches).toBe(4);
    expect(
      r.runs.map((g) => [g.state, g.startUtcMs, g.endUtcMs, g.netPnl]),
    ).toEqual([
      ['UNKNOWN', start, start + 2 * hour, '-2'],
      ['BULL', start + 2 * hour, start + 3 * hour, '4'],
      ['SIDEWAYS', start + 3 * hour, start + 4 * hour, '1'],
      ['BEAR', start + 4 * hour, start + 5 * hour, '-3'],
      ['BULL', start + 5 * hour, start + 6 * hour, '0.000000000000000001'],
    ]);
  });
  it('uses within-state descriptive returns from actual previous equity, with no account resets', () => {
    const r = analyzeRegimes(series(), params);
    expect(r.summaries[0].periodReturns).toEqual({
      count: 2,
      min: '0',
      median: '0.25',
      max: '0.5',
      mean: '0.25',
      volatility: '0.25',
    });
    expect(r.summaries[3].assetReturns).toEqual({
      count: 2,
      min: '0',
      median: '0.05',
      max: '0.1',
      mean: '0.05',
      volatility: '0.05',
    });
    expect(r.summaries[3].exposureFraction).toBe('0.5');
    expect(r.summaries[2].periodReturns.volatility).toBeNull();
    expect(r.runs[1]).toMatchObject({
      startEquity: '8',
      endEquity: '12',
      returnFraction: '0.5',
    });
    expect(r.runs[2].startEquity).toBe(r.runs[1].endEquity);
  });
  it('retains UNKNOWN for the last close when the next period is absent and no return exists for a zero denominator', () => {
    const s = series();
    const zero: RegimeSeries = {
      ...s,
      initialCash: '0',
      netPnl: '0',
      candles: s.candles.slice(0, 1),
      bars: [{ ...s.bars[0], equity: '0' }],
    };
    const r = analyzeRegimes(zero, params);
    expect(r.switches).toBe(0);
    expect(r.runs[0].returnFraction).toBeNull();
    expect(r.summaries[3]).toMatchObject({
      timeFraction: '1',
      exposureFraction: '0',
      periodReturns: { count: 0, mean: null },
    });
    expect(r.summaries[0]).toMatchObject({
      timeFraction: '0',
      exposureFraction: null,
      assetReturns: { count: 0, mean: null },
    });
  });
  it('records the final detected trend with no attributed period until the next bar exists', () => {
    const s = series();
    const r = analyzeRegimes(
      {
        ...s,
        netPnl: '-2',
        candles: s.candles.slice(0, 2),
        bars: s.bars.slice(0, 2),
      },
      params,
    );
    expect(r.labels).toEqual(['UNKNOWN', 'BULL']);
    expect(r.summaries.find((group) => group.state === 'BULL')).toMatchObject({
      bars: 0,
      occurrences: 0,
    });
    expect(r.runs.map((run) => run.state)).toEqual(['UNKNOWN']);
  });
  it('rejects ledger misalignment and exact reconciliation discrepancies', () => {
    const s = series();
    expect(() =>
      analyzeRegimes({ ...s, bars: s.bars.slice(1) }, params),
    ).toThrow(/长度/);
    expect(() =>
      analyzeRegimes(
        {
          ...s,
          bars: s.bars.map((b, i) =>
            i === 2 ? { ...b, closeUtcMs: b.closeUtcMs + 1 } : b,
          ),
        },
        params,
      ),
    ).toThrow(/错位/);
    expect(() => analyzeRegimes({ ...s, netPnl: '0' }, params)).toThrow(
      /不守恒/,
    );
    expect(() =>
      analyzeRegimes(
        {
          ...s,
          bars: s.bars.map((b, i) =>
            i === 5 ? { ...b, unrealizedDelta: '0' } : b,
          ),
        },
        params,
      ),
    ).toThrow(/逐根/);
  });
});
