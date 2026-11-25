import {
  MAX_PORTFOLIO_REPORT_BYTES,
  verifyPortfolioExperiment,
  portfolioCsv,
} from '../core/portfolio/report';
import type { PortfolioExperiment } from '../core/portfolio/report';

export async function readPortfolioFile(
  file: Blob,
  observedUtcMs: number,
): Promise<PortfolioExperiment> {
  if (!file.size || file.size > MAX_PORTFOLIO_REPORT_BYTES)
    throw new Error('组合文件为空或超过 32 MiB。');
  let value: unknown;
  try {
    const bytes = await file.arrayBuffer();
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error('组合文件无法读取为有效的 UTF-8 JSON。');
  }
  return verifyPortfolioExperiment(value, observedUtcMs);
}

export function exportPortfolioFile(
  value: unknown,
  format: 'json' | 'csv',
  observedUtcMs: number,
): Blob {
  const record = verifyPortfolioExperiment(value, observedUtcMs);
  return format === 'json'
    ? new Blob([JSON.stringify(record)], {
        type: 'application/json;charset=utf-8',
      })
    : new Blob([portfolioCsv(record)], { type: 'text/csv;charset=utf-8' });
}
