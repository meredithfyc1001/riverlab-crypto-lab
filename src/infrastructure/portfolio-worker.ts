import type { PortfolioInput } from '../core/portfolio';
import type { PortfolioExperiment } from '../core/portfolio/report';
import { requestReportWorker } from './report-worker-client';
import type { ReportRequest, ReportResponse } from './report-worker-client';

export type PortfolioRequest = ReportRequest<
  PortfolioInput,
  PortfolioExperiment
>;
export type PortfolioResponse = ReportResponse<PortfolioExperiment>;
export function portfolioTask<Q extends PortfolioRequest>(request: Q) {
  return requestReportWorker<Q, PortfolioExperiment>(
    new Worker(new URL('./portfolio.worker.ts', import.meta.url), {
      type: 'module',
    }),
    request,
  );
}
