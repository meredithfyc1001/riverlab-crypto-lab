import { verifyAdvancedReport } from '../core/advanced-research/report';
import {
  assertDataset,
  assertDatasetSummary,
  summarizeDataset,
} from '../core/data/dataset';
import { validateSnapshotFields } from '../core/data/snapshot-fields';
import {
  summarizeExperiment,
  verifyExperiment,
  type ExperimentSummary,
} from '../core/experiments';
import { verifyRegimeReport } from '../core/market-regime/report';
import { verifyPortfolioExperiment } from '../core/portfolio/report';
import {
  assertPortfolioSummary,
  summarizePortfolio,
  type PortfolioSummary,
} from '../core/portfolio/report-common';
import {
  assertReplayCheckpoint,
  ReplaySession,
  summarizeReplay,
  type ReplaySummary,
} from '../core/replay';
import {
  summarizeRisk,
  verifyRiskStudy,
  type RiskSummary,
} from '../core/risk-analysis';
import { verifyRuleRecord } from '../core/rule-library';
import { verifySharedPoolExperiment } from '../core/shared-pool/report';
import {
  checkSummary as assertAdvancedSummary,
  type AdvancedSummary,
} from './advanced-store';
import type { RepositoryKind } from './desktop-repository';
import { assertExperimentSummary } from './experiment-store';
import {
  checkSummary as assertRegimeSummary,
  type RegimeSummary,
} from './market-regime-store';
import { checkSummary as assertReplaySummary } from './replay-store';
import { checkSummary as assertRiskSummary } from './risk-store';
import { fingerprintSnapshotValue } from './snapshot-format';

type Role = 'body' | 'summary';
type ReadDataset = (id: string) => Promise<unknown>;
type IssueCode =
  | 'invalidKey'
  | 'invalidBody'
  | 'invalidSummary'
  | 'duplicateKey'
  | 'missingBody'
  | 'missingSummary'
  | 'summaryMismatch'
  | 'replaySource'
  | 'ruleLimit';

export interface SnapshotIssue {
  kind: RepositoryKind;
  role: Role;
  key: IDBValidKey;
  code: IssueCode;
  message: string;
}

// Presence is tracked even when metadata is invalid. Missing and corrupt are
// distinct findings. Never hold a report, full stored summary or candle array.
interface Pair {
  body?: string | null;
  summary?: string | null;
}

function checkSummary(kind: RepositoryKind, value: unknown): void {
  switch (kind) {
    case 'dataset':
      return assertDatasetSummary(value);
    case 'experiment':
      return assertExperimentSummary(value as ExperimentSummary);
    case 'replay':
      return assertReplaySummary(value as ReplaySummary);
    case 'risk':
      return assertRiskSummary(value as RiskSummary);
    case 'portfolio':
    case 'shared_pool':
      return assertPortfolioSummary(value as PortfolioSummary);
    case 'regime':
      return assertRegimeSummary(value as RegimeSummary);
    case 'advanced':
      return assertAdvancedSummary(value as AdvancedSummary);
    case 'rule':
      throw new Error('规则库没有独立的摘要存储。');
  }
}

// Object key order alone has no bearing on a derived summary. The snapshot
// writer separately hashes the actual stored order, bytes and clone descriptor.
function sortedSummary(value: unknown): unknown {
  const copies = new WeakMap<object, object>();
  const parents = new WeakSet<object>();
  function visit(node: unknown, depth: number): unknown {
    if (!node || typeof node !== 'object') return node;
    if (depth > 64 || parents.has(node))
      throw new Error('摘要含循环引用或嵌套超过格式上限。');
    const previous = copies.get(node);
    if (previous) return previous;
    parents.add(node);
    let result: object;
    if (Array.isArray(node)) {
      result = node.map((item) => visit(item, depth + 1));
    } else if (Object.getPrototypeOf(node) === Object.prototype) {
      const record = node as Record<string, unknown>;
      result = Object.fromEntries(
        Object.keys(record)
          .sort()
          .map((key) => [key, visit(record[key], depth + 1)]),
      );
    } else {
      result = node;
    }
    parents.delete(node);
    copies.set(node, result);
    return result;
  }
  return visit(value, 0);
}

async function summaryFingerprint(kind: RepositoryKind, summary: unknown) {
  const digest = await fingerprintSnapshotValue(
    kind,
    'summary',
    sortedSummary(summary),
  );
  return digest.projectionSha256 + '/' + digest.cloneSha256;
}

function reportSummary({
  id,
  name,
  createdUtcMs,
  reportHash,
}: RegimeSummary | AdvancedSummary) {
  return { id, name, createdUtcMs, reportHash };
}

class ReplaySourceError extends Error {}

// These two original formats seal the payload hash and select metadata fields
// separately. An extra field outside the payload is never covered by that hash.
const experimentFields = [
  'schemaVersion',
  'id',
  'name',
  'createdUtcMs',
  'elapsedMs',
  'payloadHash',
  'payload',
];
const riskFields = [...experimentFields, 'format'];

function checkEnvelope(value: unknown, fields: string[]) {
  if (
    !value ||
    typeof value !== 'object' ||
    Object.keys(value).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(value, field))
  )
    throw new Error('研究正文顶层字段缺失或含不支持的字段。');
}

/** Call serially in the export Worker. The dependency reader uses the same
 * still-open transaction that supplied the dataset rows at the start of the scan. */
export class SnapshotValidation {
  private readonly pairs = new Map<RepositoryKind, Map<string, Pair>>();
  private readonly datasetIds = new Set<string>();

