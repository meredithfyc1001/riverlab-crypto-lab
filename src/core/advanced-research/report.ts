import { sha256 } from '@noble/hashes/sha2.js';
import { forEachCanonicalChunk } from '../backtests/identity';
import { assertDataset } from '../data/dataset';
import { validateSnapshotFields } from '../data/snapshot-fields';
import { DISCLAIMER } from '../experiments';
import {
  assertMetadata,
  assertPortfolioMemoryBudget,
  digestPattern,
  encodePortfolioCsv,
  MAX_PORTFOLIO_REPORT_BYTES,
  type Metadata,
} from '../portfolio/report-common';
import { ADVANCED_VERSION, ADVANCED_VERSIONS, runAdvanced } from './index';
import type { AdvancedInput, AdvancedResult } from './types';

const FORMAT = 'riverlab-advanced-research';
export const MAX_ADVANCED_REPORT_BYTES = MAX_PORTFOLIO_REPORT_BYTES;

export interface AdvancedReport extends Metadata {
  format: typeof FORMAT;
  schemaVersion: 1;
  algorithmVersion: typeof ADVANCED_VERSION;
  versions: typeof ADVANCED_VERSIONS;
  disclaimer: typeof DISCLAIMER;
  input: AdvancedInput;
  result: AdvancedResult;
  reportHash: string;
}

function checkObserved(input: AdvancedInput, observedUtcMs: number) {
  if (
    !Number.isSafeInteger(observedUtcMs) ||
    !Number.isSafeInteger(input?.completedThroughUtcMs) ||
    input.completedThroughUtcMs > observedUtcMs
  )
    throw new Error('高级研究的收盘确认时间无效或晚于当前时间。');
}

// Only optional metadata in live IndexedDB datasets can contain undefined.
// Validate it before taking a portable snapshot. Files must already be JSON.
export function captureAdvancedInput(
  input: AdvancedInput,
  observedUtcMs: number,
): AdvancedInput {
  checkObserved(input, observedUtcMs);
  assertDataset(input.dataset);
  validateSnapshotFields(input.dataset);
  const { candles, ...metadata } = input.dataset;
  return {
    ...input,
    dataset: { ...JSON.parse(JSON.stringify(metadata)), candles },
  };
}

function reportDigest(body: Omit<AdvancedReport, 'reportHash'>) {
  assertPortfolioMemoryBudget(body);
  const hash = sha256.create();
  let bytes = ',"reportHash":""'.length + 64;
  forEachCanonicalChunk(body, (chunk) => {
    bytes += chunk.length;
    if (bytes > MAX_ADVANCED_REPORT_BYTES)
      throw new Error('高级研究报告超过 32 MiB。');
    hash.update(chunk);
  });
  return Array.from(hash.digest(), (b) => b.toString(16).padStart(2, '0')).join(
    '',
  );
}

/** The scheduler calls this after joining all scheduled folds. */
export function sealAdvancedReport(
  input: AdvancedInput,
  result: AdvancedResult,
  metadata: Metadata,
): AdvancedReport {
  assertMetadata(metadata);
  const body = {
    format: FORMAT,
    schemaVersion: 1,
    algorithmVersion: ADVANCED_VERSION,
    versions: ADVANCED_VERSIONS,
    disclaimer: DISCLAIMER,
    id: metadata.id,
    name: metadata.name,
    createdUtcMs: metadata.createdUtcMs,
    input,
    result,
  } as const;
  return { ...body, reportHash: reportDigest(body) };
}

export function verifyAdvancedReport(
  value: unknown,
  observedUtcMs: number,
): AdvancedReport {
  const report = value as AdvancedReport;
  if (
    report?.format !== FORMAT ||
    report.schemaVersion !== 1 ||
    report.algorithmVersion !== ADVANCED_VERSION
  )
    throw new Error('高级研究报告格式或版本不支持。');
  assertMetadata(report);
  checkObserved(report.input, observedUtcMs);
  const { reportHash, ...body } = report;
  if (
    typeof reportHash !== 'string' ||
    !digestPattern.test(reportHash) ||
    reportDigest(body) !== reportHash
  )
    throw new Error('高级研究报告 Hash 不符。');
  assertDataset(report.input.dataset);
  validateSnapshotFields(report.input.dataset);
  const rebuilt = sealAdvancedReport(
    report.input,
    runAdvanced(report.input),
    report,
  );
  if (rebuilt.reportHash !== reportHash)
    throw new Error('高级研究报告与完整重算结果不符。');
  return rebuilt;
}

export function advancedCsv(report: AdvancedReport) {
  const { plan, folds } = report.result;
  const rows: (string | number)[][] = [
    [DISCLAIMER],
    ['reportHash', report.reportHash],
    ['algorithmVersion', report.algorithmVersion],
    ['ruleVersion', report.input.ruleRecord.id],
    ['ruleHash', report.input.ruleRecord.ruleHash],
    ['search', JSON.stringify(report.input.search)],
    ['axes', JSON.stringify(report.input.axes)],
    ['filters', JSON.stringify(report.input.filters)],
    ['sort', JSON.stringify(report.input.sort)],
    [],
    ['invalidParameters', 'reason'],
    ...plan.invalid.map((c) => [JSON.stringify(c.values), c.reason]),
    [],
    [
      'fold',
      'role',
      'startBarInclusive',
      'endBarExclusive',
      'candidateId',
      'parameters',
      'trainingSelection',
      'totalReturn',
      'maxDrawdown',
      'profitFactor',
      'completedTrades',
      'netPnl',
      'finalEquity',
      'runHash',
      'reasons',
    ],
  ];
  const candidates = new Map(
    plan.candidates.map((c) => [c.id, JSON.stringify(c.values)]),
  );
  for (const fold of folds) {
    for (const row of [...fold.train, ...(fold.test ? [fold.test] : [])]) {
      const metrics = row.metrics;
      rows.push([
        row.window.fold,
        row.window.role,
        row.window.start,
        row.window.end,
        row.candidateId,
        candidates.get(row.candidateId)!,
        Number(row.candidateId === fold.selectedId),
        metrics?.totalReturn ?? 'NA',
        metrics?.maxDrawdown ?? 'NA',
        metrics?.profitFactor ?? 'NA',
        metrics?.completedTrades ?? 'NA',
        metrics?.netPnl ?? 'NA',
        metrics?.finalEquity ?? 'NA',
        row.runHash ?? 'NA',
        row.reasons.join(' / '),
      ]);
    }
  }
  rows.push(
    [],
    [
      'fold',
      'role',
      'candidateId',
      'regime',
      'bars',
      'netPnl',
      'realizedDelta',
      'unrealizedDelta',
      'fees',
      'fills',
    ],
  );
  for (const fold of folds) {
    for (const row of [...fold.train, ...(fold.test ? [fold.test] : [])]) {
      for (const s of row.regimes ?? []) {
        rows.push([
          row.window.fold,
          row.window.role,
          row.candidateId,
          s.state,
          s.bars,
          s.netPnl,
          s.realizedDelta,
          s.unrealizedDelta,
          s.fees,
          s.fills,
        ]);
      }
    }
  }
  return encodePortfolioCsv(rows);
}
