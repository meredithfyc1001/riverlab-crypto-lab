import { assertDataset, summarizeDataset } from '../core/data/dataset';
import type { Dataset, DatasetSummary } from '../core/data/dataset';

const DB_NAME = 'riverlab-crypto-lab';
const STORE = 'datasets';
export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
export function storageMessage(error: unknown): string {
  const name =
    error instanceof Error || error instanceof DOMException ? error.name : '';
  const reason =
    name === 'QuotaExceededError'
      ? '空间不足'
      : name === 'SecurityError' || name === 'NotAllowedError'
        ? '浏览器拒绝存储（可能为隐私模式或策略限制）'
        : error instanceof Error
          ? error.message
          : '未知存储错误';
  return `本地存储操作失败：${reason}。未确认成功；可导出备份并检查浏览器权限/空间。`;
}
export class DatasetStore {
  constructor(
    private readonly factory: () => IDBFactory = () => indexedDB,
    private readonly name = DB_NAME,
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
        const db = request.result;
        db.createObjectStore(STORE, { keyPath: 'id' });
        db.createObjectStore('summaries', { keyPath: 'id' });
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
  private async transaction<T>(
    mode: IDBTransactionMode,
    run: (tx: IDBTransaction, result: (v: T) => void) => void,
  ): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      let value: T;
      let tx: IDBTransaction | undefined;
      try {
        tx = db.transaction([STORE, 'summaries'], mode);
        tx.oncomplete = () => {
          db.close();
          resolve(value);
        };
        tx.onabort = () => {
          db.close();
          reject(tx!.error ?? new Error('事务被中止'));
        };
        tx.onerror = () => {
          /* abort settles the promise; never report request success as commit */
        };
        run(tx, (next) => {
          value = next;
        });
      } catch (error) {
        try {
          tx?.abort();
        } catch {
          /* transaction may already have aborted */
        }
        db.close();
        reject(error);
      }
    });
  }
  async save(dataset: Dataset): Promise<void> {
    assertDataset(dataset);
    await this.transaction<void>('readwrite', (tx, done) => {
      // Atomic data + metadata. Abort cannot leave a phantom list entry.
      tx.objectStore(STORE).put(dataset);
      tx.objectStore('summaries').put(summarizeDataset(dataset));
      done(undefined);
    });
  }
  async list(): Promise<DatasetSummary[]> {
    const list = await this.transaction<DatasetSummary[]>(
      'readonly',
      (tx, done) => {
        const request = tx.objectStore('summaries').getAll();
        request.onsuccess = () => done(request.result as DatasetSummary[]);
      },
    );
    for (const summary of list) {
      const q = summary?.quality;
      if (
        !summary ||
        summary.schemaVersion !== 1 ||
        typeof summary.id !== 'string' ||
        !summary.id ||
        typeof summary.name !== 'string' ||
        typeof summary.symbol !== 'string' ||
        !summary.source ||
        typeof summary.source.label !== 'string' ||
        !q ||
        !Number.isSafeInteger(q.validRows) ||
        q.validRows < 1 ||
        q.validRows > 50_000 ||
        !Number.isSafeInteger(q.intervalMs) ||
        !q.intervalMs ||
        q.intervalMs < 0 ||
        !Number.isSafeInteger(q.warningCount) ||
        q.warningCount < 0 ||
        !Number.isSafeInteger(q.missingCandles) ||
        q.missingCandles < 0 ||
        !['ms', 'us', 'iso'].includes(q.timeUnit!)
      )
        throw new Error(
          '本地数据集摘要损坏或版本不支持；未打开或自动修复，请使用备份恢复。',
        );
    }
    return list;
  }
  async load(id: string): Promise<Dataset> {
    const dataset = await this.transaction<unknown>('readonly', (tx, done) => {
      const request = tx.objectStore(STORE).get(id);
      request.onsuccess = () => done(request.result);
    });
    if (!dataset) throw new Error('找不到数据集，可能已被另一标签页删除。');
    assertDataset(dataset);
    return dataset;
  }
  async delete(id: string): Promise<void> {
    await this.transaction<void>('readwrite', (tx, done) => {
      tx.objectStore(STORE).delete(id);
      tx.objectStore('summaries').delete(id);
      done(undefined);
    });
  }
}
async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
}
export async function encodeBackup(dataset: Dataset): Promise<string> {
  assertDataset(dataset);
  const payload = JSON.stringify(dataset);
  const text = JSON.stringify({
    format: 'riverlab-dataset',
    version: 1,
    payloadSha256: await sha256(payload),
    dataset,
  });
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES)
    throw new Error('备份超过 20 MiB，无法导出；请拆分原 CSV。');
  return text;
}
export async function decodeBackup(text: string): Promise<Dataset> {
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES)
    throw new Error('备份超过 20 MiB。');
  let backup;
  try {
    backup = JSON.parse(text);
  } catch {
    throw new Error('备份不是合法 JSON。');
  }
  if (!backup || backup.format !== 'riverlab-dataset' || backup.version !== 1)
    throw new Error('不支持的备份格式/版本。');
  if ((await sha256(JSON.stringify(backup.dataset))) !== backup.payloadSha256)
    throw new Error('备份校验和不符，文件可能损坏；未恢复。');
  assertDataset(backup.dataset);
  return backup.dataset;
}
