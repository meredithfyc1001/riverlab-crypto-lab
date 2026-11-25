import {
  alignPortfolioSources,
  assetStrategy,
  executionConfig,
  requireFields,
} from '../portfolio/alignment';
import { parseDecimal, SCALE } from '../math';
import { createStrategy } from '../strategies';
import type { Strategy } from '../strategies';
import { normalizeRisk } from '../risk';
import type { RiskConfig, Protection } from '../risk';
import type { BacktestConfig } from '../backtests/types';
import type { Candle } from '../data';
import type { SharedPoolInput } from './types';

export const HUNDRED = 100n * SCALE;
export interface AssetState {
  symbol: string;
  bars: Candle[];
  strategy: Strategy | null;
  risk: RiskConfig;
  protection?: Protection;
  weight: bigint;
  config: BacktestConfig;
  quantity: bigint;
  purchased: bigint;
  sold: bigint;
  buySpend: bigint;
  sellProceeds: bigint;
  fees: bigint;
}

export function prepareSharedPool(input: SharedPoolInput) {
  const common = [
    'mode',
    'assets',
    'initialCash',
    'quoteCurrency',
    'startUtcMs',
    'endUtcMs',
    'rangeConfirmed',
    'completedThroughUtcMs',
  ];
  if (input?.mode === 'rebalance') {
    requireFields(input, [...common, 'cashWeightPercent', 'rebalanceEvery']);
    if (
      !Number.isSafeInteger(input.rebalanceEvery) ||
      input.rebalanceEvery <= 0
    )
      throw new Error('再平衡周期必须为正整数。');
  } else {
    if (input?.mode !== 'shared-strategy')
      throw new Error('共享组合模式不支持。');
    requireFields(input, common);
  }
  const initial = parseDecimal(input.initialCash);
  if (!initial) throw new Error('组合本金必须大于零。');
  const alignment = alignPortfolioSources(input);
  const assets: AssetState[] = input.assets.map((asset, i) => {
    const cover = alignment.assets[i];
    if (
      cover.sourceEndUtcMs + alignment.intervalMs >
      input.completedThroughUtcMs
    )
      throw new Error(cover.symbol + ' 原始快照含未完成收盘的 K 线。');
    const strategyAsset =
      input.mode === 'shared-strategy' ? input.assets[i] : null;
    const fields = ['dataset', 'weightPercent', 'costs'];
    requireFields(
      asset,
      strategyAsset ? [...fields, 'strategy', 'risk'] : fields,
      strategyAsset ? ['ruleRecord'] : [],
    );
    const strategy = strategyAsset
      ? createStrategy(
          assetStrategy(strategyAsset, cover.symbol),
          alignment.intervalMs,
        )
      : null;
    const bars = asset.dataset.candles.slice(
      cover.beforeCount,
      asset.dataset.candles.length - cover.afterCount,
    );
    for (const bar of bars) {
      for (const price of [bar.open, bar.high, bar.low, bar.close])
        if (parseDecimal(String(price)) === 0n)
          throw new Error('K 线价格过小。');
    }
    return {
      symbol: cover.symbol,
      bars,
      strategy,
      risk: strategyAsset ? normalizeRisk(strategyAsset.risk) : {},
      weight: parseDecimal(asset.weightPercent),
      config: executionConfig(asset.costs, input.initialCash),
      quantity: 0n,
      purchased: 0n,
      sold: 0n,
      buySpend: 0n,
      sellProceeds: 0n,
      fees: 0n,
    };
  });
  const bySymbol = (a: { symbol: string }, b: { symbol: string }) =>
    a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0;
  assets.sort(bySymbol);
  alignment.assets.sort(bySymbol);
  const assetWeight = assets.reduce((sum, asset) => sum + asset.weight, 0n);
  const cashWeight =
    input.mode === 'rebalance'
      ? parseDecimal(input.cashWeightPercent)
      : HUNDRED - assetWeight;
  if (cashWeight < 0n || assetWeight + cashWeight !== HUNDRED)
    throw new Error(
      '资产与现金目标权重必须合计 100%，策略预算总和不得超过 100%。',
    );
  return { assets, alignment, initial, cashWeight };
}
