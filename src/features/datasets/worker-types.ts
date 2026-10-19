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
}
export interface FileIdentity {
  name: string;
  bytes: number;
  sha256: string;
  parserVersion: 'csv-v1';
}
export type ReportView = Omit<ImportReport, 'candles'>;
export type CsvResult = { identity: FileIdentity } & (
  | { kind: 'inspection'; inspection: CsvInspection }
  | { kind: 'report'; report: ReportView }
);
export type CsvResponse =
  { ok: true; result: CsvResult } | { ok: false; error: string };
