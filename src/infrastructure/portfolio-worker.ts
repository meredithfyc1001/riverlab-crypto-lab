import type { PortfolioInput } from '../core/portfolio';
import type { PortfolioExperiment } from '../core/portfolio/report';

export type PortfolioRequest =
  | { kind: 'run'; input: PortfolioInput; name: string }
  | { kind: 'verify'; record: unknown }
  | { kind: 'import'; file: Blob }
  | { kind: 'export'; record: PortfolioExperiment; format: 'json' | 'csv' };

export type PortfolioResponse =
  { record: PortfolioExperiment } | { file: Blob } | { error: string };
type Result<R extends PortfolioRequest> = R extends { kind: 'export' }
  ? { file: Blob }
  : { record: PortfolioExperiment };
export function portfolioTask<R extends PortfolioRequest>(request: R) {
  const worker = new Worker(new URL('./portfolio.worker.ts', import.meta.url), {
    type: 'module',
  });
  let rejectTask: (error: Error) => void = () => {};
  const promise = new Promise<Result<R>>((resolve, reject) => {
    rejectTask = reject;
    worker.onmessage = ({ data }: MessageEvent<PortfolioResponse>) => {
      worker.terminate();
      if (data && 'error' in data) reject(new Error(data.error));
      else if (
        data &&
        (request.kind === 'export' ? 'file' in data : 'record' in data)
      )
        resolve(data as Result<R>);
      else reject(new Error('无法读取组合 Worker 结果。'));
    };
    const fail = () => {
      worker.terminate();
      reject(new Error('组合 Worker 启动或通信失败。'));
    };
    worker.onerror = fail;
    worker.onmessageerror = fail;
    try {
      worker.postMessage(request);
    } catch (error) {
      worker.terminate();
      reject(error);
    }
  });
  return {
    promise,
    cancel: () => {
      worker.terminate();
      rejectTask(new Error('组合任务已取消。'));
    },
  };
}
