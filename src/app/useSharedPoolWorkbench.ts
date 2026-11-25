import type { SharedPoolInput } from '../core/shared-pool/types';
import type { SharedPoolPlan } from '../features/portfolio/shared-model';
import { SharedPoolStore } from '../infrastructure/shared-pool-store';
import { sharedPoolTask } from '../infrastructure/shared-pool-worker';
import { loadPortfolioAssets, usePortfolioTasks } from './usePortfolioTasks';

async function prepare(plan: SharedPoolPlan): Promise<SharedPoolInput> {
  if (plan.mode === 'rebalance')
    return { ...plan, assets: await loadPortfolioAssets(plan.assets) };
  return { ...plan, assets: await loadPortfolioAssets(plan.assets) };
}
const shared = {
  store: () => new SharedPoolStore(),
  prepare,
  task: sharedPoolTask,
  basename: 'riverlab-shared-pool',
  reproduced: '完整复现通过。共享账本、权重、组合统计及 Hash 均一致。',
};
export function useSharedPoolWorkbench(active: boolean) {
  return usePortfolioTasks(active, shared);
}
