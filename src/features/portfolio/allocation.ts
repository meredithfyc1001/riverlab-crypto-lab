import { DEFAULT_CONFIG } from '../../core/backtests/config';
import type { DatasetSummary } from '../../core/data/dataset';
import type { RuleRecord } from '../../core/rule-library';
import type { StrategyInput } from '../../core/strategies';

export function newAllocation(key: number, weightPercent: string) {
  return {
    key,
    datasetId: '',
    weightPercent,
    kind: 'ma' as StrategyInput['kind'],
    ruleId: '',
    fastPeriod: '10',
    slowPeriod: '30',
    period: '14',
    lower: '30',
    upper: '70',
    lookback: '20',
    feeBps: String(DEFAULT_CONFIG.feeBps),
    buySlippageBps: String(DEFAULT_CONFIG.buySlippageBps),
    sellSlippageBps: String(DEFAULT_CONFIG.sellSlippageBps),
    quantityDecimals: String(DEFAULT_CONFIG.quantityDecimals),
    minNotional: DEFAULT_CONFIG.minNotional,
    stopLossBps: '',
    takeProfitBps: '',
  };
}
export type AllocationDraft = ReturnType<typeof newAllocation>;

const number = (value: string) => (value.trim() === '' ? NaN : Number(value));

export function buildTarget(row: AllocationDraft, dataset: DatasetSummary) {
  return {
    dataset,
    weightPercent: row.weightPercent,
    costs: {
      feeBps: number(row.feeBps),
      buySlippageBps: number(row.buySlippageBps),
      sellSlippageBps: number(row.sellSlippageBps),
      quantityDecimals: number(row.quantityDecimals),
      minNotional: row.minNotional,
    },
  };
}

export function buildAllocation(
  row: AllocationDraft,
  dataset: DatasetSummary,
  rules: RuleRecord[],
) {
  const ruleRecord =
    row.kind === 'rules' ? rules.find((r) => r.id === row.ruleId) : undefined;
  let strategy: StrategyInput;
  switch (row.kind) {
    case 'rules':
      if (!ruleRecord) throw new Error('请选择已保存的规则版本。');
      strategy = { kind: 'rules', rule: ruleRecord.rule };
      break;
    case 'ma':
      strategy = {
        kind: 'ma',
        fastPeriod: number(row.fastPeriod),
        slowPeriod: number(row.slowPeriod),
      };
      break;
    case 'rsi':
      strategy = {
        kind: 'rsi',
        period: number(row.period),
        lower: number(row.lower),
        upper: number(row.upper),
      };
      break;
    case 'breakout':
      strategy = { kind: 'breakout', lookback: number(row.lookback) };
      break;
  }
  return {
    ...buildTarget(row, dataset),
    strategy,
    ...(ruleRecord ? { ruleRecord } : {}),
    risk: {
      ...(row.stopLossBps ? { stopLossBps: number(row.stopLossBps) } : {}),
      ...(row.takeProfitBps
        ? { takeProfitBps: number(row.takeProfitBps) }
        : {}),
    },
  };
}
