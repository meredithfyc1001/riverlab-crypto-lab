import type {
  PortfolioAsset,
  PortfolioInput,
  AlignmentPreview,
} from '../portfolio/alignment';
import type { RiskTrigger } from '../risk';
import type { RejectionReason } from '../backtests/types';

export const SHARED_EXECUTION_VERSION = 'shared-spot-clock-v1';
export const SHARED_POOL_VERSIONS = {
  'shared-strategy': 'shared-spot-strategy-v1',
  rebalance: 'shared-spot-rebalance-v1',
} as const;
export type RebalanceAsset = Pick<
  PortfolioAsset,
  'dataset' | 'costs' | 'weightPercent'
>;
type Base = Omit<PortfolioInput, 'assets'>;
export type SharedPoolInput =
  | (Base & { mode: 'shared-strategy'; assets: PortfolioAsset[] })
  | (Base & {
      mode: 'rebalance';
      assets: RebalanceAsset[];
      cashWeightPercent: string;
      rebalanceEvery: number;
    });

export interface PoolOrder {
  sequence: number;
  barIndex: number;
  barOpenUtcMs: number;
  symbol: string;
  phase: 'protection-open' | 'sell' | 'buy' | 'protection-after-buys';
  side: 'buy' | 'sell';
  reason: string;
  status: 'filled' | 'rejected';
  rejection:
    | RejectionReason
    | 'risk-priority'
    | 'cash-reserve'
    | 'stop-price-underflow'
    | null;
  trigger?: RiskTrigger;
  referencePrice: string;
  requestedBudget: string | null;
  approvedBudget: string | null;
  unusedBudget: string | null;
  price: string | null;
  quantity: string;
  notional: string;
  fee: string;
  cashBefore: string;
  cashAfter: string;
  quantityBefore: string;
  quantityAfter: string;
}
export interface PoolDecision {
  barIndex: number;
  closeUtcMs: number;
  symbol: string | null;
  action: 'buy' | 'sell' | 'hold' | 'rebalance';
  reason: string;
}
export interface PoolPoint {
  timestampUtcMs: number;
  cash: string;
  equity: string;
  marketValue: string;
  benchmarkEquity: string;
  drawdown: string;
  cashWeightPercent: string | null;
  // Arrays use the canonical symbol order of SharedPoolResult.assets.
  weightsPercent: (string | null)[];
  contributions: string[];
}
export interface PoolAllocation {
  barIndex: number;
  openEquity: string;
  cashBeforeBuys: string;
  reserve: string;
  capacity: string;
  requested: string;
  approved: string;
  spent: string;
  cashAfterBuys: string;
}
export interface RebalanceRecord {
  barIndex: number;
  barOpenUtcMs: number;
  // Each vector contains canonical assets followed by the shared cash weight.
  beforePercent: (string | null)[];
  afterPercent: (string | null)[];
  deviationPercent: (string | null)[];
}
export interface SharedPoolResult {
  version: (typeof SHARED_POOL_VERSIONS)[SharedPoolInput['mode']];
  executionVersion: typeof SHARED_EXECUTION_VERSION;
  conversionVersion: string;
  mode: SharedPoolInput['mode'];
  assumptions: readonly string[];
  alignment: AlignmentPreview;
  initialCash: string;
  cashWeightPercent: string;
  assets: {
    symbol: string;
    weightPercent: string;
    strategyVersion: string | null;
    quantity: string;
    marketValue: string;
    netPnl: string;
    buySpend: string;
    sellProceeds: string;
    fees: string;
  }[];
  orders: PoolOrder[];
  allocations: PoolAllocation[];
  decisions: PoolDecision[];
  rebalances: RebalanceRecord[];
  curve: PoolPoint[];
  netPnl: string;
  fees: string;
  fillCount: number;
  totalReturn: string;
  maxDrawdown: string;
  benchmarkReturn: string;
  benchmarkReasons: { symbol: string; reason: string }[];
}
