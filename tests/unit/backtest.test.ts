// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  runBacktest,
  assertLedger,
  DEFAULT_CONFIG,
} from '../../src/core/backtests';
import type { BacktestConfig, Signal } from '../../src/core/backtests';
import { canonicalJson, contentHash } from '../../src/core/backtests/identity';
import { decimal, parseDecimal } from '../../src/core/backtests/decimal';
import {
  input,
  market,
  buy,
  sell,
  START,
  INTERVAL,
} from '../fixtures/backtest';
import { fixtureDataset } from '../fixtures/dataset';
import reference from '../fixtures/backtest-reference.json';

describe('deterministic spot kernel / fixed independent scenarios', () => {
  it.each([
    [[10, 20, 30, 40], '1500'],
    [[40, 30, 20, 10], '666.6666667'],
    [[10, 10, 10, 10], '1000'],
  ] as const)('rising/falling/flat tape %j', (prices, cash) => {
    // Falling: floor(1000/30, 8)=33.33333333; 1000 - 999.9999999 + 666.6666666.
    const r = runBacktest(input(prices, [buy(0), sell(1)]));
    expect(r.final.cash).toBe(cash);
    expect(r.final.position.quantity).toBe('0');
    assertLedger('1000', r.fills, r.manifest.config);
  });

  it('matches independently calculated Decimal fees, slippage and each leg of equity', () => {
    const r = runBacktest({
      ...input(reference.opens, [buy(0, '2'), sell(1, '2')], reference.closes),
      config: reference.config,
    });
    const [b, s] = r.fills;
    for (const [actual, expected] of [
      [b, reference.buy],
      [s, reference.sell],
    ] as const) {
      expect({
        price: actual.price,
        quantity: actual.quantity,
        notional: actual.notional,
        fee: actual.fee,
        cash: actual.after.cash,
        equityAtOpen: actual.after.equity,
        deltaEquity: actual.delta.equity,
      }).toEqual({
        price: expected.price,
        quantity: expected.quantity,
        notional: expected.notional,
        fee: expected.fee,
        cash: expected.cash,
        equityAtOpen: expected.equityAtOpen,
        deltaEquity: expected.deltaEquity,
      });
    }
    expect(r.closes[1].account.equity).toBe(reference.buy.equityAtClose);
    expect(s.totals.fees).toBe(reference.totalFees);
    expect(r.final.equity).toBe(reference.sell.cash);
  });

  it('defaults to virtual 1000 USDT and explicitly recorded cost assumptions', () => {
    const r = runBacktest({ ...input([100]), config: undefined });
    expect(r.manifest.config).toEqual(DEFAULT_CONFIG);
    expect(r.final.cash).toBe('1000');
    expect(r.manifest.assumptions).toContain(
      'unlimited-liquidity-no-order-book-volume-ignored',
    );
    expect(r.manifest.source.kind).toBe('synthetic');
    expect(r.manifest.quality.issueCounts.COVERAGE_UNVERIFIED).toBe(1);
  });

  it('emits only on completed close, fills next open despite jump, never clips using high/low', () => {
    const r = runBacktest({
      ...input([10, 1000], [buy(0, '0.1')], [500, 2000]),
      config: { feeBps: 0, buySlippageBps: 100, sellSlippageBps: 0 },
    });
    expect(r.signals[0].generatedUtcMs).toBe(START + INTERVAL);
    expect(r.orders[0].intent.targetCandleIndex).toBe(1);
    expect(r.fills[0]).toMatchObject({
      candleIndex: 1,
      timestampUtcMs: START + INTERVAL,
      referencePrice: '1000',
      price: '1010',
    });
    expect(r.closes[0].account.position.quantity).toBe('0');
    const changed = input([10, 1000], [buy(0, '0.1')], [500, 1000]);
    const sameFill = runBacktest({ ...changed, config: r.manifest.config });
    expect(sameFill.fills).toEqual(r.fills); // Different current high/low/close, identical fill.
    expect(sameFill.fills[0].price).toBe('1010'); // Above that candle's high (1000), no hindsight clamp.
  });

  it('hold/empty signals remain in cash; last signal expires without fill or fees', () => {
    expect(runBacktest(input([10, 20])).final.equity).toBe('1000');
    const r = runBacktest(
      input(
        [10, 20],
        [{ action: 'hold', candleIndex: 0, reason: 'flat' }, buy(1)],
      ),
    );
    expect(r.signals).toHaveLength(2);
    expect(r.fills).toHaveLength(0);
    expect(r.orders).toHaveLength(1);
    expect(r.orders[0]).toMatchObject({
      status: 'expired',
      reason: 'no-next-candle',
    });
    expect(r.final.cash).toBe('1000');
    const open = runBacktest(input([10, 20], [buy(0), sell(1)]));
    expect(open.final.position.quantity).toBe('50'); // Never force final liquidation.
    expect(open.final.equity).toBe('1000');
  });

  it('rejects overbuy/oversell/repeated sell without changing the account', () => {
    const r = runBacktest(
      input(
        [100, 100, 100, 100, 100, 100],
        [buy(0, '11'), sell(1, '1'), buy(2, '2'), sell(3, '3'), sell(4)],
      ),
    );
    expect(r.orders.map((o) => o.reason ?? o.status)).toEqual([
      'insufficient-cash',
      'insufficient-position',
      'filled',
      'insufficient-position',
      'filled',
    ]);
    expect(r.final.cash).toBe('1000');
    expect(r.final.position.quantity).toBe('0');
    const again = runBacktest(
      input([100, 100, 100, 100], [buy(0), sell(1), sell(2)]),
    );
    expect(again.orders[2].reason).toBe('zero-quantity');
    expect(again.final.position.quantity).toBe('0');
  });

  it('all buy includes fees and maximizes affordable quantity ticks', () => {
    const r = runBacktest({
      ...input([3, 3, 3], [buy(0), sell(1)]),
      config: {
        initialCash: '1',
        feeBps: 1000,
        buySlippageBps: 0,
        sellSlippageBps: 0,
        quantityDecimals: 2,
      },
    });
    expect(r.fills[0]).toMatchObject({
      quantity: '0.3',
      notional: '0.9',
      fee: '0.09',
      after: { cash: '0.01' },
    });
    expect(r.final.cash).toBe('0.82');
    const fixed = runBacktest({
      ...input([3, 3], [buy(0, '0.31')]),
      config: r.manifest.config,
    });
    expect(fixed.orders[0].reason).toBe('insufficient-cash');
  });

  it('rounds quantity downward, enforces minimum notional and ignores future full-bar volume', () => {
    const rounded = runBacktest({
      ...input([10, 10], [buy(0, '1.239')]),
      config: { feeBps: 0, buySlippageBps: 0, quantityDecimals: 2 },
    });
    expect(rounded.fills[0].quantity).toBe('1.23');
    expect(rounded.final.cash).toBe('987.7');
    const tooSmall = runBacktest({
      ...input([10, 10], [buy(0, '0.0001')]),
      config: { quantityDecimals: 2 },
    });
    expect(tooSmall.orders[0].reason).toBe('zero-quantity');
    expect(
      runBacktest({
        ...input([10, 10], [buy(0, '1')]),
        config: { feeBps: 0, buySlippageBps: 0, minNotional: '11' },
      }).orders[0].reason,
    ).toBe('below-min-notional');
    const zeroVolume = input([10, 10], [buy(0)]);
    zeroVolume.dataset.candles[1] = {
      ...zeroVolume.dataset.candles[1],
      volume: 0,
    };
    expect(runBacktest(zeroVolume).fills).toEqual(
      runBacktest(input([10, 10], [buy(0)])).fills,
    );
    expect(
      runBacktest({
        ...input([10, 10], [buy(0)]),
        config: { initialCash: '0' },
      }).final.equity,
    ).toBe('0');
  });

  it('handles exact 1e-18 rounding including fee quantum and sell underflow', () => {
    const r = runBacktest({
      ...input([0.5, 0.5, 0.5], [buy(0, '1e-18'), sell(1)]),
      config: {
        initialCash: '1e-17',
        quantityDecimals: 18,
        feeBps: 1,
        buySlippageBps: 0,
        sellSlippageBps: 0,
      },
    });
    expect(r.fills[0]).toMatchObject({
      notional: '0.000000000000000001',
      fee: '0.000000000000000001',
      after: { cash: '0.000000000000000008' },
      delta: { equity: '-0.000000000000000002' },
    });
    expect(r.orders[1].reason).toBe('zero-notional');
    const underflow = runBacktest({
      ...input([1e-18, 1e-18, 1e-18], [buy(0, '1'), sell(1)]),
      config: { feeBps: 0, buySlippageBps: 0, sellSlippageBps: 1 },
    });
    expect(underflow.orders[1].reason).toBe('price-underflow');
  });

  it('ceil-rounds buy slippage at one price quantum and supports integer quantity precision', () => {
    const r = runBacktest({
      ...input([1e-18, 1e-18, 1e-18], [buy(0, '1.9'), sell(1)]),
      config: {
        initialCash: '3e-18',
        feeBps: 0,
        buySlippageBps: 1,
        sellSlippageBps: 0,
        quantityDecimals: 0,
      },
    });
    expect(r.fills[0]).toMatchObject({
      price: '0.000000000000000002',
      quantity: '1',
      notional: '0.000000000000000002',
    });
    expect(r.final.cash).toBe('0.000000000000000002');
    expect(r.final.position.quantity).toBe('0');
  });

  it('supports very large and very small prices without Number accumulation', () => {
    const large = runBacktest({
      ...input([1e29, 1e29], [buy(0, '1e-18')]),
      config: {
        initialCash: '1e12',
        feeBps: 0,
        buySlippageBps: 0,
        quantityDecimals: 18,
      },
    });
    expect(large.fills[0].notional).toBe('100000000000');
    expect(large.final.cash).toBe('900000000000');
    const small = runBacktest({
      ...input([1e-18, 1e-18, 1e-18], [buy(0), sell(1)]),
      config: {
        initialCash: '1e29',
        feeBps: 0,
        buySlippageBps: 0,
        sellSlippageBps: 0,
        quantityDecimals: 18,
      },
    });
    expect(small.fills[0].quantity).toBe('1' + '0'.repeat(47));
    expect(small.final.cash).toBe('1' + '0'.repeat(29));
    assertLedger('1e29', small.fills, small.manifest.config);
    for (const price of [1e-19, 1e30, Number.MAX_VALUE, Number.MIN_VALUE])
      expect(() => runBacktest(input([price]))).toThrow(/Decimal/);
  });

  it('blocks derived accounting overflow rather than returning a partial or clipped result', () => {
    const x = {
      ...input(
        [1e-18, 1e-18, 1e29, 1e-18, 1e29],
        [buy(0), sell(1), buy(2), sell(3)],
      ),
      config: {
        initialCash: '1e29',
        feeBps: 0,
        buySlippageBps: 0,
        sellSlippageBps: 0,
        quantityDecimals: 18,
      },
    };
    expect(() => runBacktest(x)).toThrow(/Accounting.*1e78/);
  });
});

