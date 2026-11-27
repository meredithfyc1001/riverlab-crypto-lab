// Cold, read-only verification of one RLIDB001 migration candidate. The
// manifest is the result of the formal archive parser. Read values, including
// clone descriptors, from the candidate itself for every check below.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import {
  relationships,
  type Relation,
  type Read,
} from './historical-relations';
import { comparisonPaths, hashes, field } from './historical-fields';
import type { Dataset } from '../../src/core/data/dataset';
import { layouts } from '../../src/infrastructure/database-layouts';
import type { RepositoryKind } from '../../src/infrastructure/desktop-repository';
import { fingerprintSnapshotValue } from '../../src/infrastructure/snapshot-format';
import { restoreSnapshotValue } from '../../src/infrastructure/snapshot-restore';
import { SnapshotValidation } from '../../src/infrastructure/snapshot-validation';
import type { SnapshotRole } from '../../src/infrastructure/snapshot-value';

interface Member {
  key: string;
  id: string;
  role: SnapshotRole;
  database: string;
  store: string;
  projectionBytes: number;
  projectionSha256: string;
  cloneBytes: number;
  cloneSha256: string;
}
interface Manifest {
  rows: number;
  snapshotContentId: string;
  packageSha256: string;
  members: Member[];
  source: { barrierUtcMs: number };
}
interface Comparison {
  path: string;
  equal: boolean;
  entries?: number;
  hash?: string;
}
interface Result {
  kind: RepositoryKind;
  id: string;
  status: 'PASS' | 'FAIL';
  mode: string;
  comparisons: Comparison[];
  relations: Relation[];
  errors: string[];
  elapsedMs: number;
  originalBusinessHashes: Record<string, string>;
  summaryVerified: boolean;
  sourceRows: {
    role: SnapshotRole;
    projectionSha256: string;
    cloneSha256: string;
  }[];
  dataset?: { schemaVersion: number; candles: number; coverage: string };
}
const kinds = Object.keys(layouts) as RepositoryKind[];
function digest(text: string | Uint8Array) {
  return createHash('sha256').update(text).digest('hex');
}
function message(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
export async function verifyCandidate(candidate: string, decoded: string) {
  const started = performance.now();
  const manifest: Manifest = JSON.parse(
    readFileSync(join(decoded, 'manifest.json'), 'utf8'),
  );
  const expected = new Map<string, Member>();
  const byKind = new Map(kinds.map((kind) => [kind, new Set<string>()]));
  const keyOf = (kind: RepositoryKind, role: SnapshotRole, id: string) =>
    JSON.stringify([kind, role, id]);
  assert.equal(manifest.members.length, manifest.rows);
  for (const member of manifest.members) {
    const kind = kinds.find((kind) => layouts[kind][0] === member.database);
    assert(
      kind && member.key === member.id && member.key.length > 0,
      '原始成员身份无效',
    );
    assert(
      member.role === 'body'
        ? member.store === layouts[kind][1]
        : member.role === 'summary' &&
            kind !== 'rule' &&
            member.store === 'summaries',
      '原始角色/存储不匹配',
    );
    const key = keyOf(kind, member.role, member.id);
    assert(!expected.has(key), '原清单重复键 ' + key);
    expected.set(key, member);
    byKind.get(kind)!.add(member.id);
  }
  const records: Result[] = [];
  const errors: string[] = [];
  const db = new DatabaseSync(candidate, {
    readOnly: true,
    allowExtension: false,
  });
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; BEGIN');
    assert.equal(
      db.prepare('PRAGMA application_id').get()?.application_id,
      0x52564c42,
    );
    assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, 1);
    const descriptor = db.prepare(
      "SELECT CAST(descriptor AS BLOB) AS bytes,projection_sha256,clone_sha256 FROM migration_members WHERE kind=? AND id=? AND role=? AND typeof(descriptor)='text' AND octet_length(descriptor)<=20971520",
    );
    const body = db.prepare(
      "SELECT CAST(body AS BLOB) AS bytes FROM records WHERE kind=? AND id=? AND typeof(body)='text' AND octet_length(body)<=268435456",
    );
    const summary = db.prepare(
      "SELECT CAST(summary AS BLOB) AS bytes FROM summaries WHERE kind=? AND id=? AND typeof(summary)='text' AND octet_length(summary)<=20971520",
    );
    const decode = (bytes: Uint8Array) =>
      new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    const read: Read = (kind, id) => {
      const found = body.get(kind, id);
      if (!found) {
        assert(
          !byKind.get(kind)?.has(id),
          '源清单内的关联正文未能从候选读取 ' + kind + ' ' + id,
        );
        return undefined;
      }
      return JSON.parse(decode(found.bytes as Uint8Array));
    };
    async function memberValue(
      kind: RepositoryKind,
      id: string,
      role: SnapshotRole,
    ) {
      const member = expected.get(keyOf(kind, role, id));
      assert(member, '缺少原始成员 ' + role);
      const data = (role === 'body' ? body : summary).get(kind, id)?.bytes;
      const desc = descriptor.get(kind, id, role);
      assert(
        data instanceof Uint8Array && desc?.bytes instanceof Uint8Array,
        'SQLite 成员缺失或超过容量',
      );
      assert.equal(data.length, member.projectionBytes);
      assert.equal(digest(data), member.projectionSha256);
      assert.equal(desc.bytes.length, member.cloneBytes);
      assert.equal(digest(desc.bytes), member.cloneSha256);
      assert.equal(desc.projection_sha256, member.projectionSha256);
      assert.equal(desc.clone_sha256, member.cloneSha256);
      const value = restoreSnapshotValue(decode(data), decode(desc.bytes));
      const actual = await fingerprintSnapshotValue(kind, role, value);
      assert.equal(
        actual.projectionSha256,
        member.projectionSha256,
        '还原后的投影与原 SHA 不符',
      );
      assert.equal(
        actual.cloneSha256,
        member.cloneSha256,
        '还原后的共享引用、显式 undefined 或键序与原 SHA 不符',
      );
      return value;
    }
    const rules = byKind.get('rule')!;
    for (const [table, role] of [
      ['records', 'body'],
      ['summaries', 'summary'],
      ['migration_members', 'member'],
    ] as const) {
      const seen = new Set<string>();
      for (const row of db
        .prepare(
          'SELECT kind,id' +
            (role === 'member' ? ',role' : '') +
            ' FROM ' +
            table,
        )
        .iterate()) {
        const kind = row.kind as RepositoryKind,
          id = row.id as string;
        const sourceRole =
          role === 'member' ? (row.role as SnapshotRole) : role;
        const physicalKey = keyOf(kind, sourceRole, id);
        if (seen.has(physicalKey))
          errors.push(
            'SQLite 重复行 ' + JSON.stringify([table, kind, id, sourceRole]),
          );
        seen.add(physicalKey);
        if (
          !expected.has(keyOf(kind, sourceRole, id)) &&
          !(role === 'summary' && kind === 'rule' && rules.has(id))
        )
          errors.push(
            'SQLite 额外行 ' + JSON.stringify([table, kind, id, sourceRole]),
          );
      }
    }
    let current: Result;
    const validation = new SnapshotValidation({
      observedUtcMs: manifest.source.barrierUtcMs,
      observeReplay(kind, original, rebuilt) {
        const paths = [...comparisonPaths[kind]];
        if (kind === 'portfolio') {
          const assets = field(original, 'result.assets') as unknown[];
          for (const index of assets.keys())
            for (const metric of [
              'result.manifest',
              'result.orders',
              'result.fills',
              'result.closes',
              'statistics',
              'fees',
            ])
              paths.push('result.assets.' + index + '.' + metric);
        } else if (kind === 'advanced') {
          const folds = field(original, 'result.folds') as unknown[];
          for (const index of folds.keys())
            paths.push(
              'result.folds.' + index + '.train',
              'result.folds.' + index + '.test',
            );
        }
        for (const path of paths) {
          const before = field(original, path),
            after = field(rebuilt, path);
          const equal = isDeepStrictEqual(before, after);
          const result: Comparison = { path, equal };
          if (Array.isArray(before)) result.entries = before.length;
          if (typeof before === 'string' && /^[a-f0-9]{64}$/.test(before))
            result.hash = before;
          current.comparisons.push(result);
          if (!equal) current.errors.push('逐项复算不符 ' + path);
        }
        const equal = isDeepStrictEqual(original, rebuilt);
        current.comparisons.push({ path: '$', equal });
        if (!equal) current.errors.push('完整复算对象与原记录不一致');
      },
    });
    for (const kind of kinds) {
      for (const id of byKind.get(kind)!) {
        const start = performance.now();
        current = {
          kind,
          id,
          status: 'FAIL',
          mode:
            kind === 'dataset'
              ? 'source-data-validation'
              : kind === 'rule'
                ? 'rule-revision-verification'
                : 'full-replay',
          comparisons: [],
          relations: [],
          errors: [],
          elapsedMs: 0,
          originalBusinessHashes: {},
          summaryVerified: false,
          sourceRows: [],
        };
        records.push(current);
        try {
          const value = await memberValue(kind, id, 'body');
          const sourceBody = expected.get(keyOf(kind, 'body', id))!;
          current.sourceRows.push({
            role: 'body',
            projectionSha256: sourceBody.projectionSha256,
            cloneSha256: sourceBody.cloneSha256,
          });
          const issues = await validation.accept(
            kind,
            'body',
            id,
            value,
            async (datasetId) => memberValue('dataset', datasetId, 'body'),
          );
          for (const issue of issues)
            current.errors.push(issue.code + ': ' + issue.message);
          if (!issues.length) {
            if (kind === 'dataset') {
              const d = value as Dataset;
              current.dataset = {
                schemaVersion: d.schemaVersion,
                candles: d.candles.length,
                coverage:
                  'Stored OHLCV, identity, source metadata, quality counts, original body and summary. The RLIDB001 snapshot contains no raw CSV bytes.',
              };
            }
            current.relations = relationships(kind, value, read);
            current.errors.push(
              ...current.relations
                .filter(
                  (r) => r.status === 'CONFLICT' || r.status === 'MISSING',
                )
                .map((r) => r.status + ' ' + r.kind + ' ' + r.id),
            );
          }
          for (const path of hashes[kind])
            current.originalBusinessHashes[path] = field(value, path) as string;
          if (kind === 'rule') {
            const copied = summary.get(kind, id)?.bytes;
            assert(copied instanceof Uint8Array);
            assert.equal(
              digest(copied),
              expected.get(keyOf(kind, 'body', id))!.projectionSha256,
              '规则派生摘要必须存储原版本全行',
            );
            current.summaryVerified = true;
          } else {
            const saved = await memberValue(kind, id, 'summary');
            const sourceSummary = expected.get(keyOf(kind, 'summary', id))!;
            current.sourceRows.push({
              role: 'summary',
              projectionSha256: sourceSummary.projectionSha256,
              cloneSha256: sourceSummary.cloneSha256,
            });
            const issues = await validation.accept(kind, 'summary', id, saved);
            current.summaryVerified =
              issues.length === 0 && current.errors.length === 0;
            for (const issue of issues)
              current.errors.push(issue.code + ': ' + issue.message);
          }
        } catch (error) {
          current.errors.push(message(error));
        }
        current.status = current.errors.length ? 'FAIL' : 'PASS';
        current.elapsedMs = performance.now() - start;
      }
      for (const issue of validation.finish(kind))
        errors.push(JSON.stringify(issue));
    }
    db.exec('ROLLBACK');
  } finally {
    db.close();
  }
  return {
    status:
      errors.length || records.some((r) => r.status === 'FAIL')
        ? 'FAIL'
        : 'PASS',
    sourceSha256: manifest.packageSha256,
    snapshotContentId: manifest.snapshotContentId,
    observedUtcMs: manifest.source.barrierUtcMs,
    elapsedMs: performance.now() - started,
    records,
    errors,
  };
}

const [candidate, decoded, output] = process.argv.slice(2);
try {
  assert(
    candidate && decoded && output && process.argv.length === 5,
    '用法：node recompute.mjs <候选库> <正式解码目录> <新报告.json>',
  );
  const report = await verifyCandidate(candidate, decoded);
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  if (report.status !== 'PASS') process.exitCode = 1;
} catch (error) {
  console.error(message(error));
  process.exitCode = 1;
}
