import { expect, test, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  aliasesOf,
  decodedLibraries,
  frames,
  sha256,
} from './phase-6c-a-archive';
import {
  syntheticLibraries,
  inspectProfile,
  populateEmptyProfile,
} from './phase-6c-a-fixture';

test.setTimeout(90_000);

async function blobEntry(page: Page) {
  await page.addInitScript(() =>
    Object.defineProperty(window, 'showSaveFilePicker', {
      value: undefined,
      configurable: true,
    }),
  );
  await page.goto('/export.html');
}

async function start(page: Page) {
  await page.getByRole('checkbox', { name: /我确认从当前浏览器配置/ }).check();
  await page.getByRole('button', { name: /^(选择文件并)?开始导出$/ }).click();
}

async function download(page: Page, name: string, path: string) {
  const button = page.getByRole('button', { name, exact: true });
  await button.or(page.getByRole('alert')).first().waitFor({ timeout: 30000 });
  if (await page.getByRole('alert').isVisible()) {
    throw new Error(
      'Export failed: ' + (await page.getByRole('alert').innerText()),
    );
  }
  const [artifact] = await Promise.all([
    page.waitForEvent('download'),
    button.click(),
  ]);
  await artifact.saveAs(path);
  return artifact.suggestedFilename();
}

function verify(file: string, digest: string, ...options: string[]) {
  const run = spawnSync(
    process.platform === 'win32' ? 'python' : 'python3',
    ['scripts/phase6c/verify_bundle.py', file, '--sha256', digest, ...options],
    { encoding: 'utf8' },
  );
  if (run.error) throw run.error;
  return run;
}

