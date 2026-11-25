import { executeAtReference } from '../backtests/execution';
import { ACCOUNTING_LIMIT, BPS, SCALE, ceilDiv, decimal } from '../math';
import { entryProtection } from '../risk';
import type { Protection, RiskTrigger } from '../risk';
import type { PoolOrder } from './types';
import type { AssetState } from './prepare';

export function checked(n: bigint) {
  if (n < 0n || n >= ACCOUNTING_LIMIT)
    throw new Error('共享账本超出非负且小于 10^78 的范围。');
  return n;
}
export const mark = (qty: bigint, price: bigint) =>
  checked((qty * price) / SCALE);

interface OrderSpec {
  barIndex: number;
  barOpenUtcMs: number;
  phase: PoolOrder['phase'];
  reason: string;
  side: PoolOrder['side'];
  reference: bigint;
  quantity: bigint | 'all';
  rejection?: NonNullable<PoolOrder['rejection']>;
  requested?: bigint;
  approved?: bigint;
  trigger?: RiskTrigger;
}

export class PoolLedger {
  cash: bigint;
  fees = 0n;
  fillCount = 0;
  readonly orders: PoolOrder[] = [];
  // At most one order per bar, symbol and execution phase.
  private readonly seen = new Set<string>();

  constructor(
    readonly initial: bigint,
    private readonly assets: AssetState[],
  ) {
    this.cash = initial;
  }

  execute(asset: AssetState, order: OrderSpec) {
    const { barIndex, barOpenUtcMs, phase, side, reason, reference, trigger } =
      order;
    const id = [barIndex, asset.symbol, phase].join('/');
    if (this.seen.has(id)) throw new Error('检测到重复订单。');
    this.seen.add(id);
    const cashBefore = this.cash;
    const quantityBefore = asset.quantity;
    const buy = side === 'buy';
    let execution = order.rejection
      ? { rejected: order.rejection }
      : executeAtReference(
          { cash: order.approved ?? cashBefore, quantity: quantityBefore },
          reference,
          { side, quantity: order.quantity },
          asset.config,
        );
    let protection: Protection | null = null;
    if (
      buy &&
      !('rejected' in execution) &&
      (asset.risk.stopLossBps || asset.risk.takeProfitBps)
    ) {
      protection = entryProtection(execution.price, asset.risk);
      if (!protection) execution = { rejected: 'stop-price-underflow' };
    }
    const fill = 'rejected' in execution ? null : execution;
    const spent = buy && fill ? fill.notional + fill.fee : 0n;
    if (fill) {
      const expectedPrice = buy
        ? ceilDiv(reference * (BPS + BigInt(asset.config.buySlippageBps)), BPS)
        : (reference * (BPS - BigInt(asset.config.sellSlippageBps))) / BPS;
      const step = 10n ** BigInt(18 - asset.config.quantityDecimals);
      const expectedFee = ceilDiv(
        fill.notional * BigInt(asset.config.feeBps),
        BPS,
      );
      const expectedNotional = buy
        ? ceilDiv(fill.price * fill.quantity, SCALE)
        : (fill.price * fill.quantity) / SCALE;
      if (
        fill.price !== expectedPrice ||
        fill.quantity % step !== 0n ||
        fill.fee !== expectedFee ||
        fill.notional !== expectedNotional ||
        fill.quantity <= 0n ||
        (buy &&
          (order.approved === undefined ||
            spent > order.approved ||
            spent > cashBefore))
      )
        throw new Error('成交费用、数量、名义额或批准预算未能对账。');
      if (buy) {
        this.cash -= spent;
        asset.quantity += fill.quantity;
        asset.purchased += fill.quantity;
        asset.buySpend += spent;
        if (protection) asset.protection = protection;
      } else {
        const proceeds = fill.notional - fill.fee;
        this.cash += proceeds;
        asset.quantity -= fill.quantity;
        asset.sold += fill.quantity;
        asset.sellProceeds += proceeds;
      }
      this.fees += fill.fee;
      asset.fees += fill.fee;
      this.fillCount++;
      checked(this.cash);
      checked(asset.quantity);
      const cashAudit = this.assets.reduce(
        (sum, a) => sum + a.sellProceeds - a.buySpend,
        this.initial,
      );
      const feeAudit = this.assets.reduce((sum, a) => sum + a.fees, 0n);
      if (
        asset.quantity !== asset.purchased - asset.sold ||
        this.cash !== cashAudit ||
        this.fees !== feeAudit
      )
        throw new Error('共享现金、持仓或费用不守恒。');
    }
    this.orders.push({
      sequence: this.orders.length + 1,
      barIndex,
      barOpenUtcMs,
      symbol: asset.symbol,
      phase,
      side,
      reason,
      status: fill ? 'filled' : 'rejected',
      rejection: 'rejected' in execution ? execution.rejected : null,
      ...(trigger ? { trigger } : {}),
      referencePrice: decimal(reference),
      requestedBudget:
        order.requested === undefined ? null : decimal(order.requested),
      approvedBudget:
        order.approved === undefined ? null : decimal(order.approved),
      unusedBudget:
        order.approved === undefined ? null : decimal(order.approved - spent),
      price: fill ? decimal(fill.price) : null,
      quantity: decimal(fill?.quantity ?? 0n),
      notional: decimal(fill?.notional ?? 0n),
      fee: decimal(fill?.fee ?? 0n),
      cashBefore: decimal(cashBefore),
      cashAfter: decimal(this.cash),
      quantityBefore: decimal(quantityBefore),
      quantityAfter: decimal(asset.quantity),
    });
    return fill;
  }
}
