import { describe, expect, it } from 'vitest';
import {
  analyzeCsv,
  inferTimeUnit,
  inspectCsv,
  MAX_CSV_CHARS,
  MAX_DATA_ROWS,
  normalizeTimestamp,
  parseCsv,
  suggestMapping,
} from '../../src/core/data';
import type { ImportOptions } from '../../src/core/data';
import syntheticMs from '../../src/features/datasets/samples/synthetic-ms.csv?raw';
import syntheticUs from '../../src/features/datasets/samples/synthetic-us.csv?raw';
import errorCases from '../../src/features/datasets/samples/error-cases.csv?raw';

const header = 'timestamp,open,high,low,close,volume';
const baseTime = 1735689600000;
const line = (time: number | string, values = '100,104,99,102,20') =>
  `${time},${values}`;
const csv = (...rows: string[]) => [header, ...rows].join('\n');
const options: ImportOptions = {
  delimiter: ',',
  hasHeader: true,
  mapping: { timestamp: 0, open: 1, high: 2, low: 3, close: 4, volume: 5 },
  timeUnit: 'auto',
  intervalMs: 60000,
};
const codes = (text: string, config: ImportOptions = options) =>
  analyzeCsv(text, config).issues.map((issue) => issue.code);

describe('严格 CSV 与映射', () => {
  it('读取 BOM、CRLF、双引号、转义引号和跨行字段，保留物理行号', () => {
    const result = parseCsv(
      '\uFEFFname,value\r\n"hello,world","a""b"\r\n"two\r\nlines",2\r\nlast,3',
      { delimiter: ',', hasHeader: true },
    );
    expect(result.headers).toEqual(['name', 'value']);
    expect(result.records).toEqual([
      {
        line: 2,
        cells: ['hello,world', 'a"b'],
        malformed: false,
        raw: '"hello,world","a""b"',
      },
      {
        line: 3,
        cells: ['two\nlines', '2'],
        malformed: false,
        raw: '"two\r\nlines",2',
      },
      { line: 5, cells: ['last', '3'], malformed: false, raw: 'last,3' },
    ]);
    expect(result.issues).toEqual([]);
  });
  it.each(['a,b\n"broken,2', 'a,b\na"b,2', 'a,b\n"closed"bad,2'])(
    '拒绝损坏引号 %s',
    (text) => {
      expect(
        parseCsv(text, options).issues.some(
          (issue) => issue.code === 'CSV_FORMAT',
        ),
      ).toBe(true);
    },
  );
  it('支持显式分号/制表符分隔，不自动猜分隔符', () => {
    expect(
      parseCsv('a;b\n1;2', { delimiter: ';', hasHeader: true }).records[0]
        .cells,
    ).toEqual(['1', '2']);
    expect(
      parseCsv('a\tb\n1\t2', { delimiter: '\t', hasHeader: true }).records[0]
        .cells,
    ).toEqual(['1', '2']);
    expect(parseCsv('a;b\n1;2', options).headers).toEqual(['a;b']);
  });
  it('识别中文别名、允许手动重排，不替重复列名作选择', () => {
    const headers = [
      '成交量',
      '收盘价',
      '时间戳',
      '最低价',
      '开盘价',
      '最高价',
    ];
    const mapping = suggestMapping(headers, true);
    expect(mapping).toEqual({
      timestamp: 2,
      open: 4,
      high: 5,
      low: 3,
      close: 1,
      volume: 0,
    });
    const result = analyzeCsv(
      headers.join(',') + '\n20,102,1735689600000,99,100,104',
      { ...options, mapping },
    );
    expect(result.candles[0]).toEqual({
      timestampUtcMs: baseTime,
      open: 100,
      high: 104,
      low: 99,
      close: 102,
      volume: 20,
    });
    expect(
      suggestMapping(
        ['timestamp', 'open', 'open', 'low', 'close', 'volume'],
        true,
      ).open,
    ).toBeNull();
  });
  it('无表头 CSV 不丢第一行，预览有列号和建议映射', () => {
    const inspection = inspectCsv(line(baseTime), {
      ...options,
      hasHeader: false,
    });
    expect(inspection.preview[0].line).toBe(1);
    expect(inspection.recordCount).toBe(1);
    expect(inspection.mapping.timestamp).toBe(0);
    expect(
      analyzeCsv(line(baseTime), { ...options, hasHeader: false }).validRows,
    ).toBe(1);
  });
  it('拒绝缺失/越界/同列映射，不报告成功数据集', () => {
    for (const index of [null, -1, 100, 0, NaN]) {
      const result = analyzeCsv(syntheticMs, {
        ...options,
        mapping: { ...options.mapping, open: index },
      });
      expect(result.status).toBe('has-errors');
      expect(result.candles).toEqual([]);
      expect(result.issues.some((issue) => issue.code === 'MAPPING')).toBe(
        true,
      );
    }
  });
  it.each(['', '\uFEFF', ' \r\n\t\r\n', header, header + '\n'])(
    '空文件/仅表头有明确错误 %j',
    (text) => {
      expect(codes(text)).toContain('EMPTY_DATA');
    },
  );
  it('列数不符保留错误行，纯空白行单独计数', () => {
    const report = analyzeCsv(
      csv(line(baseTime), '', line(baseTime + 60000, '1,2')),
      options,
    );
    expect(report.blankLines).toBe(1);
    expect(report.invalidRows).toBe(1);
    expect(
      report.issues.find((issue) => issue.code === 'COLUMN_COUNT')?.line,
    ).toBe(4);
  });
  it('对文件、行、列、单字段上限阻断，不能静默截断', () => {
    expect(parseCsv('x'.repeat(MAX_CSV_CHARS + 1), options).truncated).toBe(
      true,
    );
    expect(parseCsv('x'.repeat(65537), options).issues[0].code).toBe(
      'CELL_LIMIT',
    );
    expect(parseCsv(Array(65).fill('a').join(','), options).truncated).toBe(
      true,
    );
    const tooMany =
      header +
      '\n' +
      Array(MAX_DATA_ROWS + 1)
        .fill(line(baseTime))
        .join('\n');
    expect(
      parseCsv(tooMany, options).issues.some(
        (issue) => issue.code === 'ROW_LIMIT',
      ),
    ).toBe(true);
  });
});

