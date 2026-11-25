import { lazy } from 'react';

export const advancedResearchPage = {
  id: 'advanced-research',
  label: '高级策略研究',
  code: '03',
  phase: 'Phase 5E',
  description:
    '选择具体规则版本，用训练数据筛选参数，再查看独立测试窗口的表现。',
  scope: '有界参数搜索、滚动优化与样本外归因',
} as const;

export const AdvancedResearchCenter = lazy(
  () => import('./AdvancedResearchCenter'),
);
