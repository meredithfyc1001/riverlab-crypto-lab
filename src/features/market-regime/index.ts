import { lazy } from 'react';

export const marketRegimePage = {
  id: 'market-regime',
  label: '市场状态研究',
  code: '05',
  phase: 'Phase 5D',
  description: '沿着原实验的资金曲线，查看各类历史市场状态下的权益变化。',
  scope: '基于已完成收盘价的市场状态标签与历史表现归因',
} as const;

export const MarketRegimeCenter = lazy(() => import('./MarketRegimeCenter'));
