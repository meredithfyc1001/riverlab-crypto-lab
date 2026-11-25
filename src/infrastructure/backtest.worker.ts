import { readExperimentFile } from './experiment-file';
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
    } else if (data.kind === 'import') {
      const record = await readExperimentFile(data.file);
      scope.postMessage({ ok: true, record });
    } else {
      const record = verifyExperiment(data.record);
      if (data.kind === 'export') {
        const file =
          data.format === 'json'
            ? new Blob([reportJson(record)], { type: 'application/json' })
            : new Blob([tradesCsv(record)], { type: 'text/csv;charset=utf-8' });
        scope.postMessage({ ok: true, file });
      } else {
        scope.postMessage({ ok: true, record });
      }
    }
  } catch (error) {
    scope.postMessage({
      ok: false,
      message: `无法完成：${error instanceof Error ? error.message : '未知错误'}。请检查数据、参数和浏览器空间；未自动修复数据。`,
    });
  }
};
