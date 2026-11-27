import {
  verifyAdvancedReport,
  type AdvancedReport,
} from '../core/advanced-research/report';
import { assertMetadata, digestPattern } from '../core/portfolio/report-common';
import { LibraryStore } from './repository';
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

export function prepareAdvancedWrite(value: unknown, observedUtcMs: number) {
  const record = verifyAdvancedReport(value, observedUtcMs);
  // Verification rebuilds every result but retains the input. Detach it
  // before awaiting the database open so callers cannot change the snapshot.
  record.input = structuredClone(record.input);
  const { id, name, createdUtcMs, reportHash } = record;
  const summary = { id, name, createdUtcMs, reportHash };
  checkSummary(summary);
  return { record, summary };
}

export class AdvancedStore extends LibraryStore {
  constructor(factory?: () => IDBFactory, name?: string) {
    super('advanced', factory, name);
  }

  async save(value: unknown, observedUtcMs = Date.now()) {
    const { record, summary } = prepareAdvancedWrite(value, observedUtcMs);
    try {
      await this.repository.insert(record, summary);
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
    const record = await this.repository.get(id);
    if (!record) throw new Error('高级研究报告不存在。');
    return record;
  }
}
