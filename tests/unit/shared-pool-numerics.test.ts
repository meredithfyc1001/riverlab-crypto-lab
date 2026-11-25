// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { analyzeCsv } from '../../src/core/data';
import { makeDataset } from '../../src/core/data/dataset';
import { readUnits } from '../../src/core/math';
import { sealRule } from '../../src/core/rule-library';
import { createStrategy, defaultRule } from '../../src/core/strategies';
import { runSharedPool } from '../../src/core/shared-pool';
import type { SharedPoolInput } from '../../src/core/shared-pool';
import { INTERVAL, START } from '../fixtures/backtest';
import { options } from '../fixtures/dataset';
import vectors from '../fixtures/shared-pool-reference.json';

type Spec = (typeof vectors)[number]['spec'];
function input(
  spec: Spec,
  length = spec.assets[0].bars.length,
): SharedPoolInput {
  const common = {
    quoteCurrency: 'USDT',
    initialCash: spec.initialCash,
    rangeConfirmed: true as const,
    startUtcMs: START,
    endUtcMs: START + (length - 1) * INTERVAL,
    completedThroughUtcMs: START + length * INTERVAL,
  };
  const assets = spec.assets.map((a) => {
    const csv = [
      'timestamp,open,high,low,close,volume',
      ...a.bars
        .slice(0, length)
        .map((prices, i) => [START + i * INTERVAL, ...prices, 1].join(',')),
    ].join('\n');
    const dataset = makeDataset(
      {
        id: a.symbol,
        name: '整数参考样本',
        symbol: a.symbol,
        createdUtcMs: START,
        source: { kind: 'synthetic', label: '人工合成', note: '独立数值参考' },
        file: {
          name: 'oracle.csv',
          parserVersion: 'csv-v1',
          bytes: Buffer.byteLength(csv),
          sha256: createHash('sha256').update(csv).digest('hex'),
        },
        warningsAcknowledged: true,
        parsing: options,
      },
      analyzeCsv(csv, options),
    );
    return { dataset, weightPercent: a.weightPercent, costs: a.costs };
  });
  return spec.rebalanceEvery
    ? {
        ...common,
        mode: 'rebalance',
        assets,
        cashWeightPercent: spec.cashWeightPercent,
        rebalanceEvery: spec.rebalanceEvery,
      }
    : {
        ...common,
        mode: 'shared-strategy',
        assets: assets.map((a, i) => ({
          ...a,
          risk: spec.assets[i].risk,
          strategy: { kind: 'breakout', lookback: 1 },
        })),
      };
}

function named(name: string) {
  const scenario = vectors.find((v) => v.spec.name === name);
  if (!scenario) throw new Error('Missing reference ' + name);
  return input(scenario.spec);
}

const amount = (v: string) =>
  v.startsWith('-') ? -readUnits(v.slice(1)) : readUnits(v);

