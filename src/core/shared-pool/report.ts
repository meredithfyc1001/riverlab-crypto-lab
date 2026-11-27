import { contentHash } from '../backtests/identity';
import { CONVERSION_VERSION } from '../backtests/engine';
import { canonicalSymbol } from '../portfolio/alignment';
import {
  assertMetadata,
  assertPortfolioMemoryBudget,
  checkSource,
  digestPattern,
  digestPortfolioPayload,
  encodePortfolioCsv,
} from '../portfolio/report-common';
import { RULE_STRATEGY_VERSION, STRATEGY_VERSION } from '../strategies';
import type { Metadata } from '../portfolio/report-common';
import { runSharedPool } from './index';
import { SHARED_POOL_VERSIONS, SHARED_EXECUTION_VERSION } from './types';
import type { SharedPoolInput, SharedPoolResult } from './types';

const FORMAT = 'riverlab-shared-pool-experiment';
const SCHEMA = 2;

export interface SharedPoolExperiment extends Metadata {
  format: typeof FORMAT;
  schemaVersion: typeof SCHEMA;
  input: SharedPoolInput;
  result: SharedPoolResult;
  payloadHash: string;
  recordHash: string;
}

function header({ id, name, createdUtcMs }: Metadata, payloadHash: string) {
  return {
    format: FORMAT,
    schemaVersion: SCHEMA,
    id,
    name,
    createdUtcMs,
    payloadHash,
  } as const;
}
function digest(
  input: SharedPoolInput,
  result: SharedPoolResult,
  metadata: Metadata,
) {
  const zero = '0'.repeat(64);
  return digestPortfolioPayload(input, result, {
    ...header(metadata, zero),
    recordHash: zero,
  });
}

export function createSharedPoolExperiment(
  input: SharedPoolInput,
  metadata: Metadata,
  observedUtcMs: number,
): SharedPoolExperiment {
  assertMetadata(metadata);
  assertPortfolioMemoryBudget(input, true);
  checkSource(input, observedUtcMs);
  // Parser metadata may include optional undefined fields. Copy the small header
  // to JSON, preserving full, original candle arrays in the dedicated Worker.
  const quote = input.quoteCurrency.trim().toUpperCase();
  function snapshotAssets<T extends SharedPoolInput['assets'][number]>(
    assets: T[],
  ): T[] {
    return assets
      .map((asset) => {
        const { candles, ...datasetMetadata } = asset.dataset;
        return {
          ...asset,
          dataset: { ...JSON.parse(JSON.stringify(datasetMetadata)), candles },
        };
      })
      .sort((a, b) => {
        const left = canonicalSymbol(a.dataset.symbol, quote);
        const right = canonicalSymbol(b.dataset.symbol, quote);
        return left < right ? -1 : left > right ? 1 : 0;
      });
  }
  const snapshot: SharedPoolInput =
    input.mode === 'rebalance'
      ? { ...input, assets: snapshotAssets(input.assets) }
      : { ...input, assets: snapshotAssets(input.assets) };
  const result = runSharedPool(snapshot);
  const body = header(metadata, digest(snapshot, result, metadata));
  return { ...body, recordHash: contentHash(body), input: snapshot, result };
}

export function verifySharedPoolExperiment(
  value: unknown,
  observedUtcMs: number,
  observeReplay?: (replayed: SharedPoolExperiment) => void,
): SharedPoolExperiment {
  const r = value as SharedPoolExperiment;
  if (!r || r.format !== FORMAT || r.schemaVersion !== SCHEMA)
    throw new Error('共享资金池报告格式或版本不支持。');
  const keys = [
    'format',
    'schemaVersion',
    'id',
    'name',
    'createdUtcMs',
    'input',
    'result',
    'payloadHash',
    'recordHash',
  ];
  if (
    Object.keys(r).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(r, key))
  )
    throw new Error('共享资金池报告字段缺失或含有未知字段。');
  assertMetadata(r);
  const mode = r.input?.mode;
  if (
    (mode !== 'rebalance' && mode !== 'shared-strategy') ||
    r.result?.mode !== mode ||
    r.result.version !== SHARED_POOL_VERSIONS[mode] ||
    r.result.executionVersion !== SHARED_EXECUTION_VERSION ||
    r.result.conversionVersion !== CONVERSION_VERSION
  )
    throw new Error('共享资金池算法或价格转换版本不支持。');
  if (
    !Array.isArray(r.result.assets) ||
    r.result.assets.length !== r.input.assets?.length ||
    r.result.assets.some((a) => {
      if (!a) return true;
      if (mode === 'rebalance') return a.strategyVersion !== null;
      return (
        a.strategyVersion !== STRATEGY_VERSION &&
        a.strategyVersion !== RULE_STRATEGY_VERSION
      );
    })
  )
    throw new Error('共享资金池资产或策略版本不支持。');
  if (
    typeof r.payloadHash !== 'string' ||
    typeof r.recordHash !== 'string' ||
    !digestPattern.test(r.payloadHash) ||
    !digestPattern.test(r.recordHash) ||
    contentHash(header(r, r.payloadHash)) !== r.recordHash
  )
    throw new Error('共享资金池报告 Hash 校验失败。');
  checkSource(r.input, observedUtcMs);
  if (digest(r.input, r.result, r) !== r.payloadHash)
    throw new Error('共享资金池报告 Hash 校验失败。');
  const quote = r.input.quoteCurrency.trim().toUpperCase();
  let previous = '';
  for (const { dataset } of r.input.assets) {
    const symbol = canonicalSymbol(dataset.symbol, quote);
    if (symbol <= previous)
      throw new Error('共享资金池来源须按规范交易对顺序保存。');
    previous = symbol;
  }
  const replay = runSharedPool(r.input);
  const payloadHash = digest(r.input, replay, r);
  if (payloadHash !== r.payloadHash)
    throw new Error('共享资金池完整重算不一致。');
  observeReplay?.({
    ...r,
    result: replay,
    payloadHash,
    recordHash: contentHash(header(r, payloadHash)),
  });
  return r;
}

