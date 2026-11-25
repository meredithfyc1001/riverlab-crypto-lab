/** Quote/price/base quantity all use 18 decimal places. No Number arithmetic. */
export const SCALE = 10n ** 18n;
export const BPS = 10000n;
const INPUT_LIMIT = 10n ** 48n;
/** Derived balances/quantities/equity must stay below 1e78 (bounded resources). */
export const ACCOUNTING_LIMIT = 10n ** 96n;
export const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

// Bounded memo of the pure decimal-to-integer conversion, with no market state.
const unitCache = new Map<string, bigint>();
export function readUnits(value: string): bigint {
  if (typeof value !== 'string' || value.length > 128)
    throw new Error('Decimal must be a string of at most 128 characters.');
  const cached = unitCache.get(value);
  if (cached !== undefined) return cached;
  const m = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d{1,3}))?$/i.exec(value);
  if (!m) throw new Error(`Invalid nonnegative decimal: ${value}`);
  const digits = BigInt(m[1] + (m[2] ?? ''));
  const shift = 18 + Number(m[3] ?? 0) - (m[2]?.length ?? 0);
  const units =
    shift >= 0 ? digits * 10n ** BigInt(shift) : digits / 10n ** BigInt(-shift);
  if (shift < 0 && digits % 10n ** BigInt(-shift) !== 0n)
    throw new Error(`Decimal exceeds 18 places: ${value}`);
  if (unitCache.size >= 4096) unitCache.clear();
  unitCache.set(value, units);
  return units;
}

export function parseDecimal(value: string): bigint {
  const units = readUnits(value);
  if (units >= INPUT_LIMIT) throw new Error('Decimal must be less than 1e30.');
  return units;
}

// Snapshots, ledger reconciliation and statistics repeatedly format the same
// balances. Cache only the pure numeric conversion, bounded in count and size.
const formattedUnits = new Map<bigint, string>();

export function decimal(units: bigint): string {
  if (units === 0n) return '0';
  if (units < 0n) return `-${decimal(-units)}`;
  const cached = formattedUnits.get(units);
  if (cached !== undefined) return cached;
  const whole = units / SCALE;
  const remainder = units % SCALE;
  const text =
    remainder === 0n
      ? String(whole)
      : `${whole}.${remainder.toString().padStart(18, '0').replace(/0+$/, '')}`;
  if (text.length <= 128) {
    if (formattedUnits.size >= 4096) formattedUnits.clear();
    formattedUnits.set(units, text);
  }
  return text;
}
