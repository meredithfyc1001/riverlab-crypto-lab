import type { BacktestConfig } from '../core/backtests';
import type { RiskConfig } from '../core/risk';
import type { ReplayCheckpoint, ReplayView } from '../core/replay';
export type ReplayRequest =
  | {
      kind: 'start';
      datasetId: string;
      config: Partial<BacktestConfig>;
      risk: RiskConfig;
      confirmed: true;
      observedUtcMs: number;
    }
  | { kind: 'advance'; count: number }
  | { kind: 'trade'; action: 'buy' | 'sell'; quantity: string }
  | { kind: 'note'; text: string }
  | { kind: 'checkpoint'; id: string; name: string; createdUtcMs: number }
  | { kind: 'restore'; record: unknown; observedUtcMs: number }
  | { kind: 'csv' };
export type ReplayResponse =
  | {
      id: number;
      ok: true;
      view?: ReplayView;
      record?: ReplayCheckpoint;
      text?: string;
    }
  | { id: number; ok: false; message: string; fatal?: boolean };
export function replayWorker() {
  const worker = new Worker(new URL('./replay.worker.ts', import.meta.url), {
    type: 'module',
  });
  let sequence = 0;
  let closed = false;
  const pending = new Map<
    number,
    {
      resolve: (v: Extract<ReplayResponse, { ok: true }>) => void;
      reject: (error: Error) => void;
    }
  >();
  const stop = (message: string) => {
    closed = true;
    worker.terminate();
    for (const p of pending.values())
      p.reject(Object.assign(new Error(message), { fatal: true }));
    pending.clear();
  };
  worker.onmessage = (event: MessageEvent<ReplayResponse>) => {
    const data = event.data,
      p = pending.get(data.id);
    if (!p) return;
    pending.delete(data.id);
    if (data.ok) p.resolve(data);
    else
      p.reject(Object.assign(new Error(data.message), { fatal: data.fatal }));
  };
  worker.onerror = () =>
    stop('回放Worker启动或执行失败；请重新打开已保存状态。');
  worker.onmessageerror = () => stop('回放Worker通信失败；未生成新结果。');
  return {
    request(request: ReplayRequest) {
      if (closed)
        return Promise.reject(
          new Error('回放Worker已关闭，请重新开始或恢复。'),
        );
      const id = ++sequence;
      return new Promise<Extract<ReplayResponse, { ok: true }>>(
        (resolve, reject) => {
          pending.set(id, { resolve, reject });
          try {
            worker.postMessage({ id, request });
          } catch (error) {
            pending.delete(id);
            reject(error);
          }
        },
      );
    },
    close: () => stop('回放任务已结束，未保存进度不会自动恢复。'),
  };
}
