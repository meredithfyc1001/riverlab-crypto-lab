import { decimal, parseDecimal, readUnits, SCALE } from '../math';
import { triggerAtOpen, triggerIntrabar } from '../risk';
import type { RiskTrigger } from '../risk';
import type { StrategyDecision } from '../strategies';
import { checked, mark, PoolLedger } from './ledger';
import { HUNDRED } from './prepare';
import type { AssetState } from './prepare';
import type { PoolAllocation, PoolOrder, RebalanceRecord } from './types';

const sum = (amounts: bigint[]) =>
  amounts.reduce((total, amount) => total + amount, 0n);
const positive = (n: bigint) => (n > 0n ? n : 0n);
export function valuesAt(assets: AssetState[], prices: bigint[]) {
  return assets.map((asset, i) => mark(asset.quantity, prices[i]));
}
export function weightVector(values: bigint[], cash: bigint) {
  const equity = checked(cash + sum(values));
  return [...values, cash].map((value) =>
    equity ? decimal((value * HUNDRED) / equity) : null,
  );
}

/** Requests are already in canonical symbol order. Never reallocate rejected purchases. */
export function approveBudgets(requests: bigint[], capacity: bigint) {
  const total = sum(requests);
  if (total <= capacity) return [...requests];
  const approvals = requests.map((amount) => (amount * capacity) / total);
  let dust = capacity - sum(approvals);
  for (let i = 0; dust && i < requests.length; i++) {
    if (approvals[i] < requests[i]) {
      approvals[i]++;
      dust--;
    }
  }
  if (dust) throw new Error('资金预算尾差不守恒。');
  return approvals;
}

interface Round {
  barIndex: number;
  barOpenUtcMs: number;
  closeUtcMs: number;
  opens: bigint[];
}
function exit(
  ledger: PoolLedger,
  asset: AssetState,
  clock: Round,
  phase: PoolOrder['phase'],
  trigger: RiskTrigger,
) {
  const fill = ledger.execute(asset, {
    barIndex: clock.barIndex,
    barOpenUtcMs: clock.barOpenUtcMs,
    phase,
    side: 'sell',
    reason: trigger.kind,
    reference: readUnits(trigger.referencePrice),
    quantity: 'all',
    trigger,
  });
  if (fill) asset.protection = undefined;
}
export function executeBarOrders(
  ledger: PoolLedger,
  assets: AssetState[],
  clock: Round,
  cashWeight: bigint,
  pending: (StrategyDecision | null)[],
  rebalance: boolean,
  allocations: PoolAllocation[],
  rebalances: RebalanceRecord[],
) {
  const { barIndex, barOpenUtcMs, closeUtcMs, opens } = clock;
  const before = valuesAt(assets, opens);
  const openingEquity = checked(ledger.cash + sum(before));
  const beforePercent = rebalance ? weightVector(before, ledger.cash) : [];
  const protectedAtOpen = assets.map((asset, i) => {
    const trigger =
      asset.protection &&
      triggerAtOpen(asset.protection, opens[i], barOpenUtcMs, closeUtcMs);
    if (trigger) exit(ledger, asset, clock, 'protection-open', trigger);
    return !!trigger;
  });

  for (const [i, asset] of assets.entries()) {
    const target = (openingEquity * asset.weight) / HUNDRED;
    const reduction = before[i] - target;
    const signal = pending[i];
    if (rebalance ? reduction <= 0n : signal?.action !== 'sell') continue;
    const fill = ledger.execute(asset, {
      barIndex,
      barOpenUtcMs,
      phase: 'sell',
      side: 'sell',
      reason: rebalance ? 'rebalance' : signal!.reason,
      reference: opens[i],
      quantity: rebalance ? (reduction * SCALE) / opens[i] : 'all',
      rejection: protectedAtOpen[i]
        ? 'risk-priority'
        : asset.quantity === 0n
          ? 'position-already-flat'
          : undefined,
    });
    if (fill && asset.quantity === 0n) asset.protection = undefined;
  }

  const market = valuesAt(assets, opens);
  const cashBeforeBuys = ledger.cash;
  const openEquity = checked(cashBeforeBuys + sum(market));
  const reserve = (openEquity * cashWeight) / HUNDRED;
  const capacity = positive(cashBeforeBuys - reserve);
  const candidates = assets.map((asset, i) => {
    const deficit = positive((openEquity * asset.weight) / HUNDRED - market[i]);
    if (rebalance) return { active: deficit > 0n, request: deficit };
    const active = pending[i]?.action === 'buy';
    const blocked = protectedAtOpen[i]
      ? ('risk-priority' as const)
      : asset.quantity
        ? ('position-already-open' as const)
        : undefined;
    return { active, request: active && !blocked ? deficit : 0n, blocked };
  });
  const requests = candidates.map((c) => c.request);
  const approved = approveBudgets(requests, capacity);
  for (const [i, asset] of assets.entries()) {
    const candidate = candidates[i];
    if (!candidate.active) continue;
    let rejection: PoolOrder['rejection'] = candidate.blocked ?? null;
    if (!rejection && candidate.request > 0n && approved[i] === 0n)
      rejection =
        reserve > 0n && capacity === 0n && cashBeforeBuys > 0n
          ? 'cash-reserve'
          : 'insufficient-cash';
    ledger.execute(asset, {
      barIndex,
      barOpenUtcMs,
      phase: 'buy',
      reason: rebalance ? 'rebalance' : pending[i]!.reason,
      side: 'buy',
      reference: opens[i],
      quantity: 'all',
      approved: approved[i],
      requested: candidate.request,
      rejection: rejection ?? undefined,
    });
  }
  const spent = cashBeforeBuys - ledger.cash;
  if (spent > capacity || spent > sum(approved))
    throw new Error('共享买入超出可用现金或批准预算。');
  if (rebalance || candidates.some((c) => c.active))
    allocations.push({
      barIndex,
      openEquity: decimal(openEquity),
      cashBeforeBuys: decimal(cashBeforeBuys),
      reserve: decimal(reserve),
      capacity: decimal(capacity),
      requested: decimal(sum(requests)),
      approved: decimal(sum(approved)),
      spent: decimal(spent),
      cashAfterBuys: decimal(ledger.cash),
    });
  if (rebalance) {
    const afterPercent = weightVector(valuesAt(assets, opens), ledger.cash);
    const targets = [...assets.map((a) => a.weight), cashWeight];
    rebalances.push({
      barIndex,
      barOpenUtcMs,
      beforePercent,
      afterPercent,
      deviationPercent: afterPercent.map((p, i) =>
        p === null ? null : decimal(readUnits(p) - targets[i]),
      ),
    });
  }
  // New positions with an already-marketable stop use the known open. All
  // proceeds of this phase remain unavailable to the preceding allocation.
  for (const [i, asset] of assets.entries()) {
    if (!asset.protection || protectedAtOpen[i]) continue;
    const bar = asset.bars[barIndex];
    const trigger =
      triggerAtOpen(asset.protection, opens[i], barOpenUtcMs, closeUtcMs) ??
      triggerIntrabar(
        asset.protection,
        parseDecimal(String(bar.high)),
        parseDecimal(String(bar.low)),
        barOpenUtcMs,
        closeUtcMs,
      );
    if (trigger) exit(ledger, asset, clock, 'protection-after-buys', trigger);
  }
}
