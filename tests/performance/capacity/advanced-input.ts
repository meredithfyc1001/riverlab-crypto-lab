import type { AdvancedInput } from '../../../src/core/advanced-research';
import { normalizeConfig } from '../../../src/core/backtests';
import { normalizeRisk } from '../../../src/core/risk';
import { sealRule } from '../../../src/core/rule-library';
import type { prepareBacktest } from '../backtest-input';

/** Frozen Phase 5E 50,000-bar, seed-27 comparison shared by both runtimes. */
export function advancedCapacityInput(
  baseline: Awaited<ReturnType<typeof prepareBacktest>>,
): AdvancedInput {
  const group = (direction: 'above' | 'below') => ({
    enabled: true,
    operator: 'AND',
    conditions: [
      {
        enabled: true,
        kind: 'cross',
        average: 'MA',
        direction,
        fastPeriod: 2,
        slowPeriod: 4,
      },
    ],
  });
  const rule = sealRule(
    {
      schemaVersion: 1,
      revision: 1,
      buy: group('above'),
      sell: group('below'),
    },
    {
      familyId: 'capacity-cross',
      name: '容量测量 MA 交叉',
      createdUtcMs: 1735689600000,
    },
  );
  return {
    dataset: baseline.input.dataset,
    completedThroughUtcMs: baseline.input.completedThroughUtcMs,
    config: normalizeConfig({}),
    risk: normalizeRisk(),
    ruleRecord: rule,
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
    search: { kind: 'random', seed: 27, count: 3 },
    filters: {
      minReturn: null,
      maxDrawdown: null,
      minProfitFactor: null,
      minTrades: 0,
    },
    sort: ['totalReturn', 'maxDrawdown'],
    evaluation: { kind: 'split', trainBars: 25000 },
    regime: { lookback: 20, thresholdBps: 500 },
  };
}
