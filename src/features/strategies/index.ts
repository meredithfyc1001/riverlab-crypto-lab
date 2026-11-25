import { lazy } from 'react';

export const strategiesPage = {
  id: 'strategies',
  label: '策略中心',
  code: '03',
  phase: 'Phase 5B',
  description: '让每一个策略假设都有据可查。',
  scope: '可视化规则版本与单次回测；原三策略参数敏感度及时间隔离研究。',
} as const;

export const ResearchCenter = lazy(() =>
  import('./ResearchCenter').then((module) => ({
    default: module.ResearchCenter,
  })),
);
export const ResearchResults = lazy(() =>
  import('./ResearchResults').then((module) => ({
    default: module.ResearchResults,
  })),
);

export const RuleEditor = lazy(() =>
  import('./RuleEditor').then((module) => ({ default: module.RuleEditor })),
);
