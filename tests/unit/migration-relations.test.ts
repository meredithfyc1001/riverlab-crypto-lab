// @vitest-environment node
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { createRegimeReport } from '../../src/core/market-regime/report';
import { SnapshotValidation } from '../../src/infrastructure/snapshot-validation';
import { relationships } from '../../scripts/phase6c/historical-relations';
import { restoreSnapshotValue } from '../../src/infrastructure/snapshot-restore';
import { market } from '../fixtures/backtest';

it('rebuilds the archived own undefined keys, their order and shared references', () => {
  const projection = '{"a":{"first":1,"last":2},"b":{"first":1,"last":2}}';
  const descriptor = {
    version: 1,
    objects: [
      {
        path: ['a'],
        keys: ['first', 'middle', 'last'],
        undefinedKeys: ['middle'],
      },
    ],
    aliases: [{ path: ['b'], target: ['a'] }],
  };
  const value = restoreSnapshotValue(
    projection,
    JSON.stringify(descriptor),
  ) as { a: object; b: object };
  expect(Object.keys(value.a)).toEqual(['first', 'middle', 'last']);
  expect(value.b).toBe(value.a);
  expect(() =>
    restoreSnapshotValue(
      projection,
      JSON.stringify({
        ...descriptor,
        aliases: [{ path: ['b'], target: ['toString'] }],
      }),
    ),
  ).toThrow();
});

it('distinguishes validated embedded snapshots from a conflicting physical source with the same ID', () => {
  const dataset = market([5, 6, 7]);
  const row = {
    payload: {
      dataset,
      result: { manifest: { strategy: { config: { kind: 'ma' } } } },
    },
  };
  const source = { ...dataset, source: { ...dataset.source, url: undefined } };
  expect(relationships('experiment', row, () => source)[0].status).toBe(
    'MATCH',
  );
  expect(relationships('experiment', row, () => undefined)[0].status).toBe(
    'DETACHED',
  );
  expect(
    relationships('experiment', row, () => ({
      ...source,
      name: source.name + ' changed',
    }))[0].status,
  ).toBe('CONFLICT');
});

it('requires the original physical replay source and never invents a family ID for embedded rules', () => {
  const dataset = market([5, 6, 7]);
  expect(
    relationships(
      'replay',
      { payload: { datasetId: dataset.id, sourceHash: 'f'.repeat(64) } },
      () => undefined,
    )[0].status,
  ).toBe('MISSING');
  const row = {
    payload: {
      dataset,
      result: {
        manifest: {
          strategy: { config: { kind: 'rules', rule: { revision: 2 } } },
        },
      },
    },
  };
  const link = relationships('experiment', row, () => undefined)[1];
  expect(link.status).toBe('EMBEDDED');
  expect(link).not.toHaveProperty('id');
});

it.each([
  ['portfolio', 'portfolio', 'phase-5c-a-synthetic.json.gz'],
  ['shared', 'shared_pool', 'phase-5c-b-rebalance.json.gz'],
] as const)(
  'replays a regime report with a sealed %s source and verifies the original ID and hashes',
  async (sourceKind, libraryKind, fixture) => {
    const original = JSON.parse(
      gunzipSync(readFileSync('tests/fixtures/' + fixture)).toString('utf8'),
    );
    const now = 1800000000000;
    const report = createRegimeReport(
      sourceKind,
      original,
      'AAA/USDT',
      { lookback: 2, thresholdBps: 100 },
      { id: 'migration-regime', name: '合成测试', createdUtcMs: now },
      now,
    );
    let observed = false;
    const validation = new SnapshotValidation({
      observedUtcMs: now,
      observeReplay(_kind, source, actual) {
        expect(actual).toStrictEqual(source);
        observed = true;
      },
    });
    expect(
      await validation.accept('regime', 'body', report.id, report),
    ).toEqual([]);
    expect(observed).toBe(true);
    const linked = relationships('regime', report, (kind, id) =>
      kind === libraryKind && id === original.id ? original : undefined,
    );
    expect(linked[0]).toMatchObject({
      kind: libraryKind,
      id: original.id,
      status: 'MATCH',
    });
    expect(
      linked
        .filter((link) => link.kind === 'dataset')
        .map((link) => link.status),
    ).toEqual(['DETACHED', 'DETACHED']);
  },
);
