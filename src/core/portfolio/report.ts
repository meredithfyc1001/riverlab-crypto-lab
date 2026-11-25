import { ALGORITHM_VERSION, CONVERSION_VERSION } from '../backtests';
import { STATISTICS_VERSION } from '../statistics';
import { RULE_STRATEGY_VERSION, STRATEGY_VERSION } from '../strategies';
import { contentHash } from '../backtests/identity';
import { PORTFOLIO_VERSION, runPortfolio } from './index';
import type { PortfolioInput, PortfolioResult } from './index';
import {
  assertPortfolioMemoryBudget,
  assertMetadata,
  checkSource,
  digestPortfolioPayload,
  digestPattern,
  encodePortfolioCsv,
} from './report-common';
import type { Metadata } from './report-common';

export {
  MAX_PORTFOLIO_REPORT_BYTES,
  PORTFOLIO_WORKING_BUDGET_BYTES,
  assertPortfolioMemoryBudget,
  summarizePortfolio,
  assertPortfolioSummary,
} from './report-common';
export type { PortfolioSummary } from './report-common';

const FORMAT = 'riverlab-portfolio-experiment';
const VERSION = 1;
export interface PortfolioExperiment extends Metadata {
  format: typeof FORMAT;
  schemaVersion: typeof VERSION;
  input: PortfolioInput;
  result: PortfolioResult;
  payloadHash: string;
  recordHash: string;
}
function header({ id, name, createdUtcMs }: Metadata, payloadHash: string) {
  return {
    format: FORMAT,
    schemaVersion: VERSION,
    id,
    name,
    createdUtcMs,
    payloadHash,
  } as const;
}

function digestPayload(
  input: PortfolioInput,
  result: PortfolioResult,
  metadata: Metadata,
) {
  const zero = '0'.repeat(64);
  return digestPortfolioPayload(input, result, {
    ...header(metadata, zero),
    recordHash: zero,
  });
}

export function createPortfolioExperiment(
  input: PortfolioInput,
  metadata: Metadata,
  observedUtcMs: number,
): PortfolioExperiment {
  assertMetadata(metadata);
  assertPortfolioMemoryBudget(input, true);
  checkSource(input, observedUtcMs);
  // The Worker already owns a clone. Parser metadata can have optional undefined
  // fields that JSON omits. Normalize only the small metadata, never the candle array.
  const snapshot = {
    ...input,
    assets: input.assets.map((asset) => {
      const { candles, ...datasetMetadata } = asset.dataset;
      return {
        ...asset,
        dataset: { ...JSON.parse(JSON.stringify(datasetMetadata)), candles },
      };
    }),
  } as PortfolioInput;
  const result = runPortfolio(snapshot);
  const body = header(metadata, digestPayload(snapshot, result, metadata));
  return { ...body, recordHash: contentHash(body), input: snapshot, result };
}

export function verifyPortfolioExperiment(
  value: unknown,
  observedUtcMs: number,
): PortfolioExperiment {
  const record = value as PortfolioExperiment;
  if (!record || record.format !== FORMAT || record.schemaVersion !== VERSION)
    throw new Error('组合实验格式或版本不支持。');
  const keys = [
    'format',
    'schemaVersion',
    'id',
    'name',
    'createdUtcMs',
    'payloadHash',
    'recordHash',
    'input',
    'result',
  ];
  if (
    Object.keys(record).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(record, k))
  )
    throw new Error('组合实验缺少字段或含未知字段。');
  assertMetadata(record);
  if (record.result?.version !== PORTFOLIO_VERSION)
    throw new Error('组合算法版本不支持。');
  if (
    !Array.isArray(record.result.assets) ||
    record.result.assets.length < 2 ||
    record.result.assets.length > 5
  )
    throw new Error('组合实验子账户数量无效。');
  for (const asset of record.result.assets) {
    const manifest = asset?.result?.manifest;
    const strategy = manifest?.strategy;
    if (
      manifest?.algorithmVersion !== ALGORITHM_VERSION ||
      manifest.conversionVersion !== CONVERSION_VERSION ||
      asset.statistics?.version !== STATISTICS_VERSION ||
      !strategy ||
      strategy.version !==
        (strategy.config?.kind === 'rules'
          ? RULE_STRATEGY_VERSION
          : STRATEGY_VERSION)
    )
      throw new Error('组合子账户引擎、策略或统计版本不支持。');
  }
  checkSource(record.input, observedUtcMs);
  if (
    !digestPattern.test(record.payloadHash) ||
    !digestPattern.test(record.recordHash) ||
    contentHash(header(record, record.payloadHash)) !== record.recordHash ||
    digestPayload(record.input, record.result, record) !== record.payloadHash
  )
    throw new Error('组合实验 Hash 校验不一致。');
  const replay = runPortfolio(record.input);
  if (digestPayload(record.input, replay, record) !== record.payloadHash)
    throw new Error('组合实验重算不一致，无法打开。');
  return record;
}

export function portfolioCsv(record: PortfolioExperiment): string {
  const { result: r, input } = record;
  const rows: (string | number)[][] = [
    ['仅供学习研究，历史表现不代表未来表现'],
    [
      'portfolioHash',
      'quoteCurrency',
      'startOpenUtcMs',
      'endOpenUtcMs',
      'initialCash',
      'finalEquity',
      'netPnl',
      'totalReturnFraction',
      'maxDrawdownFraction',
      'fees',
      'fills',
      'benchmarkReturnFraction',
      'benchmarkReason',
    ],
    [
      record.payloadHash,
      input.quoteCurrency,
      input.startUtcMs,
      input.endUtcMs,
      input.initialCash,
      r.curve.at(-1)!.equity,
      r.netPnl,
      r.totalReturn.value ?? 'NA',
      r.maxDrawdown.value ?? 'NA',
      r.fees,
      r.fillCount,
      r.benchmarkReturn.value ?? 'NA',
      r.benchmarkReason ?? '',
    ],
    [],
    [
      'symbol',
      'initialWeightPercent',
      'initialCash',
      'finalCash',
      'finalMarketValue',
      'finalEquity',
      'subaccountEquityFraction',
      'holdingMarketValueFraction',
      'returnContributionFraction',
      'feeShareFraction',
      'netPnl',
      'fees',
      'fills',
      'runHash',
    ],
    ...r.assets.map((a) => [
      a.symbol,
      a.weightPercent,
      a.initialCash,
      a.result.final.cash,
      a.result.final.marketValue,
      a.result.final.equity,
      a.equityWeight.value ?? 'NA',
      a.holdingWeight.value ?? 'NA',
      a.returnContribution.value ?? 'NA',
      a.feeShare.value ?? 'NA',
      a.netPnl,
      a.fees,
      a.result.fills.length,
      a.result.manifest.runHash,
    ]),
  ];
  return encodePortfolioCsv(rows);
}
