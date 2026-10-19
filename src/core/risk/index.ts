import type { ModuleBoundary } from '../../shared/module';

export const riskBoundary: ModuleBoundary = {
  id: 'risk',
  label: '风险',
  responsibility: '保护订单的触发与保守路径假设；成交和资金由回测账本执行。',
};

export {
  normalizeRisk,
  protectionFor,
  triggerAtOpen,
  triggerIntrabar,
} from './protection';
export type { RiskConfig, Protection, RiskTrigger } from './protection';
