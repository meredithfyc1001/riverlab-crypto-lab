import { analyzeCsv } from '../../src/core/data';
import { makeDataset } from '../../src/core/data/dataset';
import type { WorkerRequest } from '../../src/infrastructure/backtest-worker';
import { options } from '../fixtures/dataset';

export async function prepareBacktest() {
  const start = 1735689600000;
  const rows = Array.from({ length: 50000 }, (_, i) => {
    const p = 100 + (i % 12 < 6 ? i % 6 : 6 - (i % 6));
    return [start + i * 60000, p, p + 2, p - 2, p, 1].join(',');
  });
  const csv = 'timestamp,open,high,low,close,volume\n' + rows.join('\n');
  const bytes = new TextEncoder().encode(csv);
  const sha256 = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
  const dataset = makeDataset(
    {
      id: 'rc-perf',
      name: 'RC 50k',
      symbol: 'SYNTHETIC/USDT',
      createdUtcMs: start,
      source: { kind: 'synthetic', label: '人工合成', note: '性能样本' },
      file: {
        name: 'synthetic.csv',
        bytes: bytes.length,
        sha256,
        parserVersion: 'csv-v1',
      },
      parsing: options,
      warningsAcknowledged: true,
    },
    analyzeCsv(csv, options),
  );
  const request: WorkerRequest = {
    kind: 'run',
    id: 'rc-test',
    name: 'MA',
    createdUtcMs: start,
    input: {
      dataset,
      completedThroughUtcMs: start + 50000 * 60000,
      strategy: { kind: 'ma', fastPeriod: 2, slowPeriod: 4 },
    },
  };
  return request;
}
