import { normalizeConfig } from '../backtests/config';
import { assertDataset } from '../data/dataset';
import { validateSnapshotFields } from '../data/snapshot-fields';
import { assertRegimeParams } from '../market-regime/model';
import { decimal, parseDecimal, readUnits, SCALE } from '../math';
import { requireFields } from '../portfolio/alignment';
import { planWindows } from '../research';
import { normalizeRisk } from '../risk';
import { pcg32 } from '../risk-analysis/rng';
import { verifyRuleRecord } from '../rule-library';
import { normalizeRule } from '../strategies';
import type { StrategyRuleV1 } from '../strategies';
import type {
  AdvancedInput,
  AdvancedPlan,
  Candidate,
  ParameterAxis,
  ParameterTarget,
} from './types';

export const ADVANCED_LIMITS = Object.freeze({
  axes: 4,
  combinations: 1024,
  candidates: 64,
  folds: 20,
  runs: 200,
  bars: 1_000_000,
});

export function parameterTargets(rule: StrategyRuleV1) {
  const targets: (ParameterTarget & { value: number })[] = [];
  for (const side of ['buy', 'sell'] as const) {
    if (!rule[side].enabled) continue;
    for (const [condition, entry] of rule[side].conditions.entries()) {
      if (!entry.enabled) continue;
      const add = (field: ParameterTarget['field'], value: number) => {
        targets.push({ side, condition, field, value });
      };
      switch (entry.kind) {
        case 'cross':
          add('fastPeriod', entry.fastPeriod);
          add('slowPeriod', entry.slowPeriod);
          break;
        case 'rsi':
          add('period', entry.period);
          add('threshold', entry.threshold);
          break;
        case 'price-ma':
          add('period', entry.period);
          break;
        case 'breakout':
          add('lookback', entry.lookback);
          break;
      }
    }
  }
  return targets;
}

export function signedUnits(value: string) {
  return value.startsWith('-') ? -readUnits(value.slice(1)) : readUnits(value);
}
const metrics = [
  'totalReturn',
  'maxDrawdown',
  'profitFactor',
  'completedTrades',
];
type Settings = Omit<AdvancedInput, 'dataset' | 'completedThroughUtcMs'>;
function validateSettings(settings: Settings) {
  requireFields(settings, [
    'ruleRecord',
    'config',
    'risk',
    'axes',
    'search',
    'filters',
    'sort',
    'evaluation',
    'regime',
  ]);
  verifyRuleRecord(settings.ruleRecord);
  requireFields(settings.config, [
    'initialCash',
    'buySlippageBps',
    'sellSlippageBps',
    'feeBps',
    'quantityDecimals',
    'minNotional',
  ]);
  if (normalizeConfig(settings.config).initialCash === '0')
    throw new Error('研究的初始本金须为正。');
  normalizeRisk(settings.risk);
  assertRegimeParams(settings.regime);
  requireFields(settings.filters, [
    'minReturn',
    'maxDrawdown',
    'minProfitFactor',
    'minTrades',
  ]);
  const { minReturn, maxDrawdown, minProfitFactor, minTrades } =
    settings.filters;
  if (!Number.isSafeInteger(minTrades) || minTrades < 0 || minTrades > 50_000)
    throw new Error('最少完成交易次数须为 0–50,000 整数。');
  for (const limit of [minReturn, maxDrawdown, minProfitFactor]) {
    if (
      limit !== null &&
      (typeof limit !== 'string' || !/^-?\d{1,96}(\.\d{1,18})?$/.test(limit))
    )
      throw new Error('筛选阈值须为有界十进制字符串，或留空。');
  }
  if (
    maxDrawdown !== null &&
    (signedUnits(maxDrawdown) < 0n || signedUnits(maxDrawdown) > SCALE)
  )
    throw new Error('最大回撤比例须在 0 至 1 之间。');
  if (minProfitFactor !== null && signedUnits(minProfitFactor) < 0n)
    throw new Error('最小利润因子须为非负值。');
  if (
    !Array.isArray(settings.sort) ||
    !settings.sort.length ||
    settings.sort.length > metrics.length ||
    new Set(settings.sort).size !== settings.sort.length ||
    settings.sort.some((key) => !metrics.includes(key))
  )
    throw new Error('请明确选择不重复的排序指标及优先级。');
  if (settings.search?.kind === 'grid')
    requireFields(settings.search, ['kind']);
  else if (settings.search?.kind === 'random') {
    requireFields(settings.search, ['kind', 'seed', 'count']);
    if (
      !Number.isSafeInteger(settings.search.seed) ||
      settings.search.seed < 0 ||
      settings.search.seed > 0xffff_ffff
    )
      throw new Error('种子须为 0–4294967295 整数。');
    if (
      !Number.isInteger(settings.search.count) ||
      settings.search.count < 1 ||
      settings.search.count > ADVANCED_LIMITS.candidates
    )
      throw new Error('随机抽样数量须为 1–64 整数。');
  } else throw new Error('不支持的搜索方式。');
  if (
    settings.evaluation?.kind !== 'split' &&
    settings.evaluation?.kind !== 'rolling'
  )
    throw new Error('请使用按时间拆分或滚动训练/测试。');
}