describe('shared portfolio independent integer reference', () => {
  it.each(vectors)(
    'matches every fill, cash flow, budget, weight, benchmark and drawdown for $spec.name',
    ({ spec, expected }) => {
      const r = runSharedPool(input(spec));
      expect(r.fillCount).toBe(expected.fills.length);
      expect(r.orders.filter((o) => o.status === 'filled')).toMatchObject(
        expected.fills,
      );
      expect(
        r.orders.filter(
          (o) => o.requestedBudget !== null && amount(o.requestedBudget) > 0n,
        ),
      ).toMatchObject(expected.grants);
      for (const rejection of expected.rejects)
        expect(r.orders).toContainEqual(
          expect.objectContaining({ ...rejection, status: 'rejected' }),
        );
      expect(r.assets).toMatchObject(expected.assets);
      expect(r.rebalances).toMatchObject(expected.rebalances);
      expect(r.fees).toBe(expected.fees);
      expect(r.netPnl).toBe(expected.netPnl);
      expect(r.maxDrawdown).toBe(expected.maxDrawdown);
      expect(r.benchmarkReturn).toBe(expected.benchmarkReturn);
      expect(r.benchmarkReasons.map((v) => v.symbol)).toEqual(
        expected.benchmarkRejects,
      );
      for (const reason of r.benchmarkReasons)
        expect(reason.reason).toBeTruthy();
      expect(r.curve).toHaveLength(expected.curve.length);
      for (const [index, { weights, ...point }] of expected.curve.entries()) {
        expect(r.curve[index]).toMatchObject({
          ...point,
          timestampUtcMs: START + index * INTERVAL,
          weightsPercent: weights.slice(0, -1),
          cashWeightPercent: weights.at(-1),
        });
      }
    },
  );

  it.each(vectors)(
    'independently replays the public journal for $spec.name',
    ({ spec }) => {
      const r = runSharedPool(input(spec));
      let cash = amount(spec.initialCash),
        fees = 0n,
        cursor = 0;
      const quantities = new Map(r.assets.map((a) => [a.symbol, 0n]));
      const orderIds = new Set<string>();
      for (
        let barIndex = 0;
        barIndex < spec.assets[0].bars.length;
        barIndex++
      ) {
        while (
          cursor < r.orders.length &&
          r.orders[cursor].barIndex === barIndex
        ) {
          const o = r.orders[cursor++];
          expect(o.sequence).toBe(cursor);
          const key = [o.barIndex, o.phase, o.symbol].join(' ');
          expect(orderIds.has(key)).toBe(false);
          orderIds.add(key);
          expect(o.barOpenUtcMs).toBe(START + barIndex * INTERVAL);
          expect(amount(o.cashBefore)).toBe(cash);
          let qty = quantities.get(o.symbol)!;
          expect(amount(o.quantityBefore)).toBe(qty);
          const cost = amount(o.notional),
            fee = amount(o.fee);
          if (o.status === 'filled') {
            expect(o.rejection).toBeNull();
            const delta = amount(o.quantity);
            expect(delta).toBeGreaterThan(0n);
            qty += o.side === 'buy' ? delta : -delta;
            cash += o.side === 'buy' ? -cost - fee : cost - fee;
            fees += fee;
            quantities.set(o.symbol, qty);
          } else {
            expect(o.rejection).toBeTruthy();
            expect([o.quantity, o.notional, o.fee]).toEqual(['0', '0', '0']);
          }
          if (o.side === 'buy') {
            expect(amount(o.approvedBudget!)).toBeLessThanOrEqual(
              amount(o.requestedBudget!),
            );
            expect(amount(o.unusedBudget!)).toBe(
              amount(o.approvedBudget!) - cost - fee,
            );
          }
          expect(amount(o.cashAfter)).toBe(cash);
          expect(amount(o.quantityAfter)).toBe(qty);
          expect(cash).toBeGreaterThanOrEqual(0n);
          expect(qty).toBeGreaterThanOrEqual(0n);
        }
        const close = r.curve[barIndex + 1];
        const marked = spec.assets.reduce(
          (sum, a) =>
            sum +
            (quantities.get(a.symbol)! * amount(String(a.bars[barIndex][3]))) /
              10n ** 18n,
          0n,
        );
        expect(amount(close.cash)).toBe(cash);
        expect(amount(close.equity)).toBe(cash + marked);
        expect(
          close.contributions.reduce((sum, n) => sum + amount(n), 0n),
        ).toBe(cash + marked - amount(spec.initialCash));
      }
      expect(cursor).toBe(r.orders.length);
      expect(amount(r.fees)).toBe(fees);
      for (const a of r.allocations) {
        const buys = r.orders.filter(
          (o) => o.barIndex === a.barIndex && o.side === 'buy',
        );
        expect(buys.reduce((s, o) => s + amount(o.approvedBudget!), 0n)).toBe(
          amount(a.approved),
        );
        expect(amount(a.approved)).toBeLessThanOrEqual(amount(a.capacity));
        expect(amount(a.spent)).toBe(
          amount(a.cashBeforeBuys) - amount(a.cashAfterBuys),
        );
        expect(amount(a.cashAfterBuys)).toBeGreaterThanOrEqual(0n);
      }
    },
  );

  it.each(vectors)(
    'keeps every historical prefix causal and deterministic for $spec.name',
    ({ spec }) => {
      const full = runSharedPool(input(spec));
      expect(
        runSharedPool(input({ ...spec, assets: [...spec.assets].reverse() })),
      ).toEqual(full);
      expect(runSharedPool(input(JSON.parse(JSON.stringify(spec))))).toEqual(
        full,
      );
      for (let size = 1; size < spec.assets[0].bars.length; size++) {
        const r = runSharedPool(input(spec, size));
        expect(r.curve).toEqual(full.curve.slice(0, size + 1));
        for (const key of [
          'orders',
          'decisions',
          'allocations',
          'rebalances',
        ] as const)
          expect(r[key]).toEqual(full[key].filter((e) => e.barIndex < size));
      }
    },
  );

  it('keeps a rejected buy budget in cash after simultaneously funding four named assets', () => {
    const r = runSharedPool(named('five-way-clock'));
    const requests = r.orders.filter(
      (o) =>
        o.barIndex === 4 &&
        o.requestedBudget !== null &&
        amount(o.requestedBudget) > 0n,
    );
    expect(requests).toHaveLength(4);
    expect(
      requests.every(
        (o) => amount(o.approvedBudget!) < amount(o.requestedBudget!),
      ),
    ).toBe(true);
    expect(requests.at(-1)).toMatchObject({
      rejection: 'below-min-notional',
      unusedBudget: requests.at(-1)!.approvedBudget,
    });
    const round = r.allocations.find((a) => a.barIndex === 4)!;
    expect(amount(round.approved)).toBe(amount(round.capacity));
    expect(
      amount(round.cashAfterBuys) - amount(round.reserve),
    ).toBeGreaterThanOrEqual(amount(requests.at(-1)!.approvedBudget!));
  });

  it('includes actual opening sale proceeds in budgets and excludes a later intrabar dual-trigger exit', () => {
    const sell = runSharedPool(named('sell-proceeds')).orders.filter(
      (o) => o.barIndex === 5 && o.status === 'filled',
    );
    expect(sell.map((o) => o.side)).toEqual(['sell', 'buy', 'buy']);
    expect(
      amount(sell[1].approvedBudget!) + amount(sell[2].approvedBudget!),
    ).toBeGreaterThan(amount(sell[0].cashBefore));
    const r = runSharedPool(named('late-dual-trigger'));
    const orders = r.orders.filter(
      (o) => o.barIndex === 4 && o.status === 'filled',
    );
    expect(orders[0]).toMatchObject({
      symbol: 'BBB/USDT',
      side: 'buy',
      requestedBudget: '496',
      approvedBudget: '400',
    });
    expect(orders[1]).toMatchObject({
      phase: 'protection-after-buys',
      side: 'sell',
      trigger: { kind: 'stop-loss', assumption: 'ambiguous-stop-first' },
    });
    expect(amount(orders[1].cashAfter)).toBeGreaterThan(
      amount(orders[0].approvedBudget!),
    );
  });

  it('resolves same-bar protection/strategy conflicts and preserves a rejected exit', () => {
    const gap = runSharedPool(named('gap-protects-first')).orders.filter(
      (o) => o.barIndex === 4 && o.symbol === 'AAA/USDT',
    );
    expect(gap).toMatchObject([
      { phase: 'protection-open', status: 'filled', referencePrice: '150' },
      { phase: 'buy', status: 'rejected', rejection: 'risk-priority' },
    ]);
    const failed = runSharedPool(named('failed-protection')).orders.filter(
      (o) => o.barIndex === 3 && o.symbol === 'AAA/USDT',
    );
    expect(failed).toMatchObject([
      {
        phase: 'protection-open',
        status: 'rejected',
        rejection: 'below-min-notional',
      },
      { phase: 'sell', status: 'rejected', rejection: 'risk-priority' },
    ]);
    for (const o of failed) expect(o.quantityAfter).toBe(o.quantityBefore);
  });

  it('keeps partial lots, signed residual deviations and nonzero cash reserve visible', () => {
    const r = runSharedPool(named('partial-rebalance'));
    expect(r.rebalances.map((v) => v.barIndex)).toEqual([2, 4, 6, 8]);
    expect(r.decisions.map((v) => v.barIndex)).toEqual([1, 3, 5, 7]);
    expect(
      r.orders.some(
        (o) =>
          o.side === 'sell' &&
          o.status === 'filled' &&
          amount(o.quantityAfter) > 0n,
      ),
    ).toBe(true);
    expect(
      r.orders.some(
        (o) =>
          o.side === 'buy' &&
          o.status === 'filled' &&
          amount(o.quantityBefore) > 0n,
      ),
    ).toBe(true);
    expect(
      r.rebalances.some((z) =>
        z.deviationPercent.some((p) => p !== null && amount(p) !== 0n),
      ),
    ).toBe(true);
    expect(r.allocations.every((a) => amount(a.reserve) > 0n)).toBe(true);
  });

  it('starts immutable rule versions and built-ins on only their selected completed bars', () => {
    const entry = named('five-way-clock');
    if (entry.mode !== 'shared-strategy') throw new Error('wrong scenario');
    entry.startUtcMs += 2 * INTERVAL;
    const rule = sealRule(
      { ...defaultRule(), revision: 2 },
      { familyId: 'shared-test', name: '不可变版本', createdUtcMs: START },
    );
    entry.assets[0].strategy = { kind: 'rules', rule: rule.rule };
    entry.assets[0].ruleRecord = rule;
    entry.assets[1].strategy = { kind: 'ma', fastPeriod: 1, slowPeriod: 2 };
    entry.assets[2].strategy = { kind: 'rsi', period: 2 };
    const r = runSharedPool(entry);
    for (const a of entry.assets) {
      const strat = createStrategy(a.strategy, INTERVAL);
      const trace = a.dataset.candles.slice(2).map((b) => strat.onClose(b));
      expect(
        r.decisions
          .filter((v) => v.symbol === a.dataset.symbol)
          .map(({ action, reason }) => ({ action, reason })),
      ).toEqual(trace);
    }
    entry.assets[0].ruleRecord = { ...rule, ruleHash: '0'.repeat(64) };
    expect(() => runSharedPool(entry)).toThrow();
  });
});

