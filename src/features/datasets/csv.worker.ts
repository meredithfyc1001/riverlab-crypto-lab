import { analyzeCsv, inspectCsv } from '../../core/data';
import { MAX_FILE_BYTES } from './worker-types';
import type { CsvJob, CsvResponse, CsvResult } from './worker-types';

self.onmessage = async (event: MessageEvent<CsvJob>) => {
  try {
    const { file, settings, options, expectedSha256 } = event.data;
    if (file.size > MAX_FILE_BYTES)
      throw new Error('文件超过 10 MiB，请拆分 CSV。');
    const bytes = await file.arrayBuffer();
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const sha256 = [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
    if (expectedSha256 && sha256 !== expectedSha256)
      throw new Error('内置历史样本哈希与来源记录不符，停止导入。');
    const identity = {
      name: file.name,
      bytes: file.size,
      sha256,
      parserVersion: 'csv-v1' as const,
    };
    let result: CsvResult;
    if (options) {
      const fullReport = analyzeCsv(text, options);
      const { candles, ...report } = fullReport;
      if (candles.length !== report.validRows)
        throw new Error('有效候选行统计不一致，停止显示结果。');
      if (event.data.includeCandles) {
        if (
          report.status !== 'reviewed' ||
          report.errorCount ||
          report.needsConfirmation.length ||
          !candles.length
        )
          throw new Error('数据存在阻断问题，不能用于图表或保存。');
        result = { kind: 'ready', identity, report: fullReport };
      } else result = { kind: 'report', identity, report };
    } else
      result = {
        kind: 'inspection',
        identity,
        inspection: inspectCsv(text, settings),
      };
    self.postMessage({ ok: true, result } satisfies CsvResponse);
  } catch (error) {
    const message =
      error instanceof TypeError
        ? '文件必须是有效 UTF-8 CSV（支持 BOM），或当前浏览器不支持所需本地能力。'
        : error instanceof Error
          ? error.message
          : 'CSV 处理失败。';
    self.postMessage({ ok: false, error: message } satisfies CsvResponse);
  }
};
