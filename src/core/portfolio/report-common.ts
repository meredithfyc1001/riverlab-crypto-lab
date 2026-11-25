import { sha256 } from '@noble/hashes/sha2.js';
import { canonicalJson, forEachCanonicalChunk } from '../backtests/identity';
import { assertDataset } from '../data/dataset';
import type { Dataset } from '../data/dataset';
import { validateSnapshotFields } from '../data/snapshot-fields';
import { MAX_PORTFOLIO_BARS } from './alignment';

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

export interface Metadata {
  id: string;
  name: string;
  createdUtcMs: number;
}
export interface PortfolioSummary extends Metadata {
  symbols: string[];
  payloadHash: string;
}
export const digestPattern = /^[a-f0-9]{64}$/;

export function assertMetadata(m: Metadata) {
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

/** Bound the canonical ASCII stream before ever materializing an export string.
 * Canonical ASCII bytes upper-bound compact JSON UTF-8 bytes, including Unicode.
 */
export function digestPortfolioPayload(
  input: unknown,
  result: unknown,
  headerWithEmptyHashes: object,
) {
  assertPortfolioMemoryBudget({ input, result });
  // Merging the two JSON objects replaces their adjacent braces with a comma.
  let bytes = canonicalJson(headerWithEmptyHashes).length - 1;
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

export function checkSource(
  input: { completedThroughUtcMs: number; assets: { dataset: Dataset }[] },
  observedUtcMs: number,
) {
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

export interface PortfolioRecordMetadata extends Metadata {
  payloadHash: string;
  input: { assets: { dataset: Dataset }[] };
}
export function summarizePortfolio(
  e: PortfolioRecordMetadata,
): PortfolioSummary {
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

export function encodePortfolioCsv(rows: (string | number)[][]): string {
  const quote = (value: string | number) => {
    let s = String(value);
    if (/^\s*[=+@-]/.test(s) && !/^-\d+(?:\.\d+)?$/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  return (
    '\ufeff' + rows.map((row) => row.map(quote).join(',')).join('\r\n') + '\r\n'
  );
}
