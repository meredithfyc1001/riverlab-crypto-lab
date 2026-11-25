import type { Dataset } from '../data/dataset';
import type { BacktestConfig } from '../backtests';
import type { RegimeParams, RegimeSummary } from '../market-regime/model';
import type { RiskConfig } from '../risk';
import type { RuleRecord } from '../rule-library';
import type { StrategyRuleV1 } from '../strategies';
import type { Evaluation, WindowSpec } from '../research';

export type ParameterField =
  'period' | 'threshold' | 'lookback' | 'fastPeriod' | 'slowPeriod';
export interface ParameterTarget {
  side: 'buy' | 'sell';
  condition: number;
  field: ParameterField;
}
export interface ParameterAxis extends ParameterTarget {
  min: number;
  max: number;
  step: number;
}
export type SortMetric =
  'totalReturn' | 'maxDrawdown' | 'profitFactor' | 'completedTrades';
export interface AdvancedInput {
  dataset: Dataset;
  ruleRecord: RuleRecord;
  completedThroughUtcMs: number;
  config: BacktestConfig;
  risk: RiskConfig;
  axes: ParameterAxis[];
  search: { kind: 'grid' } | { kind: 'random'; seed: number; count: number };
  filters: {
    minReturn: string | null;
    maxDrawdown: string | null;
    minProfitFactor: string | null;
    minTrades: number;
  };
  sort: SortMetric[];
  evaluation: Exclude<Evaluation, { kind: 'full' }>;
  regime: RegimeParams;
}
export interface Candidate {
  id: number;
  values: number[];
  warmupBars: number;
  rule: StrategyRuleV1;
}
export interface AdvancedPlan {
  candidates: Candidate[];
  invalid: { values: number[]; reason: string }[];
  combinations: number;
  windows: WindowSpec[];
  trailingBars: number;
  runs: number;
  bars: number;
}
export interface CandidateMetrics {
  totalReturn: string | null;
  maxDrawdown: string | null;
  profitFactor: string | null;
  completedTrades: number;
  netPnl: string;
  finalEquity: string;
}
export interface CandidateRow {
  candidateId: number;
  window: WindowSpec;
  startUtcMs: number;
  endUtcMs: number;
  metrics: CandidateMetrics | null;
  runHash: string | null;
  reasons: string[];
  regimes: RegimeSummary[] | null;
}
export interface AdvancedFold {
  train: CandidateRow[];
  selectedId: number | null;
  test: CandidateRow | null;
}
export interface AdvancedResult {
  plan: AdvancedPlan;
  folds: AdvancedFold[];
}