describe('时间单位、精度与 UTC', () => {
  it('毫秒/微秒样例规范化后完全一致', () => {
    const ms = analyzeCsv(syntheticMs, options),
      us = analyzeCsv(syntheticUs, options);
    expect(ms.timeUnit).toBe('ms');
    expect(us.timeUnit).toBe('us');
    expect(ms.candles).toEqual(us.candles);
    expect(ms.candles[0].timestampUtcMs).toBe(Date.UTC(2025, 0, 1));
  });
  it('显式 Z 和 UTC+8 的同一时刻一致，不受本地时区影响', () => {
    expect(normalizeTimestamp('2025-01-01T08:00:00+08:00', 'iso')).toBe(
      baseTime,
    );
    expect(normalizeTimestamp('2024-12-31T19:00:00-05:00', 'iso')).toBe(
      baseTime,
    );
    expect(inferTimeUnit(['2025-01-01T00:00:00Z'])).toBe('iso');
    expect(normalizeTimestamp('2024-02-29T00:00:00.123Z', 'iso')).toBe(
      Date.UTC(2024, 1, 29) + 123,
    );
  });
  it.each([
    '2025-02-29T00:00:00Z',
    '2025-01-01T24:00:00Z',
    '2025-13-01T00:00:00Z',
    '2025-01-01T00:00:00',
    '2025-01-01',
    '2025-01-01T00:00:60Z',
    '2025-01-01T00:00:00.1234Z',
  ])('拒绝无时区、非法日期或隐藏精度损失 %s', (raw) => {
    expect(normalizeTimestamp(raw, 'iso')).toBeNull();
  });
  it.each([
    '1735689600000001',
    '99999999999999999999',
    '-1',
    '1.7356896e15',
    '',
    '123.5',
  ])('微秒不舍入/溢出/宽松解析 %s', (raw) => {
    expect(normalizeTimestamp(raw, 'us')).toBeNull();
  });
  it('无法识别、混用单位或秒级输入必须确认；显式毫秒可解释 epoch 边界', () => {
    expect(inferTimeUnit(['0', '60000'])).toBeNull();
    expect(inferTimeUnit(['1735689600000', '1735689660000000'])).toBeNull();
    expect(inferTimeUnit(['1735689600'])).toBeNull();
    const ambiguous = analyzeCsv(csv(line(0), line(60000)), options);
    expect(ambiguous.needsConfirmation).toContain('timeUnit');
    expect(ambiguous.candles).toHaveLength(0);
    expect(ambiguous.pendingRows).toBe(2);
    expect(
      analyzeCsv(csv(line(0), line(60000)), { ...options, timeUnit: 'ms' })
        .candles[0].timestampUtcMs,
    ).toBe(0);
    expect(normalizeTimestamp(String(Date.UTC(2100, 0, 1)), 'ms')).toBe(
      Date.UTC(2100, 0, 1),
    );
    expect(
      normalizeTimestamp(String(Date.UTC(2100, 0, 1) + 1), 'ms'),
    ).toBeNull();
  });
  it('错误时间行不使其他行静默消失；丢失亚毫秒精度为错误', () => {
    const result = analyzeCsv(csv(line(baseTime), line('bad')), options);
    expect(result.validRows).toBe(1);
    expect(result.invalidRows).toBe(1);
    const precision = analyzeCsv(csv(line('1735689600000001')), options);
    expect(precision.timeUnit).toBe('us');
    expect(
      precision.issues.some((issue) => issue.code === 'INVALID_TIMESTAMP'),
    ).toBe(true);
  });
});

