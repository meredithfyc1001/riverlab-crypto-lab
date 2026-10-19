import type { Candle, ImportOptions, ImportReport } from './index';
import { MAX_DATA_ROWS } from './csv-types';

export interface DataSource {
  kind: 'historical' | 'synthetic' | 'error-fixture' | 'user-unverified';
  label: string;
  note: string;
  url?: string;
  expectedSha256?: string;
}
export interface FileIdentity {
  name: string;
  bytes: number;
  sha256: string;
  parserVersion: 'csv-v1';
}
export type QualitySnapshot = Pick<
  ImportReport,
  | 'totalRows'
  | 'validRows'
  | 'blankLines'
  | 'timeUnit'
  | 'intervalMs'
  | 'range'
  | 'gapCount'
  | 'missingCandles'
  | 'warningCount'
  | 'issues'
  | 'issueCounts'
  | 'issueDetailsTruncated'
>;
export interface Dataset {
  schemaVersion: 1;
  id: string;
  name: string;
  symbol: string;
  createdUtcMs: number;
  source: DataSource;
  file: FileIdentity;
  parsing: ImportOptions;
  quality: QualitySnapshot;
  warningsAcknowledged: true;
  candles: Candle[];
}
export type DatasetSummary = Omit<Dataset, 'candles'>;
export function summarizeDataset({
  candles: _candles,
  ...summary
}: Dataset): DatasetSummary {
  void _candles;
  return summary;
}
export function makeDataset(
  metadata: Omit<Dataset, 'schemaVersion' | 'quality' | 'candles'>,
  report: ImportReport,
): Dataset {
  if (
    report.status !== 'reviewed' ||
    report.errorCount ||
    report.needsConfirmation.length ||
    report.invalidRows ||
    report.pendingRows ||
    !report.candles.length
  )
    throw new Error(
      '存在错误、待确认项或空数据，不能用于图表或保存；不截取有效子集。',
    );
  const {
    totalRows,
    validRows,
    blankLines,
    timeUnit,
    intervalMs,
    range,
    gapCount,
    missingCandles,
    warningCount,
    issues,
    issueCounts,
    issueDetailsTruncated,
  } = report;
  const dataset: Dataset = {
    ...metadata,
    schemaVersion: 1,
    quality: {
      totalRows,
      validRows,
      blankLines,
      timeUnit,
      intervalMs,
      range,
      gapCount,
      missingCandles,
      warningCount,
      issues,
      issueCounts,
      issueDetailsTruncated,
    },
    candles: report.candles,
  };
  assertDataset(dataset);
  return dataset;
}
const boundedText = (v: unknown, max: number) =>
  typeof v === 'string' && v.length > 0 && v.length <= max;
