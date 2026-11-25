import { lazy } from 'react';

export const backtestsPage = {
  id: 'backtests',
  label: '回测中心',
  code: '04',
  phase: 'Phase 2C',
  description: '用可复现的实验检验想法。',
  scope:
    '现货、多头、单币种、无杠杆的回测配置、Worker运行、统计、曲线与可对账账本。',
} as const;

export const BacktestCenter = lazy(() =>
  import('./BacktestCenter').then((module) => ({
    default: module.BacktestCenter,
  })),
);
const loadResults = () => import('./BacktestResults');

export function preloadBacktestResults() {
  void loadResults().catch(() => {
    // A failed import is reported by PageBoundary when the results are opened.
  });
}

export const BacktestResults = lazy(() =>
  loadResults().then((module) => ({ default: module.BacktestResults })),
);
