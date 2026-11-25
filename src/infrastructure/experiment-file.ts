import { fields } from '../core/data';
import type { Dataset } from '../core/data/dataset';
import { verifyExperiment } from '../core/experiments';
import type { Experiment } from '../core/experiments';

// A pretty-printed 50,000-bar experiment includes signals, fills and equity points.
const MAX_EXPERIMENT_BYTES = 256 * 1024 * 1024;
const REPORT_FIELDS = new Set([
  'format',
  'schemaVersion',
  'id',
  'name',
  'createdUtcMs',
  'elapsedMs',
  'payloadHash',
  'payload',
]);

// The engine independently regenerates result fields, but the original dataset
// metadata is carried forward. Check its versioned shape at the file boundary.
function validateSnapshotFields(d: Dataset) {
  const only = (value: object, allowed: readonly string[]) => {
    if (Object.keys(value).some((key) => !allowed.includes(key)))
      throw new Error('实验数据快照含有未知字段。');
  };
  only(d, [
    'schemaVersion',
    'id',
    'name',
    'symbol',
    'createdUtcMs',
    'source',
    'file',
    'parsing',
    'quality',
    'warningsAcknowledged',
    'candles',
  ]);
  only(d.source, ['kind', 'label', 'note', 'url', 'expectedSha256']);
  only(d.file, ['name', 'bytes', 'sha256', 'parserVersion']);
  only(d.parsing, [
    'delimiter',
    'hasHeader',
    'mapping',
    'timeUnit',
    'intervalMs',
  ]);
  only(d.quality, [
    'totalRows',
    'validRows',
    'blankLines',
    'timeUnit',
    'intervalMs',
    'range',
    'gapCount',
    'missingCandles',
    'warningCount',
    'issues',
    'issueCounts',
    'issueDetailsTruncated',
  ]);
  only(d.quality.range!, ['startUtcMs', 'endUtcMs']);
  for (const issue of d.quality.issues) {
    only(issue, ['severity', 'code', 'message', 'line', 'field', 'raw']);
    if (
      (issue.field !== undefined && !fields.includes(issue.field)) ||
      (issue.line !== undefined &&
        (!Number.isSafeInteger(issue.line) || issue.line < 1)) ||
      (issue.raw !== undefined &&
        (typeof issue.raw !== 'string' || issue.raw.length > 240))
    )
      throw new Error('实验数据质量明细无效。');
  }
  const candleFields = [
    'timestampUtcMs',
    'open',
    'high',
    'low',
    'close',
    'volume',
  ];
  for (const candle of d.candles) only(candle, candleFields);
}

/** Worker file boundary. Only this envelope is accepted by the restore UI. */
export async function readExperimentFile(file: Blob): Promise<Experiment> {
  if (!file.size || file.size > MAX_EXPERIMENT_BYTES)
    throw new Error('实验文件为空或超过 256 MiB，已停止读取。');
  let value: unknown;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(
      await file.arrayBuffer(),
    );
    value = JSON.parse(text);
  } catch {
    throw new Error('实验文件无法读取为有效的 UTF-8 JSON。');
  }
  if (
    !value ||
    typeof value !== 'object' ||
    !('format' in value) ||
    value.format !== 'riverlab-experiment'
  )
    throw new Error('文件格式不符，请选择从回测结果导出的完整实验 JSON。');
  if (!('schemaVersion' in value) || value.schemaVersion !== 1)
    throw new Error('实验 JSON 版本不支持。');
  if (Object.keys(value).some((key) => !REPORT_FIELDS.has(key)))
    throw new Error('实验 JSON 含有未知字段。');
  const { format, ...record } = value;
  void format;
  const experiment = verifyExperiment(record);
  if (experiment.payload.result.manifest.completedThroughUtcMs > Date.now())
    throw new Error('实验声明的收盘时间晚于当前时间，无法恢复。');
  validateSnapshotFields(experiment.payload.dataset);
  return experiment;
}
