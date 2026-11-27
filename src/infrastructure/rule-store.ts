import { verifyRuleRecord } from '../core/rule-library';
import type { RuleRecord } from '../core/rule-library';
import type { SummaryList } from './summary-list';
import { LibraryStore } from './repository';

/** Isolated schema; immutable family@revision keys, no upgrade of historical databases. */
export class RuleStore extends LibraryStore {
  constructor(factory?: () => IDBFactory, name?: string) {
    super('rule', factory, name);
  }
  async listAvailable() {
    const result: SummaryList<RuleRecord> = { items: [], damagedCount: 0 };
    await this.repository.visitSummaries((row) => {
      try {
        result.items.push(verifyRuleRecord(row));
      } catch {
        result.damagedCount++;
      }
      return result.items.length <= 100;
    });
    if (result.items.length > 100)
      throw new Error('策略库超过100版本预算，未打开。');
    result.items.sort(
      (a, b) =>
        b.createdUtcMs - a.createdUtcMs ||
        b.rule.revision - a.rule.revision ||
        a.id.localeCompare(b.id),
    );
    return result;
  }
  async list(): Promise<RuleRecord[]> {
    const { items, damagedCount } = await this.listAvailable();
    if (damagedCount) throw new Error('策略版本校验失败，未修复。');
    return items;
  }
  async save(value: RuleRecord): Promise<void> {
    const record = verifyRuleRecord(value);
    await this.repository.insert(record, record);
  }
}
