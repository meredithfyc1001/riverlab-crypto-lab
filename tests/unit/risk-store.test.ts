import { describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { RiskStore } from '../../src/infrastructure/risk-store';
import {
  analyzeExperiment,
  sealRiskStudy,
  summarizeRisk,
  verifyRiskStudy,
} from '../../src/core/risk-analysis';
import { runExperiment, sealExperiment } from '../../src/core/experiments';
import { market, START, INTERVAL } from '../fixtures/backtest';
const study = () => {
  const dataset = market(
    Array.from(
      { length: 36 },
      (_, i) => 100 + (i % 12 < 6 ? i % 6 : 6 - (i % 6)),
    ),
  );
  const e = sealExperiment(
    runExperiment({
      dataset,
      strategy: { kind: 'ma', fastPeriod: 2, slowPeriod: 4 },
      completedThroughUtcMs: START + 36 * INTERVAL,
    }),
    { id: 'source', name: '合成MA源', createdUtcMs: START, elapsedMs: 1 },
  );
  return sealRiskStudy(
    analyzeExperiment(e, {
      method: 'block',
      seed: 42,
      paths: 20,
      steps: 10,
      blockSize: 3,
      thresholdPct: 50,
    }),
    { id: 'risk', name: '中文风险报告', createdUtcMs: START, elapsedMs: 1 },
  );
};
describe('risk report transactions', () => {
  it('save/reopen/delete preserves a self-contained verified source snapshot', async () => {
    const factory = new IDBFactory(),
      s = new RiskStore(() => factory),
      r = study();
    await s.save(r);
    const fresh = new RiskStore(() => factory);
    expect(await fresh.list()).toHaveLength(1);
    expect(verifyRiskStudy(await fresh.load(r.id))).toEqual(r);
    await fresh.delete(r.id);
    expect(await fresh.list()).toEqual([]);
    await expect(fresh.load(r.id)).rejects.toThrow('不存在');
  });
  it('does not overwrite an existing record', async () => {
    const factory = new IDBFactory(),
      s = new RiskStore(() => factory),
      r = study();
    await s.save(r);
    await expect(s.save(r)).rejects.toThrow();
    expect(await s.load(r.id)).toEqual(r);
  });
  it('quota abort retains no false record and does not mutate the memory report', async () => {
    const factory = new IDBFactory(),
      s = new RiskStore(() => factory),
      r = study();
    const original = JSON.stringify(r);
    const spy = vi
      .spyOn(IDBObjectStore.prototype, 'add')
      .mockImplementation(() => {
        throw new DOMException('quota', 'QuotaExceededError');
      });
    try {
      await expect(s.save(r)).rejects.toThrow('quota');
    } finally {
      spy.mockRestore();
    }
    expect(await s.list()).toEqual([]);
    expect(JSON.stringify(r)).toBe(original);
  });
  it('rejects damaged reports and summaries', async () => {
    const factory = new IDBFactory(),
      s = new RiskStore(() => factory),
      r = study(),
      bad = structuredClone(r);
    bad.payload.simulation.paths[0].finalEquity = '9';
    await expect(s.save(bad)).rejects.toThrow('校验');
    await s.save(r);
    await s.transaction<void>('readwrite', (tx, done) => {
      tx.objectStore('summaries').put({
        ...summarizeRisk(r),
        createdUtcMs: Number.MAX_SAFE_INTEGER,
      });
      done(undefined);
    });
    await expect(s.list()).rejects.toThrow('损坏');
    await s.transaction<void>('readwrite', (tx, done) => {
      tx.objectStore('summaries').put({ id: r.id, name: '' });
      done(undefined);
    });
    await expect(s.list()).rejects.toThrow('损坏');
  });
  it('rolls back both stores after explicit abort', async () => {
    const factory = new IDBFactory(),
      s = new RiskStore(() => factory),
      r = study();
    await expect(
      s.transaction<void>('readwrite', (tx, done) => {
        tx.objectStore('studies').add(r);
        tx.abort();
        done(undefined);
      }),
    ).rejects.toThrow();
    expect(await s.list()).toEqual([]);
  });
});