test('九库十七个 store 的正式导出、外部校验与全新浏览器逐项恢复', async ({
  page,
  browser,
  baseURL,
}, info) => {
  await blobEntry(page);
  const fixtures = syntheticLibraries();
  await populateEmptyProfile(page, fixtures);
  const before = await inspectProfile(page);
  expect(before).toHaveLength(9);
  expect(before.flatMap((db) => db.stores)).toHaveLength(17);
  // Open from the workbench as a person would, then export twice.
  await page.goto('/#/charts');
  await page.getByRole('link', { name: '导出浏览器研究库快照' }).click();
  const scratch = info.outputPath('round-trip');
  await mkdir(scratch, { recursive: true });
  const archive = join(scratch, 'synthetic-full.riverlab-migration');
  await start(page);
  const filename = await download(page, '下载迁移包', archive);
  const receiptPath = join(scratch, 'browser-receipt.json');
  await download(page, '下载导出回执', receiptPath);
  const checksumPath = archive + '.sha256';
  await download(page, '下载 SHA-256', checksumPath);
  const data = await readFile(archive);
  const digest = sha256(data);
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  // Frozen independently with the Python reference reader for these nine
  // domain fixtures. File timestamps and the fence nonce may vary per export.
  expect(receipt).toMatchObject({
    snapshotContentId:
      'da5a03bb410c69b46803e712fe4f715f7d80974f790f9965247d7a6e40d54fae',
    rows: 17,
    fileSha256: digest,
    bytes: data.length,
  });
  expect(await readFile(checksumPath, 'utf8')).toBe(
    digest + '  ' + filename + '\n',
  );
  const verification = join(scratch, 'verification.json');
  const decoded = join(scratch, 'decoded');
  const ok = verify(
    archive,
    digest,
    '--manifest',
    verification,
    '--decode-dir',
    decoded,
    '--check-frozen-rule',
  );
  expect(ok.status, ok.stderr).toBe(0);
  const fresh = await browser.newContext({ baseURL });
  try {
    const target = await fresh.newPage();
    await target.goto('/export.html');
    await populateEmptyProfile(target, await decodedLibraries(data, decoded));
    await target.reload();
    const rebuilt = await inspectProfile(target);
    expect(rebuilt).toStrictEqual(before);
    for (const name of [
      'riverlab-crypto-lab-experiments',
      'riverlab-crypto-lab-advanced-research',
    ]) {
      const body = (snapshot: typeof rebuilt) =>
        snapshot
          .find((db) => db.name === name)!
          .stores.find((store) => store.name !== 'summaries')!.values[0];
      const originalAliases = aliasesOf(body(before));
      expect(originalAliases.length).toBeGreaterThan(0);
      expect(aliasesOf(body(rebuilt))).toEqual(originalAliases);
    }
    // JSON.stringify would silently omit this key. Explicitly compare its
    // presence and original enumeration order as well as all stored values.
    const storedSource = (snapshot: typeof rebuilt) =>
      (
        snapshot.find((db) => db.name === 'riverlab-crypto-lab')!.stores[0]
          .values[0] as { source: Record<string, unknown> }
      ).source;
    expect(Object.keys(storedSource(rebuilt))).toEqual([
      'kind',
      'url',
      'label',
      'note',
    ]);
    expect(Object.hasOwn(storedSource(rebuilt), 'url')).toBe(true);
  } finally {
    await fresh.close();
  }

  await start(page);
  await download(page, '下载导出回执', join(scratch, 'second.json'));
  const again = JSON.parse(
    await readFile(join(scratch, 'second.json'), 'utf8'),
  );
  expect(again.snapshotContentId).toBe(receipt.snapshotContentId);
  expect(await inspectProfile(page)).toStrictEqual(before);

  // Recompute outer SHA for malformed frames so failure must also exercise
  // inner invariants. The wrong sidecar is checked on an unmodified archive.
  expect(verify(archive, '0'.repeat(64)).status).not.toBe(0);
  const all = frames(data);
  const first = all.find((frame) => frame.tag === 2)!;
  const endRow = all.find((frame) => frame.tag === 5)!;
  const body = all.find((frame) => frame.tag === 3)!;
  const badPayload = Buffer.from(data);
  badPayload[body.start + 9] ^= 1;
  const damagedFiles = {
    'duplicate-row': Buffer.concat([
      data.subarray(0, endRow.end),
      data.subarray(first.start, endRow.end),
      data.subarray(endRow.end),
    ]),
    'changed-payload': badPayload,
    'truncated-footer': data.subarray(0, -1),
  };
  for (const [name, blob] of Object.entries(damagedFiles)) {
    const path = join(scratch, name + '.riverlab-migration');
    await writeFile(path, blob);
    const target = path + '.receipt.json';
    expect(verify(path, sha256(blob), '--manifest', target).status).not.toBe(0);
    await expect(readFile(target)).rejects.toMatchObject({ code: 'ENOENT' });
  }

  const evidence = join('work', 'phase-6c-a', info.project.name);
  await mkdir(evidence, { recursive: true });
  await Promise.all([
    writeFile(join(evidence, 'synthetic-full.riverlab-migration'), data),
    writeFile(
      join(evidence, 'synthetic-full.riverlab-migration.sha256'),
      digest + '  synthetic-full.riverlab-migration\n',
    ),
    writeFile(
      join(evidence, 'browser-receipt.json'),
      await readFile(receiptPath),
    ),
    writeFile(
      join(evidence, 'verification.json'),
      await readFile(verification),
    ),
    writeFile(
      join(evidence, 'reconciliation.json'),
      JSON.stringify(
        {
          source: spawnSync('git', ['rev-parse', 'HEAD'], {
            encoding: 'utf8',
          }).stdout.trim(),
          testedTreeDirty: Boolean(
            spawnSync('git', ['status', '--porcelain'], {
              encoding: 'utf8',
            }).stdout.trim(),
          ),
          browser: info.project.name,
          browserVersion: browser.version(),
          fileSha256: digest,
          snapshotContentId: receipt.snapshotContentId,
          repeatContentId: again.snapshotContentId,
          databases: before.map((db) => ({
            name: db.name,
            version: db.version,
            stores: db.stores.map((store) => ({
              name: store.name,
              keyPath: store.keyPath,
              keys: store.keys,
              valuesSha256: sha256(JSON.stringify(store.values)),
            })),
          })),
          completeStructuredValuesEqual: true,
          ownUndefinedAndOrderEqual: true,
          sharedObjectIdentityEqual: true,
          sourceUnchanged: true,
          independentlyRejected: ['wrong-sha256', ...Object.keys(damagedFiles)],
        },
        null,
        2,
      ) + '\n',
    ),
  ]);
});

