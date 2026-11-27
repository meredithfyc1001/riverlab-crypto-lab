// @vitest-environment node
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { contentHash } from '../../src/core/backtests/identity';
import { summarizeDataset, type Dataset } from '../../src/core/data/dataset';
import {
  summarizeExperiment,
  type Experiment,
} from '../../src/core/experiments';
import type { ReplayCheckpoint } from '../../src/core/replay';
import { summarizePortfolio } from '../../src/core/portfolio/report-common';
import type { SharedPoolExperiment } from '../../src/core/shared-pool/report';
import type { RepositoryKind } from '../../src/infrastructure/desktop-repository';
import { layouts } from '../../src/infrastructure/database-layouts';
import { SnapshotValidation } from '../../src/infrastructure/snapshot-validation';
import { syntheticLibraries } from '../e2e/phase-6c-a-fixture';
import { fixtureDataset } from '../fixtures/dataset';

const now = 1_800_000_000_000;
const validation = () => new SnapshotValidation({ observedUtcMs: now });

const fixture = syntheticLibraries();
function stores(kind: RepositoryKind) {
  return fixture.find((db) => db.name === layouts[kind][0])!.stores;
}
const dataset = stores('dataset')[0].values[0] as Dataset;
const captured = async (id: string) => {
  expect(id).toBe(dataset.id);
  return dataset;
};

