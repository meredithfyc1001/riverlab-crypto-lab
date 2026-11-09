import { assertDataset } from '../data/dataset';
import type { Dataset } from '../data/dataset';
import {
  runBacktest,
  normalizeConfig,
  ALGORITHM_VERSION,
  CONVERSION_VERSION,
  RUN_ASSUMPTIONS,
} from '../backtests';
import type { AccountSnapshot, BacktestConfig } from '../backtests';
import { canonicalJson, contentHash } from '../backtests/identity';
import { parseDecimal } from '../math';
import { normalizeStrategy, STRATEGY_VERSION } from '../strategies';
import type { StrategyConfig, StrategyInput } from '../strategies';
import { normalizeRisk } from '../risk';
import type { RiskConfig } from '../risk';
import {
  calculateStatistics,
  METRIC_DEFINITIONS,
  STATISTICS_VERSION,
} from '../statistics';
import type { Statistics } from '../statistics';
import { DISCLAIMER } from '../experiments';

export const RESEARCH_VERSION = 'chronological-independent-windows-v1';
export const LIMITS = Object.freeze({
  candidates: 25,
  folds: 20,
  runs: 100,
  barEvaluations: 1_000_000,
});
export type Evaluation =
  | { kind: 'full' }
  | { kind: 'split'; trainBars: number }
  | { kind: 'rolling'; trainBars: number; testBars: number };
