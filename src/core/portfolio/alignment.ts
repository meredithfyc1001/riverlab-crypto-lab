import { normalizeConfig } from '../backtests/config';
import type { BacktestConfig } from '../backtests/types';
import { canonicalJson } from '../backtests/identity';
import { assertDataset } from '../data/dataset';
import { validateSnapshotFields } from '../data/snapshot-fields';
import type { Dataset, DatasetSummary } from '../data/dataset';
import { decimal, parseDecimal, SCALE } from '../math';
import { windowDataset } from '../research';
import { normalizeRisk } from '../risk';
import type { RiskConfig } from '../risk';
import { verifyRuleRecord } from '../rule-library';
import type { RuleRecord } from '../rule-library';
import { normalizeStrategy } from '../strategies';
import type { StrategyConfig, StrategyInput } from '../strategies';

export const MAX_PORTFOLIO_BARS = 10_000;
const LAST_UTC_MS = 4_102_444_800_000;
const HUNDRED_PERCENT = 100n * SCALE;

export interface PortfolioAsset {
  dataset: Dataset;
  weightPercent: string;
  strategy: StrategyInput;
  ruleRecord?: RuleRecord;
  costs: Omit<BacktestConfig, 'initialCash'>;
  risk: RiskConfig;
}

interface OpenRange {
  /** Inclusive UTC timestamps of the first and last candle OPEN. */
  startUtcMs: number;
  endUtcMs: number;
}

export interface PortfolioInput extends OpenRange {
  initialCash: string;
  quoteCurrency: string;
  completedThroughUtcMs: number;
  rangeConfirmed: true;
  assets: PortfolioAsset[];
}

export interface AssetCoverage {
  symbol: string;
  sourceStartUtcMs: number;
  sourceEndUtcMs: number;
  beforeCount: number;
  afterCount: number;
  beforeRange: OpenRange | null;
  afterRange: OpenRange | null;
}

export interface AlignmentPreview extends OpenRange {
  quoteCurrency: string;
  intervalMs: number;
  commonStartUtcMs: number;
  commonEndUtcMs: number;
  barCount: number;
  totalSourceBars: number;
  assets: AssetCoverage[];
}

export interface PreparedAsset {
  symbol: string;
  dataset: Dataset;
  initialCash: string;
  weightPercent: string;
  strategy: StrategyConfig;
  config: BacktestConfig;
  risk: RiskConfig;
}

function requireFields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
) {
  if (
    !value ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some(
      (key) => !required.includes(key) && !optional.includes(key),
    )
  )
    throw new Error('组合快照字段缺失或含有未知字段。');
}

function canonicalSymbol(symbol: string, quote: string) {
  const text = symbol.trim().toUpperCase();
  // A compact pair uses the explicitly supplied quote. No lookup or inferred quote.
  const separated = /^([A-Z0-9]{1,32})[/-]([A-Z0-9]{1,32})$/.exec(text);
  const base = separated
    ? separated[1]
    : text.endsWith(quote)
      ? text.slice(0, -quote.length)
      : '';
  if (
    (separated && separated[2] !== quote) ||
    !/^[A-Z0-9]{1,32}$/.test(base) ||
    base === quote
  )
    throw new Error(
      `交易对 ${symbol} 与报价货币 ${quote} 不一致或格式不明确。`,
    );
  return `${base}/${quote}`;
}

function utc(value: number) {
  return Number.isSafeInteger(value) && value >= 0 && value <= LAST_UTC_MS;
}

