import { BPS, ceilDiv, decimal, readUnits } from '../math';

export interface RiskConfig {
  stopLossBps?: number;
  takeProfitBps?: number;
}
export interface Protection {
  entryPrice: string;
  stopPrice: string | null;
  takePrice: string | null;
}
export interface RiskTrigger extends Protection {
  phase: 'open' | 'intrabar';
  kind: 'stop-loss' | 'take-profit';
  assumption:
    'observed-open' | 'threshold-touch-order-unknown' | 'ambiguous-stop-first';
  barOpenUtcMs: number;
  barCloseUtcMs: number;
  referencePrice: string;
}
export function normalizeRisk(input: RiskConfig = {}): RiskConfig {
  if (
    !input ||
    Object.getPrototypeOf(input) !== Object.prototype ||
    Object.keys(input).some(
      (k) => !['stopLossBps', 'takeProfitBps'].includes(k),
    )
  )
    throw new Error('Invalid risk configuration.');
  const result: RiskConfig = {};
  for (const key of ['stopLossBps', 'takeProfitBps'] as const) {
    if (!Object.hasOwn(input, key)) continue;
    const n = input[key];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 9999)
      throw new Error(
        'Protection basis points require integers in 1..9999; omit to disable.',
      );
    result[key] = n;
  }
  return result;
}
export function protectionFor(entry: bigint, config: RiskConfig): Protection {
  config = normalizeRisk(config);
  if (entry <= 0n) throw new Error('Positive entry price required.');
  const stop =
    config.stopLossBps === undefined
      ? null
      : (entry * (BPS - BigInt(config.stopLossBps))) / BPS;
  const take =
    config.takeProfitBps === undefined
      ? null
      : ceilDiv(entry * (BPS + BigInt(config.takeProfitBps)), BPS);
  if (stop === 0n) throw new Error('Stop price underflow; run blocked.');
  return {
    entryPrice: decimal(entry),
    stopPrice: stop === null ? null : decimal(stop),
    takePrice: take === null ? null : decimal(take),
  };
}
/** Open phase intentionally accepts no HLC/volume. Intrabar order is never inferred. */
export function triggerAtOpen(
  protection: Protection,
  open: bigint,
  barOpenUtcMs: number,
  barCloseUtcMs: number,
): RiskTrigger | undefined {
  const stop =
      protection.stopPrice === null ? null : readUnits(protection.stopPrice),
    take =
      protection.takePrice === null ? null : readUnits(protection.takePrice);
  if (stop !== null && open <= stop)
    return {
      ...protection,
      phase: 'open',
      kind: 'stop-loss',
      assumption: 'observed-open',
      barOpenUtcMs,
      barCloseUtcMs,
      referencePrice: decimal(open),
    };
  // Conservative TP gap: no improvement beyond the protected threshold.
  if (take !== null && open >= take)
    return {
      ...protection,
      phase: 'open',
      kind: 'take-profit',
      assumption: 'observed-open',
      barOpenUtcMs,
      barCloseUtcMs,
      referencePrice: decimal(take),
    };
}
export function triggerIntrabar(
  protection: Protection,
  high: bigint,
  low: bigint,
  barOpenUtcMs: number,
  barCloseUtcMs: number,
): RiskTrigger | undefined {
  const stop =
      protection.stopPrice === null ? null : readUnits(protection.stopPrice),
    take =
      protection.takePrice === null ? null : readUnits(protection.takePrice);
  const hitStop = stop !== null && low <= stop,
    hitTake = take !== null && high >= take;
  if (!hitStop && !hitTake) return;
  return {
    ...protection,
    phase: 'intrabar',
    kind: hitStop ? 'stop-loss' : 'take-profit',
    assumption:
      hitStop && hitTake
        ? 'ambiguous-stop-first'
        : 'threshold-touch-order-unknown',
    barOpenUtcMs,
    barCloseUtcMs,
    referencePrice: decimal((hitStop ? stop : take)!),
  };
}
