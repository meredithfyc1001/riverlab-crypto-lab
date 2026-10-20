// @vitest-environment node
import { describe, expect, it, vi, afterEach } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { ExperimentStore } from '../../src/infrastructure/experiment-store';
import {
  DatasetStore,
  storageMessage,
} from '../../src/infrastructure/dataset-store';
import {
  runExperiment,
  sealExperiment,
  verifyExperiment,
  tradesCsv,
  reportJson,
  DISCLAIMER,
} from '../../src/core/experiments';
import { contentHash } from '../../src/core/backtests/identity';
import { market, START, INTERVAL } from '../fixtures/backtest';
const make = () =>
  sealExperiment(
    runExperiment({
      dataset: market([10, 9, 8, 12, 15, 8, 4, 7, 10, 13]),
      strategy: { kind: 'ma', fastPeriod: 2, slowPeriod: 4 },
      completedThroughUtcMs: START + 10 * INTERVAL,
      config: { feeBps: 10, buySlippageBps: 10, sellSlippageBps: 10 },
      risk: { stopLossBps: 1000, takeProfitBps: 2000 },
    }),
    {
      id: 'experiment-1',
      name: '人工参考',
      createdUtcMs: START,
      elapsedMs: 10,
    },
  );
afterEach(() => vi.restoreAllMocks());
describe('experiment identity and storage boundaries', () => {
  it.each(['ma', 'rsi', 'breakout'] as const)(
    '%s same data/hash/config completely reproducible',
    (kind) => {
      const input = {
        dataset: market([10, 9, 8, 12, 15, 8, 4, 7, 10, 13]),
        strategy: { kind },
        completedThroughUtcMs: START + 10 * INTERVAL,
      };
      expect(JSON.stringify(runExperiment(input))).toBe(
        JSON.stringify(runExperiment(input)),
      );
    },
  );
  it('save, new adapter instance, load, verified recomputation, delete; never overwrites the original dataset', async () => {
    const factory = new IDBFactory(),
      store = new ExperimentStore(() => factory),
      datasets = new DatasetStore(() => factory),
      e = make();
    await datasets.save(e.payload.dataset);
    await store.save(e);
    const other = new ExperimentStore(() => factory);
    expect(await other.list()).toHaveLength(1);
    expect((await other.list())[0]).not.toHaveProperty('payload');
    expect(verifyExperiment(await other.load(e.id))).toEqual(e);
    await expect(other.save(e)).rejects.toThrow(); // add: cannot overwrite an experiment
    expect(await datasets.load(e.payload.dataset.id)).toEqual(
      e.payload.dataset,
    );
    await datasets.delete(e.payload.dataset.id);
    expect(verifyExperiment(await other.load(e.id))).toEqual(e);
    await other.delete(e.id);
    expect(await other.list()).toEqual([]);
    await expect(other.load(e.id)).rejects.toThrow('找不到');
  });
  it.each(['hash', 'result', 'stats', 'data', 'version'] as const)(
    'rejects corrupt %s even if attacker rehashes payload',
    (kind) => {
      const e = make();
      if (kind === 'hash') e.payloadHash = '0'.repeat(64);
      if (kind === 'result') e.payload.result.final.cash = '99';
      if (kind === 'stats') e.payload.statistics.netPnl = '99';
      if (kind === 'data')
        e.payload.dataset.candles[0] = {
          ...e.payload.dataset.candles[0],
          high: 1,
        };
      if (kind === 'version')
        e.payload.result.manifest.algorithmVersion = 'future';
      if (kind !== 'hash') e.payloadHash = contentHash(e.payload);
      expect(() => verifyExperiment(e)).toThrow('损坏');
    },
  );
  it('JSON includes dataset snapshot, full manifest, assumptions, definitions and disclaimer; CSV matches exact fees and unknown intervals', () => {
    const e = make(),
      json = JSON.parse(reportJson(e)),
      csv = tradesCsv(e);
    expect(json.format).toBe('riverlab-experiment');
    expect(verifyExperiment(json)).toEqual(json);
    expect(json.payload.result.manifest.dataHash).toBe(
      e.payload.result.manifest.dataHash,
    );
    expect(json.payload.dataset.candles).toHaveLength(10);
    expect(json.payload.definitions.length).toBeGreaterThan(3);
    expect(json.payload.disclaimer).toBe(DISCLAIMER);
    expect(csv).toContain(DISCLAIMER);
    for (const f of e.payload.result.fills) expect(csv).toContain(`"${f.fee}"`);
    expect(csv).toContain('barOpenUtcMs');
    expect(csv).toContain('triggerAssumption');
    expect(csv.split('\r\n')).toHaveLength(e.payload.result.fills.length + 4);
  });
  it('CSV escapes quotes/newlines and neutralizes formula text', () => {
    const e = make();
    e.payload.result.fills[0].reason = '=HYPERLINK("evil")\nnext';
    expect(tradesCsv(e)).toContain('"\'=HYPERLINK(""evil"")\nnext"');
  });
  it('quota or abort rejects without a phantom summary', async () => {
    const factory = new IDBFactory(),
      store = new ExperimentStore(() => factory);
    await store.list();
    const spy = vi
      .spyOn(IDBObjectStore.prototype, 'add')
      .mockImplementation(() => {
        throw new DOMException('full', 'QuotaExceededError');
      });
    await expect(store.save(make())).rejects.toThrow('full');
    expect(
      storageMessage(new DOMException('full', 'QuotaExceededError')),
    ).toContain('空间不足');
    spy.mockRestore();
    expect(await store.list()).toEqual([]);
    const original = IDBObjectStore.prototype.add;
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<typeof original>
    ) {
      const r = original.apply(this, args);
      r.addEventListener('success', () => this.transaction.abort());
      return r;
    });
    await expect(store.save(make())).rejects.toThrow('中止');
    expect(await store.list()).toEqual([]);
  });
  it('storage access rejected, no fake save', async () => {
    const store = new ExperimentStore(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    await expect(store.save(make())).rejects.toThrow('denied');
  });
});
