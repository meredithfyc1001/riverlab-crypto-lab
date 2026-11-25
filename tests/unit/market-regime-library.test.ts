// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Experiment } from '../../src/core/experiments';
import {
  createRegimeReport,
  verifyRegimeReport,
} from '../../src/core/market-regime/report';
import { ExperimentStore } from '../../src/infrastructure/experiment-store';
import type { LocalDatabase } from '../../src/infrastructure/local-database';
import { exportRegimeFile } from '../../src/infrastructure/market-regime-file';
import {
  listRegimeSources,
  MarketRegimeStore,
} from '../../src/infrastructure/market-regime-store';
import type { RegimeRequest } from '../../src/infrastructure/market-regime-worker';
import { PortfolioStore } from '../../src/infrastructure/portfolio-store';
import { SharedPoolStore } from '../../src/infrastructure/shared-pool-store';

const now = 1800000000000;
const params = { lookback: 2, thresholdBps: 500 };
function windowsExperiment(name: string): Experiment {
  const { format, ...record } = JSON.parse(
    readFileSync('tests/fixtures/windows-20261125/' + name + '.json', 'utf8'),
  );
  expect(format).toBe('riverlab-experiment');
  return record;
}
function portfolioFixture(name: string) {
  return JSON.parse(
    gunzipSync(readFileSync('tests/fixtures/' + name + '.json.gz')).toString(
      'utf8',
    ),
  );
}
function study(source: Experiment, key: string) {
  return createRegimeReport(
    'single',
    source,
    null,
    params,
    { id: 'regime-' + key, name: 'probe ' + key, createdUtcMs: now },
    now,
  );
}
function readRows(store: LocalDatabase, table: string) {
  return store.transaction<unknown[]>('readonly', (tx, done) => {
    const read = tx.objectStore(table).getAll();
    read.onsuccess = () => done(read.result);
  });
}
async function damage(
  store: LocalDatabase,
  table: string,
  id: string,
  fields: Record<string, unknown>,
) {
  await store.transaction<void>('readwrite', (tx, done) => {
    const records = tx.objectStore(table);
    const read = records.get(id);
    read.onsuccess = () => {
      records.put({ ...read.result, ...fields });
      done(undefined);
    };
  });
}

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('retains the two healthy 5D exports and all eight original bodies from the e580125 reproduction', async () => {
  const single = new ExperimentStore(),
    fixed = new PortfolioStore(),
    shared = new SharedPoolStore(),
    reports = new MarketRegimeStore();
  const ma = windowsExperiment('ma-2-4'),
    rules = windowsExperiment('rules-v1');
  const portfolio = portfolioFixture('phase-5c-a-synthetic'),
    strategy = portfolioFixture('phase-5c-b-shared-strategy'),
    rebalance = portfolioFixture('phase-5c-b-rebalance');
  const a = study(ma, 'a'),
    b = study(rules, 'b'),
    c = study(ma, 'c');
  for (const row of [ma, rules]) await single.save(row);
  await fixed.save(portfolio);
  for (const row of [strategy, rebalance]) await shared.save(row);
  for (const row of [a, b, c]) await reports.save(row);

  await damage(shared, 'summaries', rebalance.id, { name: '' });
  await damage(reports, 'summaries', c.id, { name: '' });
  const before = await Promise.all([
    readRows(shared, 'summaries'),
    readRows(reports, 'summaries'),
  ]);
  const sources = await listRegimeSources();
  expect(sources.single).toMatchObject({
    damagedCount: 0,
    items: expect.arrayContaining([
      expect.objectContaining({ id: ma.id }),
      expect.objectContaining({ id: rules.id }),
    ]),
  });
  expect(sources.portfolio).toMatchObject({
    damagedCount: 0,
    items: [expect.objectContaining({ id: portfolio.id })],
  });
  expect(sources.shared).toMatchObject({
    damagedCount: 1,
    items: [expect.objectContaining({ id: strategy.id })],
  });
  expect(await reports.list()).toMatchObject({
    damagedCount: 1,
    items: [{ id: a.id }, { id: b.id }],
  });

  // The original deterministic report hashes and byte sizes were measured on e580125.
  for (const [original, hash, bytes] of [
    [
      a,
      '0bf2dc5e3ffd014117178ad009f7b7a3694852ec5838dbba7d86cce6f3f95ebc',
      8511,
    ],
    [
      b,
      '7b8348ffabfcd059a8afe14d2806f77cd3cbc9a5826bdea652839668ab6d7d2e',
      8889,
    ],
  ] as const) {
    const reopened = verifyRegimeReport(await reports.load(original.id), now);
    expect(reopened).toEqual(original);
    expect(reopened.reportHash).toBe(hash);
    const file = exportRegimeFile(reopened, 'json', now);
    expect(file.size).toBe(bytes);
    expect(await file.text()).toBe(JSON.stringify(original));
    expect(await exportRegimeFile(reopened, 'csv', now).text()).toContain(hash);
  }
  const bodies = await Promise.all([
    readRows(single, 'experiments'),
    readRows(fixed, 'experiments'),
    readRows(shared, 'experiments'),
    readRows(reports, 'reports'),
  ]);
  expect(
    createHash('sha256').update(JSON.stringify(bodies)).digest('hex'),
  ).toBe('126fa32e3fa1525f48b24ee7286a89c0632926def92671e313b10d4e23d9ff3f');
  expect(
    await Promise.all([
      readRows(shared, 'summaries'),
      readRows(reports, 'summaries'),
    ]),
  ).toEqual(before);
});

