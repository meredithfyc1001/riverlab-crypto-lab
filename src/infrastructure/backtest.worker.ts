import { readWorkerSource } from './worker-source';
import { readExperimentFile } from './experiment-file';
import { sealWorkerExperiment } from './experiment-hash';
import {
  runExperiment,
  verifyExperiment,
  tradesCsv,
  reportJson,
  summarizeExperiment,
} from '../core/experiments';
import type { WorkerRequest, WorkerResponse } from './backtest-worker';
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (value: WorkerResponse, transfer?: Transferable[]) => void;
};
scope.onmessage = async ({ data, ports }) => {
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
    } else if (data.kind === 'save') {
      // The run/import path delivered a validated snapshot. Encode it away from
      // the window; transferring ownership avoids serializing the report a second time.
      const bytes = new TextEncoder().encode(JSON.stringify(data.record));
      const summary = JSON.stringify(summarizeExperiment(data.record));
      scope.postMessage({ ok: true, write: { bytes, summary } }, [
        bytes.buffer,
      ]);
    } else {
      let raw: unknown;
      if (data.kind === 'open') {
        if (!ports?.[0]) throw new Error('无法连接桌面实验库。');
        raw = await readWorkerSource(ports[0], data.id);
      } else raw = data.record;
      const record = verifyExperiment(raw);
      if (data.kind === 'open' && record.id !== data.id)
        throw new Error('实验正文与选定 ID 不一致。');
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
