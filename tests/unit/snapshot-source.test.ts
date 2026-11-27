import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { locks } from 'node:worker_threads';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { layouts } from '../../src/infrastructure/database-layouts';
import { LocalDatabase } from '../../src/infrastructure/local-database';
import {
  readSnapshotSource,
  type SnapshotRow,
} from '../../src/infrastructure/snapshot-source';

const fields = Object.values(layouts);
type Seed = (store: globalThis.IDBObjectStore) => void;

function create(
  factory: IDBFactory,
  name: string,
  stores: string[],
  seed?: Seed,
) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name, 1);
    request.onupgradeneeded = () => {
      for (const table of stores) {
        const store = request.result.createObjectStore(table, {
          keyPath: 'id',
        });
        seed?.(store);
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
async function all(factory: IDBFactory, seed?: Seed) {
  for (const [name, body] of fields)
    (
      await create(
        factory,
        name,
        body === 'versions' ? [body] : [body, 'summaries'],
        seed,
      )
    ).close();
}
function read(
  factory: IDBFactory,
  options: Partial<Parameters<typeof readSnapshotSource>[0]> = {},
) {
  return readSnapshotSource({
    factory,
    signal: new AbortController().signal,
    onRow: () => {},
    ...options,
  });
}
function deferred<T>() {
  let resolve!: (result: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { resolve, promise };
}

beforeEach(() => vi.stubGlobal('navigator', { locks }));
afterEach(() => vi.unstubAllGlobals());

describe('nine-database source cut', () => {
  it.each([
    undefined,
    {
      request: () =>
        Promise.reject(new DOMException('policy', 'SecurityError')),
    },
  ])(
    'keeps legacy IDB reads and writes available when Web Locks are absent or denied',
    async (unavailable) => {
      vi.stubGlobal('navigator', { locks: unavailable });
      const factory = new IDBFactory();
      const db = new LocalDatabase(() => factory, fields[0][0], ['datasets']);
      await db.transaction('readwrite', (tx) => {
        tx.objectStore('datasets').add({ id: 'legacy' });
      });
      await expect(
        db.transaction('readonly', (tx, done) => {
          const request = tx.objectStore('datasets').get('legacy');
          request.onsuccess = () => done(request.result);
        }),
      ).resolves.toEqual({ id: 'legacy' });
      await expect(read(factory)).rejects.toThrow();
    },
  );

  it('reads actual keys / own undefined in source order and holds old and new writers until terminal events', async () => {
    const factory = new IDBFactory();
    await all(factory, (store) => {
      store.add({ id: 'b', marker: 'old', optional: undefined });
      store.add({ id: 'a', marker: 'old' });
    });
    const [datasetName, body] = fields[0];
    const oldConnection = await create(factory, datasetName, []);
    const entered = deferred<void>(),
      release = deferred<void>();
    const rows: SnapshotRow[] = [];
    let oldFinished = false,
      newStarted = false;
    const snapshot = read(factory, {
      onLayout: async (layout) => {
        expect(layout.databases.flatMap((d) => d.stores)).toHaveLength(17);
        expect(
          layout.databases.flatMap((d) => d.stores).every((s) => s.count === 2),
        ).toBe(true);
        entered.resolve();
        await release.promise;
      },
      onRow: async (row, view) => {
        rows.push(row);
        if (row.kind === 'replay' && row.store === 'replays' && row.id === 'a')
          expect(await view.getCapturedDataset('b')).toEqual({
            id: 'b',
            marker: 'old',
            optional: undefined,
          });
      },
    });
    await entered.promise;
    // Bypass the cooperative Web Lock exactly like an old tab. Its write still
    // queues behind the reader covering this database's whole store set.
    const old = new Promise<void>((resolve, reject) => {
      const tx = oldConnection.transaction(body, 'readwrite');
      tx.objectStore(body).put({ id: 'b', marker: 'old-writer' });
      tx.oncomplete = () => {
        oldFinished = true;
        resolve();
      };
      tx.onabort = () => reject(tx.error);
    });
    const newer = new LocalDatabase(() => factory, datasetName, [
      body,
    ]).transaction('readwrite', (tx) => {
      newStarted = true;
      tx.objectStore(body).add({ id: 'c', marker: 'new-writer' });
    });
    await new Promise((r) => setTimeout(r, 10));
    expect([oldFinished, newStarted]).toEqual([false, false]);
    release.resolve();
    const result = await snapshot;
    await Promise.all([old, newer]);
    oldConnection.close();
    expect([oldFinished, newStarted]).toEqual([true, true]);
    const { barrierSequence, databases } = result;
    expect(Math.max(...databases.map((d) => d.firstRead))).toBeLessThan(
      barrierSequence,
    );
    expect(
      Math.min(...databases.map((d) => d.postBarrierRead)),
    ).toBeGreaterThan(barrierSequence);
    expect(Math.max(...databases.map((d) => d.postBarrierRead))).toBeLessThan(
      Math.min(...databases.map((d) => d.completed)),
    );
    expect(
      new Set(
        databases.flatMap((d) => [d.firstRead, d.postBarrierRead, d.completed]),
      ).size,
    ).toBe(27);
    expect(rows).toHaveLength(34);
    expect(
      rows.map((row) => [row.database, row.store, row.primaryKey]),
    ).toEqual(
      databases.flatMap((db) =>
        db.stores.flatMap((s) =>
          ['a', 'b'].map((key) => [db.name, s.name, key]),
        ),
      ),
    );
    expect(
      rows.every((row) => (row.value as { marker: string }).marker === 'old'),
    ).toBe(true);
    expect(Object.hasOwn(rows[1].value as object, 'optional')).toBe(true);
  });

  it('distinguishes nine existing empty storesets from an absent database and never opens a missing name', async () => {
    const factory = new IDBFactory();
    const open = vi.spyOn(factory, 'open');
    await expect(read(factory)).rejects.toMatchObject({
      code: 'missing-databases',
      missingDatabases: fields.map(([name]) => name),
    });
    expect(open).not.toHaveBeenCalled();
    await all(factory);
    const row = vi.fn();
    const empty = await read(factory, { onRow: row });
    expect(row).not.toHaveBeenCalled();
    expect(
      empty.databases.every((db) => db.stores.every((s) => s.count === 0)),
    ).toBe(true);
    const unknown = await create(factory, 'unrelated', []);
    unknown.close();
    open.mockClear();
    await read(factory);
    expect(open.mock.calls.map(([name]) => name)).toEqual(
      fields.map(([name]) => name),
    );
  });

  it('aborts an accidental creation when the source disappeared between catalog and open', async () => {
    const factory = new IDBFactory();
    await all(factory);
    const before = await factory.databases();
    const name = fields[0][0];
    await new Promise<void>((resolve) => {
      factory.deleteDatabase(name).onsuccess = () => resolve();
    });
    const catalog = vi
      .spyOn(factory, 'databases')
      .mockResolvedValueOnce(before);
    await expect(read(factory)).rejects.toMatchObject({
      code: 'creation-race',
    });
    catalog.mockRestore();
    expect((await factory.databases()).some((db) => db.name === name)).toBe(
      false,
    );
  });

  it('rejects a failed/unsupported catalog, unknown product DB and non-whitelisted index without altering them', async () => {
    const factory = new IDBFactory();
    const failure = new DOMException('denied', 'SecurityError');
    vi.spyOn(factory, 'databases').mockRejectedValueOnce(failure);
    await expect(read(factory)).rejects.toBe(failure);
    const badIndex = fields[0][0];
    await all(factory, (store) => {
      if (store.transaction.db.name === badIndex && store.name === 'datasets')
        store.createIndex('foreign', 'name');
    });
    await expect(read(factory)).rejects.toMatchObject({ code: 'schema' });
    (await create(factory, 'riverlab-crypto-lab-unknown', [])).close();
    const open = vi.spyOn(factory, 'open');
    await expect(read(factory)).rejects.toMatchObject({ code: 'schema' });
    expect(open).not.toHaveBeenCalled();
  });

  it('aborts read/cursor faults and supports retry after the failure', async () => {
    const factory = new IDBFactory();
    await all(factory);
    const original = IDBObjectStore.prototype.openCursor;
    const injected = vi
      .spyOn(IDBObjectStore.prototype, 'openCursor')
      .mockImplementationOnce(function (this: IDBObjectStore, ...args) {
        const request = original.apply(this, args);
        this.transaction.abort();
        return request;
      });
    try {
      await expect(read(factory)).rejects.toThrow();
    } finally {
      injected.mockRestore();
    }
    await expect(read(factory)).resolves.toMatchObject({
      scope: 'all-databases',
    });
  });

  it('refuses to produce evidence when an actual whole-store transaction commits before the cut', async () => {
    const factory = new IDBFactory();
    await all(factory);
    const original = IDBObjectStore.prototype.count;
    const early = vi
      .spyOn(IDBObjectStore.prototype, 'count')
      .mockImplementationOnce(function (this: IDBObjectStore, ...args) {
        const request = original.apply(this, args);
        this.transaction.commit();
        return request;
      });
    const firstRow = vi.fn();
    try {
      await expect(read(factory, { onRow: firstRow })).rejects.toThrow();
      expect(firstRow).not.toHaveBeenCalled();
    } finally {
      early.mockRestore();
    }
    await expect(read(factory)).resolves.toMatchObject({
      scope: 'all-databases',
    });
  });

  it('blocks wrong key types, source version changes and cancelled/stalled sinks', async () => {
    const damaged = new IDBFactory();
    await all(damaged, (store) => store.add({ id: 123 }));
    await expect(read(damaged)).rejects.toMatchObject({ code: 'key' });

    const factory = new IDBFactory();
    await all(factory, (store) => store.add({ id: 'item' }));
    const controller = new AbortController();
    const before = await factory.databases();
    const never = new Promise<void>(() => {});
    await expect(
      read(factory, {
        signal: controller.signal,
        onRow: () => {
          controller.abort();
          return never;
        },
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await expect(
      read(factory, { timeoutMs: 50, onLayout: () => never }),
    ).rejects.toMatchObject({ code: 'timeout' });
    expect(await factory.databases()).toEqual(before);
    let upgrade!: IDBOpenDBRequest;
    const upgraded = deferred<void>();
    await expect(
      read(factory, {
        onLayout: () => {
          upgrade = factory.open(fields[0][0], 2);
          upgrade.onsuccess = () => {
            upgrade.result.close();
            upgraded.resolve();
          };
          return never;
        },
      }),
    ).rejects.toMatchObject({ code: 'versionchange' });
    await upgraded.promise;
    await expect(read(factory)).rejects.toMatchObject({ code: 'schema' });
  });
});
