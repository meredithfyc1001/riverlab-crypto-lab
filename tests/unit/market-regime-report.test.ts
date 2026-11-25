// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { contentHash } from '../../src/core/backtests/identity';
import {
  createRegimeReport,
  verifyRegimeReport,
  regimeCsv,
  regimeCandles,
} from '../../src/core/market-regime/report';
import type { RegimeReport } from '../../src/core/market-regime/report';

const metadata = {
  id: 'study',
  name: '历史原件核对',
  createdUtcMs: 1800000000000,
};
const now = metadata.createdUtcMs;
const params = { lookback: 1, thresholdBps: 500 };

function single() {
  const { format, ...source } = JSON.parse(
    readFileSync('tests/fixtures/windows-20261125/ma-2-4.json', 'utf8'),
  );
  expect(format).toBe('riverlab-experiment');
  return createRegimeReport('single', source, null, params, metadata, now);
}
function rehash(report: RegimeReport) {
  const { reportHash, ...payload } = report;
  void reportHash;
  return { ...payload, reportHash: contentHash(payload) };
}

it('binds the complete deterministic self-contained report, including model and original experiment identity', () => {
  const a = single(),
    b = single();
  expect(a).toEqual(b);
  expect(rehash(a).reportHash).toBe(a.reportHash);
  expect(verifyRegimeReport(JSON.parse(JSON.stringify(a)), now)).toEqual(a);
  const csv = regimeCsv(a);
  for (const field of [
    a.reportHash,
    a.source.payloadHash,
    a.modelVersion,
    a.algorithmVersion,
    'startUtcMsInclusive',
    'exposureFraction',
  ])
    expect(csv).toContain(field);
});
it('rejects outer tampering, unknown schema, model and attribution algorithm, and re-signed false outcomes', () => {
  const a = single();
  for (const r of [
    { ...a, schemaVersion: 2 },
    { ...a, modelVersion: 'future' },
    { ...a, algorithmVersion: 'future' },
  ])
    expect(() => verifyRegimeReport(r, now)).toThrow('版本');
  expect(() => verifyRegimeReport({ ...a, reference: 'XXX' }, now)).toThrow(
    'Hash',
  );
  a.result.summaries[0].fees = '1234';
  expect(() => verifyRegimeReport(rehash(a), now)).toThrow('重算');
});
it.each([
  [
    'rebalance',
    '20d5eb52253ffa23c4f9fd8c22940c6d06e4efde0e069b5e10e114217b5a9e28',
    '8a5a217ae692abe059db44270ef24079ac204aae72579eccb441544e4fdfb714',
    10,
  ],
  [
    'shared-strategy',
    '398418a871f9d086371663031d48ca2ddc697d0e748aa0bf25116fc5f800bc7f',
    '50ed076e3fe1bccfb5654df8e9917ec82f348a5ca997d6f9911a9fb6ead606f1',
    8,
  ],
] as const)(
  'replays frozen 5C-B %s bytes, original ledger and alternate reference',
  (mode, fileHash, recordHash, fills) => {
    // Exported from an isolated archive of PR #13's merge commit using synthetic prices.
    const bytes = gunzipSync(
      readFileSync('tests/fixtures/phase-5c-b-' + mode + '.json.gz'),
    );
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(fileHash);
    const original = JSON.parse(bytes.toString('utf8'));
    expect(original.recordHash).toBe(recordHash);
    const [a, b] = ['AAA/USDT', 'BBB/USDT'].map((reference) =>
      createRegimeReport('shared', original, reference, params, metadata, now),
    );
    expect(a.result.labels).not.toEqual(b.result.labels);
    for (const r of [a, b]) {
      expect(regimeCandles(r)).toHaveLength(original.result.curve.length - 1);
      expect(r.result.netPnl).toBe(original.result.netPnl);
      expect(r.result.summaries.reduce((n, s) => n + s.fills, 0)).toBe(fills);
      expect(verifyRegimeReport(JSON.parse(JSON.stringify(r)), now)).toEqual(r);
    }
    expect(() =>
      createRegimeReport('shared', original, null, params, metadata, now),
    ).toThrow('参考资产');
  },
);
