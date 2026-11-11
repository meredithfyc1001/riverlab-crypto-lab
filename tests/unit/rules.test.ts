import { describe, expect, it } from 'vitest';
import {
  createStrategy,
  defaultRule,
  normalizeRule,
  normalizeStrategy,
  RULE_STRATEGY_VERSION,
} from '../../src/core/strategies';
import type { RuleCondition, StrategyRuleV1 } from '../../src/core/strategies';
import { runBacktest } from '../../src/core/backtests';
import {
  analyzeExperiment,
  sealRiskStudy,
  verifyRiskStudy,
} from '../../src/core/risk-analysis';
import {
  runExperiment,
  sealExperiment,
  verifyExperiment,
} from '../../src/core/experiments';
import { canonicalJson, contentHash } from '../../src/core/backtests/identity';
import {
  sealRule,
  parseRuleJson,
  verifyRuleRecord,
} from '../../src/core/rule-library';
import { runResearch } from '../../src/core/research';
import { market, START, INTERVAL } from '../fixtures/backtest';
import references from '../fixtures/rules-reference.json';
const single = (condition: RuleCondition): StrategyRuleV1 => ({
  ...defaultRule(),
  buy: { enabled: true, operator: 'AND', conditions: [condition] },
  sell: { ...defaultRule().sell, enabled: false },
});
const price: RuleCondition = {
  kind: 'price-ma',
  average: 'MA',
  period: 1,
  operator: 'gte',
  enabled: true,
};
const run = (closes: number[], rule = defaultRule(), risk = {}) =>
  runBacktest({
    dataset: market(closes),
    completedThroughUtcMs: START + closes.length * INTERVAL,
    strategy: { kind: 'rules', rule },
    risk,
  });