it('quarantines invalid digest types and missing symbols in each source index', async () => {
  const single = new ExperimentStore(),
    fixed = new PortfolioStore(),
    shared = new SharedPoolStore();
  const ma = windowsExperiment('ma-2-4'),
    rules = windowsExperiment('rules-v1');
  const portfolio = portfolioFixture('phase-5c-a-synthetic'),
    strategy = portfolioFixture('phase-5c-b-shared-strategy');
  await single.save(ma);
  await single.save(rules);
  await fixed.save(portfolio);
  await shared.save(strategy);
  await damage(single, 'summaries', rules.id, {
    runHash: [rules.payload.result.manifest.runHash],
  });
  await damage(fixed, 'summaries', portfolio.id, {
    payloadHash: [portfolio.payloadHash],
  });
  const sparse = new Array<string>(2);
  sparse[0] = strategy.input.assets[0].dataset.symbol;
  await damage(shared, 'summaries', strategy.id, { symbols: sparse });
  const sources = await listRegimeSources();
  expect(sources.single).toMatchObject({
    damagedCount: 1,
    items: [{ id: ma.id }],
  });
  expect(sources.portfolio).toEqual({ damagedCount: 1, items: [] });
  expect(sources.shared).toEqual({ damagedCount: 1, items: [] });
  // Existing strict list consumers still receive an explicit failure.
  for (const store of [single, fixed, shared])
    await expect(store.list()).rejects.toThrow('摘要损坏');
});

it('rejects corrupted bodies behind valid summaries in Worker run, reopen and export', async () => {
  const source = windowsExperiment('rules-v1'),
    other = windowsExperiment('ma-2-4');
  const sources = new ExperimentStore(),
    reports = new MarketRegimeStore();
  const bad = study(source, 'a'),
    good = study(other, 'b');
  await sources.save(source);
  await sources.save(other);
  await reports.save(bad);
  await reports.save(good);
  await damage(sources, 'experiments', source.id, { schemaVersion: 666 });
  const tampered = { ...bad, result: { ...bad.result, netPnl: '1' } };
  await damage(reports, 'reports', bad.id, { result: tampered.result });
  expect(await reports.list()).toMatchObject({
    items: [{ id: bad.id }, { id: good.id }],
    damagedCount: 0,
  });
  expect((await listRegimeSources()).single).toMatchObject({
    items: expect.arrayContaining([expect.objectContaining({ id: source.id })]),
    damagedCount: 0,
  });

  const posted = vi.fn();
  vi.stubGlobal('postMessage', posted);
  vi.stubGlobal('onmessage', null);
  await import('../../src/infrastructure/market-regime.worker');
  const receive = globalThis.onmessage as unknown as (event: {
    data: RegimeRequest;
  }) => Promise<void>;
  await receive({
    data: {
      kind: 'run',
      name: '拒绝损坏源',
      input: {
        sourceKind: 'single',
        sourceId: source.id,
        expectedHash: source.payloadHash,
        reference: null,
        params,
      },
    },
  });
  expect(posted).toHaveBeenLastCalledWith({
    error: expect.stringMatching(/损坏|版本/),
  });
  const corrupt = await reports.load(bad.id);
  expect(corrupt).toEqual(tampered);
  await receive({ data: { kind: 'verify', record: corrupt } });
  expect(posted).toHaveBeenLastCalledWith({
    error: expect.stringContaining('Hash'),
  });
  await receive({
    data: {
      kind: 'export',
      format: 'json',
      record: tampered,
    },
  });
  expect(posted).toHaveBeenLastCalledWith({
    error: expect.stringContaining('Hash'),
  });
  expect(() => exportRegimeFile(corrupt, 'csv', now)).toThrow('Hash');
  await receive({
    data: { kind: 'verify', record: await reports.load(good.id) },
  });
  expect(posted).toHaveBeenLastCalledWith({ record: good });
  expect(await reports.load(bad.id)).toEqual(corrupt);
});

it('isolates a whole source database version error and distinguishes three inaccessible databases from empty ones', async () => {
  const source = windowsExperiment('ma-2-4');
  await new ExperimentStore().save(source);
  async function advanceDatabaseVersion(name: string) {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('riverlab-crypto-lab-' + name, 2);
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }
  await advanceDatabaseVersion('shared-pool');
  const partial = await listRegimeSources();
  expect(partial.single).toMatchObject({
    damagedCount: 0,
    items: [{ id: source.id }],
  });
  expect(partial.portfolio).toEqual({ items: [], damagedCount: 0 });
  expect(partial.shared).toEqual({ error: expect.any(String) });
  for (const name of ['experiments', 'portfolios', 'market-regime'])
    await advanceDatabaseVersion(name);
  const unavailable = await listRegimeSources();
  for (const entry of Object.values(unavailable))
    expect(entry).toEqual({ error: expect.any(String) });
  await expect(new MarketRegimeStore().list()).rejects.toMatchObject({
    name: 'VersionError',
  });
});

it('does not publish even a successful getAll result if the enclosing read transaction aborts', async () => {
  const store = new MarketRegimeStore(),
    row = study(windowsExperiment('ma-2-4'), 'a');
  await store.save(row);
  const getAll = IDBObjectStore.prototype.getAll;
  const spy = vi
    .spyOn(IDBObjectStore.prototype, 'getAll')
    .mockImplementation(function (this: IDBObjectStore, ...args) {
      const request = getAll.apply(this, args);
      request.addEventListener('success', () => this.transaction.abort());
      return request;
    });
  await expect(store.list()).rejects.toThrow();
  const unavailable = await listRegimeSources();
  for (const result of Object.values(unavailable))
    expect(result).toEqual({ error: expect.any(String) });
  spy.mockRestore();
  expect(await store.list()).toMatchObject({
    damagedCount: 0,
    items: [{ id: row.id }],
  });
  expect(await store.load(row.id)).toEqual(row);
});
