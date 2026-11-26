import type { openWorkerSource } from './worker-source';

export type ReportRequest<I, R> =
  | { kind: 'run'; input: I; name: string }
  | { kind: 'verify'; record: unknown }
  | { kind: 'import'; file: Blob }
  | { kind: 'export'; record: R; format: 'json' | 'csv' };

export type ReportResponse<R> =
  { record: R } | { file: Blob } | { error: string };
export type WorkerResult<Q, R> = Q extends { kind: 'export' }
  ? { file: Blob }
  : { record: R };

export function requestReportWorker<
  Q extends ReportRequest<unknown, unknown>,
  R,
>(
  worker: Worker,
  request: Q,
  label = '组合',
  source?: ReturnType<typeof openWorkerSource>,
) {
  const close = () => {
    source?.close();
    worker.terminate();
  };
  let rejectTask: (error: Error) => void = () => {};
  const promise = new Promise<WorkerResult<Q, R>>((resolve, reject) => {
    rejectTask = reject;
    worker.onmessage = ({ data }: MessageEvent<ReportResponse<R>>) => {
      close();
      if (data && 'error' in data) reject(new Error(data.error));
      else if (
        data &&
        (request.kind === 'export' ? 'file' in data : 'record' in data)
      )
        resolve(data as WorkerResult<Q, R>);
      else reject(new Error(`无法读取${label} Worker 结果。`));
    };
    const fail = () => {
      close();
      reject(new Error(`${label} Worker 启动或通信失败。`));
    };
    worker.onerror = fail;
    worker.onmessageerror = fail;
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
    cancel: () => {
      close();
      rejectTask(new Error(`${label}任务已取消。`));
    },
  };
}
