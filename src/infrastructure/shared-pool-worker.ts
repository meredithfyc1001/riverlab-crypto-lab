import type { SharedPoolInput } from '../core/shared-pool/types';
import type { SharedPoolExperiment } from '../core/shared-pool/report';
import { requestReportWorker } from './report-worker-client';
import type { ReportRequest, ReportResponse } from './report-worker-client';

export type SharedPoolRequest = ReportRequest<
  SharedPoolInput,
  SharedPoolExperiment
>;
export type SharedPoolResponse = ReportResponse<SharedPoolExperiment>;
export function sharedPoolTask<Q extends SharedPoolRequest>(request: Q) {
  return requestReportWorker<Q, SharedPoolExperiment>(
    new Worker(new URL('./shared-pool.worker.ts', import.meta.url), {
      type: 'module',
    }),
    request,
  );
}
