import type { Experiment, ExperimentSummary } from '../core/experiments';
import { summarizeExperiment } from '../core/experiments';
import { LibraryStore } from './repository';
import { readSummaryList } from './summary-list';

export function assertExperimentSummary(row: ExperimentSummary) {
  if (
    !row ||
    typeof row.id !== 'string' ||
    !row.id.length ||
    row.id.length > 100 ||
    typeof row.name !== 'string' ||
    !row.name.trim() ||
    row.name.length > 160 ||
    typeof row.symbol !== 'string' ||
    !row.symbol.length ||
    row.symbol.length > 80 ||
    !Number.isSafeInteger(row.createdUtcMs) ||
    row.createdUtcMs < 0 ||
    row.createdUtcMs > 4_102_444_800_000 ||
    typeof row.payloadHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(row.payloadHash) ||
    typeof row.runHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(row.runHash) ||
    !['ma', 'rsi', 'breakout', 'rules'].includes(row.strategy)
  )
    throw new Error('实验摘要损坏。');
}

/** Same complete/abort transaction adapter as datasets; isolated DB, never writes datasets. */
export class ExperimentStore extends LibraryStore {
  constructor(factory?: () => IDBFactory, name?: string) {
    super('experiment', factory, name);
  }
  async save(e: Experiment): Promise<void> {
    // Full hash/recalculation occurs in the Worker before this adapter is called.
    try {
      await this.repository.insert(e, summarizeExperiment(e));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'ConstraintError')
        throw new Error('相同 ID 的实验已存在，已拒绝覆盖。', { cause: error });
      throw error;
    }
  }
  listAvailable() {
    return readSummaryList(this, assertExperimentSummary);
  }
  async list(): Promise<ExperimentSummary[]> {
    const { items, damagedCount } = await this.listAvailable();
    if (damagedCount)
      throw new Error('实验摘要损坏，未打开或修复。请用JSON报告备份。');
    return items;
  }
  async load(id: string): Promise<unknown> {
    const record = await this.repository.get(id);
    if (!record) throw new Error('找不到实验，可能已被另一标签页删除。');
    return record; // Caller must verify in Worker before presenting any result.
  }
}
