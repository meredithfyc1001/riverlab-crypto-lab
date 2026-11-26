import type { Experiment, WorkbenchInput } from '../core/experiments';
import { desktopRepository } from './desktop-repository';
import { openWorkerSource } from './worker-source';
export type WorkerRequest =
  | {
      kind: 'run';
      input: WorkbenchInput;
      id: string;
      name: string;
      createdUtcMs: number;
    }
  | { kind: 'open'; id: string }
  | { kind: 'save'; record: Experiment }
  | { kind: 'verify'; record: unknown }
  | { kind: 'import'; file: Blob }
  | { kind: 'export'; record: Experiment; format: 'json' | 'csv' };
export type WorkerResponse =
  | { ok: true; record: Experiment }
  | { ok: true; file: Blob }
  | { ok: true; write: { bytes: Uint8Array<ArrayBuffer>; summary: string } }
  | { ok: false; message: string };
type Result =
  | Exclude<WorkerResponse, { ok: false } | { write: unknown }>
  | { ok: true; saved: true };
export function workerTask(request: WorkerRequest) {
  const worker = new Worker(new URL('./backtest.worker.ts', import.meta.url), {
    type: 'module',
  });
  const source =
    request.kind === 'open' ? openWorkerSource('experiment') : undefined;
  const controller = new AbortController();
  let writing = false;
  let active = true;
  let rejectTask: (error: Error) => void = () => {};
  const close = () => {
    active = false;
    worker.onerror = worker.onmessage = worker.onmessageerror = null;
    worker.terminate();
    source?.close();
  };
  const promise = new Promise<Result>((resolve, reject) => {
    rejectTask = reject;
    worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      if (!active || writing) return;
      close();
      if (!data?.ok)
        return reject(
          new Error(data?.message || '无法读取Worker结果，未生成结果。'),
        );
      if ('write' in data) {
        if (request.kind !== 'save')
          return reject(new Error('回测 Worker 保存回执不匹配。'));
        writing = true;
        void desktopRepository
          .saveBytes(
            'experiment',
            request.record.id,
            data.write.bytes,
            data.write.summary,
            controller.signal,
          )
          .then(() => resolve({ ok: true, saved: true }), reject);
      } else resolve(data);
    };
    worker.onerror = () => {
      close();
      reject(
        new Error('回测 Worker 启动或执行失败，请检查浏览器支持；未生成结果。'),
      );
    };
    worker.onmessageerror = () => {
      close();
      reject(new Error('无法读取Worker结果，未生成结果。'));
    };
    try {
      if (source) worker.postMessage(request, [source.port]);
      else worker.postMessage(request);
    } catch (error) {
      close();
      reject(error);
    }
  });
  return {
    promise,
    cancel() {
      if (writing) controller.abort();
      else if (active) {
        close();
        rejectTask(new Error('任务已取消'));
      }
    },
  };
}
