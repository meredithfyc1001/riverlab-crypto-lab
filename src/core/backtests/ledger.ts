import {
  BPS,
  SCALE,
  ceilDiv,
  decimal,
  parseDecimal,
  readUnits,
  ACCOUNTING_LIMIT,
} from './decimal';
import { normalizeConfig } from './config';
import type { AccountSnapshot, BacktestConfig, SimulatedFill } from './types';

export interface Balance {
  cash: bigint;
  quantity: bigint;
}
export function snapshot(balance: Balance, markPrice: bigint): AccountSnapshot {
  const marketValue = (balance.quantity * markPrice) / SCALE;
  if (
    [
      balance.cash,
      balance.quantity,
      marketValue,
      balance.cash + marketValue,
    ].some((v) => v < 0n || v >= ACCOUNTING_LIMIT)
  )
    throw new Error(
      'Accounting range exceeded: nonnegative values below 1e78 required; run blocked.',
    );
  return {
    cash: decimal(balance.cash),
    position: { quantity: decimal(balance.quantity) },
    markPrice: decimal(markPrice),
    marketValue: decimal(marketValue),
    equity: decimal(balance.cash + marketValue),
  };
}
/** Reconcile persisted/returned fills without trusting their deltas, totals or snapshots. */
export function assertLedger(
  initialCash: string,
  fills: readonly SimulatedFill[],
  config: BacktestConfig,
): void {
  const audit = ledgerAuditor(initialCash, normalizeConfig(config));
  fills.forEach(audit);
}
/** Incremental audit avoids O(n²) when checking after every fill. */
export function ledgerAuditor(
  initialCash: string,
  config: BacktestConfig,
): (fill: SimulatedFill) => void {
  let cash = parseDecimal(initialCash),
    quantity = 0n;
  if (decimal(cash) !== config.initialCash)
    throw new Error('Ledger initial cash mismatch.');
  let buyNotional = 0n,
    sellNotional = 0n,
    fees = 0n,
    buyQuantity = 0n,
    sellQuantity = 0n;
  const seen = new Set<string>();
  const equal = (actual: unknown, expected: unknown) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw new Error('Ledger reconciliation failed.');
  };
  let previousIndex = -1;
  let previousTime = -1;
  let sequence = 0;
  return (f) => {
    sequence++;
    if (
      !Number.isSafeInteger(f.candleIndex) ||
      f.candleIndex < 1 ||
      !Number.isSafeInteger(f.timestampUtcMs) ||
      f.timestampUtcMs < 0 ||
      typeof f.orderId !== 'string' ||
      f.orderId !== `order-${f.signalCandleIndex}` ||
      f.sequence !== sequence ||
      seen.has(f.orderId) ||
      f.candleIndex <= previousIndex ||
      f.timestampUtcMs <= previousTime ||
      f.signalCandleIndex !== f.candleIndex - 1 ||
      !['buy', 'sell'].includes(f.side)
    )
      throw new Error('Ledger event order failed.');
    seen.add(f.orderId);
    previousIndex = f.candleIndex;
    previousTime = f.timestampUtcMs;
    const open = readUnits(f.referencePrice),
      price = readUnits(f.price),
      qty = readUnits(f.quantity);
    if (
      open === 0n ||
      qty === 0n ||
      qty % 10n ** BigInt(18 - config.quantityDecimals) !== 0n
    )
      throw new Error('Ledger price/quantity failed.');
    const expectedPrice =
      f.side === 'buy'
        ? ceilDiv(open * (BPS + BigInt(config.buySlippageBps)), BPS)
        : (open * (BPS - BigInt(config.sellSlippageBps))) / BPS;
    if (price !== expectedPrice || price === 0n)
      throw new Error('Ledger fill price failed.');
    const notional =
      f.side === 'buy' ? ceilDiv(price * qty, SCALE) : (price * qty) / SCALE;
    const fee = ceilDiv(notional * BigInt(config.feeBps), BPS);
    if (notional === 0n || notional < parseDecimal(config.minNotional))
      throw new Error('Ledger notional failed.');
    equal(f.notional, decimal(notional));
    equal(f.fee, decimal(fee));
    const before = snapshot({ cash, quantity }, open);
    const beforeEquity = cash + (quantity * open) / SCALE;
    equal(f.before, before);
    const sign = f.side === 'buy' ? 1n : -1n;
    cash -= sign * notional + fee;
    quantity += sign * qty;
    fees += fee;
    if (f.side === 'buy') {
      buyNotional += notional;
      buyQuantity += qty;
    } else {
      sellNotional += notional;
      sellQuantity += qty;
    }
    if (
      cash < 0n ||
      quantity < 0n ||
      cash !== parseDecimal(initialCash) - buyNotional + sellNotional - fees ||
      quantity !== buyQuantity - sellQuantity
    )
      throw new Error('Ledger conservation failed.');
    const after = snapshot({ cash, quantity }, open);
    equal(f.after, after);
    equal(f.delta, {
      cash: decimal(-sign * notional - fee),
      quantity: decimal(sign * qty),
      equity: decimal(cash + (quantity * open) / SCALE - beforeEquity),
    });
    equal(f.totals, {
      buyNotional: decimal(buyNotional),
      sellNotional: decimal(sellNotional),
      fees: decimal(fees),
      buyQuantity: decimal(buyQuantity),
      sellQuantity: decimal(sellQuantity),
    });
  };
}
