import { desktopRepository, isDesktopRepository } from './desktop-repository';
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

export type AdvancedWorkerRequest =
  AdvancedRequest | { kind: 'prepare-save'; record: AdvancedReport };

type Preview = { plan: AdvancedPlan; workers: number };
type AdvancedResponse<Q> = Q extends { kind: 'preview' }
  ? Preview
  : Q extends { kind: 'export' }
    ? { file: Blob }
    : Q extends { kind: 'save' }
      ? { saved: true }
      : { record: AdvancedReport };
export type AdvancedReply =
  | { write: { id: string; bytes: Uint8Array<ArrayBuffer>; summary: string } }
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
  const desktop = isDesktopRepository();
  const controller = new AbortController();
  let writing = false;
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
      if (!active || writing) return;
      if (!data || typeof data !== 'object')
        return abort(new Error('高级研究 Worker 响应无效。'));
      if ('write' in data) {
        if (
          !desktop ||
          request.kind !== 'save' ||
          data.write.id !== request.record.id
        )
          return abort(new Error('高级研究 Worker 的保存回执与当前任务不符。'));
        writing = true;
        const { id, bytes, summary } = data.write;
        void desktopRepository
          .saveBytes('advanced', id, bytes, summary, controller.signal)
          .then(
            () => {
              close();
              resolve({ saved: true } as AdvancedResponse<Q>);
            },
            (error: unknown) =>
              abort(
                error instanceof Error
                  ? error
                  : new Error('高级研究报告写入失败。'),
              ),
          );
        return;
      }
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
              ? desktop || !('saved' in data && data.saved)
              : !('record' in data)
      )
        return abort(new Error('高级研究 Worker 响应无效。'));
      close();
      resolve(data as AdvancedResponse<Q>);
    };
    try {
      if (desktop && request.kind === 'run' && request.concurrency > 1) {
        peers = desktopCandidateWorkers(
          Math.min(4, request.concurrency),
          abort,
        );
        worker.postMessage(request, [peers.control]);
      } else if (desktop && request.kind === 'save') {
        worker.postMessage({
          kind: 'prepare-save',
          record: request.record,
        } satisfies AdvancedWorkerRequest);
      } else {
        worker.postMessage(request);
      }
    } catch (e) {
      abort(e instanceof Error ? e : new Error('无法传输高级研究输入。'));
    }
  });
  // The browser coordinator owns its nested Workers; the desktop window owns its peers.
  return {
    promise,
    cancel() {
      // Once COMMIT has been dispatched, the transaction receipt decides the outcome.
      if (writing) controller.abort();
      else abort(new Error('高级研究任务已取消。'));
    },
  };
}
