import type { Regime } from '../../core/market-regime/model';

export const stateNames: Record<Regime, string> = {
  BULL: '上涨',
  BEAR: '下跌',
  SIDEWAYS: '震荡',
  UNKNOWN: '未知',
};
export const colors = {
  dark: {
    BULL: '#63d7ab',
    BEAR: '#ee8f84',
    SIDEWAYS: '#85aaf1',
    UNKNOWN: '#9d9f9f',
  },
  light: {
    BULL: '#177b58',
    BEAR: '#a64639',
    SIDEWAYS: '#406aa5',
    UNKNOWN: '#6c7370',
  },
} satisfies Record<string, Record<Regime, string>>;
export type Theme = keyof typeof colors;
export const utc = (ms: number) => new Date(ms).toISOString();
export function duration(ms: number) {
  for (const [unit, scale] of [
    ['天', 86400000],
    ['小时', 3600000],
    ['分钟', 60000],
    ['秒', 1000],
  ] as const)
    if (ms > 0 && ms % scale === 0) return `${ms / scale} ${unit}`;
  return `${ms} ms`;
}
// Move the decimal point in a canonical fraction without rounding away small returns.
export function percentage(value: string | null) {
  if (value === null) return '—';
  const sign = value.startsWith('-') ? '-' : '';
  const [whole, tail = ''] = value.replace(/^-/, '').split('.');
  const digits = (whole + tail.padEnd(2, '0').slice(0, 2)).replace(
    /^0+(?=\d)/,
    '',
  );
  const fraction = tail.slice(2).replace(/0+$/, '');
  return `${sign}${digits}${fraction ? '.' + fraction : ''}%`;
}
