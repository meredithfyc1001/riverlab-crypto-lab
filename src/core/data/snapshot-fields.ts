import { fields } from './csv-types';
import type { Dataset } from './dataset';

// The engine independently regenerates result fields, but the original dataset
// metadata is carried forward. Check its versioned shape at the file boundary.
export function validateSnapshotFields(d: Dataset) {
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
