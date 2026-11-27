import { desktopRepository, isDesktopRepository } from './desktop-repository';
import { LocalDatabase } from './local-database';

import { layouts } from './database-layouts';
import type { RepositoryKind } from './desktop-repository';

interface Identified {
  id: string;
}

// Domain stores own validation and summaries. Backends own transactions,
// identity conflicts, and the ordering of a committed read snapshot.
export interface Repository {
  insert(record: Identified, summary: Identified): Promise<void>;
  get(id: string): Promise<unknown>;
  visitSummaries(visit: (row: unknown) => boolean): Promise<void>;
  remove(id: string): Promise<void>;
}

class IndexedDbRepository implements Repository {
  constructor(
    private readonly db: LocalDatabase,
    private readonly kind: RepositoryKind,
    private readonly bodyStore: string,
  ) {}

  async insert(record: Identified, summary: Identified) {
    let failure: unknown;
    try {
      await this.db.transaction<void>('readwrite', (tx) => {
        const bodies = tx.objectStore(this.bodyStore);
        const abort = (error: unknown) => {
          failure = error;
          tx.abort();
        };
        if (this.kind === 'rule') {
          const count = bodies.count();
          count.onsuccess = () => {
            try {
              if (count.result >= 100)
                throw new Error(
                  '策略库最多100版本，请先导出并删除不需要的版本。',
                );
              bodies.add(record);
            } catch (error) {
              abort(error);
            }
          };
          return;
        }
        const summaries = tx.objectStore('summaries');
        if (this.kind !== 'dataset') {
          bodies.add(record);
          summaries.add(summary);
          return;
        }
        // An unchanged dataset may be saved twice. Conflicting bodies and
        // orphan summaries are both left intact, including concurrent saves.
        const body = bodies.get(record.id);
        const metadata = summaries.get(record.id);
        metadata.onsuccess = () => {
          try {
            if (body.result === undefined && metadata.result === undefined) {
              bodies.put(record);
              summaries.put(summary);
            } else if (
              JSON.stringify(body.result) !== JSON.stringify(record) ||
              JSON.stringify(metadata.result) !== JSON.stringify(summary)
            ) {
              throw new Error('相同 ID 的数据集或摘要内容冲突，已拒绝覆盖。');
            }
          } catch (error) {
            abort(error);
          }
        };
      });
    } catch (error) {
      throw failure ?? error;
    }
  }

  get(id: string) {
    return this.db.transaction<unknown>('readonly', (tx, done) => {
      const request = tx.objectStore(this.bodyStore).get(id);
      request.onsuccess = () => done(request.result);
    });
  }

  async visitSummaries(visit: (row: unknown) => boolean) {
    if (this.kind === 'rule') {
      // Stop after the 101st valid version. A corrupt extra row must not hide
      // healthy versions or force the whole legacy database into memory.
      return this.db.transaction<void>('readonly', (tx) => {
        const cursor = tx.objectStore(this.bodyStore).openCursor();
        cursor.onsuccess = () => {
          const row = cursor.result;
          if (row && visit(row.value)) row.continue();
        };
      });
    }
    const rows = await this.db.transaction<unknown[]>(
      'readonly',
      (tx, done) => {
        const request = tx.objectStore('summaries').getAll();
        request.onsuccess = () => done(request.result);
      },
    );
    rows.every(visit);
  }

  remove(id: string) {
    return this.db.transaction<void>('readwrite', (tx) => {
      tx.objectStore(this.bodyStore).delete(id);
      if (this.kind !== 'rule') tx.objectStore('summaries').delete(id);
    });
  }
}

export class LibraryStore extends LocalDatabase {
  readonly repository: Repository;

  constructor(kind: RepositoryKind, factory?: () => IDBFactory, name?: string) {
    const [defaultName, bodyStore] = layouts[kind];
    const desktop = !factory && isDesktopRepository();
    super(
      factory ??
        (() => {
          if (desktop) throw new Error('桌面数据库不支持 IndexedDB 事务。');
          return indexedDB;
        }),
      name ?? defaultName,
      kind === 'rule' ? [bodyStore] : [bodyStore, 'summaries'],
    );
    this.repository = desktop
      ? {
          insert: (record, summary) =>
            desktopRepository.save(kind, record.id, record, summary),
          get: (id) => desktopRepository.get(kind, id),
          visitSummaries: async (visit) => {
            const rows = await desktopRepository.list(kind);
            rows.every(visit);
          },
          remove: (id) => desktopRepository.remove(kind, id),
        }
      : new IndexedDbRepository(this, kind, bodyStore);
  }

  delete(id: string) {
    return this.repository.remove(id);
  }
}
