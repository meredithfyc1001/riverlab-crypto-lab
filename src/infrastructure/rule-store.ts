import { verifyRuleRecord } from '../core/rule-library';
import type { RuleRecord } from '../core/rule-library';
import type { SummaryList } from './summary-list';
import { LocalDatabase } from './local-database';

/** Isolated schema; immutable family@revision keys, no upgrade of historical databases. */
export class RuleStore extends LocalDatabase {
  constructor(
    factory: () => IDBFactory = () => indexedDB,
    name = 'riverlab-crypto-lab-rules',
  ) {
    super(factory, name, ['versions']);
  }
  async listAvailable() {
    // Stream versions individually: a malformed extra record must not hide
    // the 100 healthy versions that fit this library. A 101st verified
    // version still exceeds the original read budget.
    const result = await this.transaction<SummaryList<RuleRecord>>(
      'readonly',
      (tx, done) => {
        const cursor = tx.objectStore('versions').openCursor();
        const list: SummaryList<RuleRecord> = { items: [], damagedCount: 0 };
        cursor.onsuccess = () => {
          const row = cursor.result;
          if (row) {
            try {
              list.items.push(verifyRuleRecord(row.value));
            } catch {
              list.damagedCount++;
            }
            if (list.items.length <= 100) {
              row.continue();
              return;
            }
          }
          done(list);
        };
      },
    );
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
    let failure: unknown;
    try {
      await this.transaction<void>('readwrite', (tx, done) => {
        const store = tx.objectStore('versions');
        const count = store.count();
        count.onsuccess = () => {
          try {
            if (count.result >= 100)
              throw new Error(
                '策略库最多100版本，请先导出并删除不需要的版本。',
              );
            store.add(record);
            done(undefined);
          } catch (error) {
            failure = error;
            tx.abort();
          }
        };
      });
    } catch (error) {
      throw failure ?? error;
    }
  }

  async delete(id: string): Promise<void> {
    await this.transaction<void>('readwrite', (tx, done) => {
      tx.objectStore('versions').delete(id);
      done(undefined);
    });
  }
}
