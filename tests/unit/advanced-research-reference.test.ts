// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runAdvanced } from '../../src/core/advanced-research';
import type {
  AdvancedFold,
  AdvancedInput,
} from '../../src/core/advanced-research/types';
import { normalizeConfig } from '../../src/core/backtests';
import { analyzeCsv } from '../../src/core/data';
import { normalizeRisk } from '../../src/core/risk';
import { verifyRuleRecord } from '../../src/core/rule-library';
import record from '../fixtures/phase-5e-breakout-rule.json';
import reference from '../fixtures/advanced-research-reference.json';
import { INTERVAL, START, market } from '../fixtures/backtest';
import { options } from '../fixtures/dataset';

const source = readFileSync(
  new URL('../fixtures/phase-5e-rolling-synthetic.csv', import.meta.url),
  'utf8',
);
const prices = analyzeCsv(source, options).candles.map((bar) => bar.close);

function request(closes = prices): AdvancedInput {
  return {
    dataset: market(closes),
    ruleRecord: verifyRuleRecord(record),
    completedThroughUtcMs: START + closes.length * INTERVAL,
    config: normalizeConfig({
      initialCash: reference.initialCash,
      feeBps: reference.feeBps,
      buySlippageBps: reference.buySlippageBps,
      sellSlippageBps: reference.sellSlippageBps,
      quantityDecimals: reference.quantityDecimals,
    }),
    risk: normalizeRisk(),
    axes: [
      { side: 'buy', condition: 0, field: 'lookback', min: 1, max: 3, step: 1 },
    ],
    search: { kind: 'grid' },
    filters: {
      minReturn: null,
      maxDrawdown: null,
      minProfitFactor: null,
      minTrades: 0,
    },
    sort: ['totalReturn', 'maxDrawdown'],
    evaluation: { kind: 'rolling', trainBars: 24, testBars: 12 },
    regime: reference.regime,
  };
}

function expectFold(
  actual: AdvancedFold,
  expected: (typeof reference.rolling)[number] | typeof reference.split,
) {
  expect(actual.selectedId).toBe(expected.selectedLookback - 1);
  expect(
    actual.train.map(({ candidateId, metrics }) => ({
      lookback: candidateId + 1,
      metrics,
    })),
  ).toEqual(expected.train);
  expect(actual.train.map(({ window }) => [window.start, window.end])).toEqual(
    expected.train.map(() => expected.trainRange),
  );
  expect(actual.test?.candidateId).toBe(actual.selectedId);
  expect([actual.test?.window.start, actual.test?.window.end]).toEqual(
    expected.testRange,
  );
  expect(actual.test?.metrics).toEqual(expected.test);
  expect(
    actual.test?.regimes?.map(({ state, bars, netPnl }) => ({
      state,
      bars,
      netPnl,
    })),
  ).toEqual(expected.regimes);
}

describe('Phase 5E independent whole-lot optimization oracle', () => {
  it('locks each rolling winner on training and matches the independent cash, returns, drawdowns, trades and lagged state sums', () => {
    const actual = runAdvanced(request());
    expect(actual.folds).toHaveLength(2);
    reference.rolling.forEach((expected, i) =>
      expectFold(actual.folds[i], expected),
    );
  });

  it('holds the first training choice through the entire independent split test', () => {
    const input = request();
    const actual = runAdvanced({
      ...input,
      evaluation: { kind: 'split', trainBars: 24 },
    });
    expect(actual.folds).toHaveLength(1);
    expectFold(actual.folds[0], reference.split);
  });

  it('matches the fixed PCG42 sample without replacement on two independent axes', () => {
    const { seed, count, candidates } = reference.randomGrid;
    const input = request();
    input.axes.push({ ...input.axes[0], side: 'sell' });
    input.search = { kind: 'random', seed, count };
    expect(
      runAdvanced(input).plan.candidates.map((candidate) => candidate.values),
    ).toEqual(candidates);
  });

  it.each([0, 1])(
    'locks the same fold %i training ranking when all future OHLC change',
    (i) => {
      const expected = reference.rolling[i];
      const changed = prices.map((p, j) =>
        j < expected.testRange[0] ? p : 100,
      );
      const actual = runAdvanced(request(changed)).folds[i];
      expect(actual.selectedId).toBe(expected.selectedLookback - 1);
      expect(
        actual.train.map(({ candidateId, metrics }) => ({
          lookback: candidateId + 1,
          metrics,
        })),
      ).toEqual(expected.train);
      expect(actual.test?.metrics?.netPnl).toBe('0');
      expect(actual.test?.metrics).not.toEqual(expected.test);
    },
  );
});
