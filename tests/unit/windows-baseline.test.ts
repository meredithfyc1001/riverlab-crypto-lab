// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeCsv } from '../../src/core/data';
import { runExperiment, verifyExperiment } from '../../src/core/experiments';
import historical from '../../src/features/datasets/samples/real-btcusdt-2024-10-28.csv?raw';

// Published Windows measurements and hashes of the three original file exports.
const cases = [
  {
    file: 'ma-2-4.json',
    fileHash:
      '97b946c84426da5a5247ed0af87b3c8c61b5f3486289c9c5459b2613146312b6',
    runHash: '64c4e1ba65702974719b31f86599931e5202c069fe8595e3802b0bc530d9dd96',
    fees: '3.0183018137280815',
    equity: '1021.9223539166904185',
  },
  {
    file: 'rules-v1.json',
    fileHash:
      '71ee4a981e28db2572918d71f0b6291902e154b6e9c8b1b8622e56c7ebaf400d',
    runHash: 'ad1b96cfe007f4d0daa4d02b2aebe29da47e84e1ec8415bb7a17eacc30832ed6',
    fees: '3.0081586048233435',
    equity: '1016.7889957453171565',
  },
  {
    file: 'rules-v2.json',
    fileHash:
      'dff234154cf6a7ff7cd5e47cda01cf3f91fc715c3c82aeadb761d99f8d6a9a2e',
    runHash: 'e71336aa5f2d076ca0eaf12f1f75e4e78e9049cb2f682e25f60d6d9767dfa28b',
    fees: '3.0081585394557412',
    equity: '1020.8545652013870588',
  },
];
describe('2026-11-25 Windows BTCUSDT 升级兼容性', () => {
  it.each(cases)(
    '$file 精确复现原件中的配置、逐笔成交、曲线、统计和 Hash',
    (expected) => {
      const bytes = readFileSync(
        'tests/fixtures/windows-20261125/' + expected.file,
      );
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(
        expected.fileHash,
      );
      const source = verifyExperiment(JSON.parse(bytes.toString('utf8')));
      const { dataset, result: original } = source.payload;
      const manifest = original.manifest;
      expect(dataset.symbol).toBe('BTCUSDT');
      expect(dataset.candles).toHaveLength(24);
      expect(analyzeCsv(historical, dataset.parsing).candles).toEqual(
        dataset.candles,
      );
      const actual = runExperiment({
        dataset,
        config: manifest.config,
        risk: manifest.risk,
        strategy: manifest.strategy!.config,
        completedThroughUtcMs: manifest.completedThroughUtcMs,
      });
      expect(actual.result.manifest.runHash).toBe(expected.runHash);
      expect(actual.result.final.equity).toBe(expected.equity);
      expect(actual.statistics.fees).toBe(expected.fees);
      expect(actual.result.fills).toHaveLength(3);
      expect(actual.statistics.curve).toHaveLength(25);
      expect(actual).toEqual(source.payload);
    },
  );
});