describe('shared clock validation', () => {
  it.each(['sell-proceeds', 'partial-rebalance'])(
    'rejects data outside its clock in %s',
    (name) => {
      const build = () => named(name);
      const gap = build();
      const bars = gap.assets[0].dataset.candles;
      bars[1] = { ...bars[1], timestampUtcMs: bars[0].timestampUtcMs };
      expect(() => runSharedPool(gap)).toThrow();
      const mismatch = build();
      mismatch.assets[0].dataset.symbol = 'AAA/EUR';
      expect(() => runSharedPool(mismatch)).toThrow();
      const unfinished = build();
      unfinished.completedThroughUtcMs = unfinished.endUtcMs;
      expect(() => runSharedPool(unfinished)).toThrow();
      const samePair = build();
      samePair.assets[1].dataset.symbol =
        samePair.assets[0].dataset.symbol.replace('/', '-');
      expect(() => runSharedPool(samePair)).toThrow();
    },
  );
  it('requires exact totals, one control mode and a positive integer period', () => {
    const a = named('five-way-clock'),
      b = named('partial-rebalance');
    a.assets[0].weightPercent = '100.000000000000000001';
    expect(() => runSharedPool(a)).toThrow();
    if (b.mode !== 'rebalance') throw new Error('wrong scenario');
    expect(() =>
      runSharedPool({ ...b, cashWeightPercent: '10.000000000000000001' }),
    ).toThrow();
    expect(() => runSharedPool({ ...b, rebalanceEvery: 1.5 })).toThrow();
    expect(() =>
      runSharedPool({
        ...b,
        assets: b.assets.map((v) => ({ ...v, risk: { stopLossBps: 10 } })),
      }),
    ).toThrow();
    expect(() =>
      runSharedPool({
        ...b,
        assets: b.assets.map((v) => ({ ...v, strategy: { kind: 'breakout' } })),
      }),
    ).toThrow();
  });
});
