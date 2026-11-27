import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  inspectProfile,
  populateEmptyProfile,
  syntheticLibraries,
} from './phase-6c-a-fixture';
import { blobEntry, download, start } from './phase-6c-snapshot-download';

test('从空测试 profile 正式导出两代规则及对应实验供 SQLite 迁移验收', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await blobEntry(page);
  await populateEmptyProfile(page, syntheticLibraries(true));
  const before = await inspectProfile(page);
  const stores = before.flatMap((database) => database.stores);
  expect(before).toHaveLength(9);
  expect(stores).toHaveLength(17);
  const versions = stores.find((store) => store.name === 'versions')!;
  expect(versions.keys).toEqual(['phase-5e-breakout@1', 'phase-5e-breakout@2']);
  expect(stores.flatMap((store) => store.keys)).toHaveLength(22);

  const directory = join('work', 'phase-6c-b', info.project.name);
  await mkdir(directory, { recursive: true });
  const archive = join(directory, 'synthetic-versions.riverlab-migration');
  const receipt = join(directory, 'browser-receipt.json');
  await start(page);
  await download(page, '下载迁移包', archive);
  await download(page, '下载导出回执', receipt);
  const { fileSha256, rows } = JSON.parse(await readFile(receipt, 'utf8'));
  expect(fileSha256).toBe(
    createHash('sha256')
      .update(await readFile(archive))
      .digest('hex'),
  );
  expect(rows).toBe(22);
  expect(await inspectProfile(page)).toStrictEqual(before);
  const candidate = info.outputPath('candidate');
  const migration = spawnSync(
    process.platform === 'win32' ? 'python' : 'python3',
    [
      '-B',
      'scripts/phase6c/migrate_candidate.py',
      archive,
      '--sha256',
      fileSha256,
      '--candidate-dir',
      candidate,
    ],
    { encoding: 'utf8', timeout: 100_000 },
  );
  expect(
    migration.status,
    migration.stderr + String(migration.error ?? ''),
  ).toBe(0);
  const read = async (name: string) =>
    JSON.parse(await readFile(join(candidate, name), 'utf8'));
  expect(await read('candidate.json')).toMatchObject({
    status: 'READY',
    sourceSha256: fileSha256,
    sourceRows: 22,
    sqliteCounts: { records: 12, summaries: 12, migration_members: 22 },
  });
  const reconciliation = await read('reconciliation.json');
  expect(reconciliation.stores).toHaveLength(17);
  expect(reconciliation.counts).toEqual({
    source: 22,
    imported: 22,
    missing: 0,
    duplicates: 0,
    conflicts: 0,
    damaged: 0,
    extra: 0,
  });
  const history = await read('recomputation.json');
  expect(history.errors).toEqual([]);
  for (const id of versions.keys) {
    expect(history.records).toContainEqual(
      expect.objectContaining({ kind: 'rule', id, status: 'PASS' }),
    );
    expect(history.records).toContainEqual(
      expect.objectContaining({
        kind: 'experiment',
        id: 'synthetic-run-' + id,
        mode: 'full-replay',
        status: 'PASS',
      }),
    );
  }
  expect((await read('reference.json')).historicalChecks).toHaveLength(12);
  expect((await read('recovery.json')).status).toBe('PASS');
  await writeFile(
    archive + '.sha256',
    fileSha256 + '  synthetic-versions.riverlab-migration\n',
  );
});
