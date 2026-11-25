import { CONVERSION_VERSION } from '../backtests';
import { executeAtReference } from '../backtests/execution';
import { decimal, parseDecimal } from '../math';
import { fraction } from '../statistics';
import type { StrategyDecision } from '../strategies';
import { checked, mark, PoolLedger } from './ledger';
import { HUNDRED, prepareSharedPool } from './prepare';
import type { AssetState } from './prepare';
import { executeBarOrders, valuesAt, weightVector } from './trading';
import { SHARED_POOL_VERSIONS, SHARED_EXECUTION_VERSION } from './types';
import type {
  PoolAllocation,
  PoolDecision,
  PoolPoint,
  RebalanceRecord,
  SharedPoolInput,
  SharedPoolResult,
} from './types';

export * from './types';
const assumptions = [
  '模拟现货与共享虚拟现金，每笔市价单按已知引用价和配置的成本成交，忽略成交量、真实流动性和盘口冲击。',
  '收盘决策、下一根开盘执行。先执行保护和卖出，同一开盘卖款视为立即到账，可用于本轮买入。根内卖款只能用于后续开盘。',
  '开盘减仓后统一估值；预留目标现金，按申请额同比批准，18 位尾差按规范交易对 ASCII 顺序补足。费用纳入预算，数量向下取整，不再次分配余款。',
  '入场前按实际模拟成交价计算保护阈值；止损价舍入为零时拒绝买入，批准的预算保留为现金。',
  '开盘保护优先，根内双触发时止损优先，触发后应用卖出成本。根内确切成交时间未知。再平衡只按周期指令执行。',
  '买入持有在共同区间首开盘按初始目标配置买入一次，扣相同买入费、滑点、数量精度及最小额，拒单留现金；末收盘估值，无卖出费用。',
  '收盘权益与组合初始本金锚点计算最大回撤。资产贡献等于买入总支出的负值加净卖出收入及收盘市值。权重以百分数表示，收益与回撤为小数比例。',
] as const;

function buyAndHold(assets: AssetState[], initial: bigint) {
  let cash = initial;
  const reasons: SharedPoolResult['benchmarkReasons'] = [];
  const quantities = assets.map((asset) => {
    if (asset.weight === 0n) return 0n;
    const budget = (initial * asset.weight) / HUNDRED;
    const fill = executeAtReference(
      { cash: budget, quantity: 0n },
      parseDecimal(String(asset.bars[0].open)),
      { side: 'buy', quantity: 'all' },
      asset.config,
    );
    if ('rejected' in fill) {
      reasons.push({ symbol: asset.symbol, reason: fill.rejected });
      return 0n;
    }
    cash -= fill.notional + fill.fee;
    return fill.quantity;
  });
  return { cash: checked(cash), quantities, reasons };
}

