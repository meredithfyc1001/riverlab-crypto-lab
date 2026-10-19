import type {
  CsvInspection,
  CsvSettings,
  ImportOptions,
  ImportReport,
} from '../../core/data';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export interface CsvJob {
  file: File;
  settings: CsvSettings;
  options?: ImportOptions;
  expectedSha256?: string;
  includeCandles?: boolean;
}
import type { FileIdentity } from '../../core/data/dataset';
export type { FileIdentity } from '../../core/data/dataset';
export type ReportView = Omit<ImportReport, 'candles'>;
export type CsvResult = { identity: FileIdentity } & (
  | { kind: 'inspection'; inspection: CsvInspection }
  | { kind: 'report'; report: ReportView }
  | { kind: 'ready'; report: ImportReport }
);
export type CsvResponse =
  { ok: true; result: CsvResult } | { ok: false; error: string };
