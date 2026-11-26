import { prepareAdvanced } from '../core/advanced-research';
import {
  captureAdvancedInput,
  sealAdvancedReport,
  verifyAdvancedReport,
} from '../core/advanced-research/report';
import { assertMetadata } from '../core/portfolio/report-common';
import { readAdvancedFile, exportAdvancedFile } from './advanced-file';
import {
  advancedWorkerCount,
  scheduleAdvanced,
  workerLane,
} from './advanced-pool';
import { AdvancedStore } from './advanced-store';
import type { AdvancedRequest, AdvancedReply } from './advanced-worker';

const scope = globalThis as unknown as {
  onmessage: ((e: MessageEvent<AdvancedRequest>) => void) | null;
  postMessage: (r: AdvancedReply) => void;
};

scope.onmessage = async ({ data, ports }) => {
  try {
    const now = Date.now();
    switch (data.kind) {
      case 'preview':
      case 'run': {
        const input = captureAdvancedInput(data.input, now);
        const plan = prepareAdvanced(input);
        if (data.kind === 'preview') {
          scope.postMessage({
            plan,
            workers: advancedWorkerCount(input, plan, data.concurrency),
          });
        } else {
          const metadata = {
            id: crypto.randomUUID(),
            name: data.name,
            createdUtcMs: now,
          };
          assertMetadata(metadata);
          const result = await scheduleAdvanced(
            input,
            plan,
            data.concurrency,
            (progress, total) => scope.postMessage({ progress, total }),
            ports[0] ? (captured) => workerLane(captured, ports[0]) : undefined,
          );
          scope.postMessage({
            record: sealAdvancedReport(input, result, metadata),
          });
        }
        break;
      }
      case 'save':
        await new AdvancedStore().save(data.record, now);
        scope.postMessage({ saved: true });
        break;
      case 'verify':
        scope.postMessage({ record: verifyAdvancedReport(data.record, now) });
        break;
      case 'import':
        scope.postMessage({ record: await readAdvancedFile(data.file, now) });
        break;
      case 'export':
        scope.postMessage({
          file: exportAdvancedFile(data.record, data.format, now),
        });
        break;
    }
  } catch (e) {
    scope.postMessage({
      error: e instanceof Error ? e.message : '高级研究任务失败。',
    });
  }
};