export function runSharedPool(input: SharedPoolInput): SharedPoolResult {
  const { assets, alignment, initial, cashWeight } = prepareSharedPool(input);
  const ledger = new PoolLedger(initial, assets);
  const benchmark = buyAndHold(assets, initial);
  const allocations: PoolAllocation[] = [];
  const decisions: PoolDecision[] = [];
  const rebalances: RebalanceRecord[] = [];
  const zeros = assets.map(() => '0');
  const curve: PoolPoint[] = [
    {
      timestampUtcMs: alignment.startUtcMs,
      cash: decimal(initial),
      equity: decimal(initial),
      marketValue: '0',
      benchmarkEquity: decimal(initial),
      drawdown: '0',
      cashWeightPercent: '100',
      weightsPercent: [...zeros],
      contributions: [...zeros],
    },
  ];
  let peak = initial,
    maxDrop = 0n,
    worstPeak = initial,
    equity = initial,
    benchmarkEquity = initial;
  let pending: (StrategyDecision | null)[] = assets.map(() => null);
  let rebalance = false;
  let marketValues = assets.map(() => 0n);
  for (let barIndex = 0; barIndex < alignment.barCount; barIndex++) {
    const barOpenUtcMs = alignment.startUtcMs + barIndex * alignment.intervalMs;
    const closeUtcMs = barOpenUtcMs + alignment.intervalMs;
    const opens = assets.map((a) =>
      parseDecimal(String(a.bars[barIndex].open)),
    );
    executeBarOrders(
      ledger,
      assets,
      { barIndex, barOpenUtcMs, closeUtcMs, opens },
      cashWeight,
      pending,
      rebalance,
      allocations,
      rebalances,
    );

    const closes = assets.map((a) =>
      parseDecimal(String(a.bars[barIndex].close)),
    );
    marketValues = valuesAt(assets, closes);
    const marketValue = checked(marketValues.reduce((a, b) => a + b, 0n));
    equity = checked(ledger.cash + marketValue);
    const contributions = assets.map(
      (a, i) => a.sellProceeds - a.buySpend + marketValues[i],
    );
    if (contributions.reduce((a, b) => a + b, 0n) !== equity - initial)
      throw new Error('资产净贡献合计与组合净盈亏不一致。');
    benchmarkEquity = checked(
      benchmark.quantities.reduce(
        (v, qty, i) => v + mark(qty, closes[i]),
        benchmark.cash,
      ),
    );
    if (equity > peak) peak = equity;
    const drop = peak - equity;
    if (drop * worstPeak > maxDrop * peak) {
      maxDrop = drop;
      worstPeak = peak;
    }
    const weights = weightVector(marketValues, ledger.cash);
    curve.push({
      timestampUtcMs: closeUtcMs,
      cash: decimal(ledger.cash),
      equity: decimal(equity),
      marketValue: decimal(marketValue),
      benchmarkEquity: decimal(benchmarkEquity),
      drawdown: fraction(drop, peak),
      cashWeightPercent: weights[assets.length],
      weightsPercent: weights.slice(0, assets.length),
      contributions: contributions.map(decimal),
    });

    if (input.mode === 'rebalance') {
      rebalance = (barIndex + 1) % input.rebalanceEvery === 0;
      if (rebalance)
        decisions.push({
          barIndex,
          closeUtcMs,
          symbol: null,
          action: 'rebalance',
          reason: 'period-complete',
        });
    } else {
      pending = assets.map((asset) => {
        const signal = asset.strategy!.onClose(asset.bars[barIndex]);
        decisions.push({
          barIndex,
          closeUtcMs,
          symbol: asset.symbol,
          ...signal,
        });
        return signal;
      });
    }
  }
  return {
    version: SHARED_POOL_VERSIONS[input.mode],
    executionVersion: SHARED_EXECUTION_VERSION,
    conversionVersion: CONVERSION_VERSION,
    mode: input.mode,
    assumptions,
    alignment,
    initialCash: decimal(initial),
    cashWeightPercent: decimal(cashWeight),
    assets: assets.map((a, i) => ({
      symbol: a.symbol,
      weightPercent: decimal(a.weight),
      quantity: decimal(a.quantity),
      marketValue: decimal(marketValues[i]),
      strategyVersion: a.strategy?.version ?? null,
      netPnl: decimal(a.sellProceeds - a.buySpend + marketValues[i]),
      buySpend: decimal(a.buySpend),
      sellProceeds: decimal(a.sellProceeds),
      fees: decimal(a.fees),
    })),
    orders: ledger.orders,
    allocations,
    decisions,
    rebalances,
    curve,
    netPnl: decimal(equity - initial),
    fees: decimal(ledger.fees),
    fillCount: ledger.fillCount,
    totalReturn: fraction(equity - initial, initial),
    maxDrawdown: fraction(maxDrop, worstPeak),
    benchmarkReturn: fraction(benchmarkEquity - initial, initial),
    benchmarkReasons: benchmark.reasons,
  };
}
