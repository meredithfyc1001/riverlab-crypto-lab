import type { Candle } from './index';

export const fields = [
  'timestamp',
  'open',
  'high',
  'low',
  'close',
  'volume',
] as const;
export type CandleField = (typeof fields)[number];
export type ColumnMapping = Record<CandleField, number | null>;
export type TimeUnit = 'auto' | 'ms' | 'us' | 'iso';
export interface CsvSettings {
  delimiter: ',' | ';' | '\t';
  hasHeader: boolean;
}
export interface ImportOptions extends CsvSettings {
  mapping: ColumnMapping;
  timeUnit: TimeUnit;
  intervalMs: number | null;
}
export const MAX_CSV_CHARS = 10 * 1024 * 1024;
export const MAX_DATA_ROWS = 50_000;
export const MAX_ISSUES = 1000;
export const MAX_COLUMNS = 64;
export interface DataIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  line?: number;
  field?: CandleField;
  raw?: string;
}
export interface CsvRecord {
  line: number;
  cells: string[];
  malformed: boolean;
  /** 原始记录文本（不含终止换行），保留引号/转义与内部换行。 */
  raw: string;
}
export interface CsvDocument {
  headers: string[];
  records: CsvRecord[];
  issues: DataIssue[];
  blankLines: number;
  truncated: boolean;
}
export interface CsvInspection {
  headers: string[];
  mapping: ColumnMapping;
  preview: CsvRecord[];
  recordCount: number;
  issues: DataIssue[];
  truncated: boolean;
}
export interface GapInterval {
  afterUtcMs: number;
  beforeUtcMs: number;
  missingCount: number;
}
export interface ImportReport {
  status: 'needs-confirmation' | 'has-errors' | 'reviewed';
  totalRows: number;
  validRows: number;
  invalidRows: number;
  pendingRows: number;
  blankLines: number;
  timeUnit: Exclude<TimeUnit, 'auto'> | null;
  intervalMs: number | null;
  suggestedIntervalMs: number | null;
  needsConfirmation: ('timeUnit' | 'interval')[];
  range: { startUtcMs: number; endUtcMs: number } | null;
  duplicateRows: number;
  duplicateGroups: number;
  missingCandles: number;
  gapCount: number;
  gaps: GapInterval[];
  errorCount: number;
  warningCount: number;
  issueCounts: Record<string, number>;
  issues: DataIssue[];
  issueDetailsTruncated: boolean;
  preview: { line: number; candle: Candle }[];
  /** 候选有效行，保持输入顺序；有阻断问题时不能当作已完成数据集。 */
  candles: Candle[];
}
