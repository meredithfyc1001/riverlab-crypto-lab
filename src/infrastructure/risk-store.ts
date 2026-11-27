import { readSummaryList } from './summary-list';
import { LibraryStore } from './repository';
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

export class RiskStore extends LibraryStore {
  constructor(factory?: () => IDBFactory, name?: string) {
    super('risk', factory, name);
  }
  async save(record: RiskStudy) {
    assertRiskStudy(record);
    await this.repository.insert(record, summarizeRisk(record));
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
    const value = await this.repository.get(id);
    if (!value) throw new Error('风险报告不存在，可能已删除。');
    return value;
  }
}
