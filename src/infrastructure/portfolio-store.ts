import {
  assertPortfolioSummary,
  summarizePortfolio,
} from '../core/portfolio/report';
import type {
  PortfolioExperiment,
  PortfolioSummary,
} from '../core/portfolio/report';
import { LocalDatabase } from './local-database';

/** Separate database. Worker generation or verification precedes every UI save. */
export class PortfolioStore extends LocalDatabase {
  constructor(
    factory: () => IDBFactory = () => indexedDB,
    name = 'riverlab-crypto-lab-portfolios',
  ) {
    super(factory, name, ['experiments', 'summaries']);
  }
  async save(record: PortfolioExperiment): Promise<void> {
    const summary = summarizePortfolio(record);
    assertPortfolioSummary(summary);
    try {
      await this.transaction<void>('readwrite', (tx, done) => {
        tx.objectStore('experiments').add(record);
        tx.objectStore('summaries').add(summary);
        done(undefined);
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'ConstraintError')
        throw new Error('相同 ID 的组合实验已存在，已拒绝覆盖。', {
          cause: error,
        });
      throw error;
    }
  }
  async list(): Promise<PortfolioSummary[]> {
    const rows = await this.transaction<PortfolioSummary[]>(
      'readonly',
      (tx, done) => {
        const request = tx.objectStore('summaries').getAll();
        request.onsuccess = () => done(request.result);
      },
    );
    rows.forEach(assertPortfolioSummary);
    return rows;
  }
  async load(id: string): Promise<unknown> {
    const row = await this.transaction<unknown>('readonly', (tx, done) => {
      const request = tx.objectStore('experiments').get(id);
      request.onsuccess = () => done(request.result);
    });
    if (!row) throw new Error('找不到组合实验，可能已被删除。');
    return row;
  }
  async delete(id: string): Promise<void> {
    await this.transaction<void>('readwrite', (tx, done) => {
      tx.objectStore('experiments').delete(id);
      tx.objectStore('summaries').delete(id);
      done(undefined);
    });
  }
}