describe('full snapshot original records', () => {
  it('verifies every physical library, all eight stored summary pairs and the single-store rule library', async () => {
    const scan = validation();
    const readDataset = vi.fn(captured);
    for (const kind of Object.keys(layouts) as RepositoryKind[]) {
      for (const store of stores(kind)) {
        const role = store.name === 'summaries' ? 'summary' : 'body';
        for (const row of store.values)
          expect(
            await scan.accept(kind, role, row.id, row, readDataset),
            kind,
          ).toEqual([]);
      }
      expect(scan.finish(kind)).toEqual([]);
    }
    expect(readDataset).toHaveBeenCalledTimes(1);
  });

  it.each(['ma-2-4', 'rules-v1', 'rules-v2'])(
    'checks the saved body of the frozen Windows %s experiment without rewriting its history',
    async (name) => {
      const { format, ...record } = JSON.parse(
        readFileSync(
          'tests/fixtures/windows-20261125/' + name + '.json',
          'utf8',
        ),
      ) as Experiment & { format: string };
      expect(format).toBe('riverlab-experiment');
      const scan = validation();
      const before = JSON.stringify(record);
      expect(
        await scan.accept('experiment', 'body', record.id, record),
      ).toEqual([]);
      expect(
        await scan.accept(
          'experiment',
          'summary',
          record.id,
          summarizeExperiment(record),
        ),
      ).toEqual([]);
      expect(scan.finish('experiment')).toEqual([]);
      expect(JSON.stringify(record)).toBe(before);
    },
  );

  it('recalculates the shared-strategy variant of the same shared-pool store', async () => {
    const row: SharedPoolExperiment = JSON.parse(
      gunzipSync(
        readFileSync('tests/fixtures/phase-5c-b-shared-strategy.json.gz'),
      ).toString('utf8'),
    );
    const scan = validation();
    expect(await scan.accept('shared_pool', 'body', row.id, row)).toEqual([]);
    expect(
      await scan.accept(
        'shared_pool',
        'summary',
        row.id,
        summarizePortfolio(row),
      ),
    ).toEqual([]);
    expect(scan.finish('shared_pool')).toEqual([]);
  });

  it('preserves allowed own-undefined fields and detects their loss in a stored summary', async () => {
    expect(Object.hasOwn(dataset.source, 'url')).toBe(true);
    const scan = validation();
    expect(await scan.accept('dataset', 'body', dataset.id, dataset)).toEqual(
      [],
    );
    const summary = JSON.parse(JSON.stringify(summarizeDataset(dataset)));
    expect(
      await scan.accept('dataset', 'summary', dataset.id, summary),
    ).toMatchObject([{ code: 'summaryMismatch', key: dataset.id }]);
    const other = validation();
    const reordered = Object.fromEntries(
      Object.entries(summarizeDataset(dataset)).reverse(),
    );
    expect(await other.accept('dataset', 'body', dataset.id, dataset)).toEqual(
      [],
    );
    expect(
      await other.accept('dataset', 'summary', dataset.id, reordered),
    ).toEqual([]);
  });

  it('detects loss of shared clone identity even when a stored summary has identical JSON', async () => {
    const original = structuredClone(dataset);
    const issue = { ...original.quality.issues[0], code: 'TEST_WARNING' };
    original.quality.issues.push(issue, issue);
    original.quality.issueCounts.TEST_WARNING = 2;
    original.quality.warningCount += 2;
    const actual = structuredClone(summarizeDataset(original));
    actual.quality.issues[actual.quality.issues.length - 1] = { ...issue };
    expect(JSON.stringify(actual)).toBe(
      JSON.stringify(summarizeDataset(original)),
    );
    const scan = validation();
    expect(await scan.accept('dataset', 'body', original.id, original)).toEqual(
      [],
    );
    expect(
      await scan.accept('dataset', 'summary', original.id, actual),
    ).toMatchObject([{ code: 'summaryMismatch' }]);
  });

  it('compares the actual primary key and both orphan directions even when counts agree', async () => {
    const scan = validation();
    expect(
      await scan.accept('dataset', 'body', 'other', dataset),
    ).toMatchObject([{ code: 'invalidKey', role: 'body' }]);
    expect(await scan.accept('dataset', 'body', dataset.id, dataset)).toEqual(
      [],
    );
    const summary = { ...summarizeDataset(dataset), id: 'missing-body' };
    expect(
      await scan.accept('dataset', 'summary', summary.id, summary),
    ).toEqual([]);
    expect(scan.finish('dataset')).toMatchObject([
      { code: 'missingSummary', key: dataset.id },
      { code: 'missingBody', key: summary.id },
    ]);
    expect(
      await validation().accept('dataset', 'summary', 1, { ...summary, id: 1 }),
    ).toMatchObject([{ code: 'invalidKey' }]);
    expect(
      await validation().accept('rule', 'summary', 'r', { id: 'r' }),
    ).toMatchObject([{ code: 'invalidSummary' }]);
  });

  it('rejects invalid stored metadata and valid-looking but stale summaries', async () => {
    const row = stores('experiment')[1].values[0];
    expect(
      await validation().accept('experiment', 'summary', row.id, {
        ...row,
        name: '',
      }),
    ).toMatchObject([{ code: 'invalidSummary' }]);
    const scan = validation();
    const body = stores('experiment')[0].values[0];
    expect(await scan.accept('experiment', 'body', body.id, body)).toEqual([]);
    expect(
      await scan.accept('experiment', 'summary', body.id, {
        ...row,
        name: 'stale',
      }),
    ).toMatchObject([{ code: 'summaryMismatch' }]);
  });

  it.each(['experiment', 'risk'] as const)(
    'refuses unsealed top-level fields on %s records',
    async (kind) => {
      const row = stores(kind)[0].values[0];
      expect(
        await validation().accept(kind, 'body', row.id, {
          ...row,
          unknownField: 'not part of the payload digest',
        }),
      ).toMatchObject([{ code: 'invalidBody' }]);
    },
  );

  it('bounds orphan diagnostics, detects duplicate keys and refuses cyclic summaries', async () => {
    const scan = validation();
    const summary = summarizeDataset(dataset);
    for (let index = 0; index < 19; index++) {
      const id = 'orphan-' + index;
      expect(
        await scan.accept('dataset', 'summary', id, { ...summary, id }),
      ).toEqual([]);
    }
    expect(
      await scan.accept('dataset', 'summary', 'orphan-0', {
        ...summary,
        id: 'orphan-0',
      }),
    ).toMatchObject([{ code: 'duplicateKey' }]);
    const missing = scan.finish('dataset');
    expect(missing).toHaveLength(16);
    expect(missing.at(-1)?.message).toContain('19');
    const cyclic = { ...summary, extra: {} };
    cyclic.extra = cyclic;
    expect(
      await validation().accept('dataset', 'summary', cyclic.id, cyclic),
    ).toMatchObject([{ code: 'invalidSummary' }]);
  });

  it.each([
    ['experiment', 'payloadHash'],
    ['rule', 'recordHash'],
    ['risk', 'payloadHash'],
    ['portfolio', 'recordHash'],
    ['shared_pool', 'payloadHash'],
    ['regime', 'reportHash'],
    ['advanced', 'reportHash'],
  ] as const)('rejects corrupted original %s hashes', async (kind, hash) => {
    const row = stores(kind)[0].values[0];
    expect(
      await validation().accept(kind, 'body', row.id, {
        ...row,
        [hash]: '0'.repeat(64),
      }),
    ).toMatchObject([{ code: 'invalidBody' }]);
  });

  it('requires the same captured replay source and verifies history beyond the outer hash', async () => {
    const replay = stores('replay')[0].values[0] as ReplayCheckpoint;
    expect(
      await validation().accept('replay', 'body', replay.id, replay, captured),
    ).toMatchObject([{ code: 'replaySource' }]);
    const scan = validation();
    expect(await scan.accept('dataset', 'body', dataset.id, dataset)).toEqual(
      [],
    );
    expect(
      await scan.accept('replay', 'body', replay.id, replay, async () => ({
        ...dataset,
        id: 'different',
      })),
    ).toMatchObject([{ code: 'replaySource' }]);
    const changed = structuredClone(replay);
    changed.payload.stateHash = '0'.repeat(64);
    changed.payloadHash = contentHash(changed.payload);
    const fresh = validation();
    await fresh.accept('dataset', 'body', dataset.id, dataset);
    expect(
      await fresh.accept('replay', 'body', changed.id, changed, captured),
    ).toMatchObject([{ code: 'invalidBody' }]);
    const otherDataset = structuredClone(dataset);
    const candle = otherDataset.candles[0];
    otherDataset.candles[0] = { ...candle, volume: candle.volume + 1 };
    const otherScan = validation();
    expect(
      await otherScan.accept('dataset', 'body', dataset.id, otherDataset),
    ).toEqual([]);
    expect(
      await otherScan.accept(
        'replay',
        'body',
        replay.id,
        replay,
        async () => otherDataset,
      ),
    ).toMatchObject([
      { code: 'invalidBody', message: expect.stringContaining('原数据集') },
    ]);
  });

  it('reports metadata-only problems and future completion claims before sealing', async () => {
    const d = fixtureDataset();
    expect(
      await validation().accept('dataset', 'body', d.id, {
        ...d,
        source: { ...d.source, label: '' },
      }),
    ).toMatchObject([{ code: 'invalidBody' }]);
    const row = stores('experiment')[0].values[0];
    expect(
      await new SnapshotValidation({ observedUtcMs: 0 }).accept(
        'experiment',
        'body',
        row.id,
        row,
      ),
    ).toMatchObject([{ code: 'invalidBody' }]);
  });
});
