import type { RepositoryKind } from './desktop-repository';

export const layouts = {
  dataset: ['riverlab-crypto-lab', 'datasets'],
  experiment: ['riverlab-crypto-lab-experiments', 'experiments'],
  rule: ['riverlab-crypto-lab-rules', 'versions'],
  replay: ['riverlab-crypto-lab-replays', 'replays'],
  risk: ['riverlab-crypto-lab-risk', 'studies'],
  portfolio: ['riverlab-crypto-lab-portfolios', 'experiments'],
  shared_pool: ['riverlab-crypto-lab-shared-pool', 'experiments'],
  regime: ['riverlab-crypto-lab-market-regime', 'reports'],
  advanced: ['riverlab-crypto-lab-advanced-research', 'reports'],
} as const satisfies Record<RepositoryKind, readonly [string, string]>;
