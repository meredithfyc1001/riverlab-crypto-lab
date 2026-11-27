import { contentHash } from '../../src/core/backtests/identity';
import type { Dataset } from '../../src/core/data/dataset';
import type { RepositoryKind } from '../../src/infrastructure/desktop-repository';
import { field } from './historical-fields';

export interface Relation {
  kind: string;
  id?: string;
  status: 'MATCH' | 'DETACHED' | 'EMBEDDED' | 'CONFLICT' | 'MISSING';
  identity: string;
  actual?: string;
}
function datasetIdentity(d: Dataset) {
  // Historical experiment input normalizes optional undefined metadata to JSON.
  // Source clone fidelity is independently checked on the original dataset row.
  const { candles, ...metadata } = d;
  return contentHash({ ...JSON.parse(JSON.stringify(metadata)), candles });
}
export type Read = (kind: RepositoryKind, id: string) => unknown;
export function relationships(
  kind: RepositoryKind,
  row: unknown,
  read: Read,
): Relation[] {
  const links: Relation[] = [];
  function check(
    kind: RepositoryKind,
    id: string,
    embedded: string,
    identify: (source: unknown) => string,
    required = false,
  ) {
    const target = read(kind, id);
    const actual = target === undefined ? undefined : identify(target);
    links.push({
      kind,
      id,
      identity: embedded,
      actual,
      status:
        actual === undefined
          ? required
            ? 'MISSING'
            : 'DETACHED'
          : actual === embedded
            ? 'MATCH'
            : 'CONFLICT',
    });
  }
  function dataset(value: unknown) {
    const d = value as Dataset;
    check('dataset', d.id, datasetIdentity(d), (value) =>
      datasetIdentity(value as Dataset),
    );
  }
  function strategy(value: unknown) {
    const config = value as
      { kind?: string; rule?: { revision: number } } | undefined;
    if (config?.kind === 'rules' && config.rule) {
      // This historical envelope has the entire rule and revision but no family ID.
      links.push({
        kind: 'embedded-rule-v' + config.rule.revision,
        status: 'EMBEDDED',
        identity: contentHash(config.rule),
      });
    }
  }
  function sourceAssets(input: unknown) {
    for (const asset of field(input, 'assets') as {
      dataset: Dataset;
      strategy?: unknown;
    }[]) {
      dataset(asset.dataset);
      strategy(asset.strategy);
    }
  }
  function reportSource(
    kind: RepositoryKind,
    identity: unknown,
    names: string[],
  ) {
    const identify = (source: unknown) =>
      contentHash(Object.fromEntries(names.map((k) => [k, field(source, k)])));
    check(kind, field(identity, 'id') as string, identify(identity), identify);
  }
  switch (kind) {
    case 'experiment':
      dataset(field(row, 'payload.dataset'));
      strategy(field(row, 'payload.result.manifest.strategy.config'));
      break;
    case 'replay':
      check(
        'dataset',
        field(row, 'payload.datasetId') as string,
        field(row, 'payload.sourceHash') as string,
        (value) => datasetIdentity(value as Dataset),
        true,
      );
      break;
    case 'risk': {
      reportSource('experiment', field(row, 'payload.source.identity'), [
        'id',
        'name',
        'createdUtcMs',
        'elapsedMs',
        'payloadHash',
      ]);
      dataset(field(row, 'payload.source.input.dataset'));
      strategy(field(row, 'payload.source.input.strategy'));
      break;
    }
    case 'regime': {
      const source = field(row, 'source'),
        sourceType = field(source, 'kind');
      const sourceKind =
        sourceType === 'single'
          ? 'experiment'
          : sourceType === 'portfolio'
            ? 'portfolio'
            : 'shared_pool';
      reportSource(sourceKind, source, [
        'id',
        'name',
        'createdUtcMs',
        'payloadHash',
        sourceType === 'single' ? 'elapsedMs' : 'recordHash',
      ]);
      if (sourceType === 'single') {
        dataset(field(source, 'input.dataset'));
        strategy(field(source, 'input.strategy'));
      } else sourceAssets(field(source, 'input'));
      break;
    }
    case 'advanced': {
      dataset(field(row, 'input.dataset'));
      const rule = field(row, 'input.ruleRecord');
      check(
        'rule',
        field(rule, 'id') as string,
        contentHash(rule),
        contentHash,
      );
      break;
    }
    case 'portfolio':
    case 'shared_pool':
      sourceAssets(field(row, 'input'));
      break;
  }
  return links;
}
