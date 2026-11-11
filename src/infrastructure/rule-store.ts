import { verifyRuleRecord } from '../core/rule-library';
import type { RuleRecord } from '../core/rule-library';
import { LocalDatabase } from './local-database';

/** Isolated schema; immutable family@revision keys, no upgrade of historical databases. */
export class RuleStore extends LocalDatabase {
  constructor(
    factory: () => IDBFactory = () => indexedDB,
    name = 'riverlab-crypto-lab-rules',
  ) {
    super(factory, name, ['versions']);
  }
  async list(): Promise<RuleRecord[]> {
    const list = await this.transaction<unknown[]>('readonly', (tx, done) => {
      const request = tx.objectStore('versions').getAll();
      request.onsuccess = () => done(request.result);
    });
    if (list.length > 100) throw new Error('策略库超过100版本预算，未打开。');
    return list
      .map(verifyRuleRecord)
      .sort(
        (a, b) =>
          b.createdUtcMs - a.createdUtcMs ||
          b.rule.revision - a.rule.revision ||
          a.id.localeCompare(b.id),
      );
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