describe('quality, causality, reproducibility and reconciliation', () => {
  it('blocks valid Phase 1 gap datasets and uncompleted bars', () => {
    expect(() =>
      runBacktest({
        ...input([10, 10]),
        dataset: fixtureDataset(true),
        completedThroughUtcMs: START + 4 * INTERVAL,
      }),
    ).toThrow(/gap/);
    const x = input([10, 10]);
    x.completedThroughUtcMs--;
    expect(() => runBacktest(x)).toThrow(/Uncompleted/);
    for (const time of [
      NaN,
      Infinity,
      -1,
      START + 0.1,
      Number.MAX_SAFE_INTEGER,
    ])
      expect(() =>
        runBacktest({ ...input([10]), completedThroughUtcMs: time }),
      ).toThrow(/UTC/);
  });

  it.each([
    'empty',
    'duplicate',
    'reverse',
    'non-grid',
    'bad-open',
    'bad-ohlc',
    'negative-volume',
    'unacknowledged',
    'bad-quality',
    'bad-hash',
  ])('blocks %s data without repairing or taking a valid subset', (kind) => {
    const x = input([10, 10]);
    const d = x.dataset;
    if (kind === 'empty') d.candles = [];
    if (kind === 'duplicate')
      d.candles[1] = { ...d.candles[1], timestampUtcMs: START };
    if (kind === 'reverse') d.candles.reverse();
    if (kind === 'non-grid')
      d.candles[1] = { ...d.candles[1], timestampUtcMs: START + INTERVAL + 1 };
    if (kind === 'bad-open') d.candles[1] = { ...d.candles[1], open: NaN };
    if (kind === 'bad-ohlc') d.candles[1] = { ...d.candles[1], high: 1 };
    if (kind === 'negative-volume')
      d.candles[1] = { ...d.candles[1], volume: -1 };
    if (kind === 'unacknowledged')
      Object.assign(d, { warningsAcknowledged: false });
    if (kind === 'bad-quality') d.quality.totalRows++;
    if (kind === 'bad-hash') d.file.sha256 = 'bad';
    const before = JSON.stringify(x);
    expect(() => runBacktest(x)).toThrow();
    expect(JSON.stringify(x)).toBe(before);
  });

  it('validates malformed signals, quantities and unknown configuration', () => {
    for (const signals of [
      [buy(0), sell(0)],
      [buy(1), buy(0)],
      [buy(-1)],
      [buy(2)],
      [buy(0, '-1')],
      [buy(0, '1e-19')],
      [{ action: 'hold', candleIndex: 0, reason: 'hold', quantity: '1' }],
      [{ action: 'short', candleIndex: 0, reason: 'invalid' }],
    ])
      expect(() => runBacktest(input([10, 10], signals as Signal[]))).toThrow();
    for (const config of [
      { feeBps: -1 },
      { feeBps: 10000 },
      { buySlippageBps: 0.1 },
      { sellSlippageBps: NaN },
      { quantityDecimals: 19 },
      { initialCash: '-1' },
      { initialCash: '1e30' },
      { leverage: 2 },
    ])
      expect(() =>
        runBacktest({
          ...input([10]),
          config: config as Partial<BacktestConfig>,
        }),
      ).toThrow();
  });

  it('is byte-identical across runs and configuration key order; does not mutate inputs', () => {
    const x = input([10, 20, 15, 30], [buy(0), sell(2)]);
    const before = JSON.stringify(x);
    const a = runBacktest(x),
      b = runBacktest(x);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(x)).toBe(before);
    expect(
      runBacktest({
        ...x,
        config: { sellSlippageBps: 0, buySlippageBps: 0, feeBps: 0 },
      }),
    ).toEqual(a);
    expect(() => JSON.stringify(a)).not.toThrow();
    expect(a.manifest.dataHash).not.toBe(a.manifest.sourceFileSha256);
    expect(a.manifest.dataHash).toMatch(/^[a-f0-9]{64}$/);
    expect(
      runBacktest({ ...x, config: { feeBps: 1 } }).manifest.runHash,
    ).not.toBe(a.manifest.runHash);
    expect(
      runBacktest({ ...x, signals: [buy(0, '1')] }).manifest.signalHash,
    ).not.toBe(a.manifest.signalHash);
  });

  it('historical fills, signal events and close snapshots are unchanged by appended/changed future candles', () => {
    const prefix = input([10, 20, 15], [buy(0), sell(1), buy(2)]);
    const p = runBacktest(prefix);
    for (const future of [
      [1e20, 1e-10],
      [2, 3],
      [1000, 500],
    ]) {
      const x = input([10, 20, 15, ...future], prefix.signals);
      const full = runBacktest(x);
      expect(full.fills.filter((f) => f.candleIndex < 3)).toEqual(p.fills);
      expect(full.closes.slice(0, 3)).toEqual(p.closes);
      expect(full.signals).toEqual(p.signals);
      expect(full.orders.slice(0, 2)).toEqual(p.orders.slice(0, 2));
      expect(p.orders[2].status).toBe('expired');
      expect(full.orders[2].status).not.toBe('expired');
      expect(full.manifest.dataHash).not.toBe(p.manifest.dataHash);
    }
  });

  it('checks canonical hash against independent Node SHA-256, including Chinese and surrogate pairs', () => {
    const value = { z: '人工🪙', a: [1, '0.1', true, null] };
    const ascii =
      '{"a":[1,"0.1",true,null],"z":"\\u4eba\\u5de5\\ud83e\\ude99"}';
    expect(canonicalJson(value)).toBe(ascii);
    expect(contentHash(value)).toBe(
      createHash('sha256').update(ascii, 'ascii').digest('hex'),
    );
    expect(contentHash({ a: value.a, z: value.z })).toBe(contentHash(value));
    const d = market([10]);
    const expectedTape = {
      symbol: d.symbol,
      intervalMs: INTERVAL,
      candles: [
        {
          timestampUtcMs: START,
          open: '10',
          high: '10',
          low: '10',
          close: '10',
          volume: '1',
        },
      ],
    };
    expect(runBacktest(input([10])).manifest.dataHash).toBe(
      createHash('sha256').update(canonicalJson(expectedTape)).digest('hex'),
    );
  });

  it.each([
    'cash',
    'quantity',
    'fee',
    'price',
    'total',
    'delta',
    'sequence',
    'event-time',
    'reorder',
  ])('independent ledger auditor rejects altered %s', (kind) => {
    const r = runBacktest(input([100, 100, 110], [buy(0, '2'), sell(1)]));
    if (kind === 'cash') r.fills[0].after.cash = '999';
    if (kind === 'quantity') r.fills[0].after.position.quantity = '3';
    if (kind === 'fee') r.fills[0].fee = '1';
    if (kind === 'price') r.fills[0].price = '1';
    if (kind === 'total') r.fills[0].totals.fees = '99';
    if (kind === 'delta') r.fills[0].delta.equity = '99';
    if (kind === 'sequence') r.fills[0].sequence = 2;
    if (kind === 'event-time') r.fills[1].timestampUtcMs = START;
    if (kind === 'reorder') r.fills.reverse();
    expect(() => assertLedger('1000', r.fills, r.manifest.config)).toThrow(
      /Ledger/,
    );
  });

  it('accumulates 999 round trips with exact decimal conservation', () => {
    const n = 1999;
    const signals = Array.from({ length: n - 1 }, (_, i) =>
      i % 2 === 0 ? buy(i, '0.1') : sell(i, '0.1'),
    );
    const r = runBacktest({
      ...input(
        Array.from({ length: n }, () => 0.3),
        signals,
      ),
      config: { feeBps: 1, buySlippageBps: 0, sellSlippageBps: 0 },
    });
    // 1998 legs * (0.3 * 0.1 * .0001) = .005994 fees; no price gain/loss.
    expect(r.final.cash).toBe('999.994006');
    expect(r.final.position.quantity).toBe('0');
    expect(r.fills.at(-1)?.totals.fees).toBe('0.005994');
    assertLedger('1000', r.fills, r.manifest.config);
  });

  it('parses decimal boundaries exactly; never silently rounds inputs', () => {
    expect(decimal(parseDecimal('1.230000e-2'))).toBe('0.0123');
    expect(decimal(parseDecimal('1e-18'))).toBe('0.000000000000000001');
    for (const v of [
      '',
      'NaN',
      'Infinity',
      '0x10',
      '-1',
      '.1',
      '1e-19',
      '1'.repeat(129),
    ])
      expect(() => parseDecimal(v)).toThrow();
  });
});
