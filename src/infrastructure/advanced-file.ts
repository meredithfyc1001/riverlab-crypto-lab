import {
  MAX_ADVANCED_REPORT_BYTES,
  advancedCsv,
  verifyAdvancedReport,
} from '../core/advanced-research/report';

// Count a lower bound on container allocations before JSON.parse materializes
// the tree. The exact logical admission check follows during report hashing.
function checkJsonBudget(text: string) {
  let depth = 0,
    treeBytes = 0,
    inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (inString) {
      if (ch === 92)
        i++; // escaped code unit
      else if (ch === 34) inString = false;
      continue;
    }
    if (ch === 34) inString = true;
    else if (ch === 123 || ch === 91) {
      if (++depth > 41) throw new Error('高级研究报告嵌套过深。');
      treeBytes += ch === 123 ? 64 : 32;
    } else if (ch === 125 || ch === 93) depth--;
    else if (ch === 44) treeBytes += 8;
    if (treeBytes > 64 * 1024 * 1024)
      throw new Error('高级研究报告超出内存预算。');
  }
}

export async function readAdvancedFile(file: Blob, observedUtcMs: number) {
  if (!file.size || file.size > MAX_ADVANCED_REPORT_BYTES)
    throw new Error('高级研究报告为空或超过 32 MiB。');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(
      await file.arrayBuffer(),
    );
  } catch {
    throw new Error('高级研究报告无法读取为有效的 UTF-8 JSON。');
  }
  checkJsonBudget(text);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('高级研究报告无法读取为有效的 UTF-8 JSON。');
  }
  return verifyAdvancedReport(value, observedUtcMs);
}

export function exportAdvancedFile(
  value: unknown,
  format: 'json' | 'csv',
  observedUtcMs: number,
) {
  const record = verifyAdvancedReport(value, observedUtcMs);
  const file =
    format === 'csv'
      ? new Blob([advancedCsv(record)], { type: 'text/csv;charset=utf-8' })
      : new Blob([JSON.stringify(record)], {
          type: 'application/json;charset=utf-8',
        });
  if (file.size > MAX_ADVANCED_REPORT_BYTES)
    throw new Error('高级研究导出文件超过 32 MiB。');
  return file;
}