/** UI preview reads bounded summaries only. Worker rechecks every full snapshot. */
export function previewAlignment(
  datasets: readonly DatasetSummary[],
  quoteCurrency: string,
  startUtcMs?: number,
  endUtcMs?: number,
): AlignmentPreview {
  if (!Array.isArray(datasets) || datasets.length < 2 || datasets.length > 5)
    throw new Error('请选择 2–5 个不同交易对。');
  const quote =
    typeof quoteCurrency === 'string' ? quoteCurrency.trim().toUpperCase() : '';
  if (!/^[A-Z0-9]{1,32}$/.test(quote))
    throw new Error('请明确填写统一报价货币。');
  const ids = new Set<string>();
  const symbols = new Set<string>();
  const intervalMs = datasets[0]?.quality?.intervalMs;
  if (!intervalMs || !Number.isSafeInteger(intervalMs) || intervalMs <= 0)
    throw new Error('K 线周期必须为已确认的正整数毫秒。');
  let totalSourceBars = 0;
  const sources = datasets.map((d) => {
    if (!d || typeof d.id !== 'string' || typeof d.symbol !== 'string')
      throw new Error('数据集身份不完整。');
    const symbol = canonicalSymbol(d.symbol, quote);
    if (ids.has(d.id) || symbols.has(symbol))
      throw new Error(`重复数据集或交易对：${symbol}。`);
    ids.add(d.id);
    symbols.add(symbol);
    const quality = d.quality;
    if (!quality || quality.intervalMs !== intervalMs)
      throw new Error('所有资产的 K 线周期必须相同。');
    if (quality.gapCount || quality.missingCandles)
      throw new Error(`${symbol} 原始数据存在缺口，不能运行组合。`);
    const range = quality.range;
    if (
      !range ||
      !utc(range.startUtcMs) ||
      !utc(range.endUtcMs) ||
      !Number.isSafeInteger(quality.validRows) ||
      quality.validRows < 1 ||
      range.endUtcMs - range.startUtcMs !== (quality.validRows - 1) * intervalMs
    )
      throw new Error(`${symbol} 的覆盖范围或行数不一致。`);
    totalSourceBars += quality.validRows;
    return {
      symbol,
      sourceStartUtcMs: range.startUtcMs,
      sourceEndUtcMs: range.endUtcMs,
    };
  });
  if (totalSourceBars > MAX_PORTFOLIO_BARS)
    throw new Error(
      `所有原始快照合计最多 ${MAX_PORTFOLIO_BARS} 根（包含截取区间外的数据）。`,
    );
  const commonStartUtcMs = Math.max(...sources.map((s) => s.sourceStartUtcMs));
  const commonEndUtcMs = Math.min(...sources.map((s) => s.sourceEndUtcMs));
  if (commonStartUtcMs > commonEndUtcMs)
    throw new Error('所选数据集没有共同历史区间。');
  const start = startUtcMs === undefined ? commonStartUtcMs : startUtcMs;
  const end = endUtcMs === undefined ? commonEndUtcMs : endUtcMs;
  if (
    !utc(start) ||
    !utc(end) ||
    start < commonStartUtcMs ||
    end > commonEndUtcMs ||
    end < start ||
    end + intervalMs > LAST_UTC_MS
  )
    throw new Error('确认区间必须位于共同历史区间内，首末根能够完整收盘。');
  const assets = sources.map((s) => {
    const beforeCount = (start - s.sourceStartUtcMs) / intervalMs;
    const afterCount = (s.sourceEndUtcMs - end) / intervalMs;
    if (!Number.isInteger(beforeCount) || !Number.isInteger(afterCount))
      throw new Error(`${s.symbol} 的 UTC 开盘时间未严格对齐。`);
    return {
      ...s,
      beforeCount,
      afterCount,
      beforeRange: beforeCount
        ? { startUtcMs: s.sourceStartUtcMs, endUtcMs: start - intervalMs }
        : null,
      afterRange: afterCount
        ? { startUtcMs: end + intervalMs, endUtcMs: s.sourceEndUtcMs }
        : null,
    };
  });
  return {
    quoteCurrency: quote,
    intervalMs,
    commonStartUtcMs,
    commonEndUtcMs,
    startUtcMs: start,
    endUtcMs: end,
    barCount: (end - start) / intervalMs + 1,
    totalSourceBars,
    assets,
  };
}

