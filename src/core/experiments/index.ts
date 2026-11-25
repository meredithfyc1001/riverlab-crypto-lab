import { runBacktest, ALGORITHM_VERSION } from '../backtests';
import type { BacktestInput, BacktestResult } from '../backtests';
import type { Dataset } from '../data/dataset';
import { contentHash } from '../backtests/identity';
import {
  calculateStatistics,
  METRIC_DEFINITIONS,
  STATISTICS_VERSION,
} from '../statistics';
import type { Statistics } from '../statistics';

export const DISCLAIMER = '仅供学习研究，历史表现不代表未来表现';
export type WorkbenchInput = Extract<BacktestInput, { strategy: unknown }>;
export interface ExperimentPayload {
  dataset: Dataset;
  result: BacktestResult;
  statistics: Statistics;
  definitions: readonly string[];
  disclaimer: typeof DISCLAIMER;
}
export interface Experiment {
  schemaVersion: 1;
  id: string;
  name: string;
  createdUtcMs: number;
  elapsedMs: number;
  payloadHash: string;
  payload: ExperimentPayload;
}
export type ExperimentSummary = Pick<
  Experiment,
  'id' | 'name' | 'createdUtcMs' | 'payloadHash'
> & { symbol: string; runHash: string; strategy: string };
export function runExperiment(input: WorkbenchInput): ExperimentPayload {
  const result = runBacktest(input);
  // The input is already an isolated Worker snapshot. Only optional metadata
  // needs JSON normalization; do not stringify/parse the entire 38MB ledger.
  const { candles, ...metadata } = input.dataset;
  const dataset = {
    ...JSON.parse(JSON.stringify(metadata)),
    candles: candles.map((c) => ({ ...c })),
  } as Dataset;
  return {
    dataset,
    result,
    statistics: calculateStatistics(result, String(candles[0].open)),
    definitions: METRIC_DEFINITIONS,
    disclaimer: DISCLAIMER,
  };
}
export function sealExperiment(
  payload: ExperimentPayload,
  metadata: Pick<Experiment, 'id' | 'name' | 'createdUtcMs' | 'elapsedMs'>,
): Experiment {
  return {
    schemaVersion: 1,
    ...metadata,
    payloadHash: contentHash(payload),
    payload,
  };
}
export function summarizeExperiment(e: Experiment): ExperimentSummary {
  return {
    id: e.id,
    name: e.name,
    createdUtcMs: e.createdUtcMs,
    payloadHash: e.payloadHash,
    symbol: e.payload.dataset.symbol,
    runHash: e.payload.result.manifest.runHash,
    strategy: e.payload.result.manifest.strategy!.config.kind,
  };
}
/** Retain the original single-experiment metadata contract on dependent reports. */
export function assertExperimentMetadata(
  e: Pick<Experiment, 'id' | 'name' | 'createdUtcMs' | 'elapsedMs'>,
) {
  if (
    !e ||
    typeof e.id !== 'string' ||
    !e.id.length ||
    e.id.length > 100 ||
    typeof e.name !== 'string' ||
    !e.name.trim() ||
    e.name.length > 160 ||
    !Number.isSafeInteger(e.createdUtcMs) ||
    e.createdUtcMs < 0 ||
    e.createdUtcMs > 4_102_444_800_000 ||
    !Number.isFinite(e.elapsedMs) ||
    e.elapsedMs < 0
  )
    throw new Error('身份、格式或校验和不符');
}
/** Run in Worker at storage trust boundaries; verifies supported versions and recomputes. */
export function verifyExperiment(value: unknown): Experiment {
  const e = value as Experiment;
  try {
    assertExperimentMetadata(e);
    if (
      e.schemaVersion !== 1 ||
      !e.payload ||
      contentHash(e.payload) !== e.payloadHash
    )
      throw new Error('身份、格式或校验和不符');
    const { result, dataset, statistics } = e.payload,
      m = result.manifest;
    if (
      m.algorithmVersion !== ALGORITHM_VERSION ||
      statistics.version !== STATISTICS_VERSION ||
      !m.strategy
    )
      throw new Error('算法版本不支持');
    const actual = runExperiment({
      dataset,
      config: m.config,
      risk: m.risk,
      strategy: m.strategy.config,
      completedThroughUtcMs: m.completedThroughUtcMs,
    });
    // The first digest checked every imported field. Hash the same canonical
    // byte stream of the independent replay without materializing two full reports as strings.
    if (contentHash(actual) !== e.payloadHash)
      throw new Error('重算结果不一致');
    return e;
  } catch (error) {
    throw new Error(
      `实验记录损坏或版本不支持：${error instanceof Error ? error.message : '无效记录'}；未修复。`,
      { cause: error },
    );
  }
}
/** CSV is exact fill detail, not a completed-roundtrip summary. */
export function tradesCsv(e: Experiment): string {
  const cell = (v: unknown, text = false) => {
    let s = v == null ? '' : String(v);
    if (text && /^[\s]*[=+\-@]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const rows: unknown[][] = [
    [DISCLAIMER],
    ['runHash', e.payload.result.manifest.runHash],
    [
      'sequence',
      'orderId',
      'side',
      'candleIndex',
      'timestampUtcMs',
      'barOpenUtcMs',
      'barCloseUtcMs',
      'reason',
      'triggerAssumption',
      'referencePrice',
      'price',
      'quantity',
      'notional',
      'fee',
      'cashBefore',
      'cashAfter',
      'quantityAfter',
      'marketValueAfter',
      'equityAfter',
    ],
    ...e.payload.result.fills.map((f) => [
      f.sequence,
      f.orderId,
      f.side,
      f.candleIndex,
      f.timestampUtcMs,
      f.trigger?.barOpenUtcMs,
      f.trigger?.barCloseUtcMs,
      f.reason,
      f.trigger?.assumption,
      f.referencePrice,
      f.price,
      f.quantity,
      f.notional,
      f.fee,
      f.before.cash,
      f.after.cash,
      f.after.position.quantity,
      f.after.marketValue,
      f.after.equity,
    ]),
  ];
  return (
    '\ufeff' +
    rows
      .map((row) =>
        row.map((v, i) => cell(v, [1, 2, 7, 8].includes(i))).join(','),
      )
      .join('\r\n') +
    '\r\n'
  );
}
export function reportJson(e: Experiment): string {
  return JSON.stringify({ format: 'riverlab-experiment', ...e }, null, 2);
}
