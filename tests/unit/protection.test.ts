// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { runBacktest, assertLedger } from '../../src/core/backtests';
import type { BacktestInput } from '../../src/core/backtests';
import { normalizeRisk, protectionFor } from '../../src/core/risk';
import { parseDecimal } from '../../src/core/backtests/decimal';
import { buy, sell, input, START, INTERVAL } from '../fixtures/backtest';
import { fixtureDataset } from '../fixtures/dataset';
import reference from '../fixtures/phase2b-reference.json';

const risk = { stopLossBps: 1000, takeProfitBps: 2000 };
function scenario(name: string) {
  const opens =
    name === 'gap-stop'
      ? [100, 100, 80]
      : name === 'gap-take'
        ? [100, 100, 130]
        : [100, 100, 100];
  const x = {
    ...input(opens, [buy(0, '2')]),
    risk,
    config: {
      feeBps: 25,
      buySlippageBps: 100,
      sellSlippageBps: 20,
      quantityDecimals: 8,
    },
  };
  if (name === 'stop' || name === 'both')
    x.dataset.candles[2] = { ...x.dataset.candles[2], low: 90 };
  if (name === 'take' || name === 'both')
    x.dataset.candles[2] = { ...x.dataset.candles[2], high: 125 };
  return x;
}
function plain() {
  return { ...input([100, 100, 100], [buy(0, '2')]), risk };
}
describe('protective market execution / independent Decimal reference', () => {
  it.each(reference.risk)(
    '$name reconciles every fee, slippage, protective price and final cash',
    (expected) => {
      const x = scenario(expected.name),
        r = runBacktest(x),
        f = r.fills[1];
      expect(r.fills).toHaveLength(2);
      expect(f).toMatchObject({
        referencePrice: expected.reference,
        price: expected.price,
        notional: expected.notional,
        fee: expected.fee,
        trigger: {
          entryPrice: expected.entry,
          stopPrice: expected.stop,
          takePrice: expected.take,
        },
        after: { cash: expected.finalCash },
        totals: { fees: expected.totalFees },
      });
      expect(r.final).toMatchObject({
        cash: expected.finalCash,
        equity: expected.finalCash,
        position: { quantity: '0' },
      });
      assertLedger('1000', r.fills, r.manifest.config);
      expect(JSON.stringify(runBacktest(x))).toBe(JSON.stringify(r));
    },
  );
  it('double touch explicitly chooses stop, ignores close direction, and has no fabricated timestamp', () => {
    const x = scenario('both'),
      r = runBacktest(x),
      f = r.fills[1];
    expect(f.timestampUtcMs).toBeNull();
    expect(f.signalCandleIndex).toBeNull();
    expect(f.trigger).toMatchObject({
      phase: 'intrabar',
      assumption: 'ambiguous-stop-first',
      kind: 'stop-loss',
      barOpenUtcMs: START + 2 * INTERVAL,
      barCloseUtcMs: START + 3 * INTERVAL,
    });
    expect(r.orders[1]).toMatchObject({
      resolvedUtcMs: null,
      intent: { generatedUtcMs: null },
    });
    x.dataset.candles[2] = { ...x.dataset.candles[2], close: 124 };
    expect(runBacktest(x).fills).toEqual(r.fills);
  });
  it.each(['gap-stop', 'gap-take'])(
    '%s uses known open time and never uses intrabar HLC or volume to improve price',
    (name) => {
      const x = scenario(name);
      x.signals = [buy(0, '2'), sell(1)];
      const r = runBacktest(x);
      expect(r.fills[1].timestampUtcMs).toBe(START + 2 * INTERVAL);
      expect(r.orders[2]).toMatchObject({
        status: 'cancelled',
        reason: 'risk-priority',
      });
      x.dataset.candles[2] = {
        ...x.dataset.candles[2],
        high: 500,
        low: 1,
        close: 400,
        volume: 0,
      };
      expect(runBacktest(x).fills).toEqual(r.fills);
      expect(r.fills.filter((f) => f.side === 'sell')).toHaveLength(1);
    },
  );
  it.each(['buy', 'sell'])(
    'gap exit cancels pending %s and prevents same-bar reentry',
    (side) => {
      const x = plain();
      x.dataset.candles[2] = {
        ...x.dataset.candles[2],
        open: 80,
        low: 80,
        close: 80,
      };
      x.signals = [buy(0, '2'), side === 'buy' ? buy(1, '1') : sell(1)];
      const r = runBacktest(x);
      expect(r.fills.map((f) => f.side)).toEqual(['buy', 'sell']);
      expect(r.orders[2].reason).toBe('risk-priority');
    },
  );
  it('pending open sell precedes unknown intrabar path; no duplicate protective sale', () => {
    const x = plain();
    x.signals = [buy(0, '2'), sell(1)];
    x.dataset.candles[2] = { ...x.dataset.candles[2], high: 150, low: 50 };
    const r = runBacktest(x);
    expect(r.fills.map((f) => f.orderId)).toEqual(['order-0', 'order-1']);
    expect(r.final.cash).toBe('1000');
  });
  it('new open purchase activates protection immediately and allows only one protective exit', () => {
    const x = plain();
    x.dataset.candles[1] = { ...x.dataset.candles[1], high: 150, low: 50 };
    const r = runBacktest(x);
    expect(r.fills.map((f) => [f.candleIndex, f.side])).toEqual([
      [1, 'buy'],
      [1, 'sell'],
    ]);
    expect(r.fills[1].trigger?.assumption).toBe('ambiguous-stop-first');
    expect(r.final.cash).toBe('980');
    assertLedger('1000', r.fills, r.manifest.config);
  });
  it('new protection already marketable after adverse entry slippage exits at the observed open, never a better stop quote', () => {
    const x = {
      ...input([100, 100], [buy(0, '2')]),
      risk: { stopLossBps: 1000 },
      config: { feeBps: 0, buySlippageBps: 9999, sellSlippageBps: 0 },
    };
    const r = runBacktest(x);
    expect(r.fills).toHaveLength(2);
    expect(r.fills[1]).toMatchObject({
      referencePrice: '100',
      timestampUtcMs: START + INTERVAL,
      trigger: { phase: 'open', entryPrice: '199.99', stopPrice: '179.991' },
    });
    expect(r.final.cash).toBe('800.02');
    assertLedger('1000', r.fills, r.manifest.config);
  });
  it('partial open sell leaves the original protection on the remainder', () => {
    const x = plain();
    x.signals = [buy(0, '2'), sell(1, '1')];
    x.dataset.candles[2] = { ...x.dataset.candles[2], low: 80 };
    const r = runBacktest(x);
    expect(r.fills.map((f) => f.quantity)).toEqual(['2', '1', '1']);
    expect(r.fills[2].trigger?.entryPrice).toBe('100');
    expect(r.final.cash).toBe('990');
    assertLedger('1000', r.fills, r.manifest.config);
  });
  it('reentry waits for next open and resets protection to new fill price', () => {
    const x = {
      ...input([100, 100, 200, 200], [buy(0, '2'), buy(1, '1')]),
      risk,
    };
    x.dataset.candles[1] = { ...x.dataset.candles[1], low: 80 };
    x.dataset.candles[3] = { ...x.dataset.candles[3], low: 150 };
    const r = runBacktest(x);
    expect(r.fills.map((f) => f.candleIndex)).toEqual([1, 1, 2, 3]);
    expect(r.fills[3].trigger).toMatchObject({
      entryPrice: '200',
      stopPrice: '180',
      takePrice: '240',
    });
    expect(r.final.cash).toBe('960');
  });
  it('protected positions reject adding exposure, while disabled protection preserves fixed-signal behavior', () => {
    const x = { ...input([100, 100, 100], [buy(0, '2'), buy(1, '1')]), risk };
    expect(runBacktest(x).orders[1].reason).toBe('position-already-open');
    expect(runBacktest({ ...x, risk: {} }).final.position.quantity).toBe('3');
  });
  it('minimum-notional rejection keeps position and retries only on next bar; pending is still cancelled', () => {
    const x = {
      ...input([100, 100, 80, 80], [buy(0, '1'), sell(1)]),
      risk,
      config: {
        feeBps: 0,
        buySlippageBps: 0,
        sellSlippageBps: 0,
        minNotional: '95',
      },
    };
    const r = runBacktest(x);
    expect(r.fills).toHaveLength(1);
    expect(r.orders.map((o) => o.reason ?? o.status)).toEqual([
      'filled',
      'below-min-notional',
      'risk-priority',
      'below-min-notional',
    ]);
    expect(r.final).toMatchObject({
      cash: '900',
      position: { quantity: '1' },
      equity: '980',
    });
  });
  it('protective slippage underflow rejects without funds change and stop-level underflow blocks run', () => {
    const x = {
      ...input([2e-18, 2e-18, 1e-18], [buy(0, '1')]),
      risk: { stopLossBps: 1000 },
      config: {
        initialCash: '1e-17',
        feeBps: 0,
        buySlippageBps: 0,
        sellSlippageBps: 1,
        quantityDecimals: 18,
      },
    };
    const r = runBacktest(x);
    expect(r.orders[1].reason).toBe('price-underflow');
    expect(r.final.position.quantity).toBe('1');
    expect(() => protectionFor(1n, { stopLossBps: 1 })).toThrow(/underflow/);
    expect(() =>
      runBacktest({ ...x, dataset: input([1e-18, 1e-18, 1e-18]).dataset }),
    ).toThrow(/Stop price underflow/);
  });
  it('one-sided protection, exact touches and fixed18 rounding are explicit', () => {
    const x = plain();
    x.dataset.candles[2] = { ...x.dataset.candles[2], high: 120, low: 90 };
    expect(
      runBacktest({ ...x, risk: { takeProfitBps: 2000 } }).fills[1].trigger
        ?.kind,
    ).toBe('take-profit');
    expect(
      runBacktest({ ...x, risk: { stopLossBps: 1000 } }).fills[1].trigger?.kind,
    ).toBe('stop-loss');
    expect(
      protectionFor(parseDecimal('1.000000000000000001'), {
        stopLossBps: 1,
        takeProfitBps: 1,
      }),
    ).toEqual({
      entryPrice: '1.000000000000000001',
      stopPrice: '0.9999',
      takePrice: '1.000100000000000002',
    });
  });
  it('handles derived TP above input price limit without accidentally reparsing it as an input', () => {
    const x = {
      ...input([9e29, 9e29, 9.9e29], [buy(0, '1e-18')]),
      risk: { takeProfitBps: 9999 },
      config: {
        initialCash: '1e13',
        feeBps: 0,
        buySlippageBps: 0,
        sellSlippageBps: 0,
        quantityDecimals: 18,
      },
    };
    // New position TP > 1e30 is valid derived state; never clipped to input range.
    expect(runBacktest(x).final.position.quantity).toBe('0.000000000000000001');
  });
  it('all-buy with cost, tiny quantity fee quantum and stop exit still reconcile exactly', () => {
    const x = {
      ...input([1, 1, 0.5], [buy(0)]),
      risk: { stopLossBps: 1000 },
      config: {
        initialCash: '1e-17',
        feeBps: 1,
        buySlippageBps: 1,
        sellSlippageBps: 1,
        quantityDecimals: 18,
      },
    };
    const r = runBacktest(x);
    assertLedger('1e-17', r.fills, r.manifest.config);
    expect(r.fills).toHaveLength(2);
    expect(r.final.position.quantity).toBe('0');
  });
  it('future extensions leave protected prefix trades, close snapshots and signals unchanged', () => {
    const x = plain();
    x.dataset.candles[1] = { ...x.dataset.candles[1], high: 150, low: 50 };
    const p = runBacktest(x);
    const full = input([100, 100, 100, 1e20, 1e-10], x.signals);
    full.dataset.candles[1] = x.dataset.candles[1];
    const f = runBacktest({ ...full, risk });
    expect(f.fills.filter((t) => t.candleIndex < 3)).toEqual(p.fills);
    expect(f.closes.slice(0, 3)).toEqual(p.closes);
    expect(f.signals).toEqual(p.signals);
  });
  it.each([
    null,
    [],
    { stopLossBps: 0 },
    { stopLossBps: 10000 },
    { takeProfitBps: NaN },
    { takeProfitBps: 1.5 },
    { takeProfitBps: undefined },
    { trailing: true },
  ])('rejects invalid risk configuration %j', (bad) =>
    expect(() => normalizeRisk(bad as never)).toThrow(),
  );
  it('risk config is canonical and affects identity even when no protective fill occurs', () => {
    const x = plain(),
      a = runBacktest(x),
      b = runBacktest({
        ...x,
        risk: { takeProfitBps: 2000, stopLossBps: 1000 },
      });
    expect(a).toEqual(b);
    expect(a.manifest.runHash).not.toBe(
      runBacktest({ ...x, risk: { stopLossBps: 2000 } }).manifest.runHash,
    );
    expect(normalizeRisk({})).toEqual({});
  });
  it.each(['empty', 'gap', 'uncompleted', 'bad-ohlc', 'extreme'])(
    'protective run blocks %s data and returns no repaired subset',
    (kind) => {
      const x: BacktestInput = plain();
      if (kind === 'empty') x.dataset.candles = [];
      if (kind === 'gap') {
        x.dataset = fixtureDataset(true);
        x.completedThroughUtcMs = START + 4 * INTERVAL;
      }
      if (kind === 'uncompleted') x.completedThroughUtcMs--;
      if (kind === 'bad-ohlc')
        x.dataset.candles[1] = { ...x.dataset.candles[1], low: NaN };
      if (kind === 'extreme')
        x.dataset.candles[1] = {
          ...x.dataset.candles[1],
          open: 1e30,
          high: 1e30,
        };
      expect(() => runBacktest(x)).toThrow();
    },
  );
  it.each([
    'timestamp',
    'phase',
    'assumption',
    'side',
    'quantity',
    'fee',
    'price',
    'order',
    'level',
  ])('auditor rejects altered risk %s', (kind) => {
    const r = runBacktest(scenario('both')),
      f = r.fills[1];
    if (kind === 'timestamp') f.timestampUtcMs = START + 2 * INTERVAL;
    if (kind === 'phase') f.trigger!.phase = 'open';
    if (kind === 'assumption') f.trigger!.assumption = 'observed-open';
    if (kind === 'side') f.side = 'buy';
    if (kind === 'quantity') f.quantity = '1';
    if (kind === 'fee') f.fee = '0';
    if (kind === 'price') f.price = '100';
    if (kind === 'order') f.orderId = 'risk-99';
    if (kind === 'level') f.trigger!.stopPrice = '999';
    expect(() => assertLedger('1000', r.fills, r.manifest.config)).toThrow(
      /Ledger/,
    );
  });
});
