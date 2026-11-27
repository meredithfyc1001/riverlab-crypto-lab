import { isDesktopRepository } from '../../infrastructure/desktop-repository';
import { hashSnapshotFile } from '../../infrastructure/snapshot-format';
import type { ExportNotice, FromWorker, ToWorker } from './messages';

export const BLOB_LIMIT = 64 * 1024 * 1024;
export const defaultName = 'riverlab-research.riverlab-migration';
type PickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string;
  }) => Promise<FileSystemFileHandle>;
};
export function supportsFilePicker() {
  return typeof (window as PickerWindow).showSaveFilePicker === 'function';
}
export async function selectDestination() {
  const host = window as PickerWindow;
  // Browsers cap individual extension filters at 16 characters. The full
  // migration suffix is valid as a suggested filename.
  return host.showSaveFilePicker
    ? host.showSaveFilePicker({ suggestedName: defaultName })
    : null;
}
export class SnapshotExportError extends Error {
  constructor(
    message: string,
    readonly missingDatabases: string[] = [],
  ) {
    super(message);
  }
}
function runWorker(
  write: (bytes: Uint8Array<ArrayBuffer>) => Promise<void>,
  notice: (event: ExportNotice) => void,
  signal: AbortSignal,
): Promise<Extract<FromWorker, { type: 'complete' }>> {
  signal.throwIfAborted();
  const worker = new Worker(new URL('./snapshot.worker.ts', import.meta.url), {
    type: 'module',
  });
  return new Promise((resolve, reject) => {
    const stop = () => {
      signal.removeEventListener('abort', cancel);
      worker.onmessage = worker.onmessageerror = worker.onerror = null;
      worker.terminate();
    };
    const fail = (reason: unknown) => {
      stop();
      reject(reason);
    };
    const cancel = () => fail(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
    worker.onerror = (event) =>
      fail(new Error(event.message || '导出 Worker 运行失败。'));
    worker.onmessageerror = () => fail(new Error('导出 Worker 数据传输失败。'));
    worker.onmessage = async ({ data }: MessageEvent<FromWorker>) => {
      try {
        switch (data.type) {
          case 'layout':
          case 'progress':
            notice(data);
            break;
          case 'chunk':
            await write(data.bytes);
            signal.throwIfAborted();
            worker.postMessage({ type: 'ack' } satisfies ToWorker);
            break;
          case 'failed':
            fail(new SnapshotExportError(data.message, data.missingDatabases));
            break;
          case 'complete':
            stop();
            resolve(data);
            break;
        }
      } catch (error) {
        fail(error);
      }
    };
    try {
      worker.postMessage({ type: 'start' } satisfies ToWorker);
    } catch (error) {
      fail(error);
    }
  });
}

export async function exportSnapshot(
  handle: FileSystemFileHandle | null,
  signal: AbortSignal,
  notice: (event: ExportNotice | { type: 'verify' }) => void,
) {
  if (isDesktopRepository()) throw new Error('此导出入口仅支持浏览器研究库。');
  signal.throwIfAborted();
  const writable = handle ? await handle.createWritable() : null;
  let committed = false;
  let byteCount = 0;
  const parts: Uint8Array<ArrayBuffer>[] = [];
  try {
    const completed = await runWorker(
      async (chunk) => {
        signal.throwIfAborted();
        if (writable) {
          await writable.write(chunk);
        } else {
          if (byteCount + chunk.byteLength > BLOB_LIMIT)
            throw new Error(
              '本次快照超过 64 MiB 下载预算。请在当前配置和来源中启用浏览器的文件保存功能后重试。',
            );
          parts.push(chunk);
        }
        byteCount += chunk.byteLength;
      },
      notice,
      signal,
    );
    signal.throwIfAborted();
    notice({ type: 'verify' });
    if (byteCount !== completed.receipt.bytes)
      throw new Error('迁移包写入字节数与封装回执不一致。');
    let file: Blob;
    if (writable && handle) {
      await writable.close();
      committed = true;
      file = await handle.getFile();
    } else {
      file = new Blob(parts, { type: 'application/octet-stream' });
      parts.length = 0;
    }
    if (
      file.size !== byteCount ||
      (await hashSnapshotFile(file, signal)) !== completed.receipt.fileSha256
    )
      throw new Error('回读文件时长度或 SHA-256 不一致。');
    signal.throwIfAborted();
    return {
      receipt: completed.receipt,
      report: completed.report,
      fileName: handle?.name ?? defaultName,
      download: handle ? null : file,
    };
  } catch (error) {
    if (writable && !committed) await writable.abort().catch(() => undefined);
    if (committed)
      throw new Error(
        '文件已写出，回读校验未完成。' +
          (error instanceof Error ? error.message : ''),
        { cause: error },
      );
    throw error;
  }
}

export type ExportResult = Awaited<ReturnType<typeof exportSnapshot>>;
