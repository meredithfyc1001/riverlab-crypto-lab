import type { DatasetSummary } from '../../core/data/dataset';
import type { SharedPoolExperiment } from '../../core/shared-pool/report';
import type { SharedPoolInput } from '../../core/shared-pool/types';
import type { PortfolioWorkbench } from './model';

type PlanForMode<I extends SharedPoolInput> = I extends SharedPoolInput
  ? Omit<I, 'assets'> & {
      assets: (Omit<I['assets'][number], 'dataset'> & {
        dataset: DatasetSummary;
      })[];
    }
  : never;
export type SharedPoolPlan = PlanForMode<SharedPoolInput>;
export interface SharedPoolWorkbench extends Omit<
  PortfolioWorkbench,
  'record' | 'run'
> {
  record: SharedPoolExperiment | null;
  run: (plan: SharedPoolPlan, name: string) => void;
}
