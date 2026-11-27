import { layouts } from './database-layouts';
import type { RepositoryKind } from './desktop-repository';
import { SNAPSHOT_FENCE } from './local-database';

interface StoreLayout {
  name: string;
  keyPath: 'id';
  autoIncrement: false;
  indexes: [];
  count: number;
}
interface DatabaseLayout {
  name: string;
  kind: RepositoryKind;
  version: number;
  stores: StoreLayout[];
  firstRead: number;
  postBarrierRead: number;
}
export interface SnapshotLayout {
  scope: 'all-databases';
  origin: string;
  startedUtcMs: number;
  barrierUtcMs: number;
  barrierSequence: number;
  fenceName: string;
  fenceVersion: 1;
  fenceId: string;
  missingDatabases: string[];
  databases: DatabaseLayout[];
}
export interface SnapshotSourceReport extends SnapshotLayout {
  finishedUtcMs: number;
  databases: (DatabaseLayout & { completed: number })[];
}
export interface SnapshotRow {
  kind: RepositoryKind;
  database: string;
  version: number;
  store: string;
  primaryKey: string;
  id: string;
  value: unknown;
}
export interface SnapshotView {
  getCapturedDataset(id: string): Promise<unknown>;
}
interface Options {
  signal: AbortSignal;
  onLayout?: (layout: SnapshotLayout) => Promise<void> | void;
  onRow: (row: SnapshotRow, view: SnapshotView) => Promise<void> | void;
  onProgress?: (progress: {
    database: string;
    store: string;
    read: number;
    total: number;
  }) => void;
  /** Tests supply an isolated factory. Production reads the current storage key. */
  factory?: IDBFactory;
  timeoutMs?: number;
}
export class SnapshotSourceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly missingDatabases: string[] = [],
  ) {
    super(message);
    this.name = 'SnapshotSourceError';
  }
}

const kinds = Object.keys(layouts) as RepositoryKind[];

// IDB open requests cannot be cancelled. An open completing after cancellation
// closes immediately; an upgrade event always aborts (including a delete race).
function openExisting(
  factory: IDBFactory,
  name: string,
  controller: AbortController,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name);
    let openingFailure: SnapshotSourceError | undefined;
    request.onupgradeneeded = () => {
      openingFailure = new SnapshotSourceError(
        'creation-race',
        `只读打开时发现源库已删除或需要升级：${name}`,
      );
      request.transaction!.abort();
      // Wait for the terminal error. The provisional empty catalog entry is
      // rolled back before this open is reported as a failed snapshot.
    };
    request.onblocked = () =>
      reject(new SnapshotSourceError('blocked', `只读打开被阻塞：${name}`));
    request.onerror = () =>
      reject(
        openingFailure ??
          new SnapshotSourceError(
            'open',
            `无法打开源库 ${name}：${request.error?.message}`,
          ),
      );
    request.onsuccess = () => {
      const db = request.result;
      if (controller.signal.aborted) {
        db.close();
        return;
      }
      db.onversionchange = () => {
        controller.abort(
          new SnapshotSourceError(
            'versionchange',
            `快照期间收到升级或删除请求：${name}`,
          ),
        );
        db.close();
      };
      db.onclose = () =>
        controller.abort(
          new SnapshotSourceError('closed', `快照连接异常关闭：${name}`),
        );
      resolve(db);
    };
  });
}

function checkedRow(
  kind: RepositoryKind,
  name: string,
  store: string,
  key: IDBValidKey,
  value: unknown,
): SnapshotRow {
  if (
    typeof key !== 'string' ||
    !value ||
    typeof value !== 'object' ||
    !Object.hasOwn(value, 'id') ||
    !('id' in value) ||
    value.id !== key ||
    !key.length
  )
    throw new SnapshotSourceError(
      'key',
      `源记录的实际主键与正文 ID 无效或不匹配：${name}/${store}，主键 ${String(key)}。`,
    );
  return {
    kind,
    database: name,
    version: 1,
    store,
    primaryKey: key,
    id: key,
    value,
  };
}

interface Cut {
  sequence: number;
  barrierSequence: number;
  barrierUtcMs: number;
  ready(): void;
}

// One outstanding count(key) keeps this database's original transaction alive.
// Cursor advances and auxiliary reads are issued inside its active request event,
// including after awaiting asynchronous, backpressured archive writes.
class PinnedDatabase {
  readonly layout: DatabaseLayout;
  private readonly tx: IDBTransaction;
  private readonly pulseStore: IDBObjectStore;
  private tasks: (() => void)[] = [];
  releasing = false;
  completed = 0;
  readonly finished: Promise<void>;

