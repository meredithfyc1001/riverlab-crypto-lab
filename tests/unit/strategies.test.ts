// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createStrategy, normalizeStrategy } from '../../src/core/strategies';
import type { StrategyInput } from '../../src/core/strategies';
import type { Candle } from '../../src/core/data';
import { runBacktest } from '../../src/core/backtests';
import { INTERVAL, START, input, market } from '../fixtures/backtest';
import reference from '../fixtures/phase2b-reference.json';

function candles(bars: readonly string[][]): Candle[] {
  return bars.map((bar, i) => ({
    timestampUtcMs: START + i * INTERVAL,
    open: Number(bar[0]),
    high: Number(bar[1]),
    low: Number(bar[2]),
    close: Number(bar[3]),
    volume: 1,
  }));
}
const configs: StrategyInput[] = [
  { kind: 'ma', fastPeriod: 2, slowPeriod: 4 },
  { kind: 'rsi', period: 3, lower: 30, upper: 70 },
  { kind: 'breakout', lookback: 3 },
];
const actions = (config: StrategyInput, bars: readonly Candle[]) => {
  const strategy = createStrategy(config, INTERVAL);
  return bars.map((c) => strategy.onClose(Object.freeze({ ...c })));
};
describe('official causal strategies / independent Decimal references', () => {
  it.each(reference.strategies)(
    '$name fixed signals and every historical prefix',
    (c) => {
      const config = c.config as StrategyInput;
      const bars = candles(c.bars);
      const full = actions(config, bars);
      expect(full.map((s) => s.action)).toEqual(c.actions);
      for (let length = 0; length <= bars.length; length++)
        expect(actions(config, bars.slice(0, length))).toEqual(
          full.slice(0, length),
        );
    },
  );
  it.each(configs)(
    '$kind ignores appended future extremes and creates fresh independent state',
    (config) => {
      const prefix = market([10, 9, 8, 12, 15, 8, 4, 7]).candles;
      const full = [
        ...prefix,
        ...[1e29, 1e-18, 40].map((p, i) => ({
          ...prefix[0],
          timestampUtcMs: START + (prefix.length + i) * INTERVAL,
          open: p,
          high: p,
          low: p,
          close: p,
        })),
      ];
      expect(actions(config, full).slice(0, prefix.length)).toEqual(
        actions(config, prefix),
      );
      expect(actions(config, full)).toEqual(actions(config, full));
    },
  );
  it('MA requires a previous defined difference; equality does not emit a cross until leaving it', () => {
    expect(
      actions(
        { kind: 'ma', fastPeriod: 1, slowPeriod: 2 },
        market([10, 10, 11, 11, 10]).candles,
      ).map((s) => s.action),
    ).toEqual(['hold', 'hold', 'buy', 'hold', 'sell']);
    expect(actions({ kind: 'ma' }, [])).toEqual([]);
  });
  it('breakout excludes current high/low and compares prior extrema rather than closes', () => {
    const bars = market([10, 10, 11, 12, 9]).candles;
    bars[1] = { ...bars[1], high: 12, low: 8 };
    bars[2] = { ...bars[2], high: 100, low: 1 };
    expect(
      actions({ kind: 'breakout', lookback: 2 }, bars).map((s) => s.action),
    ).toEqual(['hold', 'hold', 'hold', 'hold', 'hold']);
    expect(
      actions(
        { kind: 'breakout', lookback: 1 },
        market([10, 10, 11, 9]).candles,
      ).map((s) => s.action),
    ).toEqual(['hold', 'hold', 'buy', 'sell']);
    // An old extreme must leave the lookback window.
    expect(
      actions(
        { kind: 'breakout', lookback: 2 },
        market([100, 10, 10, 11]).candles,
      ).at(-1)?.action,
    ).toBe('buy');
  });
  it('RSI has inclusive 0/50/100 threshold semantics and period+1 warmup', () => {
    expect(
      actions(
        { kind: 'rsi', period: 1, lower: 0, upper: 100 },
        market([10, 11, 10, 10]).candles,
      ).map((s) => s.action),
    ).toEqual(['hold', 'sell', 'buy', 'hold']);
    expect(
      actions(
        { kind: 'rsi', period: 2, lower: 50, upper: 100 },
        market([10, 10, 10]).candles,
      ).at(-1)?.action,
    ).toBe('buy');
    expect(
      actions(
        { kind: 'rsi', period: 2, lower: 0, upper: 50 },
        market([10, 10, 10]).candles,
      ).at(-1)?.action,
    ).toBe('sell');
  });
  it.each(configs)(
    '$kind integrates close signals with next-open long/flat execution and manifest identity',
    (strategy) => {
      const x = input([10, 9, 8, 12, 15, 8, 4, 7, 10, 13]);
      const { signals: _signals, ...base } = x;
      void _signals;
      const r = runBacktest({ ...base, strategy });
      expect(r.manifest.signals.map((s) => s.action)).toEqual(
        actions(strategy, x.dataset.candles).map((s) => s.action),
      );
      for (const f of r.fills)
        expect(f.signalCandleIndex).toBe(f.candleIndex - 1);
      expect(r.manifest.strategy?.config.kind).toBe(strategy.kind);
      expect(JSON.stringify(runBacktest({ ...base, strategy }))).toBe(
        JSON.stringify(r),
      );
      expect(() =>
        runBacktest({ ...base, strategy, signals: [] } as never),
      ).toThrow(/never both/);
      expect(
        runBacktest({ ...base, strategy, risk: { stopLossBps: 1000 } }).manifest
          .runHash,
      ).not.toBe(r.manifest.runHash);
    },
  );
  it.each(configs)(
    '$kind protects every engine prefix without future-dependent historical trades',
    (strategy) => {
      const values = [10, 9, 8, 12, 15, 8, 4, 7, 10, 13];
      const run = (n: number) => {
        const { signals: _s, ...base } = input(values.slice(0, n));
        void _s;
        return runBacktest({
          ...base,
          strategy,
          risk: { stopLossBps: 1000, takeProfitBps: 2000 },
        });
      };
      const full = run(values.length);
      for (let n = 1; n <= values.length; n++) {
        const prefix = run(n);
        expect(full.signals.slice(0, n)).toEqual(prefix.signals);
        expect(full.closes.slice(0, n)).toEqual(prefix.closes);
        expect(full.fills.filter((f) => f.candleIndex < n)).toEqual(
          prefix.fills,
        );
        expect(
          full.orders.filter((o) => o.intent.targetCandleIndex < n),
        ).toEqual(prefix.orders.filter((o) => o.status !== 'expired'));
      }
    },
  );
  it('strategy buy repeats never pyramid and sell while flat never creates a short', () => {
    const { signals: _s, ...base } = input([10, 11, 12, 13, 12, 11, 10]);
    void _s;
    const r = runBacktest({
      ...base,
      strategy: { kind: 'breakout', lookback: 1 },
    });
    expect(r.fills.map((f) => f.side)).toEqual(['buy', 'sell']);
    expect(r.orders.some((o) => o.reason === 'position-already-open')).toBe(
      true,
    );
    expect(r.orders.some((o) => o.reason === 'position-already-flat')).toBe(
      true,
    );
  });
  it('configuration snapshot cannot change midstream', () => {
    const config: StrategyInput = { kind: 'ma', fastPeriod: 1, slowPeriod: 2 };
    const strategy = createStrategy(config, INTERVAL);
    config.fastPeriod = 2;
    expect(strategy.config).toEqual({
      kind: 'ma',
      fastPeriod: 1,
      slowPeriod: 2,
    });
    expect(Object.isFrozen(strategy.config)).toBe(true);
  });
  it.each([
    {},
    null,
    [],
    { kind: 'other' },
    { kind: 'ma', fastPeriod: 2, slowPeriod: 2 },
    { kind: 'ma', fastPeriod: 0 },
    { kind: 'ma', slowPeriod: 50001 },
    { kind: 'ma', fastPeriod: 1.5 },
    { kind: 'rsi', period: NaN },
    { kind: 'rsi', lower: -1 },
    { kind: 'rsi', upper: 101 },
    { kind: 'rsi', lower: 70, upper: 70 },
    { kind: 'rsi', lower: Infinity },
    { kind: 'breakout', lookback: 0 },
    { kind: 'breakout', lookback: undefined },
    { kind: 'ma', leverage: 2 },
  ])('rejects malformed config %j', (config) =>
    expect(() => normalizeStrategy(config as StrategyInput)).toThrow(),
  );
  it.each(configs)(
    '$kind validates missing/abnormal bars and maximum warmup',
    (config) => {
      const bar = market([10]).candles[0];
      for (const changed of [
        { ...bar, close: NaN },
        { ...bar, high: 1 },
        { ...bar, volume: -1 },
        { ...bar, low: 0 },
        { ...bar, open: Infinity },
        { ...bar, timestampUtcMs: -1 },
        { ...bar, open: 1e30, high: 1e30 },
        { ...bar, open: 1e-19, low: 1e-19 },
      ])
        expect(() =>
          createStrategy(config, INTERVAL).onClose(changed),
        ).toThrow();
      const s = createStrategy(config, INTERVAL);
      s.onClose(bar);
      expect(() => s.onClose(bar)).toThrow(/noncontiguous/);
      expect(() =>
        s.onClose({ ...bar, timestampUtcMs: START + 2 * INTERVAL }),
      ).toThrow(/noncontiguous/);
      for (const n of [0, NaN, 1.1, -1])
        expect(() => createStrategy(config, n)).toThrow();
    },
  );
  it('maximum valid periods retain insufficient-sample hold', () => {
    for (const c of [
      { kind: 'ma', fastPeriod: 49999, slowPeriod: 50000 },
      { kind: 'rsi', period: 50000 },
      { kind: 'breakout', lookback: 50000 },
    ] as const)
      expect(
        actions(c, market([10, 11, 12]).candles).every(
          (s) => s.action === 'hold',
        ),
      ).toBe(true);
  });
});
