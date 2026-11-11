import type { Candle } from '../data';
import { createRuleStrategy, normalizeRule } from './rules';
import type { StrategyRuleV1 } from './rules';
import { parseDecimal } from '../math';

export type StrategyConfig =
  | { kind: 'rules'; rule: StrategyRuleV1 }
  | { kind: 'ma'; fastPeriod: number; slowPeriod: number }
  | { kind: 'rsi'; period: number; lower: number; upper: number }
  | { kind: 'breakout'; lookback: number };
export type StrategyInput =
  | { kind: 'rules'; rule: StrategyRuleV1 }
  | { kind: 'ma'; fastPeriod?: number; slowPeriod?: number }
  | { kind: 'rsi'; period?: number; lower?: number; upper?: number }
  | { kind: 'breakout'; lookback?: number };
export interface StrategyDecision {
  action: 'buy' | 'sell' | 'hold';
  reason: string;
}
export interface Strategy {
  readonly config: Readonly<StrategyConfig>;
  readonly version: string;
  /** Only the current completed candle enters; all retained state is historical. */
  onClose(candle: Readonly<Candle>): StrategyDecision;
}
export const STRATEGY_VERSION = 'causal-close-ma-rsi-breakout-v1';
const period = (n: number) => Number.isInteger(n) && n >= 1 && n <= 50_000;
export function normalizeStrategy(input: StrategyInput): StrategyConfig {
  if (!input || Object.getPrototypeOf(input) !== Object.prototype)
    throw new Error('Invalid strategy configuration.');
  if (input.kind === 'rules') {
    if (Object.keys(input).length !== 2 || !Object.hasOwn(input, 'rule'))
      throw new Error('Unknown rule strategy parameter.');
    return { kind: 'rules', rule: normalizeRule(input.rule) };
  }
  let config: Exclude<StrategyConfig, { kind: 'rules' }>;
  switch (input.kind) {
    case 'ma':
      config = { fastPeriod: 10, slowPeriod: 30, ...input };
      if (
        !period(config.fastPeriod) ||
        !period(config.slowPeriod) ||
        config.fastPeriod >= config.slowPeriod
      )
        throw new Error('MA periods require 1 <= fast < slow <= 50000.');
      break;
    case 'rsi':
      config = { period: 14, lower: 30, upper: 70, ...input };
      if (
        !period(config.period) ||
        !Number.isFinite(config.lower) ||
        !Number.isFinite(config.upper) ||
        config.lower < 0 ||
        config.lower >= config.upper ||
        config.upper > 100
      )
        throw new Error(
          'RSI requires period 1..50000 and 0 <= lower < upper <= 100.',
        );
      break;
    case 'breakout':
      config = { lookback: 20, ...input };
      if (!period(config.lookback))
        throw new Error('Breakout lookback requires 1..50000.');
      break;
    default:
      throw new Error('Unknown strategy kind.');
  }
  const keys =
    input.kind === 'ma'
      ? ['kind', 'fastPeriod', 'slowPeriod']
      : input.kind === 'rsi'
        ? ['kind', 'period', 'lower', 'upper']
        : ['kind', 'lookback'];
  if (Object.keys(input).some((k) => !keys.includes(k)))
    throw new Error('Unknown strategy parameter.');
  return config;
}
const blend = (a: number, b: number, w: number) =>
  b >= a ? a + (b - a) * w : b + (a - b) * (1 - w);
const decision = (
  action: StrategyDecision['action'],
  reason: string,
): StrategyDecision => ({ action, reason });

