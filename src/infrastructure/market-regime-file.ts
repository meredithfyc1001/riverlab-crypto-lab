import {
  MAX_REGIME_REPORT_BYTES,
  regimeCsv,
  verifyRegimeReport,
} from '../core/market-regime/report';

export async function readRegimeFile(file: Blob, now: number) {
  if (!file.size || file.size > MAX_REGIME_REPORT_BYTES)
    throw new Error('市场状态报告为空或超过 32 MiB。');
  let parsed: unknown;
  try {
    const bytes = await file.arrayBuffer();
    parsed = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    );
  } catch {
    throw new Error('市场状态报告无法读取为有效的 UTF-8 JSON。');
  }
  return verifyRegimeReport(parsed, now);
}

export function exportRegimeFile(
  value: unknown,
  format: 'json' | 'csv',
  now: number,
) {
  const report = verifyRegimeReport(value, now);
  const blob =
    format === 'csv'
      ? new Blob([regimeCsv(report)], { type: 'text/csv;charset=utf-8' })
      : new Blob([JSON.stringify(report)], {
          type: 'application/json;charset=utf-8',
        });
  if (blob.size > MAX_REGIME_REPORT_BYTES)
    throw new Error('市场状态导出文件超过 32 MiB。');
  return blob;
}
