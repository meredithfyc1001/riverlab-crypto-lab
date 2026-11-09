import type { ResearchInput, ResearchReport } from '../core/research';
export type ResearchRequest =
  { kind: 'run'; input: ResearchInput } | { kind: 'verify'; report: unknown };
export type ResearchResponse =
  | { kind: 'progress'; completed: number; total: number }
  | { kind: 'success'; report: ResearchReport; elapsedMs: number }
  | { kind: 'error'; message: string };
export function researchTask(
  request: ResearchRequest,
  progress: (completed: number, total: number) => void,
) {
  const worker = new Worker(new URL('./research.worker.ts', import.meta.url), {
    type: 'module',
  });
  let rejectTask: (error: Error) => void = () => {};
  const promise = new Promise<{ report: ResearchReport; elapsedMs: number }>(
    (resolve, reject) => {
      rejectTask = reject;
      worker.onmessage = (event: MessageEvent<ResearchResponse>) => {
        const data = event.data;
        if (data.kind === 'progress') {
          progress(data.completed, data.total);
          return;
        }
        worker.terminate();
        if (data.kind === 'success') resolve(data);
        else reject(new Error(data.message));
      };
      const fail = () => {
        worker.terminate();
        reject(new Error('研究Worker启动或通信失败，未生成报告。'));
      };
      worker.onerror = fail;
      worker.onmessageerror = fail;
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
      rejectTask(new Error('研究任务已取消；未生成部分报告。'));
    },
  };
}
