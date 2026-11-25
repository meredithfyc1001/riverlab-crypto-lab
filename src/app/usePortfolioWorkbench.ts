import type { PortfolioInput } from '../core/portfolio/alignment';
import type { PortfolioPlan } from '../features/portfolio';
import { PortfolioStore } from '../infrastructure/portfolio-store';
import { portfolioTask } from '../infrastructure/portfolio-worker';
import { loadPortfolioAssets, usePortfolioTasks } from './usePortfolioTasks';

const independent = {
  store: () => new PortfolioStore(),
  prepare: async (plan: PortfolioPlan): Promise<PortfolioInput> => ({
    ...plan,
    assets: await loadPortfolioAssets(plan.assets),
  }),
  task: portfolioTask,
  basename: 'riverlab-portfolio',
  reproduced: '完整复现通过。组合 Hash、各子账户与组合统计均一致。',
};
export function usePortfolioWorkbench(active: boolean) {
  return usePortfolioTasks(active, independent);
}