export interface ResearchInput {
  dataset: Dataset;
  completedThroughUtcMs: number;
  candidates: StrategyInput[];
  config?: Partial<BacktestConfig>;
  risk?: RiskConfig;
  evaluation: Evaluation;
}
export interface WindowSpec {
  fold: number;
  role: 'full' | 'train' | 'test';
  start: number;
  end: number;
}
export interface ResearchRow {
  candidate: number;
  window: WindowSpec;
  startUtcMs: number;
  endUtcMs: number;
  strategy: StrategyConfig;
  warmupBars: number;
  warning: string | null;
  dataHash: string;
  signalHash: string;
  runHash: string;
  final: AccountSnapshot;
  statistics: Omit<Statistics, 'curve' | 'completedTrades'> & {
    completedTradeCount: number;
  };
}
export interface ResearchReport {
  format: 'riverlab-research';
  version: typeof RESEARCH_VERSION;
  input: ResearchInput;
  sourceHash: string;
  versions: {
    engine: string;
    conversion: string;
    strategy: string;
    statistics: string;
  };
  assumptions: readonly string[];
  definitions: readonly string[];
  disclaimer: typeof DISCLAIMER;
  rows: ResearchRow[];
  payloadHash: string;
}
export const RESEARCH_ASSUMPTIONS = Object.freeze([
  ...RUN_ASSUMPTIONS,
  '候选参数在批次开始前锁定，训练与测试均运行所有候选，不自动选优。',
  '所有窗口独立：同一初始本金、空仓、指标冷启动；不跨边界传递信号、仓位或预热。',
  '滚动为固定长度训练窗向前移动，测试窗不重叠；尾部不足完整测试窗明确列为未评估。',
  '训练/测试收益不拼接、不复利、不自动汇总成一条投资曲线。',
  '热力图为事先声明的有限网格描述；反复查看测试结果再调参会污染样本外证据。',
  '仅当前内存保留研究结果；导出含原数据快照和全部口径的JSON，重新导入会校验并重算。',
]);
function integer(value: number, min: number, max: number) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error('窗口/计数必须为范围内整数。');
}
export function planWindows(
  length: number,
  evaluation: Evaluation,
): WindowSpec[] {
  integer(length, 2, 50_000);
  if (!evaluation || typeof evaluation !== 'object')
    throw new Error('缺少评估方式。');
  const allowed =
    evaluation.kind === 'full'
      ? ['kind']
      : evaluation.kind === 'split'
        ? ['kind', 'trainBars']
        : ['kind', 'trainBars', 'testBars'];
  if (Object.keys(evaluation).some((k) => !allowed.includes(k)))
    throw new Error('未知评估字段。');
  if (evaluation.kind === 'full')
    return [{ fold: 0, role: 'full', start: 0, end: length }];
  if (evaluation.kind !== 'split' && evaluation.kind !== 'rolling')
    throw new Error('未知评估方式。');
  integer(evaluation.trainBars, 2, length - 2);
  if (evaluation.kind === 'split')
    return [
      { fold: 0, role: 'train', start: 0, end: evaluation.trainBars },
      { fold: 0, role: 'test', start: evaluation.trainBars, end: length },
    ];
  integer(evaluation.testBars, 2, length - evaluation.trainBars);
  const folds = Math.floor(
    (length - evaluation.trainBars) / evaluation.testBars,
  );
  integer(folds, 1, LIMITS.folds);
  return Array.from({ length: folds }, (_, fold) => {
    const start = fold * evaluation.testBars;
    return [
      {
        fold,
        role: 'train' as const,
        start,
        end: start + evaluation.trainBars,
      },
      {
        fold,
        role: 'test' as const,
        start: start + evaluation.trainBars,
        end: start + evaluation.trainBars + evaluation.testBars,
      },
    ];
  }).flat();
}
/** Explicit contiguous research slice. File identity and warnings refer to the original import. */
export function windowDataset(dataset: Dataset, window: WindowSpec): Dataset {
  const candles = dataset.candles.slice(window.start, window.end);
  return {
    ...dataset,
    id: 'range-' + contentHash([dataset.id, window.start, window.end]),
    name:
      dataset.name.slice(0, 120) + ' [' + window.start + ':' + window.end + ']',
    quality: {
      ...dataset.quality,
      totalRows: candles.length,
      validRows: candles.length,
      blankLines: 0,
      range: {
        startUtcMs: candles[0].timestampUtcMs,
        endUtcMs: candles.at(-1)!.timestampUtcMs,
      },
    },
    candles,
  };
}
export function warmupBars(strategy: StrategyConfig): number {
  return (
    (strategy.kind === 'ma'
      ? strategy.slowPeriod
      : strategy.kind === 'rsi'
        ? strategy.period
        : strategy.lookback) + 1
  );
}
export function validateResearch(input: ResearchInput) {
  if (
    !input ||
    typeof input !== 'object' ||
    Object.keys(input).some(
      (k) =>
        ![
          'dataset',
          'completedThroughUtcMs',
          'candidates',
          'config',
          'risk',
          'evaluation',
        ].includes(k),
    )
  )
    throw new Error('研究配置字段无效。');
  const d = input.dataset;
  assertDataset(d);
  if (d.quality.gapCount || d.quality.missingCandles)
    throw new Error('缺口数据阻止整批运行。');
  integer(input.completedThroughUtcMs, 0, 4_102_444_800_000);
  if (
    d.candles.at(-1)!.timestampUtcMs + d.quality.intervalMs! >
    input.completedThroughUtcMs
  )
    throw new Error('未完成K线阻止整批运行。');
  // Validate ALL original prices, including any explicitly unused rolling tail.
  for (const candle of d.candles)
    for (const price of [candle.open, candle.high, candle.low, candle.close])
      if (parseDecimal(String(price)) === 0n) throw new Error('价格精度无效。');
  if (!Array.isArray(input.candidates)) throw new Error('缺少候选策略。');
  integer(input.candidates.length, 1, LIMITS.candidates);
  const candidates = input.candidates.map((c) => normalizeStrategy(c));
  if (
    new Set(candidates.map((c) => canonicalJson(c))).size !== candidates.length
  )
    throw new Error('候选参数重复；不会去重或忽略。');
  const config = normalizeConfig(input.config);
  if (parseDecimal(config.initialCash) === 0n)
    throw new Error('初始本金必须大于0。');
  const risk = normalizeRisk(input.risk);
  const windows = planWindows(d.candles.length, input.evaluation);
  const runs = candidates.length * windows.length;
  const bars =
    candidates.length * windows.reduce((n, w) => n + w.end - w.start, 0);
  if (runs > LIMITS.runs || bars > LIMITS.barEvaluations)
    throw new Error(
      '研究预算超限：最多100次子运行、1,000,000根K线求值；请缩小显式网格或窗口数。',
    );
  return { candidates, config, risk, windows, runs, bars };
}
export function runResearch(
  input: ResearchInput,
  progress?: (completed: number, total: number) => void,
): ResearchReport {
  const checked = validateResearch(input);
  // Detach caller-owned state and lock the complete configuration before any run.
  const locked: ResearchInput = JSON.parse(
    JSON.stringify({
      ...input,
      candidates: checked.candidates,
      config: checked.config,
      risk: checked.risk,
    }),
  );
  const rows: ResearchRow[] = [];
  for (const window of checked.windows) {
    const dataset = windowDataset(locked.dataset, window);
    const endUtcMs =
      dataset.candles.at(-1)!.timestampUtcMs + dataset.quality.intervalMs!;
    for (const [candidate, strategy] of checked.candidates.entries()) {
      const result = runBacktest({
        dataset,
        strategy,
        config: checked.config,
        risk: checked.risk,
        completedThroughUtcMs: endUtcMs,
      });
      const stats = calculateStatistics(
        result,
        String(dataset.candles[0].open),
      );
      const { curve, completedTrades, ...statistics } = stats;
      void curve;
      const warmup = warmupBars(strategy);
      rows.push({
        candidate,
        window,
        startUtcMs: dataset.candles[0].timestampUtcMs,
        endUtcMs,
        strategy,
        warmupBars: warmup,
        warning:
          dataset.candles.length <= warmup
            ? '样本不足以在预热后执行下一根开盘订单；零收益不能证明策略有效。'
            : null,
        dataHash: result.manifest.dataHash,
        signalHash: result.manifest.signalHash,
        runHash: result.manifest.runHash,
        final: result.final,
        statistics: {
          ...statistics,
          completedTradeCount: completedTrades.length,
        },
      });
      progress?.(rows.length, checked.runs);
    }
  }
  const payload: Omit<ResearchReport, 'payloadHash'> = {
    format: 'riverlab-research' as const,
    version: RESEARCH_VERSION,
    input: locked,
    sourceHash: contentHash(locked.dataset),
    versions: {
      engine: ALGORITHM_VERSION,
      conversion: CONVERSION_VERSION,
      strategy: STRATEGY_VERSION,
      statistics: STATISTICS_VERSION,
    },
    assumptions: RESEARCH_ASSUMPTIONS,
    definitions: METRIC_DEFINITIONS,
    disclaimer: DISCLAIMER,
    rows,
  };
  return { ...payload, payloadHash: contentHash(payload) };
}
export function verifyResearch(
  value: unknown,
  observedUtcMs?: number,
): ResearchReport {
  if (!value || typeof value !== 'object') throw new Error('研究报告损坏。');
  const report = value as ResearchReport;
  if (
    report.format !== 'riverlab-research' ||
    report.version !== RESEARCH_VERSION
  )
    throw new Error('研究报告格式或算法版本不支持。');
  const { payloadHash, ...payload } = report;
  if (contentHash(payload) !== payloadHash)
    throw new Error('研究报告校验失败。');
  if (observedUtcMs !== undefined) {
    integer(observedUtcMs, 0, 4_102_444_800_000);
    if (!report.input || report.input.completedThroughUtcMs > observedUtcMs)
      throw new Error('报告声明的完成时间晚于当前时间，阻止运行。');
  }
  const actual = runResearch(report.input);
  if (canonicalJson(actual) !== canonicalJson(report))
    throw new Error('研究报告不能按记录复现，未修复。');
  return actual;
}
export function researchJson(report: ResearchReport): string {
  return JSON.stringify(report, null, 2);
}
export function researchCsv(report: ResearchReport): string {
  const cell = (v: unknown) => '"' + String(v).replace(/"/g, '""') + '"';
  const lines: unknown[][] = [
    [DISCLAIMER],
    ['payloadHash', report.payloadHash],
    [
      'candidate',
      'strategy',
      'parameters',
      'fold',
      'role',
      'startUtcMs',
      'endUtcMs',
      'netPnlUSDT',
      'returnFraction',
      'returnNA',
      'maxDrawdownFraction',
      'drawdownNA',
      'realizedPnlUSDT',
      'unrealizedPnlUSDT',
      'feesUSDT',
      'completedTrades',
      'winRate',
      'winRateNA',
      'profitFactor',
      'profitFactorNA',
      'benchmarkReturn',
      'benchmarkNA',
      'annualizedReturn',
      'annualizedNA',
      'dataHash',
      'runHash',
    ],
    ...report.rows.map((r) => [
      r.candidate + 1,
      r.strategy.kind,
      canonicalJson(r.strategy),
      r.window.fold + 1,
      r.window.role,
      r.startUtcMs,
      r.endUtcMs,
      r.statistics.netPnl,
      r.statistics.totalReturn.value ?? '',
      r.statistics.totalReturn.reason ?? '',
      r.statistics.maxDrawdown.value ?? '',
      r.statistics.maxDrawdown.reason ?? '',
      r.statistics.realizedPnl,
      r.statistics.unrealizedPnl,
      r.statistics.fees,
      r.statistics.completedTradeCount,
      r.statistics.winRate.value ?? '',
      r.statistics.winRate.reason ?? '',
      r.statistics.profitFactor.value ?? '',
      r.statistics.profitFactor.reason ?? '',
      r.statistics.benchmark.return.value ?? '',
      r.statistics.benchmark.return.reason ?? '',
      r.statistics.annualizedReturn.value ?? '',
      r.statistics.annualizedReturn.reason ?? '',
      r.dataHash,
      r.runHash,
    ]),
  ];
  return '\uFEFF' + lines.map((row) => row.map(cell).join(',')).join('\r\n');
}
export function parameterGrid(
  kind: 'ma' | 'rsi' | 'breakout',
  a: readonly number[],
  b: readonly number[] = [],
  period = 14,
): StrategyConfig[] {
  if (
    ![a, ...(kind === 'breakout' ? [] : [b])].every(
      (axis) =>
        axis.length > 0 &&
        axis.length <= LIMITS.candidates &&
        axis.every(Number.isFinite) &&
        new Set(axis).size === axis.length,
    )
  )
    throw new Error('网格轴不能为空、重复或包含非数字。');
  if (a.length * (kind === 'breakout' ? 1 : b.length) > LIMITS.candidates)
    throw new Error('网格最多25个候选；无效单元会阻止整批，不跳过。');
  return (
    kind === 'breakout'
      ? a.map((lookback) => ({ kind, lookback }))
      : a.flatMap((x) =>
          b.map((y) =>
            kind === 'ma'
              ? { kind, fastPeriod: x, slowPeriod: y }
              : { kind, period, lower: x, upper: y },
          ),
        )
  ).map((c) => normalizeStrategy(c));
}
