import type { ModuleBoundary } from '../../shared/module';

export const strategiesBoundary: ModuleBoundary = {
  id: 'strategies',
  label: '策略',
  responsibility: '策略版本、参数与信号生成；不负责模拟成交或 UI。',
};

export { createStrategy, normalizeStrategy, STRATEGY_VERSION } from './engine';
export type {
  Strategy,
  StrategyInput,
  StrategyConfig,
  StrategyDecision,
} from './engine';

export {
  normalizeRule,
  defaultRule,
  explainCondition,
  RULE_STRATEGY_VERSION,
} from './rules';
export type {
  StrategyRuleV1,
  RuleCondition,
  RuleGroup,
  Comparison,
} from './rules';
