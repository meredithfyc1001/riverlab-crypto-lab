import type { BacktestResult } from '../backtests';
import { executeAtReference } from '../backtests/execution';
import { snapshot } from '../backtests/ledger';
import { decimal, parseDecimal, readUnits } from '../math';

export const STATISTICS_VERSION = 'statistics-v1';
export const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
export type Metric =
  { value: string; reason: null } | { value: null; reason: string };
const na = (reason: string): Metric => ({ value: null, reason });
const available = (value: string): Metric => ({ value, reason: null });
/** Dimensionless fraction, truncated towards zero to 12 places, never money. */
export function fraction(n: bigint, d: bigint): string {
  if (d <= 0n) throw new Error('Ratio denominator must be positive.');
  return decimal(((n * 10n ** 12n) / d) * 10n ** 6n);
}
export interface CompletedTrade {
  entryCandleIndex: number;
  exitCandleIndex: number;
  netPnl: string;
}
export interface Statistics {
  version: typeof STATISTICS_VERSION;
  netPnl: string;
  totalReturn: Metric;
  realizedPnl: string;
  unrealizedPnl: string;
  remainingCostBasis: string;
  fees: string;
  completedTrades: CompletedTrade[];
  winRate: Metric;
  profitFactor: Metric;
  maxDrawdown: Metric;
  maxDrawdownAmount: string;
  maxDrawdownDurationMs: number;
  ongoingDrawdownMs: number;
  exposedMs: number;
  exposureFraction: string;
  annualizedReturn: Metric;
  benchmark: {
    return: Metric;
    netPnl: Metric;
    fee: string;
    quantity: string;
    cash: string;
    finalEquity: Metric;
    assumption: string;
  };
  curve: {
    timestampUtcMs: number;
    equity: string;
    drawdown: Metric;
    benchmarkEquity: string | null;
  }[];
}
export const METRIC_DEFINITIONS = Object.freeze([
  '净盈亏=末收盘权益−初始本金；权益=现金+按收盘价向下估值的持仓市值；不强制末尾平仓。',
  '成本基础含买手续费；部分退出按数量比例向下分配成本，最后平仓分配余数；已实现+浮动=净盈亏。滑点已含在成交名义额，不重复扣除。',
  '完成交易=空仓至再次空仓的完整周期；胜率仅净盈利周期/完成周期（含平手）；利润因子仅完成周期盈利总和/亏损绝对总和；无交易或无亏损为NA。',
  '回撤按每根收盘权益与含初始锚点的历史峰值计算；最长持续时间包括末尾未恢复区间；不代表根内最大风险。',
  '暴露为持仓覆盖K线区间上界，根内退出计整根，开盘清仓且未重新买入的根不计；未知根内时间不伪造精确暴露。',
  '买入持有首根开盘买入，初始本金、买滑点、手续费、精度和最小名义额相同，无保护，末收盘估值不清仓，不扣卖成本；拒单NA。',
  '金额18位BigInt规范字符串；无量纲比例向零截断12位。年化CAGR仅>=365天且>=252根、首末权益>0，用365天年及Number近似幂；否则NA与原因。',
]);

