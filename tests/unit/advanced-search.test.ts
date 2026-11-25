import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/core/backtests';
import {
  evaluateCandidate,
  parameterTargets,
  prepareAdvanced,
  previewAdvanced,
  rankTraining,
  runAdvanced,
  selectTraining,
} from '../../src/core/advanced-research';
import type {
  AdvancedInput,
  CandidateRow,
  ParameterAxis,
} from '../../src/core/advanced-research';
import { defaultRule } from '../../src/core/strategies';
import type { StrategyRuleV1 } from '../../src/core/strategies';
import { sealRule } from '../../src/core/rule-library';
import { market, START, INTERVAL } from '../fixtures/backtest';

function settings(rule = defaultRule()): AdvancedInput {
  return {
    dataset: market([
      100, 101, 105, 90, 99, 121, 132, 110, 90, 80, 110, 100, 100, 100, 200, 50,
    ]),
    completedThroughUtcMs: START + 16 * INTERVAL,
    ruleRecord: sealRule(rule, {
      familyId: 'research-rules',
      name: '合成规则',
      createdUtcMs: START,
    }),
    config: { ...DEFAULT_CONFIG },
    risk: {},
    regime: { lookback: 1, thresholdBps: 10 },
    axes: [
      {
        side: 'buy',
        condition: 0,
        field: 'fastPeriod',
        min: 1,
        max: 3,
        step: 1,
      },
    ],
    filters: {
      minReturn: null,
      maxDrawdown: null,
      minProfitFactor: null,
      minTrades: 0,
    },
    evaluation: { kind: 'split', trainBars: 10 },
    search: { kind: 'grid' },
    sort: ['totalReturn', 'maxDrawdown'],
  };
}

