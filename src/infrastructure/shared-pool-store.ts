import type { SharedPoolExperiment } from '../core/shared-pool/report';
import { PortfolioStore } from './portfolio-store';

/** Independent database, with the same atomic summary and payload transaction. */
export class SharedPoolStore extends PortfolioStore<SharedPoolExperiment> {
  constructor(factory?: () => IDBFactory) {
    super(factory, undefined, 'shared_pool');
  }
}
