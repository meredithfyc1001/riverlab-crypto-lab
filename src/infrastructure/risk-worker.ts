import type {
  RiskSettings,
  RiskStudy,
  SourcePreview,
} from '../core/risk-analysis';
export type RiskRequest =
  | { kind: 'inspect'; sourceId: string; observedUtcMs: number }
  | {
      kind: 'run';
      sourceId: string;
      expectedHash: string;
      settings: RiskSettings;
      id: string;
      name: string;
      createdUtcMs: number;
      observedUtcMs: number;
    }
  | { kind: 'verify'; record: unknown; observedUtcMs: number }
  | {
      kind: 'export';
      record: RiskStudy;
      format: 'json' | 'csv';
      observedUtcMs: number;
    };
export type RiskResponse =
  | { kind: 'progress'; completed: number; total: number }
  | {
      kind: 'success';
      preview?: SourcePreview;
      record?: RiskStudy;
      text?: string;
    }
  | { kind: 'error'; message: string };
export function riskTask(
  request: RiskRequest,
  progress: (n: number, total: number) => void,
) {
  const worker = new Worker(new URL('./risk.worker.ts', import.meta.url), {
    type: 'module',
  });
  let rejectTask: (e: Error) => void = () => {};
  const promise = new Promise<Extract<RiskResponse, { kind: 'success' }>>(
    (resolve, reject) => {
      rejectTask = reject;
      worker.onmessage = (event: MessageEvent<RiskResponse>) => {
        const r = event.data;
        if (r.kind === 'progress') {
          progress(r.completed, r.total);
          return;
        }
        worker.terminate();
        if (r.kind === 'success') resolve(r);
        else reject(new Error(r.message));
      };
      const fail = () => {
        worker.terminate();
        reject(new Error('风险Worker启动或通信失败，未生成报告。'));
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
      rejectTask(new Error('风险任务已取消；没有部分结果。'));
    },
  };
}
