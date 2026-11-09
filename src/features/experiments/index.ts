export const experimentsPage = {
  id: 'experiments',
  label: '实验中心',
  code: '06',
  phase: 'Phase 2C',
  description: '保留过程，才能复现结论。',
  scope: '保存完整实验，校验重开与复现，导出JSON报告和逐笔CSV。',
} as const;

export { ExperimentCenter } from './ExperimentCenter';
