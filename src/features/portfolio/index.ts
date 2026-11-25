import { lazy } from 'react';

export const portfolioPage = {
  id: 'portfolio',
  label: '组合回测',
  code: '04',
  phase: 'Phase 5C-B',
  description:
    '在共同历史区间内回测固定子账户、策略共享资金池或定期目标权重再平衡。',
  scope: '多币种历史行情组合回测',
} as const;

export const PortfolioCenter = lazy(() => import('./PortfolioCenter'));
export type { PortfolioPlan } from './model';
