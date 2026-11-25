import { runBacktest } from '../backtests';
import type { BacktestResult } from '../backtests';
import { ACCOUNTING_LIMIT, decimal, parseDecimal, readUnits } from '../math';
import { calculateStatistics, fraction } from '../statistics';
import type { Metric, Statistics } from '../statistics';
import { preparePortfolio } from './alignment';
import type { AlignmentPreview, PortfolioInput } from './alignment';
import { marketCorrelations } from './correlation';

export * from './alignment';
export const PORTFOLIO_VERSION = 'independent-spot-portfolio-v1';
export const PORTFOLIO_ASSUMPTIONS = Object.freeze([
  '各子账户以相同报价货币独立记账，一单位引擎报价单位等于一单位组合报价货币，无汇兑。',
  '首根开盘前按权重分配现金，向下取整至18位，再按余数降序逐个分配最小单位。余数相同时按规范交易对ASCII升序分配。任一子账户实际分得零则拒绝运行。',
  '各子账户初始空仓，策略从确认区间首根独立冷启动，期间无调仓或账户间转移。',
  '组合收盘权益等于子账户收盘权益之和。实际子账户权重含其现金，持仓权重只计其持仓市值，两者均以组合权益为分母。',
  '各子账户的收益贡献为其净盈亏除以组合初始本金，费用占比为其手续费除以组合手续费。比率向零截断12位。',
  '最大回撤取含初始本金锚点的组合收盘权益相对历史最高点的最大跌幅。',
  '买入持有基准采用相同本金分配。各子账户按各自手续费、买滑点、数量精度和最小名义额在首根开盘买入。末收盘估值，无期末卖出费用。任一子账户基准拒单则组合基准为NA。',
  '资产相关性为同一UTC时间轴上相邻标的收盘价简单收益的Pearson系数。至少需要两项收益，零方差为NA。收益向零截断至96位小数，系数向零截断至12位。',
]);

export interface PortfolioChild {
  symbol: string;
  weightPercent: string;
  initialCash: string;
  equityWeight: Metric;
  holdingWeight: Metric;
  returnContribution: Metric;
  feeShare: Metric;
  netPnl: string;
  fees: string;
  result: BacktestResult;
  statistics: Statistics;
}

export interface PortfolioPoint {
  timestampUtcMs: number;
  cash: string;
  marketValue: string;
  equity: string;
  benchmarkEquity: string | null;
}

export interface PortfolioResult {
  version: typeof PORTFOLIO_VERSION;
  assumptions: readonly string[];
  alignment: AlignmentPreview;
  quoteCurrency: string;
  initialCash: string;
  assets: PortfolioChild[];
  curve: PortfolioPoint[];
  totalReturn: Metric;
  maxDrawdown: Metric;
  netPnl: string;
  fees: string;
  fillCount: number;
  benchmarkReturn: Metric;
  benchmarkReason: string | null;
  correlations: Metric[][];
  correlationSamples: number;
}

const ratio = (
  num: bigint,
  den: bigint,
  zeroReason = '组合权益为零，权重无定义',
): Metric =>
  den > 0n
    ? { value: fraction(num, den), reason: null }
    : { value: null, reason: zeroReason };

function checkedAmount(units: bigint) {
  if (units < 0n || units >= ACCOUNTING_LIMIT)
    throw new Error('组合账本值必须非负且小于10^78。');
  return decimal(units);
}

/** Execute each strategy once on its own slice, then mark the accounts on the
 * common clock. A single-account result can be audited with the original
 * ledger, version and run hash. */
