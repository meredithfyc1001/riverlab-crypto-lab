import { readSummaryList } from './summary-list';
import { LocalDatabase } from './local-database';
import { assertReplayCheckpoint, summarizeReplay } from '../core/replay';
import type { ReplayCheckpoint, ReplaySummary } from '../core/replay';

function checkSummary(r: ReplaySummary) {
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

export class ReplayStore extends LocalDatabase {
  constructor(
    factory: () => IDBFactory = () => indexedDB,
    name = 'riverlab-crypto-lab-replays',
  ) {
    super(factory, name, ['replays', 'summaries']);
  }
  async save(record: ReplayCheckpoint) {
    assertReplayCheckpoint(record);
    await this.transaction<void>('readwrite', (tx, done) => {
      tx.objectStore('replays').add(record);
      tx.objectStore('summaries').add(summarizeReplay(record));
      done(undefined);
    });
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
    const record = await this.transaction<unknown>('readonly', (tx, done) => {
      const request = tx.objectStore('replays').get(id);
      request.onsuccess = () => done(request.result);
    });
    if (!record) throw new Error('回放记录不存在，可能已删除。');
    return record;
  }
  async delete(id: string) {
    await this.transaction<void>('readwrite', (tx, done) => {
      tx.objectStore('replays').delete(id);
      tx.objectStore('summaries').delete(id);
      done(undefined);
    });
  }
}
