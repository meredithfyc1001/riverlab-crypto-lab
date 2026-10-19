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
/** Convex mean using the smaller endpoint as base, avoiding cancellation at weight=1. */
function blend(previous: number, next: number, weight: number): number {
  return next >= previous
    ? previous + (next - previous) * weight
    : next + (previous - next) * (1 - weight);
}
/** Two aggregate stacks remove old values without subtracting them from a large sum.
 * Each entry moves at most once: amortized O(1) per candle, O(period) working memory.
 */
class RollingMean {
  private incoming: { value: number; mean: number }[] = [];
  private outgoing: { value: number; mean: number }[] = [];
  constructor(private readonly period: number) {}
  reset() {
    this.incoming = [];
    this.outgoing = [];
  }
  private push(stack: { value: number; mean: number }[], value: number) {
    const count = stack.length;
    stack.push({
      value,
      mean: count
        ? blend(stack[count - 1].mean, value, 1 / (count + 1))
        : value,
    });
  }
  add(value: number): number {
    if (this.period === 1) return value;
    this.push(this.incoming, value);
    if (this.incoming.length + this.outgoing.length > this.period) {
      if (!this.outgoing.length)
        while (this.incoming.length)
          this.push(this.outgoing, this.incoming.pop()!.value);
      this.outgoing.pop();
    }
    const a = this.incoming.at(-1),
      b = this.outgoing.at(-1);
    if (!a) return b!.mean;
    if (!b) return a.mean;
    return blend(
      a.mean,
      b.mean,
      this.outgoing.length / (this.incoming.length + this.outgoing.length),
    );
  }
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
  const maWindow = new RollingMean(periods.ma);
  let start = 0,
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
      maWindow.reset();
      emaSeed = 0;
      ema = null;
      gain = 0;
      loss = 0;
    }
    const count = i - start + 1;
    const maMean = maWindow.add(c.close);
    if (count <= periods.ema) {
      emaSeed = blend(emaSeed, c.close, 1 / count);
      if (count === periods.ema) ema = emaSeed;
    } else if (ema !== null) ema = blend(ema, c.close, 2 / (periods.ema + 1));
    let rsi: number | null = null;
    if (count > 1) {
      const delta = c.close - candles[i - 1].close;
      const up = Math.max(delta, 0),
        down = Math.max(-delta, 0);
      const changes = count - 1;
      if (changes <= periods.rsi) {
        gain = blend(gain, up, 1 / changes);
        loss = blend(loss, down, 1 / changes);
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
