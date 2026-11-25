import {
  verifyAdvancedReport,
  type AdvancedReport,
} from '../core/advanced-research/report';
import { assertMetadata, digestPattern } from '../core/portfolio/report-common';
import { LocalDatabase } from './local-database';
import { readSummaryList } from './summary-list';

export type AdvancedSummary = Pick<
  AdvancedReport,
  'id' | 'name' | 'createdUtcMs' | 'reportHash'
>;

function checkSummary(summary: AdvancedSummary) {
  assertMetadata(summary);
  if (
    typeof summary.reportHash !== 'string' ||
    !digestPattern.test(summary.reportHash)
  )
    throw new Error('高级研究报告摘要损坏。');
}

export class AdvancedStore extends LocalDatabase {
  constructor(factory: () => IDBFactory = () => indexedDB) {
    super(factory, 'riverlab-crypto-lab-advanced-research', [
      'reports',
      'summaries',
    ]);
  }

  /** Called inside the report Worker. Only a complete replay can enter storage. */
  async save(value: unknown, observedUtcMs = Date.now()) {
    const record = verifyAdvancedReport(value, observedUtcMs);
    // Verification rebuilds every result but retains the input. Detach it
    // before awaiting the database open so callers cannot change the snapshot.
    record.input = structuredClone(record.input);
    const { id, name, createdUtcMs, reportHash } = record;
    const summary = { id, name, createdUtcMs, reportHash };
    checkSummary(summary);
    try {
      await this.transaction<void>('readwrite', (tx, done) => {
        tx.objectStore('reports').add(record);
        tx.objectStore('summaries').add(summary);
        done(undefined);
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'ConstraintError')
        throw new Error('相同 ID 的高级研究报告已存在，已拒绝覆盖。', {
          cause: error,
        });
      throw error;
    }
  }

  list() {
    return readSummaryList(this, checkSummary);
  }

  async load(id: string): Promise<unknown> {
    const record = await this.transaction<unknown>('readonly', (tx, done) => {
      const req = tx.objectStore('reports').get(id);
      req.onsuccess = () => done(req.result);
    });
    if (!record) throw new Error('高级研究报告不存在。');
    return record;
  }
}