export function sharedPoolCsv({
  input,
  result: r,
  payloadHash,
}: SharedPoolExperiment): string {
  const rows: (string | number)[][] = [
    ['历史虚拟现货模拟，仅供学习研究，历史表现不代表未来表现'],
    [
      'payloadHash',
      'mode',
      'algorithm',
      'executionVersion',
      'conversionVersion',
      'quoteCurrency',
      'startOpenUtcMs',
      'endOpenUtcMs',
      'initialCash',
      'finalEquity',
      'netPnl',
      'totalReturn',
      'maxDrawdown',
      'fees',
      'fills',
      'benchmarkReturn',
    ],
    [
      payloadHash,
      input.mode,
      r.version,
      r.executionVersion,
      r.conversionVersion,
      input.quoteCurrency,
      input.startUtcMs,
      input.endUtcMs,
      input.initialCash,
      r.curve.at(-1)!.equity,
      r.netPnl,
      r.totalReturn,
      r.maxDrawdown,
      r.fees,
      r.fillCount,
      r.benchmarkReturn,
    ],
    [],
    [
      'symbol',
      'targetWeightPercent',
      'finalQuantity',
      'marketValue',
      'netPnl',
      'buySpend',
      'sellProceeds',
      'fees',
      'strategyVersion',
    ],
    ...r.assets.map((a) => [
      a.symbol,
      a.weightPercent,
      a.quantity,
      a.marketValue,
      a.netPnl,
      a.buySpend,
      a.sellProceeds,
      a.fees,
      a.strategyVersion ?? '',
    ]),
    [],
    [
      'sequence',
      'barIndex',
      'barOpenUtcMs',
      'symbol',
      'phase',
      'side',
      'reason',
      'status',
      'rejection',
      'referencePrice',
      'requestedBudget',
      'approvedBudget',
      'unusedBudget',
      'executionPrice',
      'quantity',
      'notional',
      'fee',
      'cashBefore',
      'cashAfter',
      'quantityBefore',
      'quantityAfter',
    ],
    ...r.orders.map((o) => [
      o.sequence,
      o.barIndex,
      o.barOpenUtcMs,
      o.symbol,
      o.phase,
      o.side,
      o.reason,
      o.status,
      o.rejection ?? '',
      o.referencePrice,
      o.requestedBudget ?? '',
      o.approvedBudget ?? '',
      o.unusedBudget ?? '',
      o.price ?? '',
      o.quantity,
      o.notional,
      o.fee,
      o.cashBefore,
      o.cashAfter,
      o.quantityBefore,
      o.quantityAfter,
    ]),
    [],
    [
      'barIndex',
      'openEquity',
      'cashBeforeBuys',
      'reserve',
      'capacity',
      'requested',
      'approved',
      'spent',
      'cashAfterBuys',
    ],
    ...r.allocations.map((a) => [
      a.barIndex,
      a.openEquity,
      a.cashBeforeBuys,
      a.reserve,
      a.capacity,
      a.requested,
      a.approved,
      a.spent,
      a.cashAfterBuys,
    ]),
    [],
    [
      'barIndex',
      'barOpenUtcMs',
      'symbol',
      'targetPercent',
      'beforePercent',
      'afterPercent',
      'deviationPercent',
    ],
  ];
  const symbols = [...r.assets.map((a) => a.symbol), 'CASH'];
  const target = [...r.assets.map((a) => a.weightPercent), r.cashWeightPercent];
  for (const step of r.rebalances) {
    symbols.forEach((symbol, i) =>
      rows.push([
        step.barIndex,
        step.barOpenUtcMs,
        symbol,
        target[i],
        step.beforePercent[i] ?? 'NA',
        step.afterPercent[i] ?? 'NA',
        step.deviationPercent[i] ?? 'NA',
      ]),
    );
  }
  rows.push(
    [],
    [
      'timestampUtcMs',
      'cash',
      'equity',
      'marketValue',
      'benchmarkEquity',
      'drawdown',
      'cashWeightPercent',
      ...r.assets.map((a) => a.symbol + ' weightPercent'),
      ...r.assets.map((a) => a.symbol + ' netContribution'),
    ],
  );
  for (const p of r.curve)
    rows.push([
      p.timestampUtcMs,
      p.cash,
      p.equity,
      p.marketValue,
      p.benchmarkEquity,
      p.drawdown,
      p.cashWeightPercent ?? 'NA',
      ...p.weightsPercent.map((w) => w ?? 'NA'),
      ...p.contributions,
    ]);
  rows.push([], ['barIndex', 'closeUtcMs', 'symbol', 'decision', 'reason']);
  for (const decision of r.decisions)
    rows.push([
      decision.barIndex,
      decision.closeUtcMs,
      decision.symbol ?? '',
      decision.action,
      decision.reason,
    ]);
  rows.push([], ['benchmarkSymbol', 'rejection']);
  for (const item of r.benchmarkReasons) rows.push([item.symbol, item.reason]);
  rows.push([], ['assumptions'], ...r.assumptions.map((value) => [value]));
  return encodePortfolioCsv(rows);
}
