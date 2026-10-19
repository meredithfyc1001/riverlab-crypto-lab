import type { Candle } from '../data';

export interface IndicatorPoint {
  timestampUtcMs: number;
  value: number | null;
}
export interface Indicators {
  ma: IndicatorPoint[];
  ema: IndicatorPoint[];
  rsi: IndicatorPoint[];
}
export function validPeriod(period: number): boolean {
  return Number.isInteger(period) && period >= 1 && period <= 50_000;
}
/** Close-only, causal indicators. A missing bar resets all warm-up state. */
export function calculateIndicators(
  candles: readonly Candle[],
  intervalMs: number,
  periods: { ma: number; ema: number; rsi: number },
): Indicators {
  if (!Object.values(periods).every(validPeriod))
    throw new Error('指标周期必须是 1–50,000 的整数。');
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0)
    throw new Error('指标需要已确认的正整数毫秒周期。');
  const result: Indicators = { ma: [], ema: [], rsi: [] };
  let start = 0,
    maMean = 0,
    emaSeed = 0,
    ema: number | null = null;
  let gain = 0,
    loss = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (
      !Number.isFinite(c.close) ||
      c.close <= 0 ||
      !Number.isSafeInteger(c.timestampUtcMs) ||
      (i > 0 && c.timestampUtcMs <= candles[i - 1].timestampUtcMs)
    )
      throw new Error('指标输入包含非法价格或异常时间戳；未排序或修复。');
    if (
      i === 0 ||
      c.timestampUtcMs - candles[i - 1].timestampUtcMs !== intervalMs
    ) {
      start = i;
      maMean = 0;
      emaSeed = 0;
      ema = null;
      gain = 0;
      loss = 0;
    }
    const count = i - start + 1;
    // Means avoid overflow from summing very large, individually finite prices.
    if (count <= periods.ma) maMean += (c.close - maMean) / count;
    else
      maMean +=
        c.close / periods.ma - candles[i - periods.ma].close / periods.ma;
    if (count <= periods.ema) {
      emaSeed += (c.close - emaSeed) / count;
      if (count === periods.ema) ema = emaSeed;
    } else if (ema !== null) ema += (c.close - ema) * (2 / (periods.ema + 1));
    let rsi: number | null = null;
    if (count > 1) {
      const delta = c.close - candles[i - 1].close;
      const up = Math.max(delta, 0),
        down = Math.max(-delta, 0);
      const changes = count - 1;
      if (changes <= periods.rsi) {
        gain += (up - gain) / changes;
        loss += (down - loss) / changes;
      } else {
        gain = gain * ((periods.rsi - 1) / periods.rsi) + up / periods.rsi;
        loss = loss * ((periods.rsi - 1) / periods.rsi) + down / periods.rsi;
      }
      if (changes >= periods.rsi)
        rsi =
          gain === 0 && loss === 0
            ? 50
            : loss === 0
              ? 100
              : gain === 0
                ? 0
                : 100 / (1 + loss / gain);
    }
    const timestampUtcMs = c.timestampUtcMs;
    result.ma.push({
      timestampUtcMs,
      value: count >= periods.ma ? maMean : null,
    });
    result.ema.push({ timestampUtcMs, value: ema });
    result.rsi.push({ timestampUtcMs, value: rsi });
  }
  return result;
}
