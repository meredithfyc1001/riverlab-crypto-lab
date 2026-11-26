import { LocalDatabase } from './local-database';
import { readSummaryList } from './summary-list';
import {
  assertDataset,
  assertDatasetSummary,
  summarizeDataset,
} from '../core/data/dataset';
import type { Dataset, DatasetSummary } from '../core/data/dataset';

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
export class DatasetStore extends LocalDatabase {
  async save(dataset: Dataset): Promise<void> {
    assertDataset(dataset);
    const summary = summarizeDataset(dataset);
    let failure: unknown;
    try {
      await this.transaction<void>('readwrite', (tx, done) => {
        const bodies = tx.objectStore(STORE),
          summaries = tx.objectStore('summaries');
        const body = bodies.get(dataset.id),
          metadata = summaries.get(dataset.id);
        // Both reads and writes share one transaction. Saving an identical current
        // dataset is idempotent, including across tabs; conflicting rows stay intact.
        metadata.onsuccess = () => {
          try {
            if (body.result === undefined && metadata.result === undefined) {
              bodies.put(dataset);
              summaries.put(summary);
            } else if (
              JSON.stringify(body.result) !== JSON.stringify(dataset) ||
              JSON.stringify(metadata.result) !== JSON.stringify(summary)
            ) {
              throw new Error('相同 ID 的数据集或摘要内容冲突，已拒绝覆盖。');
            }
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
  listAvailable() {
    return readSummaryList<DatasetSummary>(this, assertDatasetSummary);
  }
  async list(): Promise<DatasetSummary[]> {
    const { items, damagedCount } = await this.listAvailable();
    if (damagedCount)
      throw new Error('本地数据集摘要损坏或版本不支持，请使用备份恢复。');
    return items;
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