  constructor(
    db: IDBDatabase,
    kind: RepositoryKind,
    private cut: Cut,
    private controller: AbortController,
  ) {
    const [name, body] = layouts[kind];
    const names = kind === 'rule' ? [body] : [body, 'summaries'];
    if (
      db.version !== 1 ||
      db.objectStoreNames.length !== names.length ||
      names.some((n) => !db.objectStoreNames.contains(n))
    )
      throw new SnapshotSourceError(
        'schema',
        `源库布局不支持：${name} v${db.version} [${Array.from(db.objectStoreNames)}]。`,
      );
    this.tx = db.transaction(names, 'readonly');
    this.finished = new Promise<void>((resolve) => {
      this.tx.onabort = () => {
        controller.abort(
          new SnapshotSourceError(
            'transaction-abort',
            `源库只读事务已中止：${name}。`,
          ),
        );
        resolve();
      };
      this.tx.oncomplete = () => {
        if (!this.releasing)
          controller.abort(
            new SnapshotSourceError(
              'early-complete',
              `源库事务提前结束：${name}。`,
            ),
          );
        this.completed = ++cut.sequence;
        resolve();
      };
      this.tx.onerror = () =>
        controller.abort(
          new SnapshotSourceError('read', `源库读取失败：${name}。`),
        );
    });
    const stores = names.map((n): StoreLayout => {
      const store = this.tx.objectStore(n);
      if (
        store.keyPath !== 'id' ||
        store.autoIncrement ||
        store.indexNames.length
      ) {
        const indexes = Array.from(store.indexNames, (indexName) => {
          const index = store.index(indexName);
          return {
            name: index.name,
            keyPath: index.keyPath,
            unique: index.unique,
            multiEntry: index.multiEntry,
          };
        });
        controller.abort(
          new SnapshotSourceError(
            'schema',
            `源库索引或主键布局不支持：${name}/${n}，keyPath=${JSON.stringify(store.keyPath)}，autoIncrement=${store.autoIncrement}，indexes=${JSON.stringify(indexes)}。`,
          ),
        );
      }
      return {
        name: n,
        keyPath: 'id',
        autoIncrement: false,
        indexes: [],
        count: 0,
      };
    });
    this.layout = {
      name,
      kind,
      version: 1,
      stores,
      firstRead: 0,
      postBarrierRead: 0,
    };
    this.pulseStore = this.tx.objectStore(body);
    this.pulse();
  }

  private pulse() {
    if (this.releasing || this.controller.signal.aborted) return;
    const afterCut = this.cut.barrierSequence > 0;
    // Key 0 is outside the product's string key space. No source value is cloned.
    const request = this.pulseStore.count(0);
    request.onsuccess = () => {
      if (this.controller.signal.aborted) return;
      try {
        if (!this.layout.firstRead) this.layout.firstRead = ++this.cut.sequence;
        if (afterCut && !this.layout.postBarrierRead)
          this.layout.postBarrierRead = ++this.cut.sequence;
        // Requeue BEFORE checking whether all first reads have executed. At the
        // barrier every live transaction has a pending request registered.
        this.pulse();
        this.cut.ready();
        for (const task of this.tasks.splice(0)) task();
      } catch (error) {
        this.controller.abort(error);
      }
    };
  }

  abort() {
    try {
      this.tx.abort();
    } catch {
      /* already terminal */
    }
  }

  request<T>(issue: (tx: IDBTransaction) => IDBRequest<T>): Promise<T> {
    return new Promise((resolve) =>
      this.tasks.push(() => {
        const request = issue(this.tx);
        request.onsuccess = () => resolve(request.result);
      }),
    );
  }

  async scan(store: StoreLayout, options: Options, view: SnapshotView) {
    const { name, kind } = this.layout;
    return new Promise<void>((resolve) =>
      this.tasks.push(() => {
        let read = 0;
        const cursorRequest = this.tx.objectStore(store.name).openCursor();
        cursorRequest.onsuccess = () => {
          if (this.controller.signal.aborted) return;
          try {
            const cursor = cursorRequest.result;
            if (!cursor) {
              if (read !== store.count)
                throw new SnapshotSourceError(
                  'count',
                  `实际枚举数量与快照计数不符：${name}/${store.name}。`,
                );
              resolve();
              return;
            }
            const row = checkedRow(
              kind,
              name,
              store.name,
              cursor.primaryKey,
              cursor.value,
            );
            Promise.resolve(options.onRow(row, view))
              .then(() => {
                if (this.controller.signal.aborted) return;
                read++;
                options.onProgress?.({
                  database: name,
                  store: store.name,
                  read,
                  total: store.count,
                });
                this.tasks.push(() => cursor.continue());
              })
              .catch((error) => this.controller.abort(error));
          } catch (error) {
            this.controller.abort(error);
          }
        };
      }),
    );
  }
}

