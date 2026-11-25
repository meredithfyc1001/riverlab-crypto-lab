import {
  verifySharedPoolExperiment,
  sharedPoolCsv,
} from '../core/shared-pool/report';
import { MAX_PORTFOLIO_REPORT_BYTES } from '../core/portfolio/report-common';
import { parsePortfolioFile } from './portfolio-file';

export async function readSharedPoolFile(file: Blob, observedUtcMs: number) {
  return verifySharedPoolExperiment(
    await parsePortfolioFile(file),
    observedUtcMs,
  );
}
export function exportSharedPoolFile(
  value: unknown,
  format: 'json' | 'csv',
  observedUtcMs: number,
) {
  const record = verifySharedPoolExperiment(value, observedUtcMs);
  const file =
    format === 'json'
      ? new Blob([JSON.stringify(record)], {
          type: 'application/json;charset=utf-8',
        })
      : new Blob([sharedPoolCsv(record)], { type: 'text/csv;charset=utf-8' });
  if (file.size > MAX_PORTFOLIO_REPORT_BYTES)
    throw new Error('组合报告超过 32 MiB。');
  return file;
}
