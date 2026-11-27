// Generate an archive from a newly launched Chromium context and the shipped 6C-A exporter.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { build, createServer, preview } from 'vite';

const [profile, output] = process.argv.slice(2);
assert.ok(
  ['large-report', 'near-capacity'].includes(profile) && output,
  'Usage: node scripts/phase6c/generate-performance.mjs large-report|near-capacity NEW_DIRECTORY',
);
await mkdir(output);
const assets = await mkdtemp(path.join(path.resolve(output), 'site-'));
const config = {
  configFile: false,
  logLevel: 'error',
  build: {
    outDir: assets,
    target: 'chrome120',
    rollupOptions: {
      input: path.resolve('tests/performance/migration-source.ts'),
      preserveEntrySignatures: 'strict',
      output: { entryFileNames: 'profile.js' },
    },
  },
};
let browser, server, loader;
try {
  await build(config);
  await writeFile(
    path.join(assets, 'index.html'),
    '<!doctype html><title>Isolated synthetic migration fixture</title>',
  );
  server = await preview({
    ...config,
    preview: { host: '127.0.0.1', port: 0 },
  });
  const port = server.httpServer.address().port;
  loader = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true },
    appType: 'custom',
    logLevel: 'error',
  });
  const fixture = await loader.ssrLoadModule(
    '/tests/e2e/phase-6c-a-fixture.ts',
  );
  const libraries = fixture.syntheticLibraries();
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:' + port);
  await fixture.populateEmptyProfile(page, libraries);
  const source = await page.evaluate(async (profile) => {
    const fixture = await import('/profile.js');
    return fixture.addScenario(profile);
  }, profile);
  const [download, result] = await Promise.all([
    page.waitForEvent('download', { timeout: 35 * 60 * 1000 }),
    page.evaluate(async () =>
      (await import('/profile.js')).exportToPrivateFile(),
    ),
  ]);
  const filename = 'synthetic.riverlab-migration';
  const archive = path.join(output, filename);
  await download.saveAs(archive);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(archive)) hash.update(chunk);
  const sha = hash.digest('hex');
  assert.equal(sha, result.receipt.fileSha256);
  if (profile === 'near-capacity')
    assert.ok(result.receipt.bytes >= 248 * 1024 ** 2);
  await writeFile(archive + '.sha256', sha + '  ' + filename + '\n', {
    flag: 'wx',
  });
  await writeFile(
    path.join(output, 'export.json'),
    JSON.stringify(
      {
        profile,
        browser: browser.version(),
        ...source,
        ...result,
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  console.log(
    JSON.stringify({
      profile,
      ...result.receipt,
      exportAndReadbackMs: result.exportAndReadbackMs,
    }),
  );
} finally {
  await browser?.close();
  await server?.close();
  await loader?.close();
  await rm(assets, { recursive: true, force: true });
}
