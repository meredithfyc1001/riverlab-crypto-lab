export const SNAPSHOT_FENCE = 'riverlab-crypto-lab:snapshot-v1';

export class LocalDatabase {
  constructor(
    private readonly factory: () => IDBFactory = () => indexedDB,
    private readonly name = 'riverlab-crypto-lab',
    private readonly stores: string[] = ['datasets', 'summaries'],
  ) {}
  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = this.factory().open(this.name, 1);
      let finished = false;
      const timer = setTimeout(() => {
        finished = true;
        reject(new Error('打开存储超时，请关闭其他标签页后重试'));
      }, 5000);
      request.onupgradeneeded = () => {
        if (finished) {
          request.transaction?.abort();
          return;
        }
        clearTimeout(timer);
        const db = request.result;
        for (const name of this.stores)
          db.createObjectStore(name, { keyPath: 'id' });
      };
      request.onblocked = () => {
        finished = true;
        clearTimeout(timer);
        reject(new Error('存储升级被其他标签页阻塞'));
      };
      request.onerror = () => {
        clearTimeout(timer);
        reject(request.error);
      };
      request.onsuccess = () => {
        clearTimeout(timer);
        if (finished) {
          request.result.close();
          return;
        }
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
    });
  }
  async transaction<T>(
    mode: IDBTransactionMode,
    run: (tx: IDBTransaction, result: (v: T) => void) => void,
  ): Promise<T> {
    // Even an application read opens lazily and may create a database.
    // Windows and Workers that support Web Locks coordinate from before open.
    // Older clients retain normal IDB access. A snapshot can certify them
    // only with overlapping whole-database readonly transactions.
    let entered = false;
    try {
      const locks = globalThis.navigator?.locks;
      if (locks)
        return await locks.request(SNAPSHOT_FENCE, { mode: 'shared' }, () => {
          entered = true;
          return this.runTransaction(mode, run);
        });
    } catch (error) {
      // A blocked LockManager can exist even when IDB works. Never retry a
      // failed IDB operation after the callback has run.
      if (
        entered ||
        !(error instanceof DOMException) ||
        !['SecurityError', 'NotSupportedError'].includes(error.name)
      )
        throw error;
    }
    return this.runTransaction(mode, run);
  }

  private async runTransaction<T>(
    mode: IDBTransactionMode,
    run: (tx: IDBTransaction, result: (v: T) => void) => void,
  ): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      let value: T;
      let tx: IDBTransaction | undefined;
      let failure: { error: unknown } | undefined;
      try {
        tx = db.transaction(this.stores, mode);
        tx.oncomplete = () => {
          db.close();
          if (failure) reject(failure.error);
          else resolve(value);
        };
        tx.onabort = () => {
          db.close();
          reject(failure?.error ?? tx!.error ?? new Error('事务被中止'));
        };
        tx.onerror = () => {
          /* abort settles the promise; never report request success as commit */
        };
        run(tx, (next) => {
          value = next;
        });
      } catch (error) {
        if (tx) {
          failure = { error };
          try {
            tx.abort();
          } catch {
            // A commit or abort is already in flight. Its terminal event releases the lock.
          }
        } else {
          db.close();
          reject(error);
        }
      }
    });
  }
}
