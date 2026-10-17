import { datasetsPage } from '../features/datasets';
import { chartsPage } from '../features/charts';
import { strategiesPage } from '../features/strategies';
import { backtestsPage } from '../features/backtests';
import { riskPage } from '../features/risk';
import { experimentsPage } from '../features/experiments';
import { replayPage } from '../features/replay';

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

export type PageId = (typeof pages)[number]['id'];

export function pageFromHash(hash: string): PageId {
  const id = hash.replace(/^#\/?/, '');
  return pages.find((page) => page.id === id)?.id ?? 'overview';
}
