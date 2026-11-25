import { datasetsPage } from '../features/datasets';
import { chartsPage } from '../features/charts';
import { strategiesPage } from '../features/strategies';
import { backtestsPage } from '../features/backtests';
import { riskPage } from '../features/risk';
import { experimentsPage } from '../features/experiments';
import { replayPage } from '../features/replay';

import { portfolioPage } from '../features/portfolio';

export const pages = [
  {
    id: 'overview',
    label: '工作台',
    code: '00',
    phase: 'Phase 0',
    description: '从一个清晰的研究问题开始。',
    scope: '项目基础框架',
  },
  datasetsPage,
  chartsPage,
  strategiesPage,
  backtestsPage,
  riskPage,
  experimentsPage,
  replayPage,
] as const;

export const routes = [...pages, portfolioPage] as const;
export type PageId = (typeof routes)[number]['id'];

export function pageFromHash(hash: string): PageId {
  const id = hash.replace(/^#\/?/, '');
  return routes.find((page) => page.id === id)?.id ?? 'overview';
}
