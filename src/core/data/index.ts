import type { ModuleBoundary } from '../../shared/module';

export const dataBoundary: ModuleBoundary = {
  id: 'data',
  label: '数据',
  responsibility:
    '纯 TypeScript CSV 解析、字段映射、UTC 毫秒规范化及行情质量报告。',
};

/** 内部时间统一为 UTC 毫秒，金额账本不使用此展示价格类型计算。 */
export interface Candle {
  readonly timestampUtcMs: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

export interface SyntheticDataset {
  readonly id: string;
  readonly source: 'synthetic';
  readonly label: string;
  readonly disclaimer: string;
  readonly candles: readonly Candle[];
}

export { inspectCsv, parseCsv, suggestMapping } from './csv';
export { analyzeCsv } from './analyze';
export { inferTimeUnit, normalizeTimestamp } from './timestamps';
export { fields, MAX_DATA_ROWS, MAX_CSV_CHARS, MAX_ISSUES } from './csv-types';
export type {
  CandleField,
  ColumnMapping,
  CsvInspection,
  CsvSettings,
  DataIssue,
  ImportOptions,
  ImportReport,
  TimeUnit,
} from './csv-types';
