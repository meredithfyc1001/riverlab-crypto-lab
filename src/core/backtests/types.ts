import type { DataSource, QualitySnapshot, Dataset } from '../data/dataset';

export interface BacktestConfig {
  initialCash: string;
  feeBps: number;
  buySlippageBps: number;
  sellSlippageBps: number;
  quantityDecimals: number;
  minNotional: string;
}
/** Scripted test signals only; no strategy or future-data callback. */
export type Signal = {
  readonly candleIndex: number;
  readonly reason: string;
} & (
  | { readonly action: 'hold' }
  | { readonly action: 'buy' | 'sell'; readonly quantity: string | 'all' }
);
export interface SignalEvent {
  signal: Signal;
  generatedUtcMs: number;
}
export interface OrderIntent {
  id: string;
  side: 'buy' | 'sell';
  quantity: string | 'all';
  reason: string;
  signalCandleIndex: number;
  generatedUtcMs: number;
  targetCandleIndex: number;
}
export type RejectionReason =
  | 'price-underflow'
  | 'zero-quantity'
  | 'zero-notional'
  | 'below-min-notional'
  | 'insufficient-cash'
  | 'insufficient-position';
export interface OrderOutcome {
  intent: OrderIntent;
  status: 'filled' | 'rejected' | 'expired';
  reason?: RejectionReason | 'no-next-candle';
  resolvedUtcMs: number;
}
export interface Position {
  quantity: string;
}
export interface AccountSnapshot {
  cash: string;
  position: Position;
  markPrice: string;
  marketValue: string;
  equity: string;
}
export interface LedgerTotals {
  buyNotional: string;
  sellNotional: string;
  fees: string;
  buyQuantity: string;
  sellQuantity: string;
}
export interface SimulatedFill {
  sequence: number;
  orderId: string;
  side: 'buy' | 'sell';
  reason: string;
  signalCandleIndex: number;
  candleIndex: number;
  timestampUtcMs: number;
  referencePrice: string;
  price: string;
  quantity: string;
  notional: string;
  fee: string;
  before: AccountSnapshot;
  after: AccountSnapshot;
  delta: { cash: string; quantity: string; equity: string };
  totals: LedgerTotals;
}
export interface CloseSnapshot {
  candleIndex: number;
  timestampUtcMs: number;
  account: AccountSnapshot;
}
export interface BacktestInput {
  dataset: Dataset;
  /** Explicit caller declaration: every supplied candle must be completed. */
  completedThroughUtcMs: number;
  signals: readonly Signal[];
  config?: Partial<BacktestConfig>;
}
export interface RunManifest {
  algorithmVersion: string;
  conversionVersion: string;
  dataHash: string;
  signalHash: string;
  runHash: string;
  sourceFileSha256: string;
  source: DataSource;
  quality: QualitySnapshot;
  symbol: string;
  intervalMs: number;
  completedThroughUtcMs: number;
  config: BacktestConfig;
  signals: Signal[];
  assumptions: readonly string[];
}
export interface BacktestResult {
  manifest: RunManifest;
  signals: SignalEvent[];
  orders: OrderOutcome[];
  fills: SimulatedFill[];
  closes: CloseSnapshot[];
  final: AccountSnapshot;
}