/** Fixed-point stepping avoids duplicate or missing tenths in an RSI search. */
function axisValues(axis: ParameterAxis) {
  const threshold = axis.field === 'threshold';
  if (
    ![axis.min, axis.max, axis.step].every(
      (x) =>
        typeof x === 'number' &&
        Number.isFinite(x) &&
        (threshold || Number.isInteger(x)),
    ) ||
    axis.min < (threshold ? 0 : 1) ||
    axis.max > (threshold ? 100 : 50_000) ||
    axis.max < axis.min ||
    axis.step <= 0
  )
    throw new Error(
      '参数范围或步长无效。周期须为正整数，RSI 阈值须在 0–100 内。',
    );
  const lo = parseDecimal(String(axis.min)),
    hi = parseDecimal(String(axis.max)),
    step = parseDecimal(String(axis.step));
  const count = (hi - lo) / step + 1n;
  if (count > BigInt(ADVANCED_LIMITS.combinations))
    throw new Error('参数网格超过枚举预算。');
  const values = new Set<number>();
  for (let units = lo; units <= hi; units += step)
    values.add(Number(decimal(units)));
  return [...values];
}

// First close at which every enabled condition can produce a decision.
function warmupBars(rule: StrategyRuleV1) {
  return Math.max(
    ...[rule.buy, rule.sell]
      .filter((group) => group.enabled)
      .flatMap((group) =>
        group.conditions
          .filter((entry) => entry.enabled)
          .map((entry) => {
            switch (entry.kind) {
              case 'price-ma':
                return entry.period;
              case 'rsi':
                return entry.period + 1;
              case 'cross':
                return entry.slowPeriod + 1;
              case 'breakout':
                return entry.lookback + 1;
            }
          }),
      ),
  );
}
function enumerate(settings: Settings) {
  const { axes, ruleRecord, search } = settings;
  if (!Array.isArray(axes) || axes.length > ADVANCED_LIMITS.axes)
    throw new Error('每次最多搜索 4 个参数轴。');
  const available = parameterTargets(ruleRecord.rule);
  const targets = new Set<string>();
  const dimensions = axes.map((axis) => {
    requireFields(axis, ['side', 'condition', 'field', 'min', 'max', 'step']);
    if (
      !available.some(
        (t) =>
          t.side === axis.side &&
          t.condition === axis.condition &&
          t.field === axis.field,
      )
    )
      throw new Error('搜索轴须对应已启用规则的数值参数。');
    const key = [axis.side, axis.condition, axis.field].join('.');
    if (targets.has(key)) throw new Error('同一规则参数重复指定范围。');
    targets.add(key);
    return axisValues(axis);
  });
  const combinations = dimensions.reduce((n, values) => n * values.length, 1);
  if (combinations > ADVANCED_LIMITS.combinations)
    throw new Error('网格组合超过 1,024 个枚举预算。');
  const candidates: Candidate[] = [],
    invalid: AdvancedPlan['invalid'] = [];
  for (let id = 0; id < combinations; id++) {
    let rank = id;
    const values = dimensions.map(() => 0);
    for (let i = dimensions.length - 1; i >= 0; i--) {
      values[i] = dimensions[i][rank % dimensions[i].length];
      rank = Math.floor(rank / dimensions[i].length);
    }
    const rule = normalizeRule(ruleRecord.rule);
    for (const [i, axis] of axes.entries())
      Object.assign(rule[axis.side].conditions[axis.condition], {
        [axis.field]: values[i],
      });
    try {
      const valid = normalizeRule(rule);
      candidates.push({
        id,
        values,
        rule: valid,
        warmupBars: warmupBars(valid),
      });
    } catch (error) {
      invalid.push({
        values,
        reason: error instanceof Error ? error.message : '规则参数组合无效。',
      });
    }
  }
  if (search.kind === 'random') {
    if (search.count > candidates.length)
      throw new Error('随机抽样数量超过有效且互异的参数组合数。');
    const rng = pcg32(search.seed);
    for (let i = 0; i < search.count; i++) {
      const j = i + rng.bounded(candidates.length - i);
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    candidates.length = search.count;
    candidates.sort((a, b) => a.id - b.id);
  }
  if (candidates.length > ADVANCED_LIMITS.candidates)
    throw new Error(
      '实际候选超过 64 个，请减小范围或选用固定种子的有界随机抽样。',
    );
  return { candidates, invalid, combinations };
}

export function previewAdvanced(
  settings: Settings,
  bars: number,
): AdvancedPlan {
  validateSettings(settings);
  const windows = planWindows(bars, settings.evaluation);
  const search = enumerate(settings);
  const costs = windows.map((w) =>
    w.role === 'train'
      ? search.candidates.length
      : Math.min(1, search.candidates.length),
  );
  const runs = costs.reduce((sum, n) => sum + n, 0);
  const evaluations = windows.reduce(
    (sum, w, i) => sum + costs[i] * (w.end - w.start),
    0,
  );
  if (runs > ADVANCED_LIMITS.runs || evaluations > ADVANCED_LIMITS.bars)
    throw new Error(
      '研究资源预算超限，每批最多 200 次子运行、1,000,000 根 K 线求值。',
    );
  return {
    ...search,
    windows,
    trailingBars: bars - windows.at(-1)!.end,
    runs,
    bars: evaluations,
  };
}

export function prepareAdvanced(input: AdvancedInput): AdvancedPlan {
  requireFields(input, [
    'dataset',
    'completedThroughUtcMs',
    'ruleRecord',
    'config',
    'risk',
    'axes',
    'search',
    'filters',
    'sort',
    'evaluation',
    'regime',
  ]);
  const { dataset, completedThroughUtcMs, ...settings } = input;
  assertDataset(dataset);
  validateSnapshotFields(dataset);
  if (dataset.quality.gapCount || dataset.quality.missingCandles)
    throw new Error('行情存在缺口，不能开始研究。');
  const end =
    dataset.candles.at(-1)!.timestampUtcMs + dataset.quality.intervalMs!;
  if (
    !Number.isSafeInteger(completedThroughUtcMs) ||
    completedThroughUtcMs < end ||
    completedThroughUtcMs > 4_102_444_800_000
  )
    throw new Error('行情收盘时间未确认。');
  for (const c of dataset.candles) {
    for (const price of [c.open, c.high, c.low, c.close])
      if (parseDecimal(String(price)) <= 0n)
        throw new Error('行情价格超出精度范围。');
  }
  return previewAdvanced(settings, dataset.candles.length);
}
