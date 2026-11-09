import { assertDataset } from '../data/dataset';
import { normalizeConfig } from './config';
import { decimal, parseDecimal, readUnits, SCALE } from './decimal';
import { executeAtReference } from './execution';
import { createStrategy } from '../strategies';
import {
  normalizeRisk,
  protectionFor,
  triggerAtOpen,
  triggerIntrabar,
} from '../risk';
import type { Protection, RiskTrigger } from '../risk';
import { contentHash } from './identity';
import { ledgerAuditor, snapshot } from './ledger';
import type {
  BacktestInput,
  BacktestResult,
  OrderIntent,
  Signal,
  RunManifest,
} from './types';

export const ALGORITHM_VERSION = 'spot-long-protected-next-open-v2';
export const CONVERSION_VERSION = 'number-shortest-decimal-fixed18-v1';
export const RUN_ASSUMPTIONS = Object.freeze([
  'virtual-USDT-single-symbol-spot-long-only-no-leverage',
  'caller-declares-all-candles-completed',
  'strategy-stream-completed-candle-only-or-unverified-scripted-signals',
  'existing-risk-open-before-signal-intrabar-after-open-orders',
  'new-protection-marketable-at-open-exits-at-open',
  'ambiguous-intrabar-stop-first-time-unknown',
  'gap-stop-at-open-gap-take-at-threshold-no-improvement',
  'protective-trigger-market-sell-with-adverse-slippage',
  'protection-from-actual-entry-price-no-fee-basis-no-pyramiding',
  'completed-close-signal-next-open-fill',
  'strict-no-gaps-no-sorting-no-repair',
  'unlimited-liquidity-no-order-book-volume-ignored',
  'no-partial-fills',
  'adverse-two-sided-slippage-not-clamped-to-high-low',
  'quote-currency-fees-ceil-after-notional-rounding',
  'fixed18-buy-ceil-sell-floor-quantity-floor-mark-floor',
  'no-final-liquidation-close-mark-excludes-liquidation-costs',
  'source-number-precision-not-original-csv-decimal-precision',
  'coverage-and-source-authenticity-unverified',
]);

function normalizeSignals(
  signals: readonly Signal[],
  length: number,
): Signal[] {
  if (!Array.isArray(signals) || signals.length > length)
    throw new Error('Invalid fixed signals.');
  let previous = -1;
  return Array.from(signals, (s) => {
    if (
      !s ||
      !Number.isInteger(s.candleIndex) ||
      s.candleIndex <= previous ||
      s.candleIndex >= length ||
      typeof s.reason !== 'string' ||
      !s.reason.length ||
      s.reason.length > 500
    )
      throw new Error(
        'Signals require increasing, unique in-range indices and reasons.',
      );
    previous = s.candleIndex;
    if (s.action === 'hold') {
      if (
        Object.keys(s).some(
          (k) => !['action', 'candleIndex', 'reason'].includes(k),
        )
      )
        throw new Error('Hold cannot specify a quantity or unknown fields.');
      return { candleIndex: s.candleIndex, action: s.action, reason: s.reason };
    }
    if (
      !['buy', 'sell'].includes(s.action) ||
      Object.keys(s).some(
        (k) => !['action', 'candleIndex', 'reason', 'quantity'].includes(k),
      )
    )
      throw new Error('Invalid signal action/fields.');
    return {
      candleIndex: s.candleIndex,
      action: s.action,
      quantity:
        s.quantity === 'all' ? 'all' : decimal(parseDecimal(s.quantity)),
      reason: s.reason,
    };
  });
}

