import { assertDataset } from '../data/dataset';
import { normalizeConfig } from './config';
import { decimal, parseDecimal, SCALE } from './decimal';
import { executeAtOpen } from './execution';
import { contentHash } from './identity';
import { ledgerAuditor, snapshot } from './ledger';
import type {
  BacktestInput,
  BacktestResult,
  OrderIntent,
  Signal,
  RunManifest,
} from './types';

export const ALGORITHM_VERSION = 'spot-long-next-open-v1';
export const CONVERSION_VERSION = 'number-shortest-decimal-fixed18-v1';
export const RUN_ASSUMPTIONS = Object.freeze([
  'virtual-USDT-single-symbol-spot-long-only-no-leverage',
  'caller-declares-all-candles-completed',
  'scripted-signals-only-not-causal-strategy-certification',
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

export function runBacktest(input: BacktestInput): BacktestResult {
  const { dataset: d, completedThroughUtcMs } = input;
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
  const signals = normalizeSignals(input.signals, tape.length);
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
    }),
    sourceFileSha256: d.file.sha256,
    source: JSON.parse(JSON.stringify(d.source)) as RunManifest['source'],
    quality: JSON.parse(JSON.stringify(d.quality)) as RunManifest['quality'],
    symbol: d.symbol,
    intervalMs,
    completedThroughUtcMs,
    config,
    signals,
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
  for (let i = 0; i < tape.length; i++) {
    const c = tape[i],
      open = parseDecimal(c.open);
    if (pending) {
      const execution = executeAtOpen(
        { cash, quantity },
        open,
        pending,
        config,
      );
      if ('rejected' in execution)
        result.orders.push({
          intent: pending,
          status: 'rejected',
          reason: execution.rejected,
          resolvedUtcMs: c.timestampUtcMs,
        });
      else {
        const { price, quantity: qty, notional, fee } = execution;
        const before = snapshot({ cash, quantity }, open);
        const beforeEquity = cash + (quantity * open) / SCALE;
        const sign = pending.side === 'buy' ? 1n : -1n;
        cash -= sign * notional + fee;
        quantity += sign * qty;
        fees += fee;
        if (pending.side === 'buy') {
          buyNotional += notional;
          buyQuantity += qty;
        } else {
          sellNotional += notional;
          sellQuantity += qty;
        }
        const fill = {
          sequence: result.fills.length + 1,
          orderId: pending.id,
          side: pending.side,
          reason: pending.reason,
          signalCandleIndex: pending.signalCandleIndex,
          candleIndex: i,
          timestampUtcMs: c.timestampUtcMs,
          referencePrice: c.open,
          price: decimal(price),
          quantity: decimal(qty),
          notional: decimal(notional),
          fee: decimal(fee),
          before,
          after: snapshot({ cash, quantity }, open),
          delta: {
            cash: decimal(-sign * notional - fee),
            quantity: decimal(sign * qty),
            equity: decimal(cash + (quantity * open) / SCALE - beforeEquity),
          },
          totals: {
            buyNotional: decimal(buyNotional),
            sellNotional: decimal(sellNotional),
            fees: decimal(fees),
            buyQuantity: decimal(buyQuantity),
            sellQuantity: decimal(sellQuantity),
          },
        };
        audit(fill); // Conservation/reconciliation is mandatory after every simulated fill.
        result.fills.push(fill);
        result.orders.push({
          intent: pending,
          status: 'filled',
          resolvedUtcMs: c.timestampUtcMs,
        });
      }
      pending = undefined;
    }
    const closeTime = c.timestampUtcMs + intervalMs;
    result.closes.push({
      candleIndex: i,
      timestampUtcMs: closeTime,
      account: snapshot({ cash, quantity }, parseDecimal(c.close)),
    });
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
  }
  if (pending)
    result.orders.push({
      intent: pending,
      status: 'expired',
      reason: 'no-next-candle',
      resolvedUtcMs: pending.generatedUtcMs,
    });
  result.final = result.closes.at(-1)!.account;
  return result;
}
