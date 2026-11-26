import { rssKiB } from './profile-browser-rss.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';
import { contentHash } from '../src/core/backtests/identity.ts';

await mkdir('work', { recursive: true });
const outDir = await mkdtemp(resolve('work/capacity-'));
const config = {
  root: resolve('tests/performance/capacity'),
  configFile: false,
  logLevel: 'error',
  build: { outDir, target: ['chrome120', 'edge120'] },
};
const channel = process.env.E2E_BROWSER ?? 'chromium';
let server, browser;
try {
  await build(config);
  server = await preview({
    ...config,
    preview: { host: '127.0.0.1', port: 0 },
  });
  browser = await chromium.launch({
    channel: channel === 'chromium' ? undefined : channel,
    executablePath:
      channel === 'chromium'
        ? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
        : undefined,
    args: ['--enable-precise-memory-info'],
  });
  console.log(
    'CAPACITY_ENV',
    JSON.stringify({
      os: process.platform,
      node: process.version,
      browser: browser.version(),
      channel,
    }),
  );
  for (const scenario of ['single-50k', 'single-100k', 'portfolio-50k']) {
    const page = await browser.newPage();
    try {
      await page.goto('http://127.0.0.1:' + server.httpServer.address().port);
      await page.waitForFunction(
        () => typeof globalThis.runCapacitySample === 'function',
      );
      const result = await page.evaluate(
        (s) => globalThis.runCapacitySample(s),
        scenario,
      );
      console.log('CAPACITY_PROFILE', JSON.stringify(result));
    } finally {
      await page.close();
    }
  }

  const page = await browser.newPage();
  const fresh = await browser.newPage();
  const session = await browser.newBrowserCDPSession();
  let sampling = true,
    peakBrowserRssKiB = 0;
  const sampled = (async () => {
    while (sampling) {
      peakBrowserRssKiB = Math.max(
        peakBrowserRssKiB,
        (await rssKiB(session)) ?? 0,
      );
      await new Promise((done) => setTimeout(done, 200));
    }
  })();
  try {
    const url = 'http://127.0.0.1:' + server.httpServer.address().port;
    await page.goto(url);
    await page.waitForFunction(
      () => typeof globalThis.runAdvancedCapacity === 'function',
    );
    const [sample, downloaded] = await Promise.all([
      page.evaluate(() => globalThis.runAdvancedCapacity()),
      page.waitForEvent('download', { timeout: 120000 }),
    ]);
    assert.equal(await downloaded.failure(), null);
    // Keep this run's synthetic export in the existing browser CI artifact.
    await mkdir('test-results', { recursive: true });
    const exportPath = resolve(
      'test-results/advanced-capacity-recomputed.json',
    );
    await downloaded.saveAs(exportPath);
    await fresh.goto(url);
    await fresh.getByLabel('恢复研究文件').setInputFiles(exportPath);
    const restored = await fresh.evaluate(() =>
      globalThis.restoreAdvancedCapacity(),
    );
    assert.equal(restored.hash, sample.hash);
    console.log(
      'ADVANCED_PROFILE',
      JSON.stringify({
        ...sample,
        peakBrowserRssKiB,
        maxMainTimerGapMs: Math.max(
          sample.maxMainTimerGapMs,
          restored.maxMainTimerGapMs,
        ),
        maxMainHeapBytes: Math.max(
          sample.maxMainHeapBytes,
          restored.maxMainHeapBytes,
        ),
        restoreMs: restored.restoreMs,
      }),
    );
    const bytes = await readFile(exportPath);
    const { input, result } = JSON.parse(bytes);
    const receipt = {
      filename: 'advanced-capacity-recomputed.json',
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      inputHash: contentHash(input),
      resultHash: contentHash(result),
    };
    await writeFile(
      exportPath + '.receipt.json',
      JSON.stringify(receipt, null, 2),
    );
    assert.equal(input.dataset.candles.length, 50_000);
    assert.equal(sample.evaluations, 100_000);
    assert.equal(sample.completedTrades, 2_082);
    // Frozen business data from the Phase 5E reference; the envelope has a new ID/time.
    assert.equal(
      receipt.inputHash,
      '666ecfb0cd67fea63488ce6e94ee46f8abe3109145ed8443dc3ddda67c12909e',
    );
    assert.equal(
      receipt.resultHash,
      'e3fb4410dc0bac12ca6dc1d108d4a6ae2f56107a47fc20bbda789469cbaf5d6b',
    );
  } finally {
    sampling = false;
    await sampled;
    await page.close();
    await fresh.close();
  }
} finally {
  await browser?.close();
  await server?.close();
  await rm(outDir, { recursive: true, force: true });
}