  constructor(private readonly options: { observedUtcMs: number }) {
    if (
      !Number.isSafeInteger(options.observedUtcMs) ||
      options.observedUtcMs < 0 ||
      options.observedUtcMs > 4_102_444_800_000
    )
      throw new Error('快照校验时刻无效。');
  }

  private checkCompletion(end: number) {
    if (!Number.isSafeInteger(end) || end > this.options.observedUtcMs)
      throw new Error('研究完成时刻无效或晚于快照校验时刻。');
  }

  private async verifyBody(
    kind: RepositoryKind,
    value: unknown,
    readDataset?: ReadDataset,
  ) {
    const { observedUtcMs } = this.options;
    switch (kind) {
      case 'dataset': {
        assertDataset(value);
        validateSnapshotFields(value);
        return summarizeDataset(value);
      }
      case 'rule':
        verifyRuleRecord(value);
        return undefined;
      case 'experiment': {
        checkEnvelope(value, experimentFields);
        const verified = verifyExperiment(value);
        this.checkCompletion(
          verified.payload.result.manifest.completedThroughUtcMs,
        );
        validateSnapshotFields(verified.payload.dataset);
        return summarizeExperiment(verified);
      }
      case 'replay': {
        assertReplayCheckpoint(value);
        const id = value.payload.datasetId;
        if (!this.datasetIds.has(id) || !readDataset)
          throw new ReplaySourceError('同一快照中缺少已校验的原数据集。');
        const dataset = await readDataset(id);
        assertDataset(dataset);
        if (
          dataset.id !== id ||
          dataset.file.sha256 !== value.payload.sourceFileSha256 ||
          dataset.symbol !== value.payload.symbol
        )
          throw new ReplaySourceError(
            '原数据集 ID、交易对或来源文件 SHA-256 不一致。',
          );
        // Replays only the revealed prefix, applying original decisions and
        // checking sourceHash, result/state hashes and the full checkpoint.
        ReplaySession.restore(dataset, value);
        return summarizeReplay(value);
      }
      case 'risk': {
        checkEnvelope(value, riskFields);
        const verified = verifyRiskStudy(value);
        this.checkCompletion(
          verified.payload.source.input.completedThroughUtcMs,
        );
        validateSnapshotFields(verified.payload.source.input.dataset);
        return summarizeRisk(verified);
      }
      case 'portfolio':
        return summarizePortfolio(
          verifyPortfolioExperiment(value, observedUtcMs),
        );
      case 'shared_pool':
        return summarizePortfolio(
          verifySharedPoolExperiment(value, observedUtcMs),
        );
      case 'regime':
        return reportSummary(verifyRegimeReport(value, observedUtcMs));
      case 'advanced':
        return reportSummary(verifyAdvancedReport(value, observedUtcMs));
    }
  }

  async accept(
    kind: RepositoryKind,
    role: Role,
    key: IDBValidKey,
    value: unknown,
    readDataset?: ReadDataset,
  ): Promise<SnapshotIssue[]> {
    const issue = (code: IssueCode, message: string): SnapshotIssue[] => [
      { kind, role, key, code, message },
    ];
    if (
      typeof key !== 'string' ||
      !key.length ||
      !value ||
      typeof value !== 'object' ||
      !Object.hasOwn(value, 'id') ||
      (value as { id: unknown }).id !== key
    )
      return issue(
        'invalidKey',
        '实际主键与记录内部 ID 缺失、类型错误或不一致。',
      );
    if (kind === 'rule' && role === 'summary')
      return issue('invalidSummary', '规则库只能具有 versions 正文存储。');
    let rows = this.pairs.get(kind);
    if (!rows) {
      rows = new Map();
      this.pairs.set(kind, rows);
    }
    const pair = rows.get(key) ?? {};
    if (pair[role] !== undefined)
      return issue('duplicateKey', '同一存储重复出现此主键。');
    rows.set(key, pair);
    pair[role] = null;
    if (kind === 'rule' && rows.size > 100)
      return issue('ruleLimit', '策略库超过既有的 100 版本预算。');
    try {
      const summary =
        role === 'body'
          ? await this.verifyBody(kind, value, readDataset)
          : value;
      if (kind === 'rule') return [];
      checkSummary(kind, summary);
      pair[role] = await summaryFingerprint(kind, summary);
      if (kind === 'dataset' && role === 'body') this.datasetIds.add(key);
      if (pair.body && pair.summary && pair.body !== pair.summary)
        return issue(
          'summaryMismatch',
          '实存摘要与已校验正文的派生摘要不一致。',
        );
      return [];
    } catch (error) {
      const code =
        error instanceof ReplaySourceError
          ? 'replaySource'
          : role === 'body'
            ? 'invalidBody'
            : 'invalidSummary';
      return issue(
        code,
        error instanceof Error ? error.message : '记录未通过领域校验。',
      );
    }
  }

  finish(kind: RepositoryKind): SnapshotIssue[] {
    const rows = this.pairs.get(kind);
    this.pairs.delete(kind);
    if (kind === 'rule' || !rows) return [];
    const issues: SnapshotIssue[] = [];
    let missing = 0;
    for (const [key, pair] of rows) {
      if (pair.body !== undefined && pair.summary !== undefined) continue;
      missing++;
      if (issues.length >= 16) continue;
      const bodyMissing = pair.body === undefined;
      issues.push({
        kind,
        key,
        role: bodyMissing ? 'summary' : 'body',
        code: bodyMissing ? 'missingBody' : 'missingSummary',
        message: bodyMissing
          ? '孤立摘要缺少同主键正文。'
          : '正文缺少同主键实存摘要。',
      });
    }
    if (missing > issues.length)
      issues[issues.length - 1].message +=
        ` 此库共 ${missing} 条配对缺失，列出前 ${issues.length} 条。`;
    return issues;
  }
}
