import type {
  ParameterTarget,
  SortMetric,
} from '../../core/advanced-research/types';
import type { RuleRecord } from '../../core/rule-library';

export const metricNames: Record<SortMetric, string> = {
  totalReturn: '收益率',
  maxDrawdown: '最大回撤',
  profitFactor: '利润因子',
  completedTrades: '完成交易数',
};
export function axisLabel(axis: ParameterTarget, record: RuleRecord) {
  const fields = {
    period: '周期',
    threshold: '阈值',
    fastPeriod: '快线周期',
    slowPeriod: '慢线周期',
    lookback: '回看周期',
  };
  const condition = record.rule[axis.side].conditions[axis.condition];
  const indicator =
    'average' in condition
      ? condition.average
      : condition.kind === 'rsi'
        ? 'RSI'
        : '突破';
  return `${axis.side === 'buy' ? '买入' : '卖出'}条件${axis.condition + 1} · ${indicator} ${fields[axis.field]}`;
}
export const percent = (value: string | null | undefined) =>
  value == null
    ? 'NA'
    : (Number(value) * 100).toLocaleString('zh-CN', {
        maximumFractionDigits: 5,
      }) + '%';