export function createStrategy(
  input: StrategyInput,
  intervalMs: number,
): Strategy {
  const config = Object.freeze(normalizeStrategy(input));
  if (config.kind === 'rules')
    return createRuleStrategy(config.rule, intervalMs);
  if (
    !Number.isSafeInteger(intervalMs) ||
    intervalMs <= 0 ||
    intervalMs > 31_536_000_000
  )
    throw new Error('Invalid strategy interval.');
  let count = 0,
    previousTime: number | undefined,
    previousClose = 0;
  let fastSum = 0n,
    slowSum = 0n,
    previousDifference: bigint | undefined;
  const fast: bigint[] = [],
    slow: bigint[] = [];
  let gain = 0,
    loss = 0;
  const highs: { index: number; price: bigint }[] = [],
    lows: { index: number; price: bigint }[] = [];
  let highHead = 0,
    lowHead = 0;
  return Object.freeze({
    config,
    version: STRATEGY_VERSION,
    onClose(c: Readonly<Candle>): StrategyDecision {
      if (
        count >= 50_000 ||
        !c ||
        !Number.isSafeInteger(c.timestampUtcMs) ||
        c.timestampUtcMs < 0 ||
        c.timestampUtcMs + intervalMs > 4_102_444_800_000 ||
        (previousTime !== undefined &&
          c.timestampUtcMs - previousTime !== intervalMs) ||
        ![c.open, c.high, c.low, c.close].every(
          (v) => Number.isFinite(v) && v > 0,
        ) ||
        !Number.isFinite(c.volume) ||
        c.volume < 0 ||
        c.low > Math.min(c.open, c.close) ||
        c.high < Math.max(c.open, c.close)
      )
        throw new Error('Invalid or noncontiguous completed strategy candle.');
      const [open, high, low, close] = [c.open, c.high, c.low, c.close].map(
        (v) => parseDecimal(String(v)),
      );
      if ([open, high, low, close].some((v) => v === 0n))
        throw new Error('Strategy price underflow.');
      const i = count;
      let result = decision('hold', 'warmup');
      if (config.kind === 'ma') {
        const f = i % config.fastPeriod,
          s = i % config.slowPeriod;
        fastSum += close - (fast[f] ?? 0n);
        fast[f] = close;
        slowSum += close - (slow[s] ?? 0n);
        slow[s] = close;
        if (i + 1 >= config.slowPeriod) {
          const difference =
            fastSum * BigInt(config.slowPeriod) -
            slowSum * BigInt(config.fastPeriod);
          if (previousDifference !== undefined)
            result =
              previousDifference <= 0n && difference > 0n
                ? decision('buy', 'ma-cross-up')
                : previousDifference >= 0n && difference < 0n
                  ? decision('sell', 'ma-cross-down')
                  : decision('hold', 'ma-no-cross');
          previousDifference = difference;
        }
      } else if (config.kind === 'rsi') {
        if (i > 0) {
          const delta = c.close - previousClose,
            up = Math.max(delta, 0),
            down = Math.max(-delta, 0);
          if (i <= config.period) {
            gain = blend(gain, up, 1 / i);
            loss = blend(loss, down, 1 / i);
          } else {
            gain =
              gain * ((config.period - 1) / config.period) + up / config.period;
            loss =
              loss * ((config.period - 1) / config.period) +
              down / config.period;
          }
          if (i >= config.period) {
            const rsi =
              gain === 0 && loss === 0
                ? 50
                : loss === 0
                  ? 100
                  : gain === 0
                    ? 0
                    : 100 / (1 + loss / gain);
            result =
              rsi <= config.lower
                ? decision('buy', 'rsi-lower')
                : rsi >= config.upper
                  ? decision('sell', 'rsi-upper')
                  : decision('hold', 'rsi-middle');
          }
        }
      } else {
        while (
          highHead < highs.length &&
          highs[highHead].index < i - config.lookback
        )
          highHead++;
        while (
          lowHead < lows.length &&
          lows[lowHead].index < i - config.lookback
        )
          lowHead++;
        if (i >= config.lookback)
          result =
            close > highs[highHead].price
              ? decision('buy', 'breakout-up')
              : close < lows[lowHead].price
                ? decision('sell', 'breakout-down')
                : decision('hold', 'breakout-inside');
        while (highs.length > highHead && highs.at(-1)!.price <= high)
          highs.pop();
        while (lows.length > lowHead && lows.at(-1)!.price >= low) lows.pop();
        highs.push({ index: i, price: high });
        lows.push({ index: i, price: low });
      }
      previousClose = c.close;
      previousTime = c.timestampUtcMs;
      count++;
      return result;
    },
  });
}