const integer = (v: unknown, max = Number.MAX_SAFE_INTEGER): v is number =>
  Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= max;
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
/** Validate at every trust boundary: worker handoff, IndexedDB read/write, backup restore. */
export function assertDataset(value: unknown): asserts value is Dataset {
  const d = value as Dataset | null;
  function fail(message: string): never {
    throw new Error(`数据集损坏或版本不支持：${message}；未修复。`);
  }
  if (
    !d ||
    d.schemaVersion !== 1 ||
    !boundedText(d.id, 100) ||
    !boundedText(d.name, 160) ||
    !boundedText(d.symbol, 80) ||
    !integer(d.createdUtcMs, 4_102_444_800_000) ||
    d.warningsAcknowledged !== true
  )
    fail('身份/版本/确认信息无效');
  if (
    !d.source ||
    !['historical', 'synthetic', 'error-fixture', 'user-unverified'].includes(
      d.source.kind,
    ) ||
    !boundedText(d.source.label, 300) ||
    !boundedText(d.source.note, 3000) ||
    (d.source.url !== undefined &&
      (!boundedText(d.source.url, 2000) ||
        !/^https:\/\//.test(d.source.url))) ||
    (d.source.expectedSha256 !== undefined && !hash(d.source.expectedSha256))
  )
    fail('来源信息无效');
  if (
    !d.file ||
    !boundedText(d.file.name, 300) ||
    !integer(d.file.bytes, 10 * 1024 * 1024) ||
    !hash(d.file.sha256) ||
    d.file.parserVersion !== 'csv-v1' ||
    (d.source.expectedSha256 && d.source.expectedSha256 !== d.file.sha256)
  )
    fail('文件身份无效');
  const q = d.quality;
  if (
    !q ||
    !integer(q.intervalMs, 31_536_000_000) ||
    !q.intervalMs ||
    !['ms', 'us', 'iso'].includes(q.timeUnit!) ||
    !Array.isArray(d.candles) ||
    d.candles.length < 1 ||
    d.candles.length > MAX_DATA_ROWS ||
    q.validRows !== d.candles.length ||
    q.totalRows !== q.validRows ||
    !integer(q.blankLines) ||
    !integer(q.gapCount) ||
    !integer(q.missingCandles) ||
    !integer(q.warningCount) ||
    !Array.isArray(q.issues) ||
    q.issues.length > 1000 ||
    !q.issueCounts ||
    q.issueCounts.COVERAGE_UNVERIFIED !== 1 ||
    typeof q.issueDetailsTruncated !== 'boolean'
  )
    fail('质量信息无效');
  if (
    !d.parsing ||
    ![',', ';', '\t'].includes(d.parsing.delimiter) ||
    typeof d.parsing.hasHeader !== 'boolean' ||
    !['auto', 'ms', 'us', 'iso'].includes(d.parsing.timeUnit) ||
    d.parsing.intervalMs !== q.intervalMs ||
    (d.parsing.timeUnit !== 'auto' && d.parsing.timeUnit !== q.timeUnit) ||
    !d.parsing.mapping
  )
    fail('解析约定无效');
  const mapped = Object.values(d.parsing.mapping);
  if (
    mapped.length !== 6 ||
    new Set(mapped).size !== 6 ||
    mapped.some((v) => !integer(v, 63)) ||
    !['timestamp', 'open', 'high', 'low', 'close', 'volume'].every(
      (k) => k in d.parsing.mapping,
    )
  )
    fail('字段映射无效');
  let warningTotal = 0;
  for (const [code, count] of Object.entries(q.issueCounts)) {
    if (!/^[A-Z_]{1,60}$/.test(code) || !integer(count) || count === 0)
      fail('警告计数无效');
    warningTotal += count;
  }
  if (
    warningTotal !== q.warningCount ||
    q.issues.length !== Math.min(1000, q.warningCount) ||
    q.issueDetailsTruncated !== q.warningCount > 1000
  )
    fail('警告总数不一致');
  for (const issue of q.issues)
    if (
      !issue ||
      issue.severity !== 'warning' ||
      !boundedText(issue.code, 60) ||
      !boundedText(issue.message, 3000) ||
      !q.issueCounts[issue.code]
    )
      fail('警告明细无效');
  let gapCount = 0,
    missing = 0;
  for (let i = 0; i < d.candles.length; i++) {
    const c = d.candles[i];
    if (
      !c ||
      !integer(c.timestampUtcMs, 4_102_444_800_000) ||
      ![c.open, c.high, c.low, c.close].every(
        (v) => typeof v === 'number' && Number.isFinite(v) && v > 0,
      ) ||
      typeof c.volume !== 'number' ||
      !Number.isFinite(c.volume) ||
      c.volume < 0 ||
      c.low > Math.min(c.open, c.close) ||
      c.high < Math.max(c.open, c.close) ||
      c.low > c.high
    )
      fail(`第 ${i + 1} 根价格/量/UTC 时间非法`);
    if (i) {
      const delta = c.timestampUtcMs - d.candles[i - 1].timestampUtcMs;
      if (delta <= 0 || delta % q.intervalMs! !== 0)
        fail(`第 ${i + 1} 根重复、降序或周期不符`);
      if (delta > q.intervalMs!) {
        gapCount++;
        missing += delta / q.intervalMs! - 1;
      }
    }
  }
  if (
    q.gapCount !== gapCount ||
    q.missingCandles !== missing ||
    (gapCount > 0 && q.issueCounts.MISSING_CANDLES !== 1) ||
    !q.range ||
    q.range.startUtcMs !== d.candles[0].timestampUtcMs ||
    q.range.endUtcMs !== d.candles.at(-1)!.timestampUtcMs
  )
    fail('范围或缺口不一致');
}
