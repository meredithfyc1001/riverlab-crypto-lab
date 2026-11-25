import { BPS, SCALE, ceilDiv, parseDecimal, ACCOUNTING_LIMIT } from './decimal';
import type { Balance } from './ledger';
import type { BacktestConfig, OrderIntent, RejectionReason } from './types';

export type Execution =
  | { rejected: RejectionReason }
  | { price: bigint; quantity: bigint; notional: bigint; fee: bigint };

/** Only the chosen reference quote enters execution, never HLC/volume. */
export function executeAtReference(
  balance: Balance,
  open: bigint,
  intent: OrderIntent | { side: OrderIntent['side']; quantity: bigint | 'all' },
  config: BacktestConfig,
): Execution {
  const buy = intent.side === 'buy';
  const price = buy
    ? ceilDiv(open * (BPS + BigInt(config.buySlippageBps)), BPS)
    : (open * (BPS - BigInt(config.sellSlippageBps))) / BPS;
  if (price === 0n) return { rejected: 'price-underflow' };
  const step = 10n ** BigInt(18 - config.quantityDecimals);
  const amounts = (quantity: bigint) => {
    const notional = buy
      ? ceilDiv(price * quantity, SCALE)
      : (price * quantity) / SCALE;
    return { notional, fee: ceilDiv(notional * BigInt(config.feeBps), BPS) };
  };
  let quantity: bigint;
  if (intent.quantity !== 'all') {
    // Computed portfolio reductions can exceed the external decimal-input limit.
    const requested =
      typeof intent.quantity === 'bigint'
        ? intent.quantity
        : parseDecimal(intent.quantity);
    if (requested < 0n) throw new Error('Negative order quantity.');
    quantity = (requested / step) * step;
  } else if (!buy) quantity = balance.quantity;
  else {
    // Search in integer quantity ticks. Includes fee rounding in affordability.
    let lo = 0n,
      hi = (balance.cash * SCALE) / price / step;
    while (lo < hi) {
      const mid = (lo + hi + 1n) / 2n;
      const { notional, fee } = amounts(mid * step);
      if (notional + fee <= balance.cash) lo = mid;
      else hi = mid - 1n;
    }
    quantity = lo * step;
  }
  if (quantity === 0n) return { rejected: 'zero-quantity' };
  if (quantity >= ACCOUNTING_LIMIT)
    throw new Error('Accounting quantity exceeds 1e78; run blocked.');
  const { notional, fee } = amounts(quantity);
  if (notional === 0n) return { rejected: 'zero-notional' };
  if (notional < parseDecimal(config.minNotional))
    return { rejected: 'below-min-notional' };
  if (buy && notional + fee > balance.cash)
    return { rejected: 'insufficient-cash' };
  if (!buy && quantity > balance.quantity)
    return { rejected: 'insufficient-position' };
  return { price, quantity, notional, fee };
}
