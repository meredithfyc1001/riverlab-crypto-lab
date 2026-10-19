import type { TimeUnit } from './csv-types';

const AUTO_START = Date.UTC(2009, 0, 1);
const MAX_TIME = Date.UTC(2100, 0, 1);
const integer = /^\d{1,20}$/;
const zonedIso =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/;

export function normalizeTimestamp(
  raw: string,
  unit: Exclude<TimeUnit, 'auto'>,
): number | null {
  const value = raw.trim();
  if (unit === 'iso') {
    const match = zonedIso.exec(value);
    if (!match) return null;
    const [, y, m, d, h, min, s, , zone] = match;
    const year = Number(y),
      month = Number(m),
      day = Number(d);
    const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (
      year < 1970 ||
      year > 2100 ||
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > maxDay ||
      Number(h) > 23 ||
      Number(min) > 59 ||
      Number(s) > 59
    )
      return null;
    if (
      zone !== 'Z' &&
      (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59)
    )
      return null;
    const time = Date.parse(value);
    return Number.isSafeInteger(time) && time >= 0 && time <= MAX_TIME
      ? time
      : null;
  }
  if (!integer.test(value)) return null;
  const input = BigInt(value);
  if (unit === 'us' && input % 1000n !== 0n) return null;
  const ms = unit === 'us' ? input / 1000n : input;
  return ms >= 0n && ms <= BigInt(MAX_TIME) ? Number(ms) : null;
}

/** 只以固定 2009–2100 范围判别毫秒/微秒；不依赖系统时钟或本地时区。 */
export function inferTimeUnit(
  values: string[],
): Exclude<TimeUnit, 'auto'> | null {
  const nonempty = values.map((value) => value.trim()).filter(Boolean);
  if (!nonempty.length) return null;
  if (nonempty.every((value) => zonedIso.test(value))) return 'iso';
  // 错误的非数字时间由逐行校验报告，不让单个坏行掩盖其他行的单位。
  const numeric = nonempty.filter((value) => integer.test(value));
  if (!numeric.length || nonempty.some((value) => zonedIso.test(value)))
    return null;
  const candidates = (['ms', 'us'] as const).filter((unit) =>
    numeric.every((value) => {
      // 单位判定保留微秒余数，逐行规范化时拒绝精度丢失。
      const ms = Number(unit === 'us' ? BigInt(value) / 1000n : BigInt(value));
      return Number.isSafeInteger(ms) && ms >= AUTO_START && ms <= MAX_TIME;
    }),
  );
  return candidates.length === 1 ? candidates[0] : null;
}
