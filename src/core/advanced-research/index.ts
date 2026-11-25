import {
  ALGORITHM_VERSION,
  CONVERSION_VERSION,
  runBacktest,
} from '../backtests';
import { singleBars } from '../market-regime/ledger';
import {
  analyzeRegimes,
  REGIME_ATTRIBUTION_VERSION,
  REGIME_MODEL_VERSION,
} from '../market-regime/model';
import { windowDataset } from '../research';
import type { WindowSpec } from '../research';
import { RNG_VERSION } from '../risk-analysis/rng';
import { calculateStatistics, STATISTICS_VERSION } from '../statistics';
import { RULE_STRATEGY_VERSION } from '../strategies';
import { prepareAdvanced, signedUnits } from './plan';
import type {
  AdvancedFold,
  AdvancedInput,
  AdvancedResult,
  Candidate,
  CandidateMetrics,
  CandidateRow,
} from './types';
export type * from './types';
export type { WindowSpec } from '../research';
export {
  ADVANCED_LIMITS,
  prepareAdvanced,
  parameterTargets,
  previewAdvanced,
} from './plan';

export const ADVANCED_VERSION = 'rule-search-walk-forward-v1';
export const ADVANCED_VERSIONS = Object.freeze({
  optimization: ADVANCED_VERSION,
  random: RNG_VERSION,
  engine: ALGORITHM_VERSION,
  conversion: CONVERSION_VERSION,
  strategy: RULE_STRATEGY_VERSION,
  statistics: STATISTICS_VERSION,
  regime: REGIME_MODEL_VERSION,
  attribution: REGIME_ATTRIBUTION_VERSION,
});

function trainingRejections(
  metrics: CandidateMetrics,
  filters: AdvancedInput['filters'],
) {
  const reasons: string[] = [];
  const constraints = [
    ['收益率', metrics.totalReturn, filters.minReturn, 'min'],
    ['最大回撤', metrics.maxDrawdown, filters.maxDrawdown, 'max'],
    ['利润因子', metrics.profitFactor, filters.minProfitFactor, 'min'],
  ] as const;
  for (const [label, value, threshold, direction] of constraints) {
    if (threshold === null) continue;
    if (value === null) reasons.push(label + '为 NA，未通过筛选。');
    else {
      const actual = signedUnits(value),
        limit = signedUnits(threshold);
      if (direction === 'min' ? actual < limit : actual > limit)
        reasons.push(label + '未满足训练筛选阈值 ' + threshold + '。');
    }
  }
  if (metrics.completedTrades < filters.minTrades)
    reasons.push('完成交易次数少于 ' + filters.minTrades + '。');
  return reasons;
}

/** One fresh engine per window; no cross-boundary position, signal or indicator state. */
export function evaluateCandidate(
  input: AdvancedInput,
  candidate: Candidate,
  window: WindowSpec,
): CandidateRow {
  const dataset = windowDataset(input.dataset, window);
  const endUtcMs =
    dataset.candles.at(-1)!.timestampUtcMs + dataset.quality.intervalMs!;
  const identity = {
    candidateId: candidate.id,
    window,
    startUtcMs: dataset.candles[0].timestampUtcMs,
    endUtcMs,
  };
  try {
    const result = runBacktest({
      dataset,
      completedThroughUtcMs: endUtcMs,
      config: input.config,
      risk: input.risk,
      strategy: { kind: 'rules', rule: candidate.rule },
    });
    const statistics = calculateStatistics(
      result,
      String(dataset.candles[0].open),
    );
    const metrics = {
      totalReturn: statistics.totalReturn.value,
      maxDrawdown: statistics.maxDrawdown.value,
      profitFactor: statistics.profitFactor.value,
      completedTrades: statistics.completedTrades.length,
      netPnl: statistics.netPnl,
      finalEquity: result.final.equity,
    };
    const regimes = analyzeRegimes(
      {
        candles: dataset.candles,
        intervalMs: result.manifest.intervalMs,
        completedThroughUtcMs: endUtcMs,
        initialCash: result.manifest.config.initialCash,
        netPnl: statistics.netPnl,
        bars: singleBars(result, statistics),
      },
      input.regime,
    ).summaries;
    return {
      ...identity,
      metrics,
      regimes,
      runHash: result.manifest.runHash,
      reasons:
        window.role === 'train'
          ? trainingRejections(metrics, input.filters)
          : [],
    };
  } catch (error) {
    return {
      ...identity,
      metrics: null,
      regimes: null,
      runHash: null,
      reasons: [error instanceof Error ? error.message : '候选运行失败。'],
    };
  }
}

export function rankTraining(
  input: Pick<AdvancedInput, 'sort'>,
  train: CandidateRow[],
) {
  const reference = train[0]?.window;
  if (
    train.some(
      (row) =>
        row.window.role !== 'train' ||
        row.window.fold !== reference.fold ||
        row.window.start !== reference.start ||
        row.window.end !== reference.end,
    ) ||
    new Set(train.map((row) => row.candidateId)).size !== train.length
  )
    throw new Error('训练选优只允许同一训练窗口的互异候选。');
  return [...train].sort((a, b) => {
    const status = (row: CandidateRow) =>
      row.metrics === null ? 2 : row.reasons.length ? 1 : 0;
    const statusDifference = status(a) - status(b);
    if (statusDifference) return statusDifference;
    if (a.metrics && b.metrics) {
      for (const key of input.sort) {
        const av = a.metrics[key],
          bv = b.metrics[key];
        if (av === bv) continue;
        if (av === null) return 1;
        if (bv === null) return -1;
        const left = signedUnits(String(av)),
          right = signedUnits(String(bv));
        if (left !== right)
          return (left < right ? -1 : 1) * (key === 'maxDrawdown' ? 1 : -1);
      }
    }
    return a.candidateId - b.candidateId;
  });
}

export function selectTraining(sorted: CandidateRow[]): number | null {
  if (sorted.some((row) => row.window.role !== 'train'))
    throw new Error('测试结果不能用于选择参数。');
  return (
    sorted.find((row) => row.metrics !== null && !row.reasons.length)
      ?.candidateId ?? null
  );
}

export function runAdvanced(input: AdvancedInput): AdvancedResult {
  const plan = prepareAdvanced(input);
  const folds: AdvancedFold[] = [];
  for (let i = 0; i < plan.windows.length; i += 2) {
    const train = rankTraining(
      input,
      plan.candidates.map((candidate) =>
        evaluateCandidate(input, candidate, plan.windows[i]),
      ),
    );
    const selectedId = selectTraining(train);
    const candidate = plan.candidates.find((c) => c.id === selectedId);
    const test = candidate
      ? evaluateCandidate(input, candidate, plan.windows[i + 1])
      : null;
    folds.push({ train, selectedId, test });
  }
  return { plan, folds };
}
