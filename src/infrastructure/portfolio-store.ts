import type { PortfolioRecordMetadata } from '../core/portfolio/report-common';
import {
  assertPortfolioSummary,
  summarizePortfolio,
} from '../core/portfolio/report-common';
import type {
  PortfolioExperiment,
  PortfolioSummary,
} from '../core/portfolio/report';
import { LibraryStore } from './repository';
import { readSummaryList } from './summary-list';

/** Separate database. Worker generation or verification precedes every UI save. */
export class PortfolioStore<
  T extends PortfolioRecordMetadata = PortfolioExperiment,
> extends LibraryStore {
  constructor(
    factory?: () => IDBFactory,
    name?: string,
    kind: 'portfolio' | 'shared_pool' = 'portfolio',
  ) {
    super(kind, factory, name);
  }
  async save(record: T): Promise<void> {
    const summary = summarizePortfolio(record);
    assertPortfolioSummary(summary);
    try {
      await this.repository.insert(record, summary);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'ConstraintError')
        throw new Error('相同 ID 的组合实验已存在，已拒绝覆盖。', {
          cause: error,
        });
      throw error;
    }
  }
  listAvailable() {
    return readSummaryList(this, assertPortfolioSummary);
  }
  async list(): Promise<PortfolioSummary[]> {
    const { items, damagedCount } = await this.listAvailable();
    if (damagedCount) throw new Error('组合摘要损坏。');
    return items;
  }
  async load(id: string): Promise<unknown> {
    const row = await this.repository.get(id);
    if (!row) throw new Error('找不到组合实验，可能已被删除。');
    return row;
  }
}
