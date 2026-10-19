export const chartsPage = {
  id: 'charts',
  label: '行情中心',
  code: '02',
  phase: 'Phase 1',
  description: '从历史价格中观察市场。',
  scope: '本地历史 K 线、成交量与 MA/EMA/RSI，不接入实时行情。',
} as const;

export { ChartCenter } from './ChartCenter';
