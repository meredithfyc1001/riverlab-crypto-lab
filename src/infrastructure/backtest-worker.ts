import type { Experiment, WorkbenchInput } from '../core/experiments';
export type WorkerRequest =
  | {
      kind: 'run';
      input: WorkbenchInput;
      id: string;
      name: string;
      createdUtcMs: number;
    }
  | { kind: 'verify'; record: unknown }
  | { kind: 'import'; file: Blob }
  | { kind: 'export'; record: Experiment; format: 'json' | 'csv' };
export type WorkerResponse =
  | { ok: true; record: Experiment }
  | { ok: true; file: Blob }
  | { ok: false; message: string };
export function workerTask(request: WorkerRequest) {
  const worker = new Worker(new URL('./backtest.worker.ts', import.meta.url), {
    type: 'module',
  });
  let rejectTask: (error: Error) => void = () => {};
  const promise = new Promise<Extract<WorkerResponse, { ok: true }>>(
    (resolve, reject) => {
      rejectTask = reject;
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        worker.terminate();
        if (event.data.ok) resolve(event.data);
        else reject(new Error(event.data.message));
      };
      worker.onerror = () => {
        worker.terminate();
        reject(
          new Error(
            '回测 Worker 启动或执行失败，请检查浏览器支持；未生成结果。',
          ),
        );
      };
      worker.onmessageerror = () => {
        worker.terminate();
        reject(new Error('无法读取Worker结果，未生成结果。'));
      };
      try {
        worker.postMessage(request);
      } catch (error) {
        worker.terminate();
        reject(error);
      }
    },
  );
  return {
    promise,
    cancel: () => {
      worker.terminate();
      rejectTask(new Error('任务已取消'));
    },
  };
}
