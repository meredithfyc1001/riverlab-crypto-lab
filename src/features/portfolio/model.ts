import type { DatasetSummary } from '../../core/data/dataset';
import type {
  PortfolioAsset,
  PortfolioInput,
} from '../../core/portfolio/alignment';

import type {
  PortfolioExperiment,
  PortfolioSummary,
} from '../../core/portfolio/report';

export type PortfolioPlan = Omit<PortfolioInput, 'assets'> & {
  assets: (Omit<PortfolioAsset, 'dataset'> & { dataset: DatasetSummary })[];
};

export interface PortfolioWorkbench {
  record: PortfolioExperiment | null;
  records: PortfolioSummary[];
  saved: boolean;
  busy: boolean;
  canCancel: boolean;
  message: string;
  error: string;
  run: (plan: PortfolioPlan, name: string) => void;
  restore: (file: File) => void;
  open: (id: string) => void;
  save: () => void;
  remove: (id: string) => void;
  reproduce: () => void;
  exportRecord: (format: 'csv' | 'json') => void;
  cancel: () => void;
}
