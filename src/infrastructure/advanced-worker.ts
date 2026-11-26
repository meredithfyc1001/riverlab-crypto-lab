import { desktopCandidateWorkers } from './advanced-desktop-workers';
import type { AdvancedInput, AdvancedPlan } from '../core/advanced-research';
import type { AdvancedReport } from '../core/advanced-research/report';

export type AdvancedRequest =
  | { kind: 'run'; input: AdvancedInput; name: string; concurrency: number }
  | { kind: 'preview'; input: AdvancedInput; concurrency: number }
  | { kind: 'save'; record: AdvancedReport }
  | { kind: 'verify'; record: unknown }
  | { kind: 'import'; file: Blob }
  | { kind: 'export'; record: AdvancedReport; format: 'json' | 'csv' };

type Preview = { plan: AdvancedPlan; workers: number };
type AdvancedResponse<Q> = Q extends { kind: 'preview' }
  ? Preview
  : Q extends { kind: 'export' }
    ? { file: Blob }
    : Q extends { kind: 'save' }
      ? { saved: true }
      : { record: AdvancedReport };
export type AdvancedReply =
  | { progress: number; total: number }
  | { error: string }
  | Preview
  | { saved: true }
  | { record: AdvancedReport }
  | { file: Blob };

export function advancedTask<Q extends AdvancedRequest>(
  request: Q,
  onProgress?: (done: number, total: number) => void,
) {
  const worker = new Worker(new URL('./advanced.worker.ts', import.meta.url), {
    type: 'module',
  });
  let active = true;
  let peers: ReturnType<typeof desktopCandidateWorkers> | undefined;
  let abort: (e: Error) => void = () => {};
  const promise = new Promise<AdvancedResponse<Q>>((resolve, reject) => {
    function close() {
      active = false;
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      peers?.close();
    }
    abort = (error) => {
      if (!active) return;
      close();
      reject(error);
    };
    worker.onerror = worker.onmessageerror = () =>
      abort(new Error('高级研究 Worker 启动或通信失败。'));
    worker.onmessage = ({ data }: MessageEvent<AdvancedReply>) => {
      if (!active) return;
      if (!data || typeof data !== 'object')
        return abort(new Error('高级研究 Worker 响应无效。'));
      if ('progress' in data) {
        onProgress?.(data.progress, data.total);
        return;
      }
      if ('error' in data) return abort(new Error(data.error));
      if (
        request.kind === 'preview'
          ? !('plan' in data)
          : request.kind === 'export'
            ? !('file' in data)
            : request.kind === 'save'
              ? !('saved' in data && data.saved)
              : !('record' in data)
      )
        return abort(new Error('高级研究 Worker 响应无效。'));
      close();
      resolve(data as AdvancedResponse<Q>);
    };
    try {
      if (
        import.meta.env.MODE === 'desktop-6a' &&
        '__TAURI__' in window &&
        request.kind === 'run' &&
        request.concurrency > 1
      ) {
        peers = desktopCandidateWorkers(
          Math.min(4, request.concurrency),
          abort,
        );
        worker.postMessage(request, [peers.control]);
      } else {
        worker.postMessage(request);
      }
    } catch (e) {
      abort(e instanceof Error ? e : new Error('无法传输高级研究输入。'));
    }
  });
  // The browser coordinator owns its nested Workers; the desktop window owns its peers.
  return { promise, cancel: () => abort(new Error('高级研究任务已取消。')) };
}