export function runPortfolio(input: PortfolioInput): PortfolioResult {
  const { alignment, assets: prepared } = preparePortfolio(input);
  const initial = parseDecimal(input.initialCash);
  const children = prepared.map((asset) => {
    const result = runBacktest({
      dataset: asset.dataset,
      config: asset.config,
      strategy: asset.strategy,
      risk: asset.risk,
      completedThroughUtcMs: input.completedThroughUtcMs,
    });
    const statistics = calculateStatistics(
      result,
      String(asset.dataset.candles[0].open),
    );
    return {
      symbol: asset.symbol,
      weightPercent: asset.weightPercent,
      initialCash: asset.initialCash,
      result,
      statistics,
      netPnl: statistics.netPnl,
      fees: statistics.fees,
    };
  });
  if (
    children.reduce((sum, child) => sum + readUnits(child.initialCash), 0n) !==
    initial
  )
    throw new Error('子账户初始资金总和不等于组合本金。');

  const rejectedBenchmarks = children.flatMap(({ symbol, statistics }) =>
    statistics.benchmark.finalEquity.reason
      ? [symbol + ' ' + statistics.benchmark.finalEquity.reason]
      : [],
  );
  const benchmarkReason = rejectedBenchmarks.length
    ? rejectedBenchmarks.join('；')
    : null;
  let peak = initial;
  let worstDrop = 0n;
  let worstPeak = initial;
  let equity = initial;
  let benchmark = initial;
  const curve: PortfolioPoint[] = [
    {
      timestampUtcMs: alignment.startUtcMs,
      cash: decimal(initial),
      marketValue: '0',
      equity: decimal(initial),
      benchmarkEquity: benchmarkReason ? null : decimal(initial),
    },
  ];

  for (let i = 0; i < alignment.barCount; i++) {
    const timestampUtcMs =
      alignment.startUtcMs + (i + 1) * alignment.intervalMs;
    let cash = 0n,
      market = 0n;
    equity = 0n;
    benchmark = 0n;
    for (const child of children) {
      const close = child.result.closes[i];
      if (close.timestampUtcMs !== timestampUtcMs)
        throw new Error('子账户收盘时间与组合UTC时间轴不一致。');
      cash += readUnits(close.account.cash);
      market += readUnits(close.account.marketValue);
      equity += readUnits(close.account.equity);
      if (!benchmarkReason)
        benchmark += readUnits(child.statistics.curve[i + 1].benchmarkEquity!);
    }
    if (cash + market !== equity)
      throw new Error('组合现金加持仓市值与子账户权益和不一致。');
    if (equity > peak) peak = equity;
    const drop = peak - equity;
    if (drop * worstPeak > worstDrop * peak) {
      worstDrop = drop;
      worstPeak = peak;
    }
    curve.push({
      timestampUtcMs,
      cash: checkedAmount(cash),
      marketValue: checkedAmount(market),
      equity: checkedAmount(equity),
      benchmarkEquity: benchmarkReason ? null : checkedAmount(benchmark),
    });
  }

  const fees = children.reduce((sum, child) => sum + readUnits(child.fees), 0n);
  return {
    version: PORTFOLIO_VERSION,
    assumptions: PORTFOLIO_ASSUMPTIONS,
    alignment,
    quoteCurrency: alignment.quoteCurrency,
    initialCash: decimal(initial),
    assets: children.map((child) => ({
      ...child,
      equityWeight: ratio(readUnits(child.result.final.equity), equity),
      holdingWeight: ratio(readUnits(child.result.final.marketValue), equity),
      returnContribution: ratio(
        readUnits(child.result.final.equity) - readUnits(child.initialCash),
        initial,
      ),
      feeShare: ratio(
        readUnits(child.fees),
        fees,
        '组合手续费为零，费用占比无定义',
      ),
    })),
    curve,
    totalReturn: ratio(equity - initial, initial),
    maxDrawdown: ratio(worstDrop, worstPeak),
    netPnl: decimal(equity - initial),
    fees: checkedAmount(fees),
    fillCount: children.reduce(
      (sum, child) => sum + child.result.fills.length,
      0,
    ),
    benchmarkReturn: benchmarkReason
      ? { value: null, reason: benchmarkReason }
      : ratio(benchmark - initial, initial),
    benchmarkReason,
    correlations: marketCorrelations(children.map((c) => c.result.closes)),
    correlationSamples: alignment.barCount - 1,
  };
}
