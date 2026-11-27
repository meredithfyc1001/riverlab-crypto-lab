import assert from 'node:assert/strict';
import type { RepositoryKind } from '../../src/infrastructure/desktop-repository';

export const hashes: Record<RepositoryKind, string[]> = {
  dataset: ['file.sha256'],
  experiment: [
    'payloadHash',
    'payload.result.manifest.runHash',
    'payload.result.manifest.dataHash',
    'payload.result.manifest.signalHash',
  ],
  rule: ['ruleHash', 'recordHash'],
  replay: [
    'payloadHash',
    'payload.sourceHash',
    'payload.resultHash',
    'payload.stateHash',
  ],
  risk: [
    'payloadHash',
    'payload.source.identity.payloadHash',
    'payload.source.dataHash',
    'payload.source.runHash',
  ],
  portfolio: ['recordHash', 'payloadHash'],
  shared_pool: ['recordHash', 'payloadHash'],
  regime: ['reportHash', 'source.payloadHash'],
  advanced: [
    'reportHash',
    'input.ruleRecord.recordHash',
    'input.ruleRecord.ruleHash',
  ],
};
export const comparisonPaths: Record<RepositoryKind, string[]> = {
  dataset: [],
  rule: ['id', 'rule', 'ruleHash', 'recordHash'],
  experiment: [
    'payload.dataset',
    'payload.result.manifest',
    'payload.result.signals',
    'payload.result.orders',
    'payload.result.fills',
    'payload.result.closes',
    'payload.result.final',
    'payload.statistics',
    'payload.statistics.curve',
    'payloadHash',
  ],
  replay: [
    'payload.datasetId',
    'payload.sourceHash',
    'payload.config',
    'payload.risk',
    'payload.cursor',
    'payload.decisions',
    'payload.notes',
    'payload.resultHash',
    'payload.stateHash',
    'payloadHash',
  ],
  risk: [
    'payload.source',
    'payload.preview',
    'payload.simulation.settings',
    'payload.simulation.paths',
    'payload.simulation.quantiles',
    'payload.simulation.bands',
    'payload.simulation',
    'payloadHash',
  ],
  portfolio: [
    'input',
    'result.alignment',
    'result.assets',
    'result.curve',
    'result.fees',
    'result.fillCount',
    'result.netPnl',
    'payloadHash',
    'recordHash',
  ],
  shared_pool: [
    'input',
    'result.alignment',
    'result.orders',
    'result.allocations',
    'result.decisions',
    'result.rebalances',
    'result.assets',
    'result.curve',
    'result.fees',
    'payloadHash',
    'recordHash',
  ],
  regime: [
    'algorithmVersion',
    'modelVersion',
    'params',
    'reference',
    'source',
    'result.labels',
    'result.runs',
    'result.summaries',
    'result.netPnl',
    'reportHash',
  ],
  advanced: [
    'versions',
    'input',
    'input.ruleRecord',
    'result.plan',
    'result.folds',
    'reportHash',
  ],
};
export function field(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((parent, key) => {
    assert(
      parent !== null &&
        typeof parent === 'object' &&
        Object.hasOwn(parent, key),
      '缺少已声明字段 ' + path,
    );
    return (parent as Record<string, unknown>)[key];
  }, value);
}
