import type { Candle } from '../data';
import { parseDecimal } from '../math';
import type { Strategy, StrategyDecision } from './engine';

export type Comparison = 'gt' | 'gte' | 'lt' | 'lte';
export type RuleCondition = { enabled: boolean } & (
  | {
      kind: 'cross';
      average: 'MA' | 'EMA';
      fastPeriod: number;
      slowPeriod: number;
      direction: 'above' | 'below';
    }
  | {
      kind: 'price-ma';
      average: 'MA' | 'EMA';
      period: number;
      operator: Comparison;
    }
  | { kind: 'rsi'; period: number; operator: Comparison; threshold: number }
  | { kind: 'breakout'; lookback: number; direction: 'above' | 'below' }
);
export interface RuleGroup {
  enabled: boolean;
  operator: 'AND' | 'OR';
  conditions: RuleCondition[];
}
export interface StrategyRuleV1 {
  schemaVersion: 1;
  revision: number;
  buy: RuleGroup;
  sell: RuleGroup;
}
export const RULE_STRATEGY_VERSION = 'causal-declarative-rules-v1';
const fail = (message: string): never => {
  throw new Error(`规则无效：${message}`);
};
function object(
  value: unknown,
  keys: string[],
  path: string,
): Record<string, unknown> {
  if (
    !value ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(value, k))
  )
    return fail(`${path} 字段缺少、未知或类型错误。`);
  return value as Record<string, unknown>;
}
const period = (n: unknown) =>
  typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 50_000;
const comparison = (v: unknown) =>
  ['gt', 'gte', 'lt', 'lte'].includes(v as string);
export function normalizeRule(value: unknown): StrategyRuleV1 {
  const r = object(value, ['schemaVersion', 'revision', 'buy', 'sell'], '策略');
  if (r.schemaVersion !== 1) fail('只支持 schemaVersion=1，未迁移。');
  if (
    typeof r.revision !== 'number' ||
    !Number.isSafeInteger(r.revision) ||
    r.revision < 1 ||
    r.revision > 1_000_000
  )
    fail('revision 必须为1–1,000,000整数。');
  function group(value: unknown, side: string): RuleGroup {
    const g = object(value, ['enabled', 'operator', 'conditions'], side);
    if (
      typeof g.enabled !== 'boolean' ||
      !['AND', 'OR'].includes(g.operator as string) ||
      !Array.isArray(g.conditions) ||
      g.conditions.length < 1 ||
      g.conditions.length > 5
    )
      return fail(`${side} 需要布尔启用状态、AND/OR及1–5条条件。`);
    const conditions = Array.from(g.conditions, (value, i): RuleCondition => {
      const kind = (value as RuleCondition | null)?.kind;
      const keys =
        kind === 'cross'
          ? ['average', 'fastPeriod', 'slowPeriod', 'direction']
          : kind === 'price-ma'
            ? ['average', 'period', 'operator']
            : kind === 'rsi'
              ? ['period', 'operator', 'threshold']
              : kind === 'breakout'
                ? ['lookback', 'direction']
                : fail('未知条件类型。');
      const c = object(
        value,
        ['kind', 'enabled', ...keys],
        `${side}条件${i + 1}`,
      );
      if (typeof c.enabled !== 'boolean') fail('enabled 必须为布尔值。');
      if (kind === 'cross' || kind === 'price-ma') {
        if (!['MA', 'EMA'].includes(c.average as string))
          fail('均线必须为MA/EMA。');
      }
      if (kind === 'cross' || kind === 'breakout') {
        if (!['above', 'below'].includes(c.direction as string))
          fail('方向必须为above/below。');
      }
      if (
        kind === 'cross' &&
        (!period(c.fastPeriod) ||
          !period(c.slowPeriod) ||
          (c.fastPeriod as number) >= (c.slowPeriod as number))
      )
        fail('交叉周期必须为1–50,000整数，快线小于慢线。');
      if (
        (kind === 'price-ma' || kind === 'rsi') &&
        (!period(c.period) || !comparison(c.operator))
      )
        fail('周期必须为1–50,000整数，比较符号必须明确。');
      if (
        kind === 'rsi' &&
        (typeof c.threshold !== 'number' ||
          !Number.isFinite(c.threshold) ||
          c.threshold < 0 ||
          c.threshold > 100)
      )
        fail('RSI阈值必须为0–100有限数字。');
      if (kind === 'breakout' && !period(c.lookback))
        fail('突破回看必须为1–50,000整数。');
      return { ...c } as RuleCondition;
    });
    if (g.enabled && !conditions.some((c) => c.enabled))
      fail(`${side}至少启用一条条件。`);
    return {
      enabled: g.enabled,
      operator: g.operator as RuleGroup['operator'],
      conditions,
    };
  }
  const buy = group(r.buy, '买入'),
    sell = group(r.sell, '卖出');
  if (!buy.enabled && !sell.enabled) fail('至少启用一侧规则。');
  return { schemaVersion: 1, revision: r.revision as number, buy, sell };
}
export function defaultRule(): StrategyRuleV1 {
  return {
    schemaVersion: 1,
    revision: 1,
    buy: {
      enabled: true,
      operator: 'AND',
      conditions: [
        {
          kind: 'cross',
          enabled: true,
          average: 'MA',
          fastPeriod: 2,
          slowPeriod: 5,
          direction: 'above',
        },
      ],
    },
    sell: {
      enabled: true,
      operator: 'AND',
      conditions: [
        {
          kind: 'cross',
          enabled: true,
          average: 'MA',
          fastPeriod: 2,
          slowPeriod: 5,
          direction: 'below',
        },
      ],
    },
  };
}
const symbols = { gt: '>', gte: '≥', lt: '<', lte: '≤' };
export function explainCondition(c: RuleCondition): string {
  const prefix = c.enabled ? '' : '已禁用：';
  if (c.kind === 'cross')
    return `${prefix}${c.average}(${c.fastPeriod})${c.direction === 'above' ? '上穿' : '下穿'}${c.average}(${c.slowPeriod})；前值含等号，当前严格越过。`;
  if (c.kind === 'price-ma')
    return `${prefix}当前收盘价 ${symbols[c.operator]} ${c.average}(${c.period})，均线含当前收盘。`;
  if (c.kind === 'rsi')
    return `${prefix}Wilder RSI(${c.period}) ${symbols[c.operator]} ${c.threshold}。`;
  return `${prefix}当前收盘严格${c.direction === 'above' ? '高于前N根最高high' : '低于前N根最低low'}，N=${c.lookback}；当前根不在窗口，等号不满足。`;
}
const blend = (a: number, b: number, w: number) =>
  b >= a ? a + (b - a) * w : b + (a - b) * (1 - w);
