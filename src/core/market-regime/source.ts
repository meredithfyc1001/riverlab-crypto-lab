import type { BacktestResult } from '../backtests';
import { canonicalJson } from '../backtests/identity';
import type { Candle } from '../data';
import { validateSnapshotFields } from '../data/snapshot-fields';
import {
  assertExperimentMetadata,
  runExperiment,
  sealExperiment,
  verifyExperiment,
} from '../experiments';
import type { Experiment, WorkbenchInput } from '../experiments';
import type { PortfolioInput } from '../portfolio';
import {
  createPortfolioExperiment,
  verifyPortfolioExperiment,
} from '../portfolio/report';
import type { PortfolioExperiment } from '../portfolio/report';
import { requireFields } from '../portfolio/alignment';
import type { Metadata } from '../portfolio/report-common';
import {
  createSharedPoolExperiment,
  verifySharedPoolExperiment,
} from '../shared-pool/report';
import type { SharedPoolExperiment } from '../shared-pool/report';
import type { SharedPoolInput } from '../shared-pool/types';
import type { RegimeSeries } from './model';
import { portfolioBars, sharedBars, singleBars } from './ledger';

function singleVersions(result: BacktestResult, statisticsVersion: string) {
  const m = result.manifest;
  return {
    engine: m.algorithmVersion,
    conversion: m.conversionVersion,
    statistics: statisticsVersion,
    strategy: m.strategy!.version,
    signalHash: m.signalHash,
    runHash: m.runHash,
    dataHash: m.dataHash,
  };
}

type SingleSnapshot = Metadata & {
  kind: 'single';
  schemaVersion: 1;
  input: WorkbenchInput;
  elapsedMs: number;
  payloadHash: string;
  runHash: string;
  dataHash: string;
  versions: ReturnType<typeof singleVersions>;
};
type PortfolioSnapshot = Metadata & {
  kind: 'portfolio';
  schemaVersion: 1;
  input: PortfolioInput;
  payloadHash: string;
  recordHash: string;
  versions: {
    algorithm: string;
    assets: { symbol: string; versions: ReturnType<typeof singleVersions> }[];
  };
};
type PoolSnapshot = Metadata & {
  kind: 'shared';
  schemaVersion: 2;
  input: SharedPoolInput;
  payloadHash: string;
  recordHash: string;
  versions: {
    algorithm: string;
    execution: string;
    conversion: string;
    assets: { symbol: string; strategy: string | null }[];
  };
};
export type SourceSnapshot = SingleSnapshot | PortfolioSnapshot | PoolSnapshot;
export type SourceKind = SourceSnapshot['kind'];
interface CapturedSource {
  source: SourceSnapshot;
  series: RegimeSeries;
  candles: Candle[];
}

export function sourceCandles(
  source: SourceSnapshot,
  reference: string | null,
): Candle[] {
  if (source.kind === 'single') {
    if (reference !== null) throw new Error('单币种研究使用原实验行情。');
    return source.input.dataset.candles;
  }
  const { startUtcMs, endUtcMs, assets } = source.input;
  const asset = assets.find((a) => a.dataset.symbol === reference);
  if (!asset) throw new Error('请显式选择组合原始快照中的参考资产。');
  return asset.dataset.candles.filter(
    (bar) => bar.timestampUtcMs >= startUtcMs && bar.timestampUtcMs <= endUtcMs,
  );
}

function metadata({ id, name, createdUtcMs }: Metadata): Metadata {
  return { id, name, createdUtcMs };
}

function fromSingle(
  e: Experiment,
  reference: string | null,
  now: number,
): CapturedSource {
  const { result, statistics, dataset } = e.payload;
  const m = result.manifest;
  if (!Number.isSafeInteger(now) || m.completedThroughUtcMs > now)
    throw new Error('源实验声明的收盘时间晚于当前时间或无效。');
  validateSnapshotFields(dataset);
  const input = {
    dataset,
    config: m.config,
    risk: m.risk,
    strategy: m.strategy!.config,
    completedThroughUtcMs: m.completedThroughUtcMs,
  };
  const source: SingleSnapshot = {
    kind: 'single',
    schemaVersion: e.schemaVersion,
    ...metadata(e),
    elapsedMs: e.elapsedMs,
    payloadHash: e.payloadHash,
    input,
    runHash: m.runHash,
    dataHash: m.dataHash,
    versions: singleVersions(result, statistics.version),
  };
  const candles = sourceCandles(source, reference);
  return {
    source,
    candles,
    series: {
      candles,
      intervalMs: m.intervalMs,
      completedThroughUtcMs: m.completedThroughUtcMs,
      initialCash: m.config.initialCash,
      netPnl: statistics.netPnl,
      bars: singleBars(result, statistics),
    },
  };
}

