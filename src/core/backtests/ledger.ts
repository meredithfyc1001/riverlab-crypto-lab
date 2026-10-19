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
  let previousWasOpenSignal = false;
  let previousSide: string | undefined;
  let sequence = 0;
  return (f) => {
    sequence++;
    const trigger = f.trigger;
    const intrabar = trigger?.phase === 'intrabar';
    if (
      !Number.isSafeInteger(f.candleIndex) ||
      f.candleIndex < 1 ||
      f.sequence !== sequence ||
      seen.has(f.orderId) ||
      f.candleIndex < previousIndex ||
      (f.candleIndex === previousIndex &&
        !(
          trigger &&
          previousWasOpenSignal &&
          (intrabar || previousSide === 'buy')
        )) ||
      !['buy', 'sell'].includes(f.side)
    )
      throw new Error('Ledger event order failed.');
    if (trigger) {
      if (
        f.orderId !== `risk-${f.candleIndex}` ||
        f.signalCandleIndex !== null ||
        f.side !== 'sell' ||
        !['open', 'intrabar'].includes(trigger.phase) ||
        !['stop-loss', 'take-profit'].includes(trigger.kind) ||
        f.reason !== trigger.kind ||
        trigger.referencePrice !== f.referencePrice ||
        !Number.isSafeInteger(trigger.barOpenUtcMs) ||
        !Number.isSafeInteger(trigger.barCloseUtcMs) ||
        trigger.barOpenUtcMs < 0 ||
        trigger.barCloseUtcMs <= trigger.barOpenUtcMs ||
        (intrabar
          ? f.timestampUtcMs !== null ||
            !['threshold-touch-order-unknown', 'ambiguous-stop-first'].includes(
              trigger.assumption,
            )
          : f.timestampUtcMs !== trigger.barOpenUtcMs ||
            trigger.assumption !== 'observed-open') ||
        (trigger.assumption === 'ambiguous-stop-first' &&
          trigger.kind !== 'stop-loss')
      )
        throw new Error('Ledger risk event failed.');
      const entry = readUnits(trigger.entryPrice);
      const stop =
        trigger.stopPrice === null ? null : readUnits(trigger.stopPrice);
      const take =
        trigger.takePrice === null ? null : readUnits(trigger.takePrice);
      const ref = readUnits(trigger.referencePrice);
      if (
        entry === 0n ||
        (stop !== null && (stop === 0n || stop >= entry)) ||
        (take !== null && take <= entry) ||
        (trigger.kind === 'stop-loss'
          ? stop === null || (intrabar ? ref !== stop : ref > stop)
          : take === null || ref !== take)
      )
        throw new Error('Ledger protection price failed.');
    } else if (
      f.orderId !== `order-${f.signalCandleIndex}` ||
      f.signalCandleIndex !== f.candleIndex - 1 ||
      !Number.isSafeInteger(f.timestampUtcMs) ||
      f.timestampUtcMs === null ||
      f.timestampUtcMs < 0
    )
      throw new Error('Ledger signal event failed.');
    const eventStart = trigger ? trigger.barOpenUtcMs : f.timestampUtcMs!;
    if (f.candleIndex > previousIndex && eventStart <= previousTime)
      throw new Error('Ledger event time failed.');
    seen.add(f.orderId);
    previousWasOpenSignal = !trigger;
    previousSide = f.side;
    previousIndex = f.candleIndex;
    // Intrabar time is unknown; its lower bound must still follow prior bars.
    previousTime = eventStart;
    const open = readUnits(f.referencePrice),
      price = readUnits(f.price),
      qty = readUnits(f.quantity);
    if (
      open === 0n ||
      qty === 0n ||
      (trigger && qty !== quantity) ||
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
