// @vitest-environment node
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runExperiment, sealExperiment } from '../../src/core/experiments';
import { createRegimeReport } from '../../src/core/market-regime/report';
import {
  readRegimeFile,
  exportRegimeFile,
} from '../../src/infrastructure/market-regime-file';
import { marketRegimeTask } from '../../src/infrastructure/market-regime-worker';
import type { RegimeRequest } from '../../src/infrastructure/market-regime-worker';
import {
  MarketRegimeStore,
  listRegimeSources,
} from '../../src/infrastructure/market-regime-store';
import { ExperimentStore } from '../../src/infrastructure/experiment-store';
import { INTERVAL, START, market } from '../fixtures/backtest';

const observed = START + 12 * INTERVAL;
function source() {
  const dataset = market([
    100, 110, 109, 95, 100, 100, 103, 101, 118, 109, 111, 95,
  ]);
  return sealExperiment(
    runExperiment({
      dataset,
      strategy: { kind: 'ma', fastPeriod: 2, slowPeriod: 4 },
      completedThroughUtcMs: observed,
    }),
    { id: 'source', name: '原实验', createdUtcMs: observed, elapsedMs: 1 },
  );
}
function report() {
  return createRegimeReport(
    'single',
    source(),
    null,
    { lookback: 1, thresholdBps: 10 },
    { id: 'report', name: '市场状态示例', createdUtcMs: observed },
    observed,
  );
}

describe('市场状态报告存储与 Worker 边界', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  it('源摘要区分实验类型，既有实验独立于报告保存和删除', async () => {
    const s = new ExperimentStore(),
      r = report(),
      e = source();
    await s.save(e);
    expect(await listRegimeSources()).toEqual({
      single: {
        damagedCount: 0,
        items: [
          {
            kind: 'single',
            id: e.id,
            name: e.name,
            payloadHash: e.payloadHash,
            symbols: [e.payload.dataset.symbol],
          },
        ],
      },
      portfolio: { items: [], damagedCount: 0 },
      shared: { items: [], damagedCount: 0 },
    });
    const store = new MarketRegimeStore();
    await store.save(r);
    await expect(store.save(r)).rejects.toThrow('拒绝覆盖');
    expect(await new MarketRegimeStore().load(r.id)).toEqual(r);
    expect(await store.list()).toEqual({
      damagedCount: 0,
      items: [
        {
          id: r.id,
          name: r.name,
          createdUtcMs: r.createdUtcMs,
          reportHash: r.reportHash,
        },
      ],
    });
    await store.delete(r.id);
    expect(await store.list()).toEqual({ items: [], damagedCount: 0 });
    await expect(store.load(r.id)).rejects.toThrow('不存在');
    expect(await s.load(e.id)).toEqual(e);
  });
  it('写入摘要时耗尽配额会回滚此前已添加的报告', async () => {
    const store = new MarketRegimeStore(),
      r = report();
    const add = IDBObjectStore.prototype.add;
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (
      this: IDBObjectStore,
      ...args
    ) {
      if (this.name === 'summaries')
        throw new DOMException('quota', 'QuotaExceededError');
      return add.apply(this, args);
    });
    await expect(store.save(r)).rejects.toMatchObject({
      name: 'QuotaExceededError',
    });
    expect(await store.list()).toEqual({ items: [], damagedCount: 0 });
    await expect(store.load(r.id)).rejects.toThrow('不存在');
  });
  it('损坏摘要阻止展示记录', async () => {
    const store = new MarketRegimeStore();
    await store.transaction<void>('readwrite', (tx, done) => {
      tx.objectStore('summaries').add({ id: 'damaged' });
      done(undefined);
    });
    expect(await store.list()).toEqual({ items: [], damagedCount: 1 });
  });
  it('先校验文件字节上限、UTF-8 和 JSON，再重算报告', async () => {
    const tooLarge = new Blob();
    Object.defineProperty(tooLarge, 'size', { value: 32 * 1024 * 1024 + 1 });
    const read = vi.spyOn(tooLarge, 'arrayBuffer');
    await expect(readRegimeFile(tooLarge, observed)).rejects.toThrow('32 MiB');
    expect(read).not.toHaveBeenCalled();
    await expect(readRegimeFile(new Blob(), observed)).rejects.toThrow('为空');
    for (const bad of [new Blob(['{']), new Blob([new Uint8Array([0xff])])])
      await expect(readRegimeFile(bad, observed)).rejects.toThrow('UTF-8 JSON');
    const r = report();
    const json = exportRegimeFile(r, 'json', observed);
    expect(await readRegimeFile(json, observed)).toEqual(r);
    expect(
      (await exportRegimeFile(r, 'csv', observed).text()).length,
    ).toBeGreaterThan(20);
    for (const corrupted of [
      { ...r, reportHash: 'f'.repeat(64) },
      { ...r, schemaVersion: 10001 },
    ])
      await expect(
        readRegimeFile(new Blob([JSON.stringify(corrupted)]), observed),
      ).rejects.toThrow();
  });
  it('Worker 在运行时拒绝已改动或已删除的原实验，不写入研究报告', async () => {
    const e = source();
    const original = new ExperimentStore();
    await original.save(e);
    const postMessage = vi.fn();
    vi.stubGlobal('postMessage', postMessage);
    vi.stubGlobal('onmessage', null);
    await import('../../src/infrastructure/market-regime.worker');
    const receive = globalThis.onmessage as unknown as (e: {
      data: RegimeRequest;
    }) => Promise<void>;
    const request: RegimeRequest = {
      kind: 'run',
      name: '锁定源实验',
      input: {
        sourceKind: 'single',
        sourceId: e.id,
        expectedHash: '0'.repeat(64),
        reference: null,
        params: { lookback: 1, thresholdBps: 10 },
      },
    };
    await receive({ data: request });
    expect(postMessage).toHaveBeenLastCalledWith({
      error: expect.stringContaining('源实验已改变'),
    });
    await original.delete(e.id);
    await receive({
      data: {
        ...request,
        input: { ...request.input, expectedHash: e.payloadHash },
      },
    });
    expect(postMessage).toHaveBeenLastCalledWith({
      error: expect.stringContaining('找不到实验'),
    });
    expect(await new MarketRegimeStore().list()).toEqual({
      items: [],
      damagedCount: 0,
    });
  });
  it('取消终止 Worker；即使旧结果延迟到达，也没有可用报告', async () => {
    const stop = vi.fn(),
      send = vi.fn();
    let deliver: ((message: unknown) => void) | undefined;
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          deliver = (message) => this.onmessage?.({ data: message });
        }
        onmessage?: (e: { data: unknown }) => void;
        postMessage = send;
        terminate = stop;
      },
    );
    const task = marketRegimeTask({ kind: 'verify', record: {} });
    expect(send).toHaveBeenCalledWith({ kind: 'verify', record: {} });
    const rejection = expect(task.promise).rejects.toThrow(
      '市场状态任务已取消',
    );
    task.cancel();
    expect(stop).toHaveBeenCalled();
    deliver?.({ record: {} });
    await rejection;
  });
});
