import type { BacktestResult, SimulatedFill } from '../backtests';
import { decimal, readUnits } from '../math';
import type { PortfolioResult } from '../portfolio';
import type { SharedPoolResult } from '../shared-pool/types';
import { allocateSaleCost, type Statistics } from '../statistics';
import type { RegimeLedgerBar } from './model';

type Fill = Pick<
  SimulatedFill,
  'side' | 'quantity' | 'notional' | 'fee' | 'trigger'
>;
type Mark = { timestampUtcMs: number; equity: string; marketValue: string };

// Traverse each asset's original fill sequence once. Pool cash remains shared.
// Only cost basis and quantity are tracked here; no orders are generated.
function ledgerAttribution(marks: readonly Mark[]) {
  const changes = marks.map(() => ({
    fills: 0,
    fees: 0n,
    realized: 0n,
    cost: 0n,
    openPositions: 0,
    intrabar: false,
  }));
  const holdings = new Map<string, { quantity: bigint; cost: bigint }>();
  let fees = 0n,
    fills = 0;

  function apply(symbol: string, index: number, fill: Fill) {
    const bar = changes[index];
    const holding = holdings.get(symbol) ?? { quantity: 0n, cost: 0n };
    const quantity = readUnits(fill.quantity);
    const notional = readUnits(fill.notional);
    const fee = readUnits(fill.fee);
    const oldCost = holding.cost;
    const oldQuantity = holding.quantity;
    if (fill.side === 'buy') {
      holding.quantity += quantity;
      holding.cost += notional + fee;
    } else {
      const allocated = allocateSaleCost(oldCost, oldQuantity, quantity);
      holding.quantity -= quantity;
      holding.cost -= allocated;
      bar.realized += notional - fee - allocated;
    }
    bar.openPositions +=
      Number(holding.quantity > 0n) - Number(oldQuantity > 0n);
    bar.intrabar ||= fill.side === 'buy' || fill.trigger?.phase === 'intrabar';
    bar.cost += holding.cost - oldCost;
    bar.fees += fee;
    bar.fills++;
    fees += fee;
    fills++;
    holdings.set(symbol, holding);
  }

  function finish(
    expectedFees: string,
    expectedFills: number,
    statistics?: readonly Statistics[],
  ): RegimeLedgerBar[] {
    if (decimal(fees) !== expectedFees || fills !== expectedFills)
      throw new Error('成交次数或费用与原实验不一致。');
    let previousMarket = 0n,
      positions = 0,
      realized = 0n,
      unrealized = 0n;
    const bars = marks.map((point, i) => {
      const bar = changes[i];
      const market = readUnits(point.marketValue);
      const unrealizedDelta = market - previousMarket - bar.cost;
      previousMarket = market;
      positions += bar.openPositions;
      realized += bar.realized;
      unrealized += unrealizedDelta;
      return {
        closeUtcMs: point.timestampUtcMs,
        equity: point.equity,
        realizedDelta: decimal(bar.realized),
        unrealizedDelta: decimal(unrealizedDelta),
        fills: bar.fills,
        fees: decimal(bar.fees),
        exposed: positions > 0 || bar.intrabar,
      };
    });
    if (statistics) {
      const sum = (field: 'realizedPnl' | 'unrealizedPnl') =>
        statistics.reduce((total, s) => total + signed(s[field]), 0n);
      if (
        realized !== sum('realizedPnl') ||
        unrealized !== sum('unrealizedPnl')
      )
        throw new Error('已实现及浮动盈亏与原实验不一致。');
    }
    return bars;
  }
  return { apply, finish };
}

function signed(text: string) {
  return text.startsWith('-') ? -readUnits(text.slice(1)) : readUnits(text);
}

export function singleBars(result: BacktestResult, statistics: Statistics) {
  const ledger = ledgerAttribution(
    result.closes.map((c) => ({
      timestampUtcMs: c.timestampUtcMs,
      equity: c.account.equity,
      marketValue: c.account.marketValue,
    })),
  );
  for (const f of result.fills)
    ledger.apply(result.manifest.symbol, f.candleIndex, f);
  const bars = ledger.finish(statistics.fees, result.fills.length, [
    statistics,
  ]);
  if (
    bars.reduce(
      (ms, b) => ms + (b.exposed ? result.manifest.intervalMs : 0),
      0,
    ) !== statistics.exposedMs
  )
    throw new Error('持仓暴露与原实验不一致。');
  return bars;
}
export function portfolioBars(result: PortfolioResult) {
  const ledger = ledgerAttribution(result.curve.slice(1));
  for (const a of result.assets)
    for (const f of a.result.fills) ledger.apply(a.symbol, f.candleIndex, f);
  return ledger.finish(
    result.fees,
    result.fillCount,
    result.assets.map((a) => a.statistics),
  );
}
export function sharedBars(result: SharedPoolResult) {
  const ledger = ledgerAttribution(result.curve.slice(1));
  for (const f of result.orders)
    if (f.status === 'filled') ledger.apply(f.symbol, f.barIndex, f);
  return ledger.finish(result.fees, result.fillCount);
}