function allocate(input: PortfolioInput, coverage: AssetCoverage[]) {
  const capital = parseDecimal(input.initialCash);
  if (capital === 0n) throw new Error('组合初始本金必须大于零。');
  const weights = input.assets.map((a) => parseDecimal(a.weightPercent));
  if (
    weights.some((w) => w <= 0n) ||
    weights.reduce((sum, w) => sum + w, 0n) !== HUNDRED_PERCENT
  )
    throw new Error('每个币种的初始权重须为正，权重总和必须精确等于 100%。');
  const numerators = weights.map((w) => capital * w);
  const cash = numerators.map((n) => n / HUNDRED_PERCENT);
  const residual = capital - cash.reduce((sum, n) => sum + n, 0n);
  const priority = numerators
    .map((n, i) => ({
      index: i,
      symbol: coverage[i].symbol,
      remainder: n % HUNDRED_PERCENT,
    }))
    .sort((a, b) => {
      if (a.remainder !== b.remainder)
        return a.remainder > b.remainder ? -1 : 1;
      return a.symbol < b.symbol ? -1 : 1;
    });
  // The number of undistributed atomic units is strictly less than the asset count.
  for (let i = 0; i < Number(residual); i++) cash[priority[i].index]++;
  const empty = cash.findIndex((amount) => amount === 0n);
  if (empty !== -1)
    throw new Error(
      `${coverage[empty].symbol} 的分配金额取整后为零，请增加本金或调整权重。`,
    );
  return cash.map(decimal);
}

export function preparePortfolio(input: PortfolioInput): {
  alignment: AlignmentPreview;
  assets: PreparedAsset[];
} {
  requireFields(input, [
    'initialCash',
    'quoteCurrency',
    'startUtcMs',
    'endUtcMs',
    'completedThroughUtcMs',
    'rangeConfirmed',
    'assets',
  ]);
  if (input.rangeConfirmed !== true)
    throw new Error('请明确确认共同区间，确认后才能运行。');
  if (
    !Array.isArray(input.assets) ||
    input.assets.length < 2 ||
    input.assets.length > 5
  )
    throw new Error('组合必须包含 2–5 个不同交易对。');
  let bars = 0;
  for (const a of input.assets) {
    requireFields(
      a,
      ['dataset', 'weightPercent', 'strategy', 'costs', 'risk'],
      ['ruleRecord'],
    );
    if (!Array.isArray(a.dataset?.candles))
      throw new Error('缺少完整数据快照。');
    bars += a.dataset.candles.length;
  }
  if (bars > MAX_PORTFOLIO_BARS)
    throw new Error(`所有原始快照合计最多 ${MAX_PORTFOLIO_BARS} 根。`);
  for (const { dataset } of input.assets) {
    assertDataset(dataset);
    validateSnapshotFields(dataset);
  }
  if (!utc(input.startUtcMs) || !utc(input.endUtcMs))
    throw new Error('必须明确确认区间的 UTC 毫秒起止时间。');
  const alignment = previewAlignment(
    input.assets.map((a) => a.dataset),
    input.quoteCurrency,
    input.startUtcMs,
    input.endUtcMs,
  );
  if (
    !utc(input.completedThroughUtcMs) ||
    input.endUtcMs + alignment.intervalMs > input.completedThroughUtcMs
  )
    throw new Error('所选区间包含未完成收盘的 K 线。');
  const allocations = allocate(input, alignment.assets);
  const assets = input.assets.map((asset, i) => {
    const cover = alignment.assets[i];
    const initialCash = allocations[i];
    requireFields(asset.costs, [
      'feeBps',
      'buySlippageBps',
      'sellSlippageBps',
      'quantityDecimals',
      'minNotional',
    ]);
    const config = normalizeConfig({ ...asset.costs, initialCash });
    const strategy = normalizeStrategy(asset.strategy);
    if (strategy.kind === 'rules') {
      const record = verifyRuleRecord(asset.ruleRecord);
      if (canonicalJson(strategy.rule) !== canonicalJson(record.rule))
        throw new Error(`${cover.symbol} 策略与保存的规则版本不一致。`);
    } else if (Object.hasOwn(asset, 'ruleRecord'))
      throw new Error('内置策略不能附加规则版本。');
    return {
      symbol: cover.symbol,
      weightPercent: decimal(parseDecimal(asset.weightPercent)),
      initialCash,
      strategy,
      config,
      risk: normalizeRisk(asset.risk),
      dataset: windowDataset(asset.dataset, {
        fold: 0,
        role: 'full',
        start: cover.beforeCount,
        end: asset.dataset.candles.length - cover.afterCount,
      }),
    };
  });
  return { alignment, assets };
}
