// Run only against the extracted Windows browser kit and an empty Playwright context.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'vite';

export async function checkSnapshotPackage(page, url, folder, evidence) {
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, 'showSaveFilePicker', {
      value: undefined,
    });
  });
  await page.goto(url + '/export.html');
  const vite = await createServer({
    configFile: false,
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });
  try {
    const fixtures = await vite.ssrLoadModule(
      '/tests/e2e/phase-6c-a-fixture.ts',
    );
    await fixtures.populateEmptyProfile(page, fixtures.syntheticLibraries());
    const before = await fixtures.inspectProfile(page);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: '开始导出', exact: true }).click();
    await mkdir(evidence, { recursive: true });
    async function save(button, filename) {
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: button, exact: true }).click();
      const download = await pending;
      await download.saveAs(join(evidence, filename));
    }
    const archive = 'synthetic-full.riverlab-migration';
    await save('下载迁移包', archive);
    await save('下载 SHA-256', archive + '.sha256');
    await save('下载导出回执', 'browser-receipt.json');
    assert.deepEqual(await fixtures.inspectProfile(page), before);
    const actual = createHash('sha256')
      .update(await readFile(join(evidence, archive)))
      .digest('hex');
    const expected = (
      await readFile(join(evidence, archive + '.sha256'), 'utf8')
    )
      .trim()
      .split(/\s+/)[0];
    assert.equal(actual, expected);
    const output = execFileSync(
      process.env.RIVERLAB_PYTHON ??
        (process.platform === 'win32' ? 'python' : 'python3'),
      [
        join(folder, 'acceptance', 'reference', 'verify_bundle.py'),
        join(evidence, archive),
        '--sha256',
        expected,
        '--check-frozen-rule',
      ],
      { encoding: 'utf8' },
    );
    const verified = JSON.parse(output);
    assert.equal(verified.packageSha256, expected);
    const summary = {
      packageSha256: expected,
      snapshotContentId: verified.snapshotContentId,
      rows: verified.rows,
      databaseCount: before.length,
      sourceUnchanged: true,
    };
    await writeFile(
      join(evidence, 'verification.json'),
      JSON.stringify(verified, null, 2) + '\n',
    );
    return summary;
  } finally {
    await vite.close();
  }
}
