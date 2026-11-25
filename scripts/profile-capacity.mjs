import { rssKiB } from './profile-browser-rss.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';

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
    await fresh.goto(url);
    await fresh
      .getByLabel('恢复研究文件')
      .setInputFiles(await downloaded.path());
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