describe('质量报告与不确定性', () => {
  it('错误明细保留原文引号、转义与记录内换行，不重新拼接字段', () => {
    for (const raw of [
      `${baseTime},"bad""quote\r\nvalue",104,99,102,20`,
      `${baseTime},"closed"bad,104,99,102,20`,
    ]) {
      for (const ending of ['', '\r\n']) {
        const report = analyzeCsv(header + '\r\n' + raw + ending, options);
        const issue = report.issues.find(
          (item) =>
            item.code ===
            (raw.includes('closed') ? 'CSV_FORMAT' : 'INVALID_PRICE'),
        );
        expect(issue?.line).toBe(2);
        expect(issue?.raw).toBe(raw);
      }
    }
  });
  it('价格错误不能掩盖重复时间，重复行仍带原始内容', () => {
    const report = analyzeCsv(
      csv(line(baseTime), line(baseTime, '-1,104,99,102,20')),
      options,
    );
    expect(report.duplicateRows).toBe(2);
    expect(report.issueCounts.INVALID_PRICE).toBe(1);
    expect(
      report.issues.find(
        (issue) => issue.code === 'DUPLICATE_TIMESTAMP' && issue.line === 3,
      )?.raw,
    ).toContain('-1,104');
  });
  it('周期不自动确认，即使各行等距也明确提示完整性不能证明', () => {
    const report = analyzeCsv(syntheticMs, { ...options, intervalMs: null });
    expect(report.suggestedIntervalMs).toBe(60000);
    expect(report.intervalMs).toBeNull();
    expect(report.status).toBe('needs-confirmation');
    expect(report.needsConfirmation).toContain('interval');
    expect(
      report.issues.some((issue) => issue.code === 'COVERAGE_UNVERIFIED'),
    ).toBe(true);
  });
  it('同一份稀疏数据按不同确认周期会有不同缺口，不猜真实成因', () => {
    const text = csv(
      line(baseTime),
      line(baseTime + 120000),
      line(baseTime + 240000),
    );
    const minute = analyzeCsv(text, options);
    expect(minute.gapCount).toBe(2);
    expect(minute.missingCandles).toBe(2);
    expect(minute.gaps[0]).toEqual({
      afterUtcMs: baseTime,
      beforeUtcMs: baseTime + 120000,
      missingCount: 1,
    });
    expect(analyzeCsv(text, { ...options, intervalMs: 120000 }).gapCount).toBe(
      0,
    );
  });
  it('非周期整数倍的时间差不能当作零缺口成功', () => {
    const report = analyzeCsv(
      csv(line(baseTime), line(baseTime + 90000)),
      options,
    );
    expect(report.status).toBe('has-errors');
    expect(report.issueCounts.INTERVAL_MISMATCH).toBe(1);
  });
  it.each([0, -1, NaN, Infinity, 0.5, 31536000001])(
    '拒绝非法固定周期 %s',
    (intervalMs) => {
      expect(codes(syntheticMs, { ...options, intervalMs })).toContain(
        'INVALID_INTERVAL',
      );
    },
  );
  it('重复时间标记全部相关行，降序不排序；输入内容保持不变', () => {
    const input = csv(line(baseTime + 60000), line(baseTime), line(baseTime));
    const result = analyzeCsv(input, options);
    expect(result.duplicateGroups).toBe(1);
    expect(result.duplicateRows).toBe(2);
    expect(result.issueCounts.OUT_OF_ORDER).toBe(1);
    expect(
      result.issues
        .filter((issue) => issue.code === 'DUPLICATE_TIMESTAMP')
        .map((issue) => issue.line),
    ).toEqual([3, 4]);
    expect(input).toBe(
      csv(line(baseTime + 60000), line(baseTime), line(baseTime)),
    );
  });
  it.each([
    ['0,104,0,102,20', 'INVALID_PRICE'],
    ['-1,104,0,102,20', 'INVALID_PRICE'],
    ['NaN,104,99,102,20', 'INVALID_PRICE'],
    ['Infinity,104,99,102,20', 'INVALID_PRICE'],
    ['1e309,104,99,102,20', 'INVALID_PRICE'],
    ['100,104,99,102,-1', 'INVALID_VOLUME'],
    ['100,104,99,102,1e-400', 'INVALID_VOLUME'],
    ['100,99,98,102,20', 'INVALID_OHLC'],
    ['100,104,101,102,20', 'INVALID_OHLC'],
    ['100,98,101,102,20', 'INVALID_OHLC'],
    ['100,104,99,,20', 'INVALID_PRICE'],
    ['100,104,99,102,0x10', 'INVALID_VOLUME'],
  ])('拒绝价格/量/OHLC 错误 %s', (values, code) => {
    const report = analyzeCsv(csv(line(baseTime, values)), options);
    expect(report.issueCounts[code]).toBeGreaterThan(0);
    expect(report.invalidRows).toBe(1);
  });
  it('零成交量与全相同价格合法', () => {
    expect(
      analyzeCsv(csv(line(baseTime, '100,100,100,100,0')), options).validRows,
    ).toBe(1);
  });
  it('错误样本同时报告重复、缺口、坏值、时间与格式错误', () => {
    const report = analyzeCsv(errorCases, options);
    for (const code of [
      'DUPLICATE_TIMESTAMP',
      'MISSING_CANDLES',
      'INVALID_PRICE',
      'INVALID_VOLUME',
      'INVALID_OHLC',
      'INVALID_TIMESTAMP',
      'COLUMN_COUNT',
    ])
      expect(report.issueCounts[code]).toBeGreaterThan(0);
    expect(report.status).toBe('has-errors');
    expect(report.validRows + report.invalidRows + report.pendingRows).toBe(
      report.totalRows,
    );
  });
  it('明细上限不截掉真实错误总数', () => {
    const report = analyzeCsv(
      csv(
        ...Array.from({ length: 1200 }, (_, i) =>
          line(baseTime + i * 60000, '100,104,99,102,-1'),
        ),
      ),
      options,
    );
    expect(report.errorCount).toBe(1200);
    expect(report.issues).toHaveLength(1000);
    expect(report.issueDetailsTruncated).toBe(true);
    expect(report.invalidRows).toBe(1200);
  });
});
