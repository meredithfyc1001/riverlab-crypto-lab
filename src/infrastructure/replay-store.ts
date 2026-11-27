import { readSummaryList } from './summary-list';
import { LibraryStore } from './repository';
import { assertReplayCheckpoint, summarizeReplay } from '../core/replay';
import type { ReplayCheckpoint, ReplaySummary } from '../core/replay';

export function checkSummary(r: ReplaySummary) {
  if (
    !r ||
    typeof r.id !== 'string' ||
    !r.id ||
    r.id.length > 100 ||
    typeof r.name !== 'string' ||
    !r.name.trim() ||
    r.name.length > 160 ||
    typeof r.symbol !== 'string' ||
    !r.symbol.length ||
    r.symbol.length > 80 ||
    !Number.isSafeInteger(r.cursor) ||
    r.cursor < 1 ||
    r.cursor > 50000 ||
    !Number.isSafeInteger(r.createdUtcMs) ||
    r.createdUtcMs < 0 ||
    r.createdUtcMs > 4_102_444_800_000 ||
    typeof r.payloadHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(r.payloadHash)
  )
    throw new Error('回放摘要损坏，未打开或修复。');
}

export class ReplayStore extends LibraryStore {
  constructor(factory?: () => IDBFactory, name?: string) {
    super('replay', factory, name);
  }
  async save(record: ReplayCheckpoint) {
    assertReplayCheckpoint(record);
    await this.repository.insert(record, summarizeReplay(record));
  }
  listAvailable() {
    return readSummaryList(this, checkSummary);
  }
  async list(): Promise<ReplaySummary[]> {
    const { items, damagedCount } = await this.listAvailable();
    if (damagedCount) throw new Error('回放摘要损坏，未打开或修复。');
    return items;
  }
  async load(id: string): Promise<unknown> {
    const record = await this.repository.get(id);
    if (!record) throw new Error('回放记录不存在，可能已删除。');
    return record;
  }
}
