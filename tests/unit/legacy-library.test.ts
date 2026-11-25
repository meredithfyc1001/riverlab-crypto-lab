// @vitest-environment node
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { summarizeDataset } from '../../src/core/data/dataset';
import { defaultRule } from '../../src/core/strategies';
import { sealRule } from '../../src/core/rule-library';
import { DatasetStore } from '../../src/infrastructure/dataset-store';
import type { LocalDatabase } from '../../src/infrastructure/local-database';
import { ReplayStore } from '../../src/infrastructure/replay-store';
import { RiskStore } from '../../src/infrastructure/risk-store';
import { RuleStore } from '../../src/infrastructure/rule-store';
import { fixtureDataset } from '../fixtures/dataset';

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function insert(store: LocalDatabase, key: string, rows: unknown[]) {
  return store.transaction<void>('readwrite', (tx, done) => {
    for (const row of rows) tx.objectStore(key).add(row);
    done(undefined);
  });
}
function read(store: LocalDatabase, key: string) {
  return store.transaction<unknown[]>('readonly', (tx, done) => {
    const r = tx.objectStore(key).getAll();
    r.onsuccess = () => done(r.result);
  });
}

const factories = [DatasetStore, RiskStore, ReplayStore, RuleStore] as const;
it.each(factories.map((Store) => [Store.name, Store] as const))(
  '%s propagates failed opens and late aborts; successful requests alone provide no snapshot',
  async (_name, Store) => {
    const instance = new Store();
    const broken = new Store(() => {
      throw new DOMException('disabled', 'SecurityError');
    });
    await expect(broken.listAvailable()).rejects.toThrow('disabled');
    const getAll = IDBObjectStore.prototype.getAll;
    const cursor = IDBObjectStore.prototype.openCursor;
    vi.spyOn(IDBObjectStore.prototype, 'getAll').mockImplementation(function (
      this: IDBObjectStore,
      ...args
    ) {
      const r = getAll.apply(this, args);
      r.addEventListener('success', () => this.transaction.abort());
      return r;
    });
    vi.spyOn(IDBObjectStore.prototype, 'openCursor').mockImplementation(
      function (this: IDBObjectStore, ...args) {
        const r = cursor.apply(this, args);
        r.addEventListener('success', () => this.transaction.abort());
        return r;
      },
    );
    await expect(instance.listAvailable()).rejects.toThrow('中止');
    vi.restoreAllMocks();
    await expect(instance.listAvailable()).resolves.toEqual({
      items: [],
      damagedCount: 0,
    });
  },
);

it('isolates malformed provenance and hashes individually and rejects conflicting writes without changing any row', async () => {
  const d = fixtureDataset(),
    data = new DatasetStore(),
    summary = summarizeDataset(d);
  await data.save(d);
  await data.save(structuredClone(d)); // The UI can explicitly save its unchanged current dataset.
  const damaged = {
    ...summary,
    id: 'dataset-damaged',
    file: { ...summary.file, sha256: 'bad' },
  };
  await insert(data, 'summaries', [damaged]);
  const rules = new RuleStore(),
    good = sealRule(defaultRule(), {
      familyId: 'family',
      name: 'fixture',
      createdUtcMs: 1,
    });
  await rules.save(good);
  const badRule = { ...good, id: 'family@2', ruleHash: 'bad' };
  await insert(rules, 'versions', [badRule]);

  const risk = new RiskStore(),
    replay = new ReplayStore();
  const identity = {
    id: 'good',
    name: 'probe',
    symbol: 'BTC',
    createdUtcMs: 1000,
    payloadHash: 'a'.repeat(64),
  };
  const riskRow = { ...identity, sourceName: 'source' },
    replayRow = { ...identity, cursor: 1 };
  for (const [store, row] of [
    [risk, riskRow],
    [replay, replayRow],
  ] as const)
    await insert(store, 'summaries', [
      row,
      { ...row, id: 'bad', payloadHash: [row.payloadHash] },
    ]);

  const snapshot = () =>
    Promise.all([
      read(data, 'summaries'),
      read(data, 'datasets'),
      read(rules, 'versions'),
      read(risk, 'summaries'),
      read(replay, 'summaries'),
    ]);
  const before = await snapshot();
  for (const [store, row] of [
    [data, summary],
    [rules, good],
    [risk, riskRow],
    [replay, replayRow],
  ] as const)
    expect(await store.listAvailable()).toEqual({
      damagedCount: 1,
      items: [row],
    });
  expect(await data.load(d.id)).toEqual(d);
  await expect(data.save({ ...d, id: damaged.id })).rejects.toThrow('冲突');
  await expect(data.save({ ...d, name: '不同内容' })).rejects.toThrow('冲突');
  expect(await snapshot()).toEqual(before);
});

it('preserves each readable library when other databases have incompatible physical versions', async () => {
  const databases = [
    new DatasetStore(),
    new RiskStore(),
    new ReplayStore(),
    new RuleStore(),
  ];
  for (const name of ['riverlab-crypto-lab', 'riverlab-crypto-lab-replays']) {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(name, 2);
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }
  const results = await Promise.allSettled(
    databases.map((store) => store.listAvailable()),
  );
  expect(results.map((r) => r.status)).toEqual([
    'rejected',
    'fulfilled',
    'rejected',
    'fulfilled',
  ]);
  for (const r of results)
    if (r.status === 'rejected')
      expect(r.reason).toMatchObject({ name: 'VersionError' });
    else expect(r.value).toEqual({ items: [], damagedCount: 0 });
});

it('counts extra damaged versions separately from the original 100 valid-version budget', async () => {
  const store = new RuleStore();
  const rule = defaultRule();
  const records = Array.from({ length: 101 }, (_, i) =>
    sealRule(
      { ...rule, revision: i + 1 },
      { familyId: 'limit', name: '预算测试', createdUtcMs: i },
    ),
  );
  await insert(store, 'versions', [
    ...records.slice(0, 100),
    { id: 'broken@1', format: 'bad' },
  ]);
  expect((await store.listAvailable()).items).toHaveLength(100);
  expect((await store.listAvailable()).damagedCount).toBe(1);
  await expect(store.save(records[100])).rejects.toThrow('100');
  await insert(store, 'versions', [records[100]]);
  await expect(store.listAvailable()).rejects.toThrow('超过100');
});
