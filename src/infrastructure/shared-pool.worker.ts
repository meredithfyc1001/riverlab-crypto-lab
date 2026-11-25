import {
  createSharedPoolExperiment,
  verifySharedPoolExperiment,
} from '../core/shared-pool/report';
import { readSharedPoolFile, exportSharedPoolFile } from './shared-pool-file';
import type {
  SharedPoolRequest,
  SharedPoolResponse,
} from './shared-pool-worker';
const scope = globalThis as unknown as {
  onmessage: ((e: MessageEvent<SharedPoolRequest>) => void) | null;
  postMessage: (v: SharedPoolResponse) => void;
};
scope.onmessage = async ({ data }) => {
  try {
    const now = Date.now();
    switch (data.kind) {
      case 'run':
        scope.postMessage({
          record: createSharedPoolExperiment(
            data.input,
            {
              id: crypto.randomUUID(),
              name: data.name,
              createdUtcMs: now,
            },
            now,
          ),
        });
        break;
      case 'verify':
        scope.postMessage({
          record: verifySharedPoolExperiment(data.record, now),
        });
        break;
      case 'import':
        scope.postMessage({ record: await readSharedPoolFile(data.file, now) });
        break;
      case 'export':
        scope.postMessage({
          file: exportSharedPoolFile(data.record, data.format, now),
        });
        break;
    }
  } catch (error) {
    scope.postMessage({
      error: error instanceof Error ? error.message : '组合任务失败。',
    });
  }
};