async function scan(
  options: Options,
  controller: AbortController,
  startedUtcMs: number,
): Promise<SnapshotSourceReport> {
  const { signal } = controller;
  signal.throwIfAborted();
  const failed = new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), {
      once: true,
    });
  });
  const dbs: IDBDatabase[] = [];
  const pinned: PinnedDatabase[] = [];
  const run = async (): Promise<SnapshotSourceReport> => {
    const factory = options.factory ?? indexedDB;
    if (!factory.databases)
      throw new SnapshotSourceError(
        'catalog',
        '当前浏览器无法只读枚举 IndexedDB 目录。',
      );
    const entries = await factory.databases();
    signal.throwIfAborted();
    const known = new Set<string>(kinds.map((kind) => layouts[kind][0]));
    const unknown = entries.find(
      (e) => e.name?.startsWith('riverlab-crypto-lab-') && !known.has(e.name),
    );
    if (unknown)
      throw new SnapshotSourceError(
        'schema',
        `存在未知产品库：${unknown.name} v${unknown.version}。`,
      );
    const catalog = new Map(entries.map((e) => [e.name, e.version]));
    const missing = Array.from(known).filter((name) => !catalog.has(name));
    if (missing.length)
      throw new SnapshotSourceError(
        'missing-databases',
        `目录中未见以下库，无法证明全库切面：${missing.join('、')}。`,
        missing,
      );
    for (const name of known) {
      if (catalog.get(name) !== 1)
        throw new SnapshotSourceError(
          'schema',
          `源库版本不支持：${name} v${catalog.get(name)}。`,
        );
      const db = await openExisting(factory, name, controller);
      if (signal.aborted) {
        db.close();
        signal.throwIfAborted();
      }
      dbs.push(db);
    }

    let releaseCut!: () => void;
    const reachedCut = new Promise<void>((resolve) => {
      releaseCut = resolve;
    });
    const cut: Cut = {
      sequence: 0,
      barrierSequence: 0,
      barrierUtcMs: 0,
      ready() {
        if (pinned.length !== kinds.length) return;
        if (!cut.barrierSequence && pinned.every((p) => p.layout.firstRead)) {
          cut.barrierSequence = ++cut.sequence;
          cut.barrierUtcMs = Date.now();
        }
        if (pinned.every((p) => p.layout.postBarrierRead)) releaseCut();
      },
    };
    for (const [i, kind] of kinds.entries()) {
      pinned.push(new PinnedDatabase(dbs[i], kind, cut, controller));
      signal.throwIfAborted();
    }
    await reachedCut;
    for (const pin of pinned) {
      for (const store of pin.layout.stores)
        store.count = await pin.request((tx) =>
          tx.objectStore(store.name).count(),
        );
    }
    const layout: SnapshotLayout = {
      scope: 'all-databases',
      origin: globalThis.location.origin,
      startedUtcMs,
      barrierUtcMs: cut.barrierUtcMs,
      barrierSequence: cut.barrierSequence,
      fenceName: SNAPSHOT_FENCE,
      fenceVersion: 1,
      fenceId: crypto.randomUUID(),
      missingDatabases: [],
      databases: pinned.map((p) => structuredClone(p.layout)),
    };
    await options.onLayout?.(structuredClone(layout));
    signal.throwIfAborted();
    const [dataset] = pinned;
    const view: SnapshotView = {
      async getCapturedDataset(id) {
        signal.throwIfAborted();
        if (dataset.releasing)
          throw new SnapshotSourceError('closed', '数据集快照已结束。');
        const store = layouts.dataset[1];
        const raw = await Promise.race([
          failed,
          dataset.request((tx) => tx.objectStore(store).get(id)),
        ]);
        return checkedRow('dataset', dataset.layout.name, store, id, raw).value;
      },
    };
    for (const pin of pinned) {
      for (const store of pin.layout.stores)
        await pin.scan(store, options, view);
    }
    for (const pin of pinned) pin.releasing = true;
    await Promise.all(pinned.map((p) => p.finished));
    signal.throwIfAborted();
    return {
      ...layout,
      finishedUtcMs: Date.now(),
      databases: pinned.map((p) => ({ ...p.layout, completed: p.completed })),
    };
  };
  try {
    return await Promise.race([failed, run()]);
  } catch (error) {
    controller.abort(error);
    for (const pin of pinned) pin.abort();
    await Promise.all(pinned.map((p) => p.finished));
    throw error;
  } finally {
    for (const db of dbs) db.close();
  }
}

export async function readSnapshotSource(
  options: Options,
): Promise<SnapshotSourceReport> {
  options.signal.throwIfAborted();
  if (!globalThis.navigator?.locks)
    throw new SnapshotSourceError('fence', '当前环境无法取得浏览器写入栅栏。');
  const controller = new AbortController();
  const onCancel = () => controller.abort(options.signal.reason);
  options.signal.addEventListener('abort', onCancel, { once: true });
  const started = Date.now();
  // Long archives stay bounded even when an output sink or an old writer stalls.
  const timer = setTimeout(
    () =>
      controller.abort(
        new SnapshotSourceError('timeout', '全库只读快照超时，已停止。'),
      ),
    options.timeoutMs ?? 30 * 60 * 1000,
  );
  try {
    return await navigator.locks.request(
      SNAPSHOT_FENCE,
      { mode: 'exclusive', signal: controller.signal },
      () => scan(options, controller, started),
    );
  } finally {
    options.signal.removeEventListener('abort', onCancel);
    clearTimeout(timer);
  }
}
