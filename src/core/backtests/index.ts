import type { ModuleBoundary } from '../../shared/module';

export const backtestsBoundary: ModuleBoundary = {
  id: 'backtests',
  label: '回测',
  responsibility: '确定性事件驱动、模拟成交与逐笔账本；不连接交易账户。',
};

export {
  runBacktest,
  createBacktestSession,
  ALGORITHM_VERSION,
  CONVERSION_VERSION,
  RUN_ASSUMPTIONS,
} from './engine';
export { DEFAULT_CONFIG, normalizeConfig } from './config';
export { assertLedger } from './ledger';
export type {
  BacktestConfig,
  Signal,
  SignalEvent,
  OrderIntent,
  OrderOutcome,
  Position,
  AccountSnapshot,
  SimulatedFill,
  LedgerTotals,
  CloseSnapshot,
  BacktestInput,
  RunManifest,
  BacktestResult,
} from './types';
