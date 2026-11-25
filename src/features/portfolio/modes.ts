import type { SharedPoolInput } from '../../core/shared-pool/types';

export type RunMode = 'independent' | SharedPoolInput['mode'];

export const modeLabels: Record<RunMode, string> = {
  independent: '固定子账户',
  'shared-strategy': '策略驱动共享资金池',
  rebalance: '定期目标权重再平衡',
};
