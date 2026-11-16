import { sealWorkerExperiment } from './experiment-hash';
import {
  runExperiment,
  verifyExperiment,
  tradesCsv,
  reportJson,
} from '../core/experiments';
import type { WorkerRequest, WorkerResponse } from './backtest-worker';
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (value: WorkerResponse) => void;
};
scope.onmessage = async ({ data }) => {
  try {
    if (data.kind === 'run') {
      const start = performance.now();
      const payload = runExperiment(data.input);
      const record = await sealWorkerExperiment(payload, {
        id: data.id,
        name: data.name,
        createdUtcMs: data.createdUtcMs,
        elapsedMs: performance.now() - start,
      });
      scope.postMessage({ ok: true, record });
    } else {
      const record = verifyExperiment(data.record);
      scope.postMessage({
        ok: true,
        record,
        ...(data.kind === 'export'
          ? {
              text:
                data.format === 'json' ? reportJson(record) : tradesCsv(record),
            }
          : {}),
      });
    }
  } catch (error) {
    scope.postMessage({
      ok: false,
      message: `无法完成：${error instanceof Error ? error.message : '未知错误'}。请检查数据、参数和浏览器空间；未自动修复数据。`,
    });
  }
};