function fromPortfolio(
  e: PortfolioExperiment | SharedPoolExperiment,
  reference: string | null,
): CapturedSource {
  const common = {
    ...metadata(e),
    payloadHash: e.payloadHash,
    recordHash: e.recordHash,
  };
  const source: PortfolioSnapshot | PoolSnapshot =
    e.format === 'riverlab-portfolio-experiment'
      ? {
          ...common,
          kind: 'portfolio',
          schemaVersion: e.schemaVersion,
          input: e.input,
          versions: {
            algorithm: e.result.version,
            assets: e.result.assets.map((a) => ({
              symbol: a.symbol,
              versions: singleVersions(a.result, a.statistics.version),
            })),
          },
        }
      : {
          ...common,
          kind: 'shared',
          schemaVersion: e.schemaVersion,
          input: e.input,
          versions: {
            algorithm: e.result.version,
            execution: e.result.executionVersion,
            conversion: e.result.conversionVersion,
            assets: e.result.assets.map((a) => ({
              symbol: a.symbol,
              strategy: a.strategyVersion,
            })),
          },
        };
  const candles = sourceCandles(source, reference);
  return {
    source,
    candles,
    series: {
      candles,
      intervalMs: e.result.alignment.intervalMs,
      completedThroughUtcMs: e.input.completedThroughUtcMs,
      initialCash: e.result.initialCash,
      netPnl: e.result.netPnl,
      bars:
        e.format === 'riverlab-portfolio-experiment'
          ? portfolioBars(e.result)
          : sharedBars(e.result),
    },
  };
}

export function captureSource(
  kind: SourceKind,
  record: unknown,
  reference: string | null,
  now: number,
): CapturedSource {
  switch (kind) {
    case 'single':
      return fromSingle(verifyExperiment(record), reference, now);
    case 'portfolio':
      return fromPortfolio(verifyPortfolioExperiment(record, now), reference);
    case 'shared':
      return fromPortfolio(verifySharedPoolExperiment(record, now), reference);
    default:
      throw new Error('不支持的源实验类型。');
  }
}

// Payload hashes authenticate the replayed ledger and datasets. Compare compact
// identity and order separately: an engine can normalize parameters or assets.
function replayIdentity(source: SourceSnapshot) {
  if (source.kind === 'single') {
    const { input, ...identity } = source;
    const { dataset, ...settings } = input;
    return canonicalJson({ identity, settings, datasetId: dataset.id });
  }
  const { input, ...identity } = source;
  return canonicalJson({
    identity,
    symbols: input.assets.map((a) => a.dataset.symbol),
  });
}

export function replaySource(
  snapshot: SourceSnapshot,
  reference: string | null,
  now: number,
): CapturedSource {
  const meta = metadata(snapshot);
  let restored: CapturedSource;
  if (snapshot.kind === 'single') {
    if (snapshot.schemaVersion !== 1) throw new Error('源实验版本不支持。');
    assertExperimentMetadata(snapshot);
    requireFields(snapshot.input, [
      'dataset',
      'config',
      'risk',
      'strategy',
      'completedThroughUtcMs',
    ]);
    const actual = runExperiment(snapshot.input);
    restored = fromSingle(
      sealExperiment(actual, { ...meta, elapsedMs: snapshot.elapsedMs }),
      reference,
      now,
    );
  } else if (snapshot.kind === 'portfolio') {
    if (snapshot.schemaVersion !== 1) throw new Error('源组合实验版本不支持。');
    restored = fromPortfolio(
      createPortfolioExperiment(snapshot.input, meta, now),
      reference,
    );
  } else if (snapshot.kind === 'shared') {
    if (snapshot.schemaVersion !== 2)
      throw new Error('源共享资金池报告版本不支持。');
    restored = fromPortfolio(
      createSharedPoolExperiment(snapshot.input, meta, now),
      reference,
    );
  } else throw new Error('不支持的源实验类型。');
  if (replayIdentity(snapshot) !== replayIdentity(restored.source))
    throw new Error('源实验版本、身份或 Hash 与原内核重算不符。');
  return restored;
}