export function calculateStatistics(
  r: BacktestResult,
  firstOpen: string,
): Statistics {
  const { closes, fills, manifest: m } = r;
  if (!closes.length)
    throw new Error('统计需要有效收盘快照，空样本不能生成指标。');
  const initial = parseDecimal(m.config.initialCash);
  const start = closes[0].timestampUtcMs - m.intervalMs;
  const end = closes.at(-1)!.timestampUtcMs;
  const duration = end - start;
  if (!(duration > 0)) throw new Error('Invalid statistics time range.');
  let cost = 0n,
    quantity = 0n,
    realized = 0n,
    fees = 0n,
    episode = 0n,
    entry = 0;
  const completedTrades: CompletedTrade[] = [];
  const buyBars = new Set<number>();
  for (const f of fills) {
    const qty = readUnits(f.quantity),
      fee = readUnits(f.fee),
      notional = readUnits(f.notional);
    fees += fee;
    if (f.side === 'buy') {
      if (quantity === 0n) {
        entry = f.candleIndex;
        episode = 0n;
      }
      cost += notional + fee;
      quantity += qty;
      buyBars.add(f.candleIndex);
    } else {
      if (qty > quantity || quantity === 0n)
        throw new Error('Invalid cost basis quantity.');
      const allocated = qty === quantity ? cost : (cost * qty) / quantity;
      const pnl = notional - fee - allocated;
      realized += pnl;
      episode += pnl;
      cost -= allocated;
      quantity -= qty;
      if (quantity === 0n)
        completedTrades.push({
          entryCandleIndex: entry,
          exitCandleIndex: f.candleIndex,
          netPnl: decimal(episode),
        });
    }
  }
  const finalEquity = readUnits(r.final.equity);
  const net = finalEquity - initial;
  const unrealized = readUnits(r.final.marketValue) - cost;
  if (
    realized + unrealized !== net ||
    quantity !== readUnits(r.final.position.quantity)
  )
    throw new Error('统计与账本终值不一致。');
  let wins = 0,
    gains = 0n,
    losses = 0n;
  for (const t of completedTrades) {
    const p = t.netPnl.startsWith('-')
      ? -readUnits(t.netPnl.slice(1))
      : readUnits(t.netPnl);
    if (p > 0n) {
      wins++;
      gains += p;
    } else losses -= p;
  }
  const passive = executeAtReference(
    { cash: initial, quantity: 0n },
    parseDecimal(firstOpen),
    {
      id: 'benchmark',
      side: 'buy',
      quantity: 'all',
      reason: 'passive-first-open',
      signalCandleIndex: null,
      generatedUtcMs: start,
      targetCandleIndex: 0,
    },
    m.config,
  );
  const benchmarkFailure =
    'rejected' in passive ? `基准买入被拒绝：${passive.rejected}` : null;
  const passiveCash =
    'rejected' in passive ? initial : initial - passive.notional - passive.fee;
  const passiveQty = 'rejected' in passive ? 0n : passive.quantity;
  const intrabarSellBars = new Set(
    fills
      .filter((f) => f.side === 'sell' && f.trigger?.phase === 'intrabar')
      .map((f) => f.candleIndex),
  );
  let peak = initial,
    peakTime = start,
    longest = 0,
    ongoing = 0,
    maxN = 0n,
    maxD = 0n,
    maxAmount = 0n;
  let exposedMs = 0;
  const curve: Statistics['curve'] = [
    {
      timestampUtcMs: start,
      equity: decimal(initial),
      drawdown: initial > 0n ? available('0') : na('峰值权益为0'),
      benchmarkEquity: benchmarkFailure ? null : decimal(initial),
    },
  ];
  let benchmarkFinal = initial;
  for (const c of closes) {
    const equity = readUnits(c.account.equity);
    if (equity >= peak) {
      if (ongoing) longest = Math.max(longest, c.timestampUtcMs - peakTime);
      peak = equity;
      peakTime = c.timestampUtcMs;
      ongoing = 0;
    } else {
      ongoing = c.timestampUtcMs - peakTime;
      longest = Math.max(longest, ongoing);
    }
    const drawdown = peak - equity;
    if (peak > 0n && (maxD === 0n || drawdown * maxD > maxN * peak)) {
      maxN = drawdown;
      maxD = peak;
      maxAmount = drawdown;
    }
    // Open sells are known to remove exposure before this interval. Intrabar exits have unknown time.
    const fs = fillsByBarExposure(c.candleIndex);
    if (
      readUnits(c.account.position.quantity) > 0n ||
      buyBars.has(c.candleIndex) ||
      fs
    )
      exposedMs += m.intervalMs;
    benchmarkFinal = readUnits(
      snapshot(
        { cash: passiveCash, quantity: passiveQty },
        readUnits(c.account.markPrice),
      ).equity,
    );
    curve.push({
      timestampUtcMs: c.timestampUtcMs,
      equity: c.account.equity,
      drawdown:
        peak > 0n ? available(fraction(drawdown, peak)) : na('峰值权益为0'),
      benchmarkEquity: benchmarkFailure ? null : decimal(benchmarkFinal),
    });
  }
  function fillsByBarExposure(index: number) {
    return intrabarSellBars.has(index);
  }
  let annualizedReturn: Metric;
  if (duration < YEAR_MS || closes.length < 252)
    annualizedReturn = na('需要至少365天且252根有效收盘样本');
  else if (initial <= 0n || finalEquity <= 0n)
    annualizedReturn = na('年化需要初始和末权益均大于0');
  else {
    const value = Math.expm1(
      (Math.log(Number(finalEquity) / Number(initial)) * YEAR_MS) / duration,
    );
    annualizedReturn =
      Number.isFinite(value) && Math.abs(value) < 1e21
        ? available(value.toFixed(12))
        : na('年化超出可可靠表示范围');
  }
  const rate = (n: bigint) =>
    initial > 0n ? available(fraction(n, initial)) : na('初始本金为0');
  return {
    version: STATISTICS_VERSION,
    netPnl: decimal(net),
    totalReturn: rate(net),
    realizedPnl: decimal(realized),
    unrealizedPnl: decimal(unrealized),
    remainingCostBasis: decimal(cost),
    fees: decimal(fees),
    completedTrades,
    winRate: completedTrades.length
      ? available(fraction(BigInt(wins), BigInt(completedTrades.length)))
      : na('没有已完成交易'),
    profitFactor: !completedTrades.length
      ? na('没有已完成交易')
      : losses > 0n
        ? available(fraction(gains, losses))
        : na('已完成交易没有净亏损，分母为0'),
    maxDrawdown:
      maxD > 0n ? available(fraction(maxN, maxD)) : na('没有正峰值权益'),
    maxDrawdownAmount: decimal(maxAmount),
    maxDrawdownDurationMs: longest,
    ongoingDrawdownMs: ongoing,
    exposedMs,
    exposureFraction: fraction(BigInt(exposedMs), BigInt(duration)),
    annualizedReturn,
    benchmark: {
      return: benchmarkFailure
        ? na(benchmarkFailure)
        : rate(benchmarkFinal - initial),
      netPnl: benchmarkFailure
        ? na(benchmarkFailure)
        : available(decimal(benchmarkFinal - initial)),
      fee: 'rejected' in passive ? '0' : decimal(passive.fee),
      quantity: decimal(passiveQty),
      cash: decimal(passiveCash),
      finalEquity: benchmarkFailure
        ? na(benchmarkFailure)
        : available(decimal(benchmarkFinal)),
      assumption:
        '同区间/本金；首开盘买入，沿用买滑点/费/精度/最小额；无保护；末收盘市值计量、不强制平仓、不扣卖成本。',
    },
    curve,
  };
}
