import {
  createPortfolioExperiment,
  verifyPortfolioExperiment,
} from '../core/portfolio/report';
import { readPortfolioFile, exportPortfolioFile } from './portfolio-file';
import type { PortfolioRequest, PortfolioResponse } from './portfolio-worker';
const scope = globalThis as unknown as {
  onmessage: ((e: MessageEvent<PortfolioRequest>) => void) | null;
  postMessage: (v: PortfolioResponse) => void;
};
scope.onmessage = async ({ data }) => {
  try {
    const now = Date.now();
    switch (data.kind) {
      case 'run':
        scope.postMessage({
          record: createPortfolioExperiment(
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
          record: verifyPortfolioExperiment(data.record, now),
        });
        break;
      case 'import':
        scope.postMessage({ record: await readPortfolioFile(data.file, now) });
        break;
      case 'export':
        scope.postMessage({
          file: exportPortfolioFile(data.record, data.format, now),
        });
        break;
    }
  } catch (error) {
    scope.postMessage({
      error: error instanceof Error ? error.message : '组合任务失败。',
    });
  }
};