describe('saved rule candidate generation', () => {
  it('uses only enabled numeric fields and preserves immutable source identity', () => {
    const rule = defaultRule();
    rule.buy.conditions.push({
      enabled: true,
      kind: 'rsi',
      operator: 'lte',
      period: 3,
      threshold: 10,
    });
    rule.sell.conditions.push({
      enabled: false,
      kind: 'price-ma',
      average: 'EMA',
      period: 8,
      operator: 'lt',
    });
    const input = settings(rule);
    const original = JSON.stringify(input.ruleRecord);
    expect(
      parameterTargets(rule).map((t) => [
        t.side,
        t.condition,
        t.field,
        t.value,
      ]),
    ).toEqual([
      ['buy', 0, 'fastPeriod', 2],
      ['buy', 0, 'slowPeriod', 5],
      ['buy', 1, 'period', 3],
      ['buy', 1, 'threshold', 10],
      ['sell', 0, 'fastPeriod', 2],
      ['sell', 0, 'slowPeriod', 5],
    ]);
    input.axes.push({
      side: 'buy',
      condition: 1,
      field: 'threshold',
      min: 30.1,
      max: 30.3,
      step: 0.1,
    });
    const plan = prepareAdvanced(input);
    expect(plan.combinations).toBe(9);
    expect(plan.candidates.map((c) => c.values)).toEqual([
      [1, 30.1],
      [1, 30.2],
      [1, 30.3],
      [2, 30.1],
      [2, 30.2],
      [2, 30.3],
      [3, 30.1],
      [3, 30.2],
      [3, 30.3],
    ]);
    expect(plan.candidates[0].warmupBars).toBe(6);
    expect(plan).toMatchObject({ runs: 10, bars: 96, trailingBars: 0 });
    expect(plan.candidates[0].rule.buy.conditions[1]).toMatchObject({
      kind: 'rsi',
      threshold: 30.1,
      period: 3,
      operator: 'lte',
    });
    expect(plan.candidates[0].rule.sell).toEqual(rule.sell);
    plan.candidates[0].rule.buy.conditions.length = 0;
    expect(plan.candidates[1].rule.buy.conditions).toHaveLength(2);
    expect(JSON.stringify(input.ruleRecord)).toBe(original);
  });
  it('handles both EMA parameter kinds, tracks invalid combinations without running them', () => {
    const rule = defaultRule();
    rule.buy.conditions[0] = {
      enabled: true,
      kind: 'cross',
      average: 'EMA',
      fastPeriod: 2,
      slowPeriod: 3,
      direction: 'below',
    };
    rule.sell.conditions[0] = {
      enabled: true,
      kind: 'price-ma',
      average: 'EMA',
      period: 5,
      operator: 'lte',
    };
    const input = settings(rule);
    input.axes.push({
      side: 'sell',
      condition: 0,
      field: 'period',
      min: 3,
      max: 4,
      step: 1,
    });
    const { plan, folds } = runAdvanced(input);
    expect(plan.candidates.map((c) => c.values)).toEqual([
      [1, 3],
      [1, 4],
      [2, 3],
      [2, 4],
    ]);
    expect(plan.invalid.map((c) => c.values)).toEqual([
      [3, 3],
      [3, 4],
    ]);
    expect(plan.invalid[0].reason).toContain('快线小于慢线');
    expect(folds[0].train).toHaveLength(4);
    expect(folds[0].train.every((row) => row.runHash)).toBe(true);
  });
  it.each([
    { min: 0 },
    { min: 1.5 },
    { max: 50001 },
    { min: 4, max: 1 },
    { step: 0 },
    { step: 0.5 },
    { step: NaN },
    { condition: 1 },
    { side: '__proto__' },
    { field: 'direction' },
  ])('rejects invalid target or bound %j', (change) => {
    const input = settings();
    Object.assign(input.axes[0], change);
    expect(() => prepareAdvanced(input)).toThrow();
  });
  it('blocks malformed saved versions, invalid thresholds and repeated target definitions', () => {
    const rule = defaultRule();
    rule.buy.conditions[0] = {
      enabled: true,
      kind: 'rsi',
      operator: 'gte',
      period: 5,
      threshold: 70,
    };
    const input = settings(rule);
    input.axes = [
      {
        side: 'buy',
        condition: 0,
        field: 'threshold',
        min: 90,
        max: 101,
        step: 1,
      },
    ];
    expect(() => prepareAdvanced(input)).toThrow(/阈值/);
    input.axes[0].max = 100;
    input.axes.push({ ...input.axes[0] });
    expect(() => prepareAdvanced(input)).toThrow(/重复/);
    input.ruleRecord.name = '未经重新签名的名称';
    expect(() => prepareAdvanced(input)).toThrow(/校验/);
  });
  it('deduplicates parameter values that round to identical 5B numbers', () => {
    const rule = defaultRule();
    rule.buy.conditions[0] = {
      enabled: true,
      kind: 'rsi',
      operator: 'gte',
      period: 5,
      threshold: 70,
    };
    const input = settings(rule);
    input.axes = [
      {
        side: 'buy',
        condition: 0,
        field: 'threshold',
        min: 90,
        max: 90.00000000000001,
        step: 1e-17,
      },
    ];
    const result = prepareAdvanced(input).candidates;
    expect(result.map((c) => c.values[0])).toEqual([90, 90.00000000000001]);
  });
  it('fixes the random sample without replacement before any market data are used', () => {
    const input = settings();
    input.axes = [
      {
        side: 'sell',
        condition: 0,
        field: 'slowPeriod',
        min: 3,
        max: 35,
        step: 1,
      },
    ];
    input.search = { kind: 'random', count: 7, seed: 42 };
    const ids = prepareAdvanced(input).candidates.map((c) => c.id);
    // Independent stream-54 PCG32 and partial Fisher–Yates sampling.
    expect(ids).toEqual([4, 7, 10, 18, 20, 28, 32]);
    expect(new Set(ids).size).toBe(7);
    const other = settings();
    other.dataset = market(Array.from({ length: 16 }, () => 999));
    expect(
      prepareAdvanced({ ...input, dataset: other.dataset }).candidates.map(
        (c) => c.id,
      ),
    ).toEqual(ids);
    input.search.seed++;
    expect(prepareAdvanced(input).candidates.map((c) => c.id)).not.toEqual(ids);
    input.search.count = 34;
    expect(() => prepareAdvanced(input)).toThrow(/有效且互异/);
    input.search.seed = -1;
    expect(() => prepareAdvanced(input)).toThrow(/种子/);
  });
});

