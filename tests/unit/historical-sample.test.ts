import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeCsv, suggestMapping } from '../../src/core/data';
import historical from '../../src/features/datasets/samples/real-btcusdt-2024-10-28.csv?raw';
import provenance from '../../src/features/datasets/samples/real-btcusdt.provenance.json';

describe('历史样本身份与范围', () => {
  it('CSV 与来源记录哈希匹配，来源绑定固定提交而非合成数据', () => {
    expect(createHash('sha256').update(historical).digest('hex')).toBe(
      provenance.csvSha256,
    );
    expect(provenance.upstreamUrl).toContain(provenance.upstreamCommit);
    expect(provenance.upstreamCommit).toMatch(/^[a-f0-9]{40}$/);
    expect(provenance.kind).toBe('historical');
    const archive = readFileSync(
      resolve('tests/fixtures/spot-klines-BTCUSDT-1h-2024-10-28.zip'),
    );
    expect(createHash('sha256').update(archive).digest('hex')).toBe(
      provenance.archiveSha256,
    );
  });
  it('读取全部 24 条真实历史记录，UTC 范围与首尾原始值吻合', () => {
    const report = analyzeCsv(historical, {
      delimiter: ',',
      hasHeader: false,
      mapping: suggestMapping(Array(12).fill(''), false),
      timeUnit: 'auto',
      intervalMs: 3600000,
    });
    expect(report.status).toBe('reviewed');
    expect(report.totalRows).toBe(24);
    expect(report.validRows).toBe(24);
    expect(report.errorCount).toBe(0);
    expect(report.missingCandles).toBe(0);
    expect(report.timeUnit).toBe('ms');
    expect(report.range).toEqual({
      startUtcMs: Date.UTC(2024, 9, 28),
      endUtcMs: Date.UTC(2024, 9, 28, 23),
    });
    expect(report.candles[0]).toEqual({
      timestampUtcMs: 1730073600000,
      open: 68021.69,
      high: 68116.78,
      low: 67839.9,
      close: 67859.91,
      volume: 555.35912,
    });
    expect(
      report.issues.some((issue) => issue.code === 'COVERAGE_UNVERIFIED'),
    ).toBe(true);
  });
});
