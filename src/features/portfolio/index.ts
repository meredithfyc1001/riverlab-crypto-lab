import { lazy } from 'react';

export const portfolioPage = {
  id: 'portfolio',
  label: '组合回测',
  code: '04',
  phase: 'Phase 5C-A',
  description: '在共同历史区间内，比较独立子账户的净值、交易与盈亏贡献。',
  scope: '多币种历史行情组合回测',
} as const;

export const PortfolioCenter = lazy(() => import('./PortfolioCenter'));
export type { PortfolioPlan } from './model';