function average(kind: 'MA' | 'EMA', n: number) {
  let count = 0,
    mean = 0;
  let sum = 0n;
  const ring: bigint[] = [];
  return (close: number, units: bigint): bigint | number | null => {
    if (kind === 'MA') {
      const slot = count % n;
      sum += units - (ring[slot] ?? 0n);
      ring[slot] = units;
    } else
      mean =
        count < n
          ? blend(mean, close, 1 / (count + 1))
          : blend(mean, close, 2 / (n + 1));
    count++;
    return count < n ? null : kind === 'MA' ? sum : mean;
  };
}
function compare(a: number | bigint, b: number | bigint, op: Comparison) {
  return op === 'gt'
    ? a > b
    : op === 'gte'
      ? a >= b
      : op === 'lt'
        ? a < b
        : a <= b;
}
function condition(
  c: RuleCondition,
): (bar: Readonly<Candle>, units: bigint) => boolean | null {
  if (c.kind === 'cross' || c.kind === 'price-ma') {
    const slowPeriod = c.kind === 'cross' ? c.slowPeriod : c.period;
    const slow = average(c.average, slowPeriod);
    const fast = c.kind === 'cross' ? average(c.average, c.fastPeriod) : null;
    let previous: -1 | 0 | 1 | undefined;
    return (bar, units) => {
      const s = slow(bar.close, units),
        f = fast?.(bar.close, units);
      if (s === null || (fast && f == null)) return null;
      if (c.kind === 'price-ma')
        return compare(
          c.average === 'MA' ? units * BigInt(c.period) : bar.close,
          s,
          c.operator,
        );
      const a = c.average === 'MA' ? (f as bigint) * BigInt(c.slowPeriod) : f!;
      const b = c.average === 'MA' ? (s as bigint) * BigInt(c.fastPeriod) : s;
      const next = a < b ? -1 : a > b ? 1 : 0;
      const result =
        previous === undefined
          ? null
          : c.direction === 'above'
            ? previous <= 0 && next > 0
            : previous >= 0 && next < 0;
      previous = next;
      return result;
    };
  }
  if (c.kind === 'rsi') {
    let count = 0,
      previous = 0,
      gain = 0,
      loss = 0;
    return (bar) => {
      if (count) {
        const delta = bar.close - previous,
          up = Math.max(delta, 0),
          down = Math.max(-delta, 0);
        gain =
          count <= c.period
            ? blend(gain, up, 1 / count)
            : gain * ((c.period - 1) / c.period) + up / c.period;
        loss =
          count <= c.period
            ? blend(loss, down, 1 / count)
            : loss * ((c.period - 1) / c.period) + down / c.period;
      }
      previous = bar.close;
      count++;
      if (count <= c.period) return null;
      const rsi =
        gain === 0 && loss === 0
          ? 50
          : loss === 0
            ? 100
            : gain === 0
              ? 0
              : 100 / (1 + loss / gain);
      return compare(rsi, c.threshold, c.operator);
    };
  }
  const queue: { index: number; price: bigint }[] = [];
  let count = 0,
    head = 0;
  return (bar, units) => {
    while (head < queue.length && queue[head].index < count - c.lookback)
      head++;
    const result =
      count < c.lookback
        ? null
        : c.direction === 'above'
          ? units > queue[head].price
          : units < queue[head].price;
    const price = parseDecimal(
      String(c.direction === 'above' ? bar.high : bar.low),
    );
    while (
      queue.length > head &&
      (c.direction === 'above'
        ? queue.at(-1)!.price <= price
        : queue.at(-1)!.price >= price)
    )
      queue.pop();
    queue.push({ index: count++, price });
    if (head > 1024) {
      queue.splice(0, head);
      head = 0;
    }
    return result;
  };
}
export function createRuleStrategy(
  value: unknown,
  intervalMs: number,
): Strategy {
  const rule = normalizeRule(value);
  if (
    !Number.isSafeInteger(intervalMs) ||
    intervalMs <= 0 ||
    intervalMs > 31_536_000_000
  )
    fail('非法周期。');
  for (const g of [rule.buy, rule.sell]) {
    g.conditions.forEach(Object.freeze);
    Object.freeze(g.conditions);
    Object.freeze(g);
  }
  Object.freeze(rule);
  function group(g: RuleGroup) {
    const evaluators = g.conditions.filter((c) => c.enabled).map(condition);
    return (bar: Readonly<Candle>, units: bigint) => {
      if (!g.enabled) return false;
      const values = evaluators.map((evaluate) => evaluate(bar, units));
      if (values.includes(null)) return null;
      return g.operator === 'AND'
        ? values.every(Boolean)
        : values.some(Boolean);
    };
  }
  const buy = group(rule.buy),
    sell = group(rule.sell);
  let count = 0,
    previousTime: number | undefined,
    previousBuy = false,
    previousSell = false;
  return Object.freeze({
    config: Object.freeze({ kind: 'rules' as const, rule }),
    version: RULE_STRATEGY_VERSION,
    onClose(bar: Readonly<Candle>): StrategyDecision {
      if (
        count >= 50_000 ||
        !bar ||
        !Number.isSafeInteger(bar.timestampUtcMs) ||
        bar.timestampUtcMs < 0 ||
        bar.timestampUtcMs + intervalMs > 4_102_444_800_000 ||
        (previousTime !== undefined &&
          bar.timestampUtcMs - previousTime !== intervalMs) ||
        ![bar.open, bar.high, bar.low, bar.close].every(
          (v) => Number.isFinite(v) && v > 0,
        ) ||
        !Number.isFinite(bar.volume) ||
        bar.volume < 0 ||
        bar.low > Math.min(bar.open, bar.close) ||
        bar.high < Math.max(bar.open, bar.close)
      )
        fail('只接收合法连续的已完成K线。');
      const prices = [bar.open, bar.high, bar.low, bar.close].map((v) =>
        parseDecimal(String(v)),
      );
      if (prices.some((v) => v === 0n)) fail('价格下溢。');
      previousTime = bar.timestampUtcMs;
      count++;
      const b = buy(bar, prices[3]),
        s = sell(bar, prices[3]);
      if (b === null || s === null)
        return { action: 'hold', reason: 'rules-warmup' };
      const buyEdge = b && !previousBuy,
        sellEdge = s && !previousSell;
      previousBuy = b;
      previousSell = s;
      if (b && s) return { action: 'hold', reason: 'rules-conflict' };
      if (buyEdge) return { action: 'buy', reason: 'rules-buy' };
      if (sellEdge) return { action: 'sell', reason: 'rules-sell' };
      return {
        action: 'hold',
        reason: b || s ? 'rules-repeat' : 'rules-no-match',
      };
    },
  });
}