/** Shared state: construction validates all input; advance alone executes the next candle. Keep interactive sessions inside a Worker. */
export function createBacktestSession(
  input: BacktestInput,
  interactive = false,
) {
  const { dataset: d, completedThroughUtcMs } = input;
  if (interactive && (input.strategy !== undefined || input.signals?.length))
    throw new Error('Interactive sessions require empty scripted signals.');
  assertDataset(d);
  if (
    !Number.isSafeInteger(completedThroughUtcMs) ||
    completedThroughUtcMs < 0 ||
    completedThroughUtcMs > 4_102_444_800_000
  )
    throw new Error('Invalid completed-through UTC milliseconds.');
  const intervalMs = d.quality.intervalMs!;
  const tape = d.candles.map((c, i) => {
    if (c.timestampUtcMs + intervalMs > completedThroughUtcMs)
      throw new Error('Uncompleted candle blocks the run.');
    if (i && c.timestampUtcMs - d.candles[i - 1].timestampUtcMs !== intervalMs)
      throw new Error('Data gap blocks the run.');
    const prices = [c.open, c.high, c.low, c.close].map((v) =>
      parseDecimal(String(v)),
    );
    if (prices.some((p) => p === 0n)) throw new Error('Price underflow.');
    return {
      timestampUtcMs: c.timestampUtcMs,
      open: decimal(prices[0]),
      high: decimal(prices[1]),
      low: decimal(prices[2]),
      close: decimal(prices[3]),
      volume: String(c.volume),
    };
  });
  const config = normalizeConfig(input.config);
  if (input.strategy !== undefined && input.signals !== undefined)
    throw new Error('Choose strategy or fixed signals, never both.');
  const strategy =
    input.strategy === undefined
      ? undefined
      : createStrategy(input.strategy, intervalMs);
  const risk = normalizeRisk(input.risk);
  const protectedRun = Object.keys(risk).length > 0;
  const signals: Signal[] = strategy
    ? []
    : normalizeSignals(input.signals!, tape.length);
  const dataHash = contentHash({ symbol: d.symbol, intervalMs, candles: tape });
  const signalHash = contentHash(signals);
  const manifest: RunManifest = {
    algorithmVersion: ALGORITHM_VERSION,
    conversionVersion: CONVERSION_VERSION,
    dataHash,
    signalHash,
    runHash: contentHash({
      algorithmVersion: ALGORITHM_VERSION,
      conversionVersion: CONVERSION_VERSION,
      dataHash,
      signalHash,
      config,
      completedThroughUtcMs,
      strategy: strategy
        ? { config: strategy.config, version: strategy.version }
        : null,
      risk,
    }),
    sourceFileSha256: d.file.sha256,
    source: JSON.parse(JSON.stringify(d.source)) as RunManifest['source'],
    quality: JSON.parse(JSON.stringify(d.quality)) as RunManifest['quality'],
    symbol: d.symbol,
    intervalMs,
    completedThroughUtcMs,
    config,
    signals,
    strategy: strategy
      ? { config: strategy.config, version: strategy.version }
      : null,
    risk,
    assumptions: RUN_ASSUMPTIONS,
  };
  const result: BacktestResult = {
    manifest,
    signals: [],
    orders: [],
    fills: [],
    closes: [],
    final: snapshot(
      { cash: parseDecimal(config.initialCash), quantity: 0n },
      parseDecimal(tape[0].open),
    ),
  };
  let cash = parseDecimal(config.initialCash),
    quantity = 0n;
  let buyNotional = 0n,
    sellNotional = 0n,
    fees = 0n,
    buyQuantity = 0n,
    sellQuantity = 0n;
  let pending: OrderIntent | undefined;
  let nextSignal = 0;
  const audit = ledgerAuditor(config.initialCash, config);
  let protection: Protection | undefined;
  const execute = (
    intent: OrderIntent,
    i: number,
    reference: string,
    time: number | null,
  ) => {
    const mark = readUnits(reference);
    const blocked =
      !intent.trigger &&
      (strategy || protectedRun) &&
      intent.side === 'buy' &&
      quantity > 0n
        ? ('position-already-open' as const)
        : !intent.trigger &&
            strategy &&
            intent.side === 'sell' &&
            quantity === 0n
          ? ('position-already-flat' as const)
          : undefined;
    const execution = blocked
      ? { rejected: blocked }
      : executeAtReference({ cash, quantity }, mark, intent, config);
    if ('rejected' in execution) {
      result.orders.push({
        intent,
        status: 'rejected',
        reason: execution.rejected,
        resolvedUtcMs: time,
      });
      return;
    }
    const { price, quantity: qty, notional, fee } = execution;
    const before = snapshot({ cash, quantity }, mark);
    const beforeEquity = cash + (quantity * mark) / SCALE;
    const sign = intent.side === 'buy' ? 1n : -1n;
    cash -= sign * notional + fee;
    quantity += sign * qty;
    fees += fee;
    if (intent.side === 'buy') {
      buyNotional += notional;
      buyQuantity += qty;
    } else {
      sellNotional += notional;
      sellQuantity += qty;
    }
    const fill = {
      sequence: result.fills.length + 1,
      orderId: intent.id,
      side: intent.side,
      reason: intent.reason,
      signalCandleIndex: intent.signalCandleIndex,
      candleIndex: i,
      timestampUtcMs: time,
      ...(intent.trigger ? { trigger: intent.trigger } : {}),
      referencePrice: reference,
      price: decimal(price),
      quantity: decimal(qty),
      notional: decimal(notional),
      fee: decimal(fee),
      before,
      after: snapshot({ cash, quantity }, mark),
      delta: {
        cash: decimal(-sign * notional - fee),
        quantity: decimal(sign * qty),
        equity: decimal(cash + (quantity * mark) / SCALE - beforeEquity),
      },
      totals: {
        buyNotional: decimal(buyNotional),
        sellNotional: decimal(sellNotional),
        fees: decimal(fees),
        buyQuantity: decimal(buyQuantity),
        sellQuantity: decimal(sellQuantity),
      },
    };
    audit(fill);
    result.fills.push(fill);
    result.orders.push({ intent, status: 'filled', resolvedUtcMs: time });
    if (quantity === 0n) protection = undefined;
    else if (intent.side === 'buy' && protectedRun)
      protection = protectionFor(price, risk);
  };
  const executeRisk = (trigger: RiskTrigger, i: number) => {
    const time = trigger.phase === 'open' ? trigger.barOpenUtcMs : null;
    execute(
      {
        id: `risk-${i}`,
        side: 'sell',
        quantity: 'all',
        reason: trigger.kind,
        signalCandleIndex: null,
        generatedUtcMs: time,
        targetCandleIndex: i,
        trigger,
      },
      i,
      trigger.referencePrice,
      time,
    );
  };
  let cursor = 0;
  let completed = false;
  const advance = () => {
    if (completed || cursor >= tape.length) throw new Error('No next candle.');
    const i = cursor++;
    const c = tape[i],
      open = parseDecimal(c.open);
    const end = c.timestampUtcMs + intervalMs;
    const gap =
      protection && triggerAtOpen(protection, open, c.timestampUtcMs, end);
    if (gap) {
      executeRisk(gap, i);
      if (pending)
        result.orders.push({
          intent: pending,
          status: 'cancelled',
          reason: 'risk-priority',
          resolvedUtcMs: c.timestampUtcMs,
        });
      pending = undefined;
    } else {
      if (pending) execute(pending, i, c.open, c.timestampUtcMs);
      pending = undefined;
      // A new entry's adverse slippage can put its stop above the known open.
      // Such protection is immediately marketable, so never award the better stop.
      const activated =
        protection && triggerAtOpen(protection, open, c.timestampUtcMs, end);
      if (activated) executeRisk(activated, i);
      else {
        const touch =
          protection &&
          triggerIntrabar(
            protection,
            parseDecimal(c.high),
            parseDecimal(c.low),
            c.timestampUtcMs,
            end,
          );
        if (touch) executeRisk(touch, i);
      }
    }
    const closeTime = c.timestampUtcMs + intervalMs;
    result.closes.push({
      candleIndex: i,
      timestampUtcMs: closeTime,
      account: snapshot({ cash, quantity }, parseDecimal(c.close)),
    });
    if (strategy) {
      const decision = strategy.onClose(Object.freeze({ ...d.candles[i] }));
      signals.push(
        decision.action === 'hold'
          ? { candleIndex: i, ...decision, action: 'hold' }
          : {
              candleIndex: i,
              ...decision,
              action: decision.action,
              quantity: 'all',
            },
      );
    }
    const s = signals[nextSignal];
    if (s?.candleIndex === i) {
      nextSignal++;
      result.signals.push({ signal: s, generatedUtcMs: closeTime });
      if (s.action !== 'hold')
        pending = {
          id: `order-${i}`,
          side: s.action,
          quantity: s.quantity,
          reason: s.reason,
          signalCandleIndex: i,
          generatedUtcMs: closeTime,
          targetCandleIndex: i + 1,
        };
    }
    result.final = result.closes.at(-1)!.account;
    return result.closes.at(-1)!;
  };
  const finish = () => {
    if (completed) return result;
    if (cursor !== tape.length)
      throw new Error('Cannot finish before the last candle.');
    completed = true;
    if (pending)
      result.orders.push({
        intent: pending,
        status: 'expired',
        reason: 'no-next-candle',
        resolvedUtcMs: pending.generatedUtcMs,
      });
    // Streamed signals are complete only after all close events have been evaluated.
    manifest.signalHash = contentHash(signals);
    manifest.runHash = contentHash({
      algorithmVersion: ALGORITHM_VERSION,
      conversionVersion: CONVERSION_VERSION,
      dataHash,
      signalHash: manifest.signalHash,
      config,
      completedThroughUtcMs,
      strategy: manifest.strategy,
      risk,
    });
    result.final = result.closes.at(-1)!.account;
    pending = undefined;
    return result;
  };
  return {
    advance,
    finish,
    submit(signal: Signal) {
      if (
        !interactive ||
        completed ||
        cursor < 1 ||
        signal.candleIndex !== cursor - 1 ||
        signals.at(-1)?.candleIndex === signal.candleIndex
      )
        throw new Error(
          'Only one decision at the current revealed close is allowed.',
        );
      const s = normalizeSignals([signal], tape.length)[0];
      if (s.action === 'hold')
        throw new Error('Interactive hold requires no order.');
      signals.push(s);
      nextSignal++;
      const closeTime = d.candles[cursor - 1].timestampUtcMs + intervalMs;
      result.signals.push({ signal: s, generatedUtcMs: closeTime });
      pending = {
        id: 'order-' + s.candleIndex,
        side: s.action,
        quantity: s.quantity,
        reason: s.reason,
        signalCandleIndex: s.candleIndex,
        generatedUtcMs: closeTime,
        targetCandleIndex: cursor,
      };
    },
    get cursor() {
      return cursor;
    },
    get pending() {
      return pending ?? null;
    },
    get result() {
      return result;
    },
  };
}

export function runBacktest(input: BacktestInput): BacktestResult {
  const session = createBacktestSession(input);
  while (session.cursor < input.dataset.candles.length) session.advance();
  return session.finish();
}
