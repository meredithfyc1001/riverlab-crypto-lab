import { webcrypto } from 'node:crypto';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DatasetStore,
  encodeBackup,
  decodeBackup,
  storageMessage,
  MAX_BACKUP_BYTES,
} from '../../src/infrastructure/dataset-store';
import { assertDataset, makeDataset } from '../../src/core/data/dataset';
import { analyzeCsv } from '../../src/core/data';
import { fixtureDataset, options } from '../fixtures/dataset';
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('IndexedDB 原生事务与备份契约', () => {
  it('保存、实例重建后列表/重新打开、删除；列表不加载行情数组', async () => {
    const factory = new IDBFactory();
    const first = new DatasetStore(() => factory);
    const dataset = fixtureDataset();
    await first.save(dataset);
    const reopened = new DatasetStore(() => factory);
    const list = await reopened.list();
    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty('candles');
    expect(await reopened.load(dataset.id)).toEqual(dataset);
    await reopened.delete(dataset.id);
    expect(await reopened.list()).toEqual([]);
    await expect(reopened.load(dataset.id)).rejects.toThrow('找不到');
  });
  it('请求成功之后事务 abort 仍算失败，没有虚假成功或残留摘要', async () => {
    const factory = new IDBFactory();
    const store = new DatasetStore(() => factory);
    await store.list();
    const original = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<typeof original>
    ) {
      const request = original.apply(this, args);
      request.addEventListener('success', () => this.transaction.abort());
      return request;
    });
    await expect(store.save(fixtureDataset())).rejects.toThrow('中止');
    expect(await store.list()).toEqual([]);
  });
  it('写入抛出 QuotaExceededError 时原子回滚并明确提示空间不足', async () => {
    const factory = new IDBFactory();
    const store = new DatasetStore(() => factory);
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    let failure: unknown;
    try {
      await store.save(fixtureDataset());
    } catch (error) {
      failure = error;
    }
    expect(storageMessage(failure)).toContain('空间不足');
    expect(await store.list()).toEqual([]);
  });
  it('拒绝访问、隐私模式能力不足时失败，不回退成假保存', async () => {
    const store = new DatasetStore(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    await expect(store.save(fixtureDataset())).rejects.toThrow('denied');
    expect(
      storageMessage(new DOMException('denied', 'SecurityError')),
    ).toContain('浏览器拒绝');
  });
  it('源文件有错误/待确认不允许保存有效子集', () => {
    const d = fixtureDataset();
    const report = analyzeCsv(
      'timestamp,open,high,low,close,volume\n1735689600000,bad,2,1,1,1',
      options,
    );
    expect(() => makeDataset(d, report)).toThrow('不截取有效子集');
    const pending = analyzeCsv(
      'timestamp,open,high,low,close,volume\n1735689600000,1,2,1,1,1',
      { ...options, intervalMs: null },
    );
    expect(() => makeDataset(d, pending)).toThrow('待确认');
  });
  it('带缺口的完整数据及警告、身份、解析约定备份恢复不丢失', async () => {
    const d = fixtureDataset(true);
    const backup = await encodeBackup(d);
    const restored = await decodeBackup(backup);
    expect(restored).toEqual(d);
    expect(restored.quality.missingCandles).toBe(2);
    const store = new DatasetStore(() => new IDBFactory());
    await store.save(restored);
  });
  it('损坏 JSON/版本/校验和被拒绝', async () => {
    await expect(decodeBackup('')).rejects.toThrow('合法 JSON');
    await expect(decodeBackup('{"version":99}')).rejects.toThrow('版本');
    const backup = JSON.parse(await encodeBackup(fixtureDataset()));
    backup.dataset.candles[0].close = 100;
    await expect(decodeBackup(JSON.stringify(backup))).rejects.toThrow(
      '校验和',
    );
  });
  it('即使校验和重算，非法 OHLC/时间/质量元信息也不能恢复', async () => {
    const backup = JSON.parse(await encodeBackup(fixtureDataset()));
    backup.dataset.candles[0].timestampUtcMs = -1;
    backup.payloadSha256 = Buffer.from(
      await webcrypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify(backup.dataset)),
      ),
    ).toString('hex');
    await expect(decodeBackup(JSON.stringify(backup))).rejects.toThrow(
      'UTC 时间非法',
    );
  });
  it('备份资源上限不改变 CSV 导入上限', async () => {
    await expect(
      decodeBackup(' '.repeat(MAX_BACKUP_BYTES + 1)),
    ).rejects.toThrow('20 MiB');
  });
  it.each([
    'price',
    'duplicate',
    'interval',
    'quality',
    'hash',
    'version',
    'mapping',
    'unit',
    'warning',
  ] as const)('拒绝损坏数据：%s', (kind) => {
    const d = structuredClone(fixtureDataset());
    if (kind === 'price') d.candles[0] = { ...d.candles[0], high: 1 };
    if (kind === 'duplicate')
      d.candles[1] = {
        ...d.candles[1],
        timestampUtcMs: d.candles[0].timestampUtcMs,
      };
    if (kind === 'interval')
      d.candles[1] = {
        ...d.candles[1],
        timestampUtcMs: d.candles[1].timestampUtcMs + 1,
      };
    if (kind === 'quality') d.quality.missingCandles = 99;
    if (kind === 'hash') d.file.sha256 = 'bad';
    if (kind === 'version') Object.assign(d, { schemaVersion: 99 });
    if (kind === 'mapping') d.parsing.mapping.volume = 1;
    if (kind === 'unit') d.parsing.timeUnit = 'us';
    if (kind === 'warning') d.quality.warningCount = 0;
    expect(() => assertDataset(d)).toThrow('损坏');
  });
});

it('第二个写入同步失败时，也必须回滚第一个数据写入', async () => {
  const factory = new IDBFactory(),
    store = new DatasetStore(() => factory);
  const original = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
    this: IDBObjectStore,
    ...args: Parameters<typeof original>
  ) {
    if (this.name === 'summaries')
      throw new DOMException('full', 'QuotaExceededError');
    return original.apply(this, args);
  });
  await expect(store.save(fixtureDataset())).rejects.toThrow('full');
  expect(await store.list()).toEqual([]);
  await expect(store.load('fixture-1')).rejects.toThrow('找不到');
});
it('摘要损坏时明确失败，不能把它作为可用列表交给界面', async () => {
  const factory = new IDBFactory(),
    store = new DatasetStore(() => factory);
  await store.save(fixtureDataset());
  await new Promise<void>((resolve, reject) => {
    const request = factory.open('riverlab-crypto-lab', 1);
    request.onsuccess = () => {
      const db = request.result,
        tx = db.transaction('summaries', 'readwrite');
      tx.objectStore('summaries').put({ id: 'bad' });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onabort = () => reject(tx.error);
    };
  });
  await expect(store.list()).rejects.toThrow('摘要损坏');
});
