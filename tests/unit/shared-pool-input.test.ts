// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { runSharedPool } from '../../src/core/shared-pool';
import type { SharedPoolInput } from '../../src/core/shared-pool';
import { START, INTERVAL, market } from '../fixtures/backtest';
import { sealRule } from '../../src/core/rule-library';
import { defaultRule, RULE_STRATEGY_VERSION } from '../../src/core/strategies';
import { readUnits } from '../../src/core/math';

function plan(): Extract<SharedPoolInput, { mode: 'rebalance' }> {
  return {
    mode: 'rebalance',
    quoteCurrency: 'USDT',
    initialCash: '100',
    cashWeightPercent: '0',
    rebalanceEvery: 1,
    startUtcMs: START,
    endUtcMs: START + 3 * INTERVAL,
    completedThroughUtcMs: START + 4 * INTERVAL,
    rangeConfirmed: true,
    assets: ['A', 'B'].map((base) => ({
      dataset: { ...market([8, 9, 10, 11]), id: base, symbol: base + '/USDT' },
      weightPercent: '50',
      costs: {
        feeBps: 0,
        buySlippageBps: 0,
        sellSlippageBps: 0,
        quantityDecimals: 18,
        minNotional: '0',
      },
    })),
  };
}

function strategyPlan(): Extract<SharedPoolInput, { mode: 'shared-strategy' }> {
  const input = plan();
  return {
    mode: 'shared-strategy',
    quoteCurrency: input.quoteCurrency,
    initialCash: input.initialCash,
    startUtcMs: input.startUtcMs,
    endUtcMs: input.endUtcMs,
    completedThroughUtcMs: input.completedThroughUtcMs,
    rangeConfirmed: true,
    assets: input.assets.map((a) => ({
      ...a,
      strategy: { kind: 'breakout', lookback: 1 },
      risk: {},
    })),
  };
}
describe('shared portfolio input contracts', () => {
  it('accepts a 100% cash target and leaves the benchmark and weights in cash', () => {
    const p = plan();
    for (const a of p.assets) a.weightPercent = '0';
    p.cashWeightPercent = '100';
    const r = runSharedPool(p);
    expect(r.orders).toEqual([]);
    expect(r.benchmarkReasons).toEqual([]);
    for (const point of r.curve) {
      expect(point).toMatchObject({
        equity: '100',
        benchmarkEquity: '100',
        cashWeightPercent: '100',
        weightsPercent: ['0', '0'],
      });
    }
    expect(r.rebalances).toHaveLength(3);
  });
  it('rejects mixed or inaccurate scheduling and weights down to one atomic unit', () => {
    for (const k of ['strategy', 'risk', 'ruleRecord']) {
      const p = plan();
      Object.assign(p.assets[0], { [k]: {} });
      expect(() => runSharedPool(p)).toThrow(/未知/);
    }
    expect(() =>
      runSharedPool(Object.assign(strategyPlan(), { rebalanceEvery: 1 })),
    ).toThrow(/未知/);
    expect(() =>
      runSharedPool({ ...plan(), cashWeightPercent: '0.000000000000000001' }),
    ).toThrow(/100%/);
    expect(() => runSharedPool({ ...plan(), rebalanceEvery: 0.5 })).toThrow(
      /周期/,
    );
    const p = strategyPlan();
    p.assets[0].weightPercent = '50.000000000000000001';
    expect(() => runSharedPool(p)).toThrow(/100%/);
  });
  it('rejects an unclosed source bar beyond the selected historical range', () => {
    const p = plan();
    p.endUtcMs -= INTERVAL;
    p.completedThroughUtcMs--;
    expect(() => runSharedPool(p)).toThrow(/原始快照含未完成/);
  });
  it('starts each strategy inside the selected range even when the excluded prefix would produce a buy', () => {
    const p = strategyPlan();
    p.startUtcMs += 2 * INTERVAL;
    const r = runSharedPool(p);
    expect(r.decisions.slice(0, 2).map((d) => d.action)).toEqual([
      'hold',
      'hold',
    ]);
    expect(r.decisions.slice(2).map((d) => d.action)).toEqual(['buy', 'buy']);
    expect(r.orders).toEqual([]);
  });
  it('requires the recorded immutable revision when streaming custom rules', () => {
    const p = strategyPlan();
    const rule = sealRule(
      { ...defaultRule(), revision: 2 },
      { familyId: 'family', name: '固定版本', createdUtcMs: START },
    );
    p.assets[1].strategy = { kind: 'rules', rule: rule.rule };
    expect(() => runSharedPool(p)).toThrow();
    p.assets[1].ruleRecord = rule;
    expect(runSharedPool(p).assets[1].strategyVersion).toBe(
      RULE_STRATEGY_VERSION,
    );
    p.assets[1].strategy = {
      kind: 'rules',
      rule: { ...rule.rule, revision: 3 },
    };
    expect(() => runSharedPool(p)).toThrow(/规则版本不一致/);
  });
  it('rejects a one-atom entry whose configured stop rounds to zero before any cash or fee is booked', () => {
    const p = strategyPlan();
    for (const [i, a] of p.assets.entries()) {
      const prices = i === 0 ? [2e-18, 3e-18, 1e-18, 2e-18] : [1, 1, 1, 1];
      a.dataset = {
        ...market(prices),
        id: a.dataset.id,
        symbol: a.dataset.symbol,
      };
      a.risk = { stopLossBps: 1 };
      a.costs.feeBps = 10;
    }
    const r = runSharedPool(p);
    expect(
      r.orders.find((o) => o.barIndex === 2 && o.symbol === 'A/USDT'),
    ).toMatchObject({
      status: 'rejected',
      rejection: 'stop-price-underflow',
      quantity: '0',
      fee: '0',
      cashBefore: '100',
      cashAfter: '100',
      quantityBefore: '0',
      quantityAfter: '0',
      approvedBudget: '50',
      unusedBudget: '50',
    });
    expect(r.fillCount).toBe(0);
    expect(r.fees).toBe('0');
    expect(r.netPnl).toBe('0');
    expect(r.curve.every((c) => c.equity === '100')).toBe(true);
  });
  it('reduces positions whose internally derived quantity exceeds the external input bound', () => {
    const p = plan();
    p.initialCash = '1e29';
    for (const [i, a] of p.assets.entries()) {
      a.dataset = {
        ...market(i ? [1, 1, 1, 1] : [1e-18, 1e-18, 1e-17, 1e-17]),
        id: a.dataset.id,
        symbol: a.dataset.symbol,
      };
    }
    const r = runSharedPool(p);
    const reduction = r.orders.find(
      (o) => o.barIndex === 2 && o.phase === 'sell',
    )!;
    expect(reduction.status).toBe('filled');
    expect(readUnits(reduction.quantity)).toBeGreaterThan(readUnits('1e30'));
    expect(readUnits(reduction.quantityAfter)).toBeGreaterThan(0n);
  });
});