describe('declarative streaming rules, independent Decimal100 reference', () => {
  it.each(references)('$name', (reference) => {
    const strategy = createStrategy(
      { kind: 'rules', rule: reference.rule as StrategyRuleV1 },
      INTERVAL,
    );
    const candles = market(reference.closes).candles;
    expect(
      candles.map((c) => strategy.onClose(Object.freeze({ ...c }))),
    ).toEqual(reference.expected);
    expect(strategy.version).toBe(RULE_STRATEGY_VERSION);
  });
  it('strictly excludes the current wick from breakout and includes historical wick/equality', () => {
    const rule = single({
      kind: 'breakout',
      lookback: 1,
      direction: 'above',
      enabled: true,
    });
    const strategy = createStrategy({ kind: 'rules', rule }, INTERVAL);
    const candles = market([100, 110, 120, 130]).candles;
    expect(strategy.onClose({ ...candles[0], high: 110 })).toEqual({
      action: 'hold',
      reason: 'rules-warmup',
    });
    expect(strategy.onClose({ ...candles[1], high: 1000 }).action).toBe('hold'); // equals past high
    expect(strategy.onClose(candles[2]).action).toBe('hold'); // current 120 below historical 1000
    expect(strategy.onClose({ ...candles[3], high: 9000 }).action).toBe('buy'); // own high excluded
  });
  it('does not treat OR warmup as false; disabled conditions do not warm up', () => {
    const rule = single(price);
    rule.buy.operator = 'OR';
    rule.buy.conditions.push({
      kind: 'rsi',
      period: 10,
      threshold: 100,
      operator: 'lte',
      enabled: true,
    });
    expect(
      run([100, 101, 102], rule).signals.every(
        (s) => s.signal.reason === 'rules-warmup',
      ),
    ).toBe(true);
    rule.buy.conditions[1].enabled = false;
    expect(
      run([100, 101, 102], rule).signals.map((s) => s.signal.action),
    ).toEqual(['buy', 'hold', 'hold']);
  });
  it('holds conflicts and consumes both edges without deferring an unsafe action', () => {
    const r = single(price);
    r.sell = structuredClone(r.buy);
    expect(run([100, 101, 99], r).signals.map((s) => s.signal.reason)).toEqual([
      'rules-conflict',
      'rules-conflict',
      'rules-conflict',
    ]);
    expect(run([100, 101, 99], r).fills).toEqual([]);
  });
  it('does not release a buy deferred by conflict or retry after a protective exit', () => {
    const r = single(price);
    r.sell = {
      enabled: true,
      operator: 'AND',
      conditions: [{ ...price, period: 2, operator: 'gt' }],
    };
    expect(run([100, 110, 90], r).signals.map((s) => s.signal.reason)).toEqual([
      'rules-warmup',
      'rules-conflict',
      'rules-repeat',
    ]);
    const protectedRun = run([100, 110, 80, 70, 120], single(price), {
      stopLossBps: 100,
    });
    expect(protectedRun.fills.map((f) => f.side)).toEqual(['buy', 'sell']);
    expect(
      protectedRun.signals
        .slice(1)
        .every((s) => s.signal.reason === 'rules-repeat'),
    ).toBe(true);
  });
  it('uses next-open, no duplicate fills, expires last-root signal, no final liquidation', () => {
    const result = run([100, 110, 120], single(price));
    expect(result.fills.map((f) => [f.candleIndex, f.side])).toEqual([
      [1, 'buy'],
    ]);
    expect(result.final.position.quantity).not.toBe('0');
    expect(run([100], single(price)).orders[0]).toMatchObject({
      status: 'expired',
      reason: 'no-next-candle',
    });
    const never = single({ ...price, operator: 'gt' });
    expect(run([100, 100, 100], never).fills).toEqual([]);
  });
  it('keeps original position-side rejection and risk protection rules', () => {
    const flatSell = single(price);
    flatSell.buy.enabled = false;
    flatSell.sell = { ...flatSell.sell, enabled: true, conditions: [price] };
    expect(run([100, 100], flatSell).orders[0]).toMatchObject({
      status: 'rejected',
      reason: 'position-already-flat',
    });
    const r = single({ ...price, period: 2, operator: 'gt' });
    const again = run([100, 110, 100, 110, 120], r);
    expect(
      again.orders.some(
        (o) => o.status === 'rejected' && o.reason === 'position-already-open',
      ),
    ).toBe(true);
    const protectedRun = run([100, 110, 80, 70], single(price), {
      stopLossBps: 100,
    });
    expect(protectedRun.fills.map((f) => f.side)).toEqual(['buy', 'sell']);
    expect(protectedRun.fills[1].reason).toBe('stop-loss');
  });
  it.each([
    defaultRule(),
    single(price),
    references.find((r) => r.name === 'OR dual')!.rule as StrategyRuleV1,
  ])(
    'preserves every historical signal, fill and close when future is appended %#',
    (rule) => {
      const closes = [100, 100, 95, 110, 120, 90, 85, 115, 125, 90, 100, 120];
      const full = run(closes, rule);
      for (let n = 1; n <= closes.length; n++) {
        const prefix = run(closes.slice(0, n), rule);
        expect(full.signals.slice(0, n)).toEqual(prefix.signals);
        expect(full.fills.filter((f) => f.candleIndex < n)).toEqual(
          prefix.fills,
        );
        expect(full.closes.slice(0, n)).toEqual(prefix.closes);
      }
    },
  );
  it('normalizes a deep snapshot, freezes runtime config and produces byte-identical hashes/results', () => {
    const r = defaultRule(),
      s = createStrategy({ kind: 'rules', rule: r }, INTERVAL);
    r.buy.conditions[0].enabled = false;
    expect(
      (s.config as { kind: 'rules'; rule: StrategyRuleV1 }).rule.buy
        .conditions[0].enabled,
    ).toBe(true);
    expect(
      Object.isFrozen(
        (s.config as { kind: 'rules'; rule: StrategyRuleV1 }).rule.buy
          .conditions,
      ),
    ).toBe(true);
    const a = run([100, 90, 110, 120, 80, 90, 110]),
      b = run([100, 90, 110, 120, 80, 90, 110]);
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(a.manifest.runHash).toBe(b.manifest.runHash);
    const changed = defaultRule();
    changed.revision++;
    expect(
      run([100, 90, 110, 120, 80, 90, 110], changed).manifest.runHash,
    ).not.toBe(a.manifest.runHash);
  });
  it('rule experiments reopen without the library and editing never changes old payload', () => {
    const dataset = market([100, 100, 95, 110, 120, 90, 85, 115]);
    const rule = defaultRule();
    const payload = runExperiment({
      dataset,
      strategy: { kind: 'rules', rule },
      completedThroughUtcMs: START + dataset.candles.length * INTERVAL,
    });
    const e = sealExperiment(payload, {
      id: 'rule-experiment',
      name: '规则实验',
      createdUtcMs: START,
      elapsedMs: 1,
    });
    const hash = contentHash(e);
    rule.buy.conditions[0].enabled = false;
    expect(verifyExperiment(JSON.parse(JSON.stringify(e)))).toEqual(e);
    expect(contentHash(e)).toBe(hash);
  });
  it('reproduces risk studies sourced from verified rule experiments without changing historical risk schema', () => {
    const closes = Array.from(
      { length: 48 },
      (_, i) => 100 + (i % 12 < 6 ? i % 6 : 6 - (i % 6)),
    );
    const dataset = market(closes);
    const e = sealExperiment(
      runExperiment({
        dataset,
        strategy: { kind: 'rules', rule: defaultRule() },
        completedThroughUtcMs: START + closes.length * INTERVAL,
      }),
      {
        id: 'rule-risk-source',
        name: '规则来源',
        createdUtcMs: START,
        elapsedMs: 1,
      },
    );
    const payload = analyzeExperiment(e, {
      method: 'iid',
      seed: 42,
      paths: 20,
      steps: 12,
      blockSize: 1,
      thresholdPct: 95,
    });
    const study = sealRiskStudy(payload, {
      id: 'rule-risk',
      name: '规则风险参考',
      createdUtcMs: START,
      elapsedMs: 1,
    });
    expect(verifyRiskStudy(JSON.parse(JSON.stringify(study)))).toEqual(study);
    expect(payload.source.input.strategy).toEqual(
      e.payload.result.manifest.strategy!.config,
    );
  });
  it('rejects rule candidates at the research boundary without mapping to a built-in', () => {
    expect(() =>
      runResearch({
        dataset: market([100, 101]),
        completedThroughUtcMs: START + 2 * INTERVAL,
        candidates: [{ kind: 'rules', rule: defaultRule() }],
        evaluation: { kind: 'full' },
      }),
    ).toThrow('暂不支持');
  });
  it('rejects bad or noncontiguous single completed candles and price underflow', () => {
    const s = createStrategy({ kind: 'rules', rule: defaultRule() }, INTERVAL),
      c = market([100]).candles[0];
    expect(() => s.onClose({ ...c, close: NaN })).toThrow();
    s.onClose(c);
    expect(() => s.onClose(c)).toThrow();
    expect(() =>
      createStrategy({ kind: 'rules', rule: defaultRule() }, 0),
    ).toThrow();
    expect(() =>
      createStrategy({ kind: 'rules', rule: defaultRule() }, INTERVAL).onClose({
        ...c,
        open: 1e-19,
        high: 1e-19,
        low: 1e-19,
        close: 1e-19,
      }),
    ).toThrow();
  });
});
describe('strict DSL and portable immutable versions', () => {
  const invalid: [string, (r: StrategyRuleV1) => void][] = [
    ['unknown root', (r) => Object.assign(r, { script: 'alert(1)' })],
    ['bad version', (r) => Object.assign(r, { schemaVersion: 2 })],
    ['zero revision', (r) => (r.revision = 0)],
    ['string revision', (r) => Object.assign(r, { revision: '1' })],
    ['empty group', (r) => (r.buy.conditions = [])],
    [
      'six conditions',
      (r) => (r.buy.conditions = Array.from({ length: 6 }, () => price)),
    ],
    [
      'both off',
      (r) => {
        r.buy.enabled = false;
        r.sell.enabled = false;
      },
    ],
    [
      'all disabled',
      (r) => r.buy.conditions.forEach((c) => (c.enabled = false)),
    ],
    ['nested groups', (r) => Object.assign(r.buy, { children: [] })],
    ['bad operator', (r) => Object.assign(r.buy, { operator: 'XOR' })],
    ['boolean string', (r) => Object.assign(r.buy, { enabled: 'true' })],
    [
      'condition unknown',
      (r) => Object.assign(r.buy.conditions[0], { futureIndex: 1 }),
    ],
    ['bad kind', (r) => Object.assign(r.buy.conditions[0], { kind: 'js' })],
    ['empty condition', (r) => (r.buy.conditions = [{} as RuleCondition])],
    [
      'period string',
      (r) => Object.assign(r.buy.conditions[0], { fastPeriod: '2' }),
    ],
    ['NaN', (r) => Object.assign(r.buy.conditions[0], { fastPeriod: NaN })],
    [
      'Infinity',
      (r) => Object.assign(r.buy.conditions[0], { slowPeriod: Infinity }),
    ],
    [
      'zero period',
      (r) => Object.assign(r.buy.conditions[0], { fastPeriod: 0 }),
    ],
    [
      'fraction',
      (r) => Object.assign(r.buy.conditions[0], { fastPeriod: 1.5 }),
    ],
    [
      'out of range',
      (r) => Object.assign(r.buy.conditions[0], { slowPeriod: 50001 }),
    ],
    [
      'equal fast slow',
      (r) => Object.assign(r.buy.conditions[0], { fastPeriod: 5 }),
    ],
    [
      'unknown average',
      (r) => Object.assign(r.buy.conditions[0], { average: 'WMA' }),
    ],
    [
      'bad direction',
      (r) => Object.assign(r.buy.conditions[0], { direction: 'future' }),
    ],
    [
      'bad RSI',
      (r) =>
        (r.buy.conditions = [
          {
            kind: 'rsi',
            enabled: true,
            period: 2,
            operator: 'lte',
            threshold: 101,
          },
        ]),
    ],
    [
      'negative RSI',
      (r) =>
        (r.buy.conditions = [
          {
            kind: 'rsi',
            enabled: true,
            period: 2,
            operator: 'lte',
            threshold: -1,
          },
        ]),
    ],
    [
      'bad breakout',
      (r) =>
        (r.buy.conditions = [
          { kind: 'breakout', enabled: true, lookback: 0, direction: 'above' },
        ]),
    ],
    [
      'missing field',
      (r) => Reflect.deleteProperty(r.buy.conditions[0], 'enabled'),
    ],
    [
      'disabled invalid',
      (r) => {
        r.sell.enabled = false;
        Object.assign(r.sell.conditions[0], { slowPeriod: NaN });
      },
    ],
  ];
  it.each(invalid)('rejects %s', (_, mutate) => {
    const r = defaultRule();
    mutate(r);
    expect(() => normalizeRule(r)).toThrow();
  });
  it.each([null, [], 1, 'rule', Object.create(null)])(
    'rejects non-plain DSL %s',
    (v) => expect(() => normalizeRule(v)).toThrow(),
  );
  it('requires exact strategy wrapper fields and canonical portable content', () => {
    expect(() =>
      normalizeStrategy({
        kind: 'rules',
        rule: defaultRule(),
        url: 'https://bad',
      } as never),
    ).toThrow();
    const r = sealRule(defaultRule(), {
      familyId: 'family',
      name: '中文 策略',
      createdUtcMs: START,
    });
    expect(parseRuleJson(JSON.stringify(r))).toEqual(r);
    expect(() => verifyRuleRecord({ ...r, format: 'bad' })).toThrow();
    expect(() => parseRuleJson(JSON.stringify({ ...r, evil: true }))).toThrow();
    const bad = structuredClone(r);
    bad.rule.revision++;
    expect(() => verifyRuleRecord(bad)).toThrow();
    expect(() => parseRuleJson('{')).toThrow();
    expect(() => parseRuleJson(' '.repeat(128 * 1024 + 1))).toThrow('128KiB');
  });
});
