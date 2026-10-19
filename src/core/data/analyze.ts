import type { Candle } from './index';
import { parseCsv } from './csv';
import { inferTimeUnit, normalizeTimestamp } from './timestamps';
import { fields, MAX_ISSUES } from './csv-types';
import type {
  CandleField,
  DataIssue,
  ImportOptions,
  ImportReport,
} from './csv-types';

const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const labels: Record<CandleField, string> = {
  timestamp: '时间戳',
  open: '开盘价',
  high: '最高价',
  low: '最低价',
  close: '收盘价',
  volume: '成交量',
};
export function analyzeCsv(text: string, options: ImportOptions): ImportReport {
  const document = parseCsv(text, options);
  const rowsByLine = new Map(document.records.map((row) => [row.line, row]));
  const issues: DataIssue[] = [];
  const errorRows = new Set<number>();
  const issueCounts: Record<string, number> = {};
  let errorCount = 0;
  let warningCount = 0;
  function add(issue: DataIssue) {
    if (issue.severity === 'error') {
      errorCount++;
      if (issue.line !== undefined) errorRows.add(issue.line);
    } else warningCount++;
    issueCounts[issue.code] = (issueCounts[issue.code] ?? 0) + 1;
    if (issues.length < MAX_ISSUES) {
      const row =
        issue.line === undefined ? undefined : rowsByLine.get(issue.line);
      const raw = issue.raw ?? row?.raw;
      issues.push({ ...issue, raw: raw?.slice(0, 240) });
    }
  }
  document.issues.forEach(add);
  const report: ImportReport = {
    status: 'reviewed',
    totalRows: document.records.length,
    validRows: 0,
    invalidRows: 0,
    pendingRows: 0,
    blankLines: document.blankLines,
    timeUnit: null,
    intervalMs: null,
    suggestedIntervalMs: null,
    needsConfirmation: [],
    range: null,
    duplicateRows: 0,
    duplicateGroups: 0,
    missingCandles: 0,
    gapCount: 0,
    gaps: [],
    errorCount: 0,
    warningCount: 0,
    issueCounts,
    issues,
    issueDetailsTruncated: false,
    preview: [],
    candles: [],
  };
  if (document.blankLines)
    add({
      severity: 'warning',
      code: 'BLANK_LINES',
      message: `跳过 ${document.blankLines} 条纯空白行；未把它们当作行情。`,
    });
  let mappingValid = true;
  const used = new Set<number>();
  for (const field of fields) {
    const index = options.mapping[field];
    if (
      index === null ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= document.headers.length ||
      used.has(index)
    ) {
      mappingValid = false;
      add({
        severity: 'error',
        code: 'MAPPING',
        field,
        message: `${labels[field]}需要映射到独立、存在的列。`,
      });
    } else used.add(index);
  }
  const rows = document.records;
  const rawValue = (cells: string[], field: CandleField) =>
    cells[options.mapping[field] ?? -1]?.trim() ?? '';
  if (mappingValid) {
    report.timeUnit =
      options.timeUnit === 'auto'
        ? inferTimeUnit(
            rows
              .filter(
                (row) =>
                  !row.malformed &&
                  row.cells.length === document.headers.length,
              )
              .map((row) => rawValue(row.cells, 'timestamp')),
          )
        : options.timeUnit;
    if (!report.timeUnit) {
      report.needsConfirmation.push('timeUnit');
      add({
        severity: 'warning',
        code: 'TIME_UNIT_CONFIRMATION',
        message:
          '无法可靠判定时间单位（可能混用单位或超出自动识别范围）；请选择毫秒、微秒或带时区 ISO，不能静默猜测。',
      });
    } else if (options.timeUnit === 'auto')
      add({
        severity: 'warning',
        code: 'TIME_UNIT_DETECTED',
        message: `自动识别为 ${report.timeUnit}，依据固定 2009–2100 范围或显式 ISO 时区；请核对原始格式。`,
      });
  }
  const entries: { line: number; candle: Candle }[] = [];
  const timedRows = new Map<number, number[]>();
  let previousTime: number | null = null;
  if (mappingValid)
    for (const row of rows) {
      if (row.malformed) continue;
      const raw = row.raw;
      if (row.cells.length !== document.headers.length) {
        add({
          severity: 'error',
          code: 'COLUMN_COUNT',
          line: row.line,
          raw,
          message: `应有 ${document.headers.length} 列，实际 ${row.cells.length} 列；请核对分隔符和表头设置。`,
        });
        continue;
      }
      const values = {} as Record<
        'open' | 'high' | 'low' | 'close' | 'volume',
        number
      >;
      for (const field of ['open', 'high', 'low', 'close', 'volume'] as const) {
        const value = rawValue(row.cells, field);
        const number = decimal.test(value) ? Number(value) : NaN;
        // 拒绝非零小数下溢到 0，不能把超小成交量静默当作零。
        const underflow = number === 0 && /[1-9]/.test(value.split(/[eE]/)[0]);
        if (
          !Number.isFinite(number) ||
          underflow ||
          (field === 'volume' ? number < 0 : number <= 0)
        ) {
          add({
            severity: 'error',
            code: field === 'volume' ? 'INVALID_VOLUME' : 'INVALID_PRICE',
            line: row.line,
            field,
            raw,
            message: `${labels[field]}必须是${field === 'volume' ? '非负' : '正'}有限数值，且不能下溢。`,
          });
        }
        values[field] = number;
      }
      if (
        !errorRows.has(row.line) &&
        (values.low > Math.min(values.open, values.close) ||
          values.high < Math.max(values.open, values.close) ||
          values.low > values.high)
      ) {
        add({
          severity: 'error',
          code: 'INVALID_OHLC',
          line: row.line,
          raw,
          message: '非法 OHLC：最低价 ≤ 开盘/收盘价 ≤ 最高价。',
        });
      }
      const valuesValid = !errorRows.has(row.line);
      const timestampRaw = rawValue(row.cells, 'timestamp');
      const timestamp = report.timeUnit
        ? normalizeTimestamp(timestampRaw, report.timeUnit)
        : null;
      if (timestamp === null && report.timeUnit) {
        add({
          severity: 'error',
          code: 'INVALID_TIMESTAMP',
          line: row.line,
          field: 'timestamp',
          raw,
          message:
            '时间戳无效：要求 1970–2100 范围、毫秒/微秒整数字符串（微秒须能精确整除 1000），或带 Z/偏移的严格 ISO 日期；不舍入、不猜本地时区。',
        });
      } else if (
        timestamp === null &&
        !(['ms', 'us', 'iso'] as const).some(
          (unit) => normalizeTimestamp(timestampRaw, unit) !== null,
        )
      ) {
        add({
          severity: 'error',
          code: 'INVALID_TIMESTAMP',
          line: row.line,
          field: 'timestamp',
          raw,
          message:
            '时间列不是可规范化的毫秒、整毫秒精度微秒或带时区 ISO 日期。',
        });
      }
      if (timestamp !== null) {
        const lines = timedRows.get(timestamp) ?? [];
        lines.push(row.line);
        timedRows.set(timestamp, lines);
        if (previousTime !== null && timestamp < previousTime)
          add({
            severity: 'error',
            code: 'OUT_OF_ORDER',
            line: row.line,
            message: '时间未严格递增；未自动排序。',
          });
        previousTime = timestamp;
        // 时间顺序错误仍参与时间覆盖诊断，但不会成为有效候选行。
        if (valuesValid)
          entries.push({
            line: row.line,
            candle: { timestampUtcMs: timestamp, ...values },
          });
      }
    }
  const byTime = new Map<number, typeof entries>();
  entries.forEach((entry) => {
    const list = byTime.get(entry.candle.timestampUtcMs) ?? [];
    list.push(entry);
    byTime.set(entry.candle.timestampUtcMs, list);
  });
  timedRows.forEach((lines) => {
    if (lines.length < 2) return;
    report.duplicateGroups++;
    report.duplicateRows += lines.length;
    lines.forEach((line) =>
      add({
        severity: 'error',
        code: 'DUPLICATE_TIMESTAMP',
        line,
        message: `重复时间戳，涉及行 ${lines.slice(0, 10).join('、')}${lines.length > 10 ? '…' : ''}；未自动去重。`,
      }),
    );
  });
  // 排序副本只用于诊断缺口，不修改输入顺序或候选行情顺序。
  const times = [...byTime.keys()].sort((a, b) => a - b);
  let minimumDelta = Infinity;
  for (let i = 1; i < times.length; i++)
    minimumDelta = Math.min(minimumDelta, times[i] - times[i - 1]);
  report.suggestedIntervalMs = Number.isFinite(minimumDelta)
    ? minimumDelta
    : null;
  if (times.length)
    report.range = { startUtcMs: times[0], endUtcMs: times[times.length - 1] };
  if (options.intervalMs === null) {
    report.needsConfirmation.push('interval');
    add({
      severity: 'warning',
      code: 'INTERVAL_CONFIRMATION',
      message:
        '尚未确认预期周期；相邻间隔只能作为建议，不能据此证明没有缺失 K 线。请选择或确认固定周期。',
    });
  } else if (
    !Number.isSafeInteger(options.intervalMs) ||
    options.intervalMs <= 0 ||
    options.intervalMs > 31_536_000_000
  ) {
    report.needsConfirmation.push('interval');
    add({
      severity: 'error',
      code: 'INVALID_INTERVAL',
      message: '周期必须为正整数毫秒且不超过 365 天；日历月周期暂不支持。',
    });
  } else {
    report.intervalMs = options.intervalMs;
    for (let i = 1; i < times.length; i++) {
      const delta = times[i] - times[i - 1];
      if (delta % options.intervalMs !== 0) {
        add({
          severity: 'error',
          code: 'INTERVAL_MISMATCH',
          line: byTime.get(times[i])?.[0].line,
          message: `相邻时间差 ${delta} ms 不是已选周期 ${options.intervalMs} ms 的整数倍；无法可靠计算此间隔缺口，请核对周期或数据。`,
        });
      } else if (delta > options.intervalMs) {
        const missingCount = delta / options.intervalMs - 1;
        report.gapCount++;
        report.missingCandles += missingCount;
        if (report.gaps.length < MAX_ISSUES)
          report.gaps.push({
            afterUtcMs: times[i - 1],
            beforeUtcMs: times[i],
            missingCount,
          });
      }
    }
    if (report.gapCount)
      add({
        severity: 'warning',
        code: 'MISSING_CANDLES',
        message: `文件内检测到 ${report.gapCount} 个缺失区间，共缺 ${report.missingCandles} 根 K 线，未自动填补；这不说明缺口的真实成因。`,
      });
  }
  if (times.length < 2)
    add({
      severity: 'warning',
      code: 'INSUFFICIENT_ROWS',
      message: '有效时间点不足两条，无法检查连续性。',
    });
  add({
    severity: 'warning',
    code: 'COVERAGE_UNVERIFIED',
    message:
      '仅检查文件内首末有效时间点之间；未提供预期起止范围，无法证明首尾完整、市场连续性或来源真实性。无效行不会充当有效行情覆盖。',
  });
  const validEntries = entries.filter((entry) => !errorRows.has(entry.line));
  report.candles = validEntries.map((entry) => entry.candle);
  report.preview = validEntries.slice(0, 20);
  report.validRows = validEntries.length;
  report.invalidRows = rows.filter((row) => errorRows.has(row.line)).length;
  report.pendingRows = rows.length - report.validRows - report.invalidRows;
  report.errorCount = errorCount;
  report.warningCount = warningCount;
  report.issueDetailsTruncated = errorCount + warningCount > MAX_ISSUES;
  report.status = errorCount
    ? 'has-errors'
    : report.needsConfirmation.length
      ? 'needs-confirmation'
      : 'reviewed';
  return report;
}
