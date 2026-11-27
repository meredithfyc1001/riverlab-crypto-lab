import { openWorkerSource } from './worker-source';
import type { RegimeParams } from '../core/market-regime/model';
import type { RegimeReport } from '../core/market-regime/report';
import type { SourceKind } from '../core/market-regime/source';
import { requestReportWorker } from './report-worker-client';
import type { ReportRequest } from './report-worker-client';

export type RegimeSourceKind = SourceKind;
export interface RegimeRunInput {
  sourceKind: RegimeSourceKind;
  sourceId: string;
  expectedHash: string;
  reference: string | null;
  params: RegimeParams;
}
export type RegimeRequest = ReportRequest<RegimeRunInput, RegimeReport>;

export function marketRegimeTask<Q extends RegimeRequest>(request: Q) {
  return requestReportWorker<Q, RegimeReport>(
    new Worker(new URL('./market-regime.worker.ts', import.meta.url), {
      type: 'module',
    }),
    request,
    '市场状态',
    request.kind === 'run'
      ? openWorkerSource(
          (
            {
              single: 'experiment',
              portfolio: 'portfolio',
              shared: 'shared_pool',
            } as const
          )[request.input.sourceKind],
        )
      : undefined,
  );
}
