import { sha256 } from '@noble/hashes/sha2.js';
import { ALGORITHM_VERSION, CONVERSION_VERSION } from '../backtests';
import { STATISTICS_VERSION } from '../statistics';
import { RULE_STRATEGY_VERSION, STRATEGY_VERSION } from '../strategies';
import {
  canonicalJson,
  contentHash,
  forEachCanonicalChunk,
} from '../backtests/identity';
import { validateSnapshotFields } from '../data/snapshot-fields';
import { assertDataset } from '../data/dataset';
import { MAX_PORTFOLIO_BARS, PORTFOLIO_VERSION, runPortfolio } from './index';
import type { PortfolioInput, PortfolioResult } from './index';

export const MAX_PORTFOLIO_REPORT_BYTES = 32 * 1024 * 1024;
export const PORTFOLIO_WORKING_BUDGET_BYTES = 256 * 1024 * 1024;

// Charge 128 MiB for a 32 MiB Blob, a 32 MiB byte view and a 64 MiB
// decoded string. Charge two complete trees for verification against replay.
// This admission budget counts logical storage; JS engines control actual RSS.
export function assertPortfolioMemoryBudget(
  value: unknown,
  allowUndefined = false,
) {
  let bytes = MAX_PORTFOLIO_REPORT_BYTES * 4;
  function charge(n: number) {
    bytes += 2 * n;
    if (bytes > PORTFOLIO_WORKING_BUDGET_BYTES)
      throw new Error('组合估算工作内存超过 256 MiB。');
  }
  function visit(node: unknown, depth: number) {
    if (depth > 40) throw new Error('组合报告嵌套过深。');
    if (typeof node === 'string') {
      charge(32 + node.length * 2);
      // The longest allowed free text is a dataset source note/issue (3000).
      // Bound transient canonical escaping buffers even on malformed records.
      if (node.length > 4096) throw new Error('组合报告字段过长。');
    } else if (Array.isArray(node)) {
      charge(32 + node.length * 8);
      if (Object.keys(node).length !== node.length)
        throw new Error('组合报告含稀疏数组或额外数组字段。');
      for (let i = 0; i < node.length; i++) {
        if (!Object.hasOwn(node, i)) throw new Error('组合报告含稀疏数组。');
        visit(node[i], depth + 1);
      }
    } else if (node !== null && typeof node === 'object') {
      if (Object.getPrototypeOf(node) !== Object.prototype)
        throw new Error('组合报告只能包含普通 JSON 对象。');
      charge(64);
      for (const key of Object.keys(node)) {
        charge(16 + 2 * key.length);
        if (key.length > 256) throw new Error('组合报告键名过长。');
        visit((node as Record<string, unknown>)[key], depth + 1);
      }
    } else if (
      node === null ||
      typeof node === 'boolean' ||
      (typeof node === 'number' && Number.isFinite(node)) ||
      (allowUndefined && node === undefined)
    )
      charge(16);
    else throw new Error('组合报告包含非 JSON 值。');
  }
  visit(value, 0);
}

const FORMAT = 'riverlab-portfolio-experiment';
const VERSION = 1;
interface Metadata {
  id: string;
  name: string;
  createdUtcMs: number;
}
export interface PortfolioExperiment extends Metadata {
  format: typeof FORMAT;
  schemaVersion: typeof VERSION;
  input: PortfolioInput;
  result: PortfolioResult;
  payloadHash: string;
  recordHash: string;
}
export interface PortfolioSummary extends Metadata {
  symbols: string[];
  payloadHash: string;
}
const digestPattern = /^[a-f0-9]{64}$/;

function assertMetadata(m: Metadata) {
  if (
    !m ||
    typeof m.id !== 'string' ||
    !m.id.trim() ||
    m.id.length > 100 ||
    typeof m.name !== 'string' ||
    !m.name.trim() ||
    m.name.length > 160 ||
    !Number.isSafeInteger(m.createdUtcMs) ||
    m.createdUtcMs < 0 ||
    m.createdUtcMs > 4_102_444_800_000
  )
    throw new Error('组合实验身份、名称或时间无效。');
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

/** Bound the canonical ASCII stream before ever materializing an export string.
 * Canonical ASCII bytes upper-bound compact JSON UTF-8 bytes, including Unicode.
 */
function digestPayload(
  input: PortfolioInput,
  result: PortfolioResult,
  metadata: Metadata,
) {
  assertPortfolioMemoryBudget({ input, result });
  const zero = '0'.repeat(64);
  // Merging the two JSON objects replaces their adjacent braces with a comma.
  let bytes =
    canonicalJson({ ...header(metadata, zero), recordHash: zero }).length - 1;
  const hash = sha256.create();
  forEachCanonicalChunk({ input, result }, (chunk) => {
    bytes += chunk.length;
    if (bytes > MAX_PORTFOLIO_REPORT_BYTES)
      throw new Error('组合报告超过 32 MiB 预算，请缩短回测区间或减少数据量。');
    hash.update(chunk);
  });
  return Array.from(hash.digest(), (n) => n.toString(16).padStart(2, '0')).join(
    '',
  );
}

function checkSource(input: PortfolioInput, observedUtcMs: number) {
  if (
    !input ||
    !Number.isSafeInteger(observedUtcMs) ||
    !Number.isSafeInteger(input.completedThroughUtcMs) ||
    input.completedThroughUtcMs > observedUtcMs
  )
    throw new Error('组合收盘确认时间无效或晚于当前时间。');
  if (
    !Array.isArray(input.assets) ||
    input.assets.length < 2 ||
    input.assets.length > 5
  )
    throw new Error('组合需要 2–5 个资产。');
  let rows = 0;
  for (const asset of input.assets) {
    if (!Array.isArray(asset?.dataset?.candles))
      throw new Error('组合行情快照损坏。');
    rows += asset.dataset.candles.length;
    if (rows > MAX_PORTFOLIO_BARS)
      throw new Error('所有源数据合计最多 10,000 根。');
    assertDataset(asset.dataset);
    validateSnapshotFields(asset.dataset);
  }
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

export function summarizePortfolio(e: PortfolioExperiment): PortfolioSummary {
  const { id, name, createdUtcMs, payloadHash } = e;
  return {
    id,
    name,
    createdUtcMs,
    payloadHash,
    symbols: e.input.assets.map((a) => a.dataset.symbol),
  };
}
export function assertPortfolioSummary(s: PortfolioSummary) {
  assertMetadata(s);
  if (
    !digestPattern.test(s.payloadHash) ||
    !Array.isArray(s.symbols) ||
    s.symbols.length < 2 ||
    s.symbols.length > 5 ||
    s.symbols.some(
      (v) => typeof v !== 'string' || !v.trim() || v.length > 80,
    ) ||
    new Set(s.symbols).size !== s.symbols.length
  )
    throw new Error('组合摘要损坏。');
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
  const quote = (value: string | number) => {
    let s = String(value);
    if (/^\s*[=+@-]/.test(s) && !/^-\d+(?:\.\d+)?$/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  return (
    '\ufeff' + rows.map((row) => row.map(quote).join(',')).join('\r\n') + '\r\n'
  );
}
