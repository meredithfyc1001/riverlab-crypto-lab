import type { Experiment, ExperimentSummary } from '../core/experiments';
import { summarizeExperiment } from '../core/experiments';
import { LocalDatabase } from './local-database';

/** Same complete/abort transaction adapter as datasets; isolated DB, never writes datasets. */
export class ExperimentStore extends LocalDatabase {
  constructor(
    factory: () => IDBFactory = () => indexedDB,
    name = 'riverlab-crypto-lab-experiments',
  ) {
    super(factory, name, ['experiments', 'summaries']);
  }
  async save(e: Experiment): Promise<void> {
    // Full hash/recalculation occurs in the Worker before this adapter is called.
    await this.transaction<void>('readwrite', (tx, done) => {
      tx.objectStore('experiments').add(e);
      tx.objectStore('summaries').add(summarizeExperiment(e));
      done(undefined);
    });
  }
  async list(): Promise<ExperimentSummary[]> {
    const list = await this.transaction<ExperimentSummary[]>(
      'readonly',
      (tx, done) => {
        const r = tx.objectStore('summaries').getAll();
        r.onsuccess = () => done(r.result as ExperimentSummary[]);
      },
    );
    if (
      list.some(
        (s) =>
          !s ||
          typeof s.id !== 'string' ||
          !s.id ||
          typeof s.name !== 'string' ||
          !s.name ||
          typeof s.symbol !== 'string' ||
          !Number.isSafeInteger(s.createdUtcMs) ||
          s.createdUtcMs < 0 ||
          !/^[a-f0-9]{64}$/.test(s.payloadHash) ||
          !/^[a-f0-9]{64}$/.test(s.runHash) ||
          !['ma', 'rsi', 'breakout', 'rules'].includes(s.strategy),
      )
    )
      throw new Error('实验摘要损坏，未打开或修复。请用JSON报告备份。');
    return list;
  }
  async load(id: string): Promise<unknown> {
    const record = await this.transaction<unknown>('readonly', (tx, done) => {
      const r = tx.objectStore('experiments').get(id);
      r.onsuccess = () => done(r.result);
    });
    if (!record) throw new Error('找不到实验，可能已被另一标签页删除。');
    return record; // Caller must verify in Worker before presenting any result.
  }
  async delete(id: string): Promise<void> {
    await this.transaction<void>('readwrite', (tx, done) => {
      tx.objectStore('experiments').delete(id);
      tx.objectStore('summaries').delete(id);
      done(undefined);
    });
  }
}
