import { readSummaryList } from './summary-list';
import { LocalDatabase } from './local-database';
import { assertRiskStudy, summarizeRisk } from '../core/risk-analysis';
import type { RiskStudy, RiskSummary } from '../core/risk-analysis';
function checkSummary(s: RiskSummary) {
  if (
    !s ||
    typeof s.id !== 'string' ||
    !s.id ||
    s.id.length > 100 ||
    typeof s.name !== 'string' ||
    !s.name.trim() ||
    s.name.length > 160 ||
    typeof s.symbol !== 'string' ||
    !s.symbol.trim() ||
    s.symbol.length > 80 ||
    typeof s.sourceName !== 'string' ||
    !s.sourceName.trim() ||
    s.sourceName.length > 160 ||
    !Number.isSafeInteger(s.createdUtcMs) ||
    s.createdUtcMs < 0 ||
    s.createdUtcMs > 4_102_444_800_000 ||
    typeof s.payloadHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(s.payloadHash)
  )
    throw new Error('风险摘要损坏，未自动修复。');
}

export class RiskStore extends LocalDatabase {
  constructor(
    factory: () => IDBFactory = () => indexedDB,
    name = 'riverlab-crypto-lab-risk',
  ) {
    super(factory, name, ['studies', 'summaries']);
  }
  async save(record: RiskStudy) {
    assertRiskStudy(record);
    await this.transaction<void>('readwrite', (tx, done) => {
      tx.objectStore('studies').add(record);
      tx.objectStore('summaries').add(summarizeRisk(record));
      done(undefined);
    });
  }
  listAvailable() {
    return readSummaryList(this, checkSummary);
  }
  async list(): Promise<RiskSummary[]> {
    const { items, damagedCount } = await this.listAvailable();
    if (damagedCount) throw new Error('风险摘要损坏，未自动修复。');
    return items;
  }
  async load(id: string): Promise<unknown> {
    const value = await this.transaction<unknown>('readonly', (tx, done) => {
      const r = tx.objectStore('studies').get(id);
      r.onsuccess = () => done(r.result);
    });
    if (!value) throw new Error('风险报告不存在，可能已删除。');
    return value;
  }
  async delete(id: string) {
    await this.transaction<void>('readwrite', (tx, done) => {
      tx.objectStore('studies').delete(id);
      tx.objectStore('summaries').delete(id);
      done(undefined);
    });
  }
}