test('缺库时报告名称，原库及已缺失的库均保持原样', async ({ page }) => {
  await blobEntry(page);
  const fixtures = syntheticLibraries();
  await populateEmptyProfile(page, fixtures.slice(0, -1));
  const before = await inspectProfile(page);
  await start(page);
  await expect(page.getByRole('alert')).toContainText(
    'riverlab-crypto-lab-advanced-research',
  );
  await expect(page.getByRole('heading', { name: '导出回执' })).toHaveCount(0);
  expect(await inspectProfile(page)).toStrictEqual(before);
});

test('存在但无效的原始摘要不被覆盖或修复', async ({ page }) => {
  await blobEntry(page);
  const fixtures = syntheticLibraries();
  const risk = fixtures.find((db) => db.name.endsWith('-risk'))!;
  const summaries = risk.stores.find((store) => store.name === 'summaries')!;
  Object.assign(summaries.values[0], { payloadHash: '0'.repeat(64) });
  await populateEmptyProfile(page, fixtures);
  const before = await inspectProfile(page);
  await start(page);
  await expect(page.getByRole('alert')).toContainText(/risk|风险/, {
    timeout: 30000,
  });
  await expect(page.getByRole('button', { name: '下载迁移包' })).toHaveCount(0);
  expect(await inspectProfile(page)).toStrictEqual(before);
});

// Picker automation returns a real OPFS file in this test's empty profile.
// Pause a real destination write after the worker's nine-store barrier, while
// keeping page, worker, IDB transactions and writer acknowledgements live.
type ExportControls = { paused: boolean; release: () => void };
declare global {
  interface Window {
    phase6cControls: ExportControls;
    phase6cLegacyWrite?: string;
  }
}
async function fileEntry(page: Page, corruptReadback = false) {
  await page.addInitScript(
    ({ corruptReadback }) => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      window.phase6cControls = { paused: false, release };
      Object.defineProperty(window, 'showSaveFilePicker', {
        configurable: true,
        value: async () => {
          const directory = await navigator.storage.getDirectory();
          const handle = await directory.getFileHandle(
            'selected.riverlab-migration',
            { create: true },
          );
          const previous = await handle.createWritable();
          await previous.write('synthetic prior destination');
          await previous.close();
          return {
            name: handle.name,
            createWritable: async () => {
              const writable = await handle.createWritable();
              return {
                write: async (data: Uint8Array<ArrayBuffer>) => {
                  window.phase6cControls.paused = true;
                  await gate;
                  await writable.write(data);
                },
                close: () => writable.close(),
                abort: () => writable.abort(),
              };
            },
            getFile: async () => {
              const file = await handle.getFile();
              if (!corruptReadback) return file;
              const bytes = new Uint8Array(await file.arrayBuffer());
              bytes[bytes.length - 1] ^= 1;
              return new File([bytes], file.name);
            },
          };
        },
      });
    },
    { corruptReadback },
  );
  await page.goto('/export.html');
  await populateEmptyProfile(page, syntheticLibraries());
}
async function waitForBarrier(page: Page) {
  await start(page);
  await expect(page.getByRole('heading', { name: '源库清单' })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.phase6cControls.paused))
    .toBe(true);
}
async function selectedBytes(page: Page) {
  return Buffer.from(
    await page.evaluate(async () => {
      const dir = await navigator.storage.getDirectory();
      const handle = await dir.getFileHandle('selected.riverlab-migration');
      return Array.from(
        new Uint8Array(await (await handle.getFile()).arrayBuffer()),
      );
    }),
  );
}

