import { openWorkerSource } from './worker-source';
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
  const source =
    request.kind === 'inspect' || request.kind === 'run'
      ? openWorkerSource('experiment')
      : undefined;
  const close = () => {
    source?.close();
    worker.terminate();
  };
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
        close();
        if (r.kind === 'success') resolve(r);
        else reject(new Error(r.message));
      };
      const fail = () => {
        close();
        reject(new Error('风险Worker启动或通信失败，未生成报告。'));
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
    },
  );
  return {
    promise,
    cancel: () => {
      close();
      rejectTask(new Error('风险任务已取消；没有部分结果。'));
    },
  };
}
