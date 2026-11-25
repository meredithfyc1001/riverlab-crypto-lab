import {
  createRegimeReport,
  verifyRegimeReport,
} from '../core/market-regime/report';
import type { RegimeReport } from '../core/market-regime/report';
import { ExperimentStore } from './experiment-store';
import { PortfolioStore } from './portfolio-store';
import { SharedPoolStore } from './shared-pool-store';
import { readRegimeFile, exportRegimeFile } from './market-regime-file';
import type { RegimeRequest, RegimeSourceKind } from './market-regime-worker';
import type { ReportResponse } from './report-worker-client';

const scope = globalThis as unknown as {
  onmessage: ((e: MessageEvent<RegimeRequest>) => void) | null;
  postMessage: (r: ReportResponse<RegimeReport>) => void;
};

function storeFor(kind: RegimeSourceKind) {
  switch (kind) {
    case 'single':
      return new ExperimentStore();
    case 'portfolio':
      return new PortfolioStore();
    case 'shared':
      return new SharedPoolStore();
    default:
      throw new Error('市场状态研究不支持此实验类型。');
  }
}

scope.onmessage = async ({ data }) => {
  try {
    const now = Date.now();
    switch (data.kind) {
      case 'run': {
        const { sourceKind, sourceId, expectedHash, reference, params } =
          data.input;
        const original = await storeFor(sourceKind).load(sourceId);
        if (
          !original ||
          typeof original !== 'object' ||
          !('id' in original) ||
          original.id !== sourceId ||
          !('payloadHash' in original) ||
          original.payloadHash !== expectedHash
        )
          throw new Error('源实验已改变，请重新选择。');
        const record = createRegimeReport(
          sourceKind,
          original,
          reference,
          params,
          {
            id: crypto.randomUUID(),
            name: data.name,
            createdUtcMs: now,
          },
          now,
        );
        scope.postMessage({ record });
        break;
      }
      case 'verify':
        scope.postMessage({ record: verifyRegimeReport(data.record, now) });
        break;
      case 'import':
        scope.postMessage({ record: await readRegimeFile(data.file, now) });
        break;
      case 'export':
        scope.postMessage({
          file: exportRegimeFile(data.record, data.format, now),
        });
        break;
    }
  } catch (e) {
    scope.postMessage({
      error: e instanceof Error ? e.message : '市场状态任务失败。',
    });
  }
};