test('旧标签页直接写与工作台写入均在九库读取屏障之后提交', async ({
  page,
  context,
}, info) => {
  await fileEntry(page);
  const app = await context.newPage();
  await app.goto('/#/charts');
  await app.getByLabel('已保存的数据集').selectOption('backtest-fixture');
  await app.getByRole('checkbox', { name: /确认删除选中数据集/ }).check();
  const legacy = await context.newPage();
  await legacy.goto('/export.html');
  await waitForBarrier(page);
  await legacy.evaluate(() => {
    const open = indexedDB.open('riverlab-crypto-lab-rules');
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('versions', 'readwrite');
      tx.objectStore('versions').delete('phase-5e-breakout@1');
      window.phase6cLegacyWrite = 'queued';
      tx.oncomplete = () => {
        window.phase6cLegacyWrite = 'committed';
        db.close();
      };
      tx.onabort = () => {
        window.phase6cLegacyWrite = 'aborted';
        db.close();
      };
    };
  });
  await expect
    .poll(() => legacy.evaluate(() => window.phase6cLegacyWrite))
    .toBe('queued');
  await app.getByRole('button', { name: '删除选中数据集' }).click();
  await expect
    .poll(() =>
      app.evaluate(async () =>
        (await navigator.locks.query()).pending?.some(
          (lock) =>
            lock.name === 'riverlab-crypto-lab:snapshot-v1' &&
            lock.mode === 'shared',
        ),
      ),
    )
    .toBe(true);
  // The uncooperative transaction still cannot pass the held native IDB read.
  expect(await legacy.evaluate(() => window.phase6cLegacyWrite)).toBe('queued');
  await page.evaluate(() => window.phase6cControls.release());
  await expect(page.getByRole('heading', { name: '导出回执' })).toBeVisible({
    timeout: 30000,
  });
  await expect
    .poll(() => legacy.evaluate(() => window.phase6cLegacyWrite))
    .toBe('committed');
  await expect
    .poll(
      async () =>
        (await inspectProfile(app)).find(
          (db) => db.name === 'riverlab-crypto-lab',
        )!.stores[0].keys,
    )
    .toEqual([]);
  const bytes = await selectedBytes(page);
  const archive = info.outputPath('concurrent.riverlab-migration');
  await writeFile(archive, bytes);
  const verified = verify(archive, sha256(bytes), '--check-frozen-rule');
  expect(verified.status, verified.stderr).toBe(0);
  const keys = frames(bytes)
    .filter((frame) => frame.tag === 2)
    .map((frame) => JSON.parse(frame.payload.toString('utf8')));
  expect(keys).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ store: 'datasets', key: 'backtest-fixture' }),
      expect.objectContaining({
        store: 'versions',
        key: 'phase-5e-breakout@1',
      }),
    ]),
  );
  const after = await inspectProfile(page);
  expect(
    after.find((db) => db.name.endsWith('-rules'))!.stores[0].keys,
  ).toEqual([]);
});

test('已开始写入时取消，保留原目标且并发读锁释放', async ({ page }) => {
  await fileEntry(page);
  const before = await inspectProfile(page);
  await waitForBarrier(page);
  await page.getByRole('button', { name: '取消导出' }).click();
  await expect(page.getByRole('status')).toContainText('已取消');
  await page.evaluate(() => window.phase6cControls.release());
  await expect(page.getByRole('heading', { name: '导出回执' })).toHaveCount(0);
  expect((await selectedBytes(page)).toString()).toBe(
    'synthetic prior destination',
  );
  expect(await inspectProfile(page)).toStrictEqual(before);
  expect(
    await page.evaluate(async () =>
      (await navigator.locks.query()).held?.some(
        (lock) => lock.name === 'riverlab-crypto-lab:snapshot-v1',
      ),
    ),
  ).toBe(false);
});

test('其他标签请求升级源库时，真实 versionchange 中止导出且不改变库结构', async ({
  page,
  context,
}) => {
  await fileEntry(page);
  const before = await inspectProfile(page);
  const legacy = await context.newPage();
  await legacy.goto('/export.html');
  await waitForBarrier(page);
  await legacy.evaluate(() => {
    const req = indexedDB.open('riverlab-crypto-lab-rules', 2);
    req.onupgradeneeded = () => req.transaction!.abort();
    req.onerror = (event) => event.preventDefault();
    req.onsuccess = () => req.result.close();
  });
  await expect(page.getByRole('alert')).toContainText(/升级|关闭|中止/);
  await page.evaluate(() => window.phase6cControls.release());
  expect((await selectedBytes(page)).toString()).toBe(
    'synthetic prior destination',
  );
  await expect(page.getByRole('heading', { name: '导出回执' })).toHaveCount(0);
  expect(await inspectProfile(page)).toStrictEqual(before);
});

test('文件回读字节数相同但 SHA 不符时不给成功回执', async ({ page }) => {
  await fileEntry(page, true);
  await waitForBarrier(page);
  await page.evaluate(() => window.phase6cControls.release());
  await expect(page.getByRole('alert')).toContainText('SHA-256', {
    timeout: 30000,
  });
  await expect(page.getByRole('heading', { name: '导出回执' })).toHaveCount(0);
});
