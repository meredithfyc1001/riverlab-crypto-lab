// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import {
  BLOB_LIMIT,
  exportSnapshot,
} from '../../src/features/snapshot/export-client';
import type {
  FromWorker,
  ToWorker,
} from '../../src/features/snapshot/messages';

afterEach(() => vi.unstubAllGlobals());

const bytes = new TextEncoder().encode('人工测试归档');
const hash = createHash('sha256').update(bytes).digest('hex');

function fakeWorker(chunk = bytes, repeats = 1) {
  const terminate = vi.fn();
  vi.stubGlobal('window', { location: new URL('http://127.0.0.1') });
  vi.stubGlobal(
    'Worker',
    class {
      onmessage?: (event: { data: FromWorker }) => void;
      terminate = terminate;
      sent = 0;
      postMessage(message: ToWorker) {
        if (message.type === 'start' || this.sent < repeats) {
          this.sent++;
          queueMicrotask(() =>
            this.onmessage?.({ data: { type: 'chunk', bytes: chunk } }),
          );
        } else {
          queueMicrotask(() =>
            this.onmessage?.({
              data: {
                type: 'complete',
                receipt: {
                  bytes: chunk.length * repeats,
                  rows: 0,
                  fileSha256: hash,
                  snapshotContentId: hash,
                },
                report: {} as never,
              },
            }),
          );
        }
      }
    },
  );
  return terminate;
}
function fileTarget(content: Uint8Array<ArrayBuffer> = bytes) {
  const stream = {
    write: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    abort: vi.fn(() => Promise.resolve()),
  };
  const handle = {
    name: '合成 数据.riverlab-migration',
    createWritable: vi.fn(async () => stream),
    getFile: vi.fn(async () => new Blob([content])),
  };
  return { stream, handle, target: handle as unknown as FileSystemFileHandle };
}

it('receipts require the hash of the closed file to equal the encoder receipt', async () => {
  fakeWorker();
  const { stream, handle, target } = fileTarget();
  const result = await exportSnapshot(
    target,
    new AbortController().signal,
    () => {},
  );
  expect(result.download).toBeNull();
  expect(result.receipt.fileSha256).toBe(hash);
  expect(stream.close).toHaveBeenCalledBefore(handle.getFile);
  const stale = fileTarget(new Uint8Array(bytes.length));
  await expect(
    exportSnapshot(stale.target, new AbortController().signal, () => {}),
  ).rejects.toThrow('文件已写出，回读校验未完成');
});

it('a write failure aborts the chosen stream without requesting a file receipt', async () => {
  fakeWorker();
  const { stream, handle, target } = fileTarget();
  stream.write.mockRejectedValueOnce(new Error('磁盘写入失败'));
  await expect(
    exportSnapshot(target, new AbortController().signal, () => {}),
  ).rejects.toThrow('磁盘写入失败');
  expect(stream.abort).toHaveBeenCalledOnce();
  expect(stream.close).not.toHaveBeenCalled();
  expect(handle.getFile).not.toHaveBeenCalled();
});

it('cancel during a write terminates the worker and aborts the destination', async () => {
  const terminate = fakeWorker();
  const { stream, handle, target } = fileTarget();
  const controller = new AbortController();
  stream.write.mockImplementationOnce(async () => {
    controller.abort();
  });
  await expect(
    exportSnapshot(target, controller.signal, () => {}),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(terminate).toHaveBeenCalled();
  expect(stream.abort).toHaveBeenCalledOnce();
  expect(handle.getFile).not.toHaveBeenCalled();
});

it('bounds a download-only export before allocating the final Blob', async () => {
  const chunk = new Uint8Array(1024 * 1024);
  fakeWorker(chunk, BLOB_LIMIT / chunk.length + 1);
  await expect(
    exportSnapshot(null, new AbortController().signal, () => {}),
  ).rejects.toThrow('64 MiB');
});
