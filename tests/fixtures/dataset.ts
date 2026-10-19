import { analyzeCsv } from '../../src/core/data';
import type { ImportOptions } from '../../src/core/data';
import { makeDataset } from '../../src/core/data/dataset';
export const options: ImportOptions = {
  delimiter: ',',
  hasHeader: true,
  mapping: { timestamp: 0, open: 1, high: 2, low: 3, close: 4, volume: 5 },
  timeUnit: 'ms',
  intervalMs: 60000,
};
export function fixtureDataset(gap = false) {
  const text = `timestamp,open,high,low,close,volume\n1735689600000,100,104,99,102,20\n${gap ? 1735689780000 : 1735689660000},102,104,99,101,21`;
  return makeDataset(
    {
      id: 'fixture-1',
      name: 'synthetic.csv',
      symbol: 'DEMO/USDT',
      createdUtcMs: 1735689600000,
      source: {
        kind: 'synthetic',
        label: '人工合成',
        note: '算法测试，非真实行情',
      },
      file: {
        name: 'synthetic.csv',
        bytes: text.length,
        sha256: 'a'.repeat(64),
        parserVersion: 'csv-v1',
      },
      parsing: options,
      warningsAcknowledged: true,
    },
    analyzeCsv(text, options),
  );
}
