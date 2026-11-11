import { describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { RuleStore } from '../../src/infrastructure/rule-store';
import { defaultRule } from '../../src/core/strategies';
import { sealRule } from '../../src/core/rule-library';
import { ExperimentStore } from '../../src/infrastructure/experiment-store';
import {
  runExperiment,
  sealExperiment,
  verifyExperiment,
} from '../../src/core/experiments';
import { START, INTERVAL, market } from '../fixtures/backtest';
const record = (revision = 1) =>
  sealRule(
    { ...defaultRule(), revision },
    {
      familyId: 'family',
      name: '中文 空格策略',
      createdUtcMs: START + revision,
    },
  );
describe('immutable rule version persistence', () => {
  it('persists/reopens multiple immutable versions, rejects collisions, deletes one without changing the others', async () => {
    const factory = new IDBFactory(),
      store = new RuleStore(() => factory),
      a = record(),
      b = record(2);
    await store.save(a);
    await store.save(b);
    await expect(store.save(a)).rejects.toThrow();
    const fresh = new RuleStore(() => factory);
    expect(await fresh.list()).toEqual([b, a]);
    await fresh.delete(b.id);
    expect(await fresh.list()).toEqual([a]);
  });
  it('rejects write/list corruption and unavailable browser policy', async () => {
    const factory = new IDBFactory(),
      store = new RuleStore(() => factory),
      a = record();
    await expect(store.save({ ...a, ruleHash: 'bad' })).rejects.toThrow();
    await store.transaction<void>('readwrite', (tx, done) => {
      tx.objectStore('versions').add({ ...a, recordHash: 'bad' });
      done(undefined);
    });
    await expect(store.list()).rejects.toThrow('校验');
    await expect(
      new RuleStore(() => {
        throw new DOMException('blocked', 'SecurityError');
      }).list(),
    ).rejects.toThrow('blocked');
  });
  it('does not report quota or abort success, leaves the portable memory version intact', async () => {
    const factory = new IDBFactory(),
      store = new RuleStore(() => factory),
      a = record();
    const spy = vi
      .spyOn(IDBObjectStore.prototype, 'add')
      .mockImplementation(() => {
        throw new DOMException('quota', 'QuotaExceededError');
      });
    try {
      await expect(store.save(a)).rejects.toThrow('quota');
    } finally {
      spy.mockRestore();
    }
    expect(await store.list()).toEqual([]);
    await expect(
      store.transaction<void>('readwrite', (tx, done) => {
        tx.objectStore('versions').add(a);
        tx.abort();
        done(undefined);
      }),
    ).rejects.toThrow();
    expect(await store.list()).toEqual([]);
    expect(JSON.stringify(a)).toContain(a.ruleHash);
  });
  it('enforces the 100-version budget without dropping existing records', async () => {
    const factory = new IDBFactory(),
      store = new RuleStore(() => factory);
    for (let i = 1; i <= 100; i++) await store.save(record(i));
    await expect(store.save(record(101))).rejects.toThrow('100');
    expect(await store.list()).toHaveLength(100);
  });
  it('rule experiments list and reopen after the library is removed', async () => {
    const factory = new IDBFactory(),
      store = new RuleStore(() => factory),
      experiments = new ExperimentStore(() => factory),
      a = record();
    await store.save(a);
    const d = market([100, 95, 100, 110, 120, 80, 90, 120]);
    const experiment = sealExperiment(
      runExperiment({
        dataset: d,
        strategy: { kind: 'rules', rule: a.rule },
        completedThroughUtcMs: START + d.candles.length * INTERVAL,
      }),
      { id: 'rules', name: '规则实验', createdUtcMs: START, elapsedMs: 1 },
    );
    await experiments.save(experiment);
    await store.delete(a.id);
    expect((await experiments.list())[0].strategy).toBe('rules');
    expect(verifyExperiment(await experiments.load(experiment.id))).toEqual(
      experiment,
    );
  });
});