describe('window selection and budget', () => {
  it('records every filter rejection and retains valid metrics without evaluating an ineligible candidate out of sample', () => {
    const input = settings();
    input.filters = {
      minReturn: '1',
      maxDrawdown: '0',
      minProfitFactor: '10',
      minTrades: 100,
    };
    const { folds } = runAdvanced(input);
    expect(folds[0].selectedId).toBeNull();
    expect(folds[0].test).toBeNull();
    expect(
      folds[0].train.every(
        (row) =>
          row.metrics !== null &&
          row.reasons.some((r) => r.includes('交易次数')) &&
          row.reasons.some((r) => r.includes('收益率')) &&
          row.reasons.some((r) => r.includes('利润因子')),
      ),
    ).toBe(true);
    expect(folds[0].train[0].regimes?.map((r) => r.state)).toEqual([
      'BULL',
      'BEAR',
      'SIDEWAYS',
      'UNKNOWN',
    ]);
  });
  it('keeps failed subruns isolated and rejects attempts to mix test or other fold rows into selection', () => {
    const input = settings();
    const plan = prepareAdvanced(input);
    const failRule = JSON.parse(
      JSON.stringify(plan.candidates[0].rule),
    ) as StrategyRuleV1;
    failRule.buy.conditions = [];
    const failed = evaluateCandidate(
      input,
      { ...plan.candidates[0], rule: failRule },
      plan.windows[0],
    );
    const good = evaluateCandidate(input, plan.candidates[1], plan.windows[0]);
    expect(failed).toMatchObject({
      reasons: [expect.stringContaining('规则')],
      metrics: null,
      runHash: null,
    });
    expect(selectTraining(rankTraining(input, [failed, good]))).toBe(
      good.candidateId,
    );
    const test = evaluateCandidate(input, plan.candidates[0], plan.windows[1]);
    expect(() => rankTraining(input, [test])).toThrow(/训练窗口/);
    expect(() => selectTraining([test])).toThrow(/测试结果/);
    expect(() =>
      rankTraining(input, [
        good,
        { ...failed, window: { ...failed.window, fold: 1 } },
      ]),
    ).toThrow();
    expect(() => rankTraining(input, [good, good])).toThrow();
  });
  it('compares exact large or negative metrics with explicit priorities, NA last and grid-index ties', () => {
    const input = settings();
    const { train } = runAdvanced(input).folds[0];
    const row = (
      id: number,
      profitFactor: string | null,
      maxDrawdown: string,
      totalReturn: string,
    ): CandidateRow => ({
      ...train[0],
      candidateId: id,
      reasons: [],
      metrics: { ...train[0].metrics!, profitFactor, maxDrawdown, totalReturn },
    });
    const rows = [
      row(3, null, '0', '1'),
      row(2, '10000000000000000000000000', '0.1', '-0.05'),
      row(1, '10000000000000000000000000.000000000001', '0.2', '-0.05'),
      row(0, '10000000000000000000000000.000000000001', '0.2', '-0.05'),
    ];
    expect(
      rankTraining({ sort: ['profitFactor', 'maxDrawdown'] }, rows).map(
        (r) => r.candidateId,
      ),
    ).toEqual([0, 1, 2, 3]);
    expect(
      rankTraining(
        { sort: ['totalReturn', 'maxDrawdown', 'profitFactor'] },
        [...rows].reverse(),
      ).map((r) => r.candidateId),
    ).toEqual([3, 2, 0, 1]);
  });
  it('plans rolling work including locked tests, budgets only complete folds and discloses unused tails', () => {
    const input = settings();
    input.evaluation = { kind: 'rolling', trainBars: 5, testBars: 3 };
    expect(prepareAdvanced(input)).toMatchObject({
      trailingBars: 2,
      runs: 12,
      bars: 54,
    });
    const { dataset, completedThroughUtcMs, ...options } = input;
    expect(dataset.candles.length).toBe(16);
    expect(completedThroughUtcMs).toBeGreaterThan(START);
    const axis: ParameterAxis = {
      side: 'buy',
      condition: 0,
      field: 'slowPeriod',
      min: 3,
      max: 66,
      step: 1,
    };
    expect(() =>
      previewAdvanced(
        {
          ...options,
          axes: [axis],
          evaluation: { kind: 'split', trainBars: 30000 },
        },
        50000,
      ),
    ).toThrow(/预算/);
    expect(() =>
      previewAdvanced(
        {
          ...options,
          axes: [axis],
          evaluation: { kind: 'rolling', trainBars: 10, testBars: 10 },
        },
        60,
      ),
    ).toThrow(/预算/);
    expect(() =>
      previewAdvanced({ ...options, axes: [{ ...axis, max: 67 }] }, 16),
    ).toThrow(/64/);
    expect(() =>
      previewAdvanced({ ...options, axes: [{ ...axis, max: 2000 }] }, 16),
    ).toThrow(/枚举预算/);
  });
});
