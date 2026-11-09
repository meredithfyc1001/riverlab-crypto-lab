import { describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { ReplayStore } from '../../src/infrastructure/replay-store';
import { DatasetStore } from '../../src/infrastructure/dataset-store';
import { ReplaySession } from '../../src/core/replay';
import { market, START } from '../fixtures/backtest';
const record = () => {
  const d = market([100, 110, 90, 120]);
  const s = new ReplaySession(d);
  s.advance();
  s.trade('buy', '1');
  return {
    d,
    record: s.checkpoint({
      id: 'checkpoint',
      name: '中文 空格快照',
      createdUtcMs: START,
    }),
  };
};
describe('replay IndexedDB complete/abort and source isolation', () => {
  it('saves, lists, reopens in a fresh adapter and deletes without touching source datasets', async () => {
    const factory = new IDBFactory(),
      store = new ReplayStore(() => factory),
      { d, record: r } = record(),
      datasets = new DatasetStore(() => factory);
    await datasets.save(d);
    await store.save(r);
    const fresh = new ReplayStore(() => factory);
    expect(await fresh.list()).toHaveLength(1);
    const loaded = await fresh.load(r.id);
    expect(
      ReplaySession.restore(await datasets.load(d.id), loaded).view().pending
        ?.side,
    ).toBe('buy');
    await fresh.delete(r.id);
    expect(await fresh.list()).toEqual([]);
    await expect(fresh.load(r.id)).rejects.toThrow('不存在');
    expect(await datasets.load(d.id)).toEqual(d);
  });
  it('does not overwrite an existing checkpoint or its summary', async () => {
    const factory = new IDBFactory(),
      store = new ReplayStore(() => factory),
      r = record().record;
    await store.save(r);
    await expect(store.save(r)).rejects.toThrow();
    expect(await store.list()).toHaveLength(1);
    expect(await store.load(r.id)).toEqual(r);
  });
  it('rejects corruption on writes and damaged summaries on listing', async () => {
    const factory = new IDBFactory(),
      store = new ReplayStore(() => factory),
      r = record().record;
    const bad = structuredClone(r);
    bad.payload.cursor++;
    await expect(store.save(bad)).rejects.toThrow('校验');
    expect(await store.list()).toEqual([]);
    await store.save(r);
    await store.transaction<void>('readwrite', (tx, done) => {
      tx.objectStore('summaries').put({ id: r.id, name: '' });
      done(undefined);
    });
    await expect(store.list()).rejects.toThrow('损坏');
  });
  it('quota failure never reports success or commits a partial summary; memory report remains exportable', async () => {
    const factory = new IDBFactory(),
      store = new ReplayStore(() => factory),
      r = record().record;
    const spy = vi
      .spyOn(IDBObjectStore.prototype, 'add')
      .mockImplementation(() => {
        throw new DOMException('quota', 'QuotaExceededError');
      });
    try {
      await expect(store.save(r)).rejects.toThrow('quota');
    } finally {
      spy.mockRestore();
    }
    expect(await store.list()).toEqual([]);
    expect(JSON.stringify(r)).toContain(r.payloadHash);
  });
  it('abort after the full record write rolls back both stores', async () => {
    const factory = new IDBFactory(),
      store = new ReplayStore(() => factory),
      r = record().record;
    await expect(
      store.transaction<void>('readwrite', (tx, done) => {
        tx.objectStore('replays').add(r);
        tx.abort();
        done(undefined);
      }),
    ).rejects.toThrow();
    expect(await store.list()).toEqual([]);
    await expect(store.load(r.id)).rejects.toThrow('不存在');
  });
  it('IndexedDB factory/policy failures stay failures', async () => {
    const store = new ReplayStore(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    await expect(store.list()).rejects.toThrow('blocked');
  });
});
