import { sha256 } from '@noble/hashes/sha2.js';
import { forEachCanonicalChunk } from '../backtests/identity';
import {
  assertMetadata,
  assertPortfolioMemoryBudget,
  digestPattern,
  encodePortfolioCsv,
  MAX_PORTFOLIO_REPORT_BYTES,
} from '../portfolio/report-common';
import type { Metadata } from '../portfolio/report-common';
import {
  analyzeRegimes,
  assertRegimeParams,
  REGIME_MODEL_VERSION,
  REGIME_ATTRIBUTION_VERSION,
} from './model';
import type { RegimeParams, RegimeResult } from './model';
import { captureSource, replaySource, sourceCandles } from './source';
import type { SourceSnapshot } from './source';

export const REGIME_VERSION = REGIME_ATTRIBUTION_VERSION;
export const MAX_REGIME_REPORT_BYTES = MAX_PORTFOLIO_REPORT_BYTES;
const FORMAT = 'riverlab-market-regime';
export interface RegimeReport extends Metadata {
  format: typeof FORMAT;
  schemaVersion: 1;
  algorithmVersion: typeof REGIME_VERSION;
  modelVersion: typeof REGIME_MODEL_VERSION;
  reference: string | null;
  params: RegimeParams;
  source: SourceSnapshot;
  result: RegimeResult;
  reportHash: string;
}

function digest(body: Omit<RegimeReport, 'reportHash'>) {
  // The shared admission estimate reserves space for file decoding and two
  // report trees. Original engine replay has its own independent limits.
  assertPortfolioMemoryBudget(body);
  const hash = sha256.create();
  let bytes = ',"reportHash":""'.length + 64;
  forEachCanonicalChunk(body, (chunk) => {
    bytes += chunk.length;
    if (bytes > MAX_REGIME_REPORT_BYTES)
      throw new Error('市场状态报告超过 32 MiB，请缩短原实验区间。');
    hash.update(chunk);
  });
  return Array.from(hash.digest(), (b) => b.toString(16).padStart(2, '0')).join(
    '',
  );
}

function seal(
  captured: ReturnType<typeof captureSource>,
  reference: string | null,
  params: RegimeParams,
  metadata: Metadata,
): RegimeReport {
  const body = {
    format: FORMAT,
    schemaVersion: 1,
    algorithmVersion: REGIME_VERSION,
    modelVersion: REGIME_MODEL_VERSION,
    id: metadata.id,
    name: metadata.name,
    createdUtcMs: metadata.createdUtcMs,
    reference,
    params: { ...params },
    source: captured.source,
    result: analyzeRegimes(captured.series, params),
  } as const;
  return { ...body, reportHash: digest(body) };
}

export function createRegimeReport(
  kind: SourceSnapshot['kind'],
  original: unknown,
  reference: string | null,
  params: RegimeParams,
  metadata: Metadata,
  observedUtcMs: number,
): RegimeReport {
  assertMetadata(metadata);
  assertRegimeParams(params);
  return seal(
    captureSource(kind, original, reference, observedUtcMs),
    reference,
    params,
    metadata,
  );
}

export function verifyRegimeReport(
  value: unknown,
  observedUtcMs: number,
): RegimeReport {
  const r = value as RegimeReport;
  if (
    r?.format !== FORMAT ||
    r.schemaVersion !== 1 ||
    r.modelVersion !== REGIME_MODEL_VERSION ||
    r.algorithmVersion !== REGIME_VERSION
  )
    throw new Error('市场状态报告格式或版本不支持。');
  assertMetadata(r);
  const { reportHash, ...body } = r;
  if (
    typeof reportHash !== 'string' ||
    !digestPattern.test(reportHash) ||
    digest(body) !== reportHash
  )
    throw new Error('市场状态报告 Hash 不符。');
  const rebuilt = seal(
    replaySource(r.source, r.reference, observedUtcMs),
    r.reference,
    r.params,
    r,
  );
  if (rebuilt.reportHash !== reportHash)
    throw new Error('市场状态报告与原实验重算结果不符。');
  return rebuilt;
}

/** Called only on a generated or verified report. */
export function regimeCandles(r: RegimeReport) {
  return sourceCandles(r.source, r.reference);
}

export function regimeCsv(r: RegimeReport): string {
  const rows: (string | number)[][] = [
    ['历史市场状态研究，标签仅描述已完成的历史行情'],
    [
      'reportHash',
      'sourceExperimentId',
      'sourcePayloadHash',
      'algorithmVersion',
      'modelVersion',
      'referenceSymbol',
      'lookback',
      'thresholdBps',
      'netPnl',
      'switches',
    ],
    [
      r.reportHash,
      r.source.id,
      r.source.payloadHash,
      r.algorithmVersion,
      r.modelVersion,
      r.reference ??
        (r.source.kind === 'single' ? r.source.input.dataset.symbol : 'NA'),
      r.params.lookback,
      r.params.thresholdBps,
      r.result.netPnl,
      r.result.switches,
    ],
    [],
    [
      'state',
      'bars',
      'durationMs',
      'timeFraction',
      'occurrences',
      'equityChange',
      'realizedChange',
      'unrealizedChange',
      'fills',
      'fees',
      'exposedMs',
      'exposureFraction',
      'periodReturnCount',
      'minPeriodReturn',
      'medianPeriodReturn',
      'maxPeriodReturn',
      'meanPeriodReturn',
      'periodVolatility',
      'assetReturnCount',
      'minAssetReturn',
      'medianAssetReturn',
      'maxAssetReturn',
      'meanAssetReturn',
      'assetPeriodVolatility',
    ],
    ...r.result.summaries.map((s) => [
      s.state,
      s.bars,
      s.durationMs,
      s.timeFraction,
      s.occurrences,
      s.netPnl,
      s.realizedDelta,
      s.unrealizedDelta,
      s.fills,
      s.fees,
      s.exposedMs,
      s.exposureFraction ?? 'NA',
      s.periodReturns.count,
      s.periodReturns.min ?? 'NA',
      s.periodReturns.median ?? 'NA',
      s.periodReturns.max ?? 'NA',
      s.periodReturns.mean ?? 'NA',
      s.periodReturns.volatility ?? 'NA',
      s.assetReturns.count,
      s.assetReturns.min ?? 'NA',
      s.assetReturns.median ?? 'NA',
      s.assetReturns.max ?? 'NA',
      s.assetReturns.mean ?? 'NA',
      s.assetReturns.volatility ?? 'NA',
    ]),
    [],
    [
      'state',
      'startUtcMsInclusive',
      'endUtcMsExclusive',
      'bars',
      'startEquity',
      'endEquity',
      'netPnl',
      'returnFraction',
    ],
    ...r.result.runs.map((s) => [
      s.state,
      s.startUtcMs,
      s.endUtcMs,
      s.bars,
      s.startEquity,
      s.endEquity,
      s.netPnl,
      s.returnFraction ?? 'NA',
    ]),
  ];
  return encodePortfolioCsv(rows);
}
