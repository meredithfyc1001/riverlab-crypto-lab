import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { cpus, release } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';

await mkdir('work', { recursive: true });
const outDir = await mkdtemp(resolve('work/portfolio-profile-'));
const config = {
  root: resolve('tests/performance/portfolio'),
  configFile: false,
  logLevel: 'error',
  build: { outDir, target: ['chrome120', 'edge120'] },
};
const channel = process.env.E2E_BROWSER ?? 'chromium';
let browser, server;
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
  const session = await browser.newBrowserCDPSession();
  console.log(
    'PORTFOLIO_ENV',
    JSON.stringify({
      channel,
      browser: browser.version(),
      node: process.version,
      os: process.platform + ' ' + release(),
      cpu: cpus()[0].model,
    }),
  );
  for (const count of [2, 5]) {
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:' + server.httpServer.address().port);
    await page.waitForFunction(
      () => typeof globalThis.samplePortfolio === 'function',
    );
    // RSS sums may count shared pages more than once. Include only this browser's
    // processes reported by CDP; other browser sessions and Node are excluded.
    let peakBrowserRssKiB = 0,
      finished = false;
    async function sampleRss() {
      while (!finished && process.platform === 'linux') {
        const { processInfo } = await session.send('SystemInfo.getProcessInfo');
        const readings = await Promise.all(
          processInfo.map(async ({ id }) => {
            try {
              const status = await readFile('/proc/' + id + '/status', 'utf8');
              return Number(/^VmRSS:\s*(\d+)/m.exec(status)?.[1] ?? 0);
            } catch (error) {
              if (error.code === 'ENOENT' || error.code === 'ESRCH') return 0;
              throw error;
            }
          }),
        );
        peakBrowserRssKiB = Math.max(
          peakBrowserRssKiB,
          readings.reduce((a, b) => a + b, 0),
        );
        await new Promise((done) => setTimeout(done, 100));
      }
    }
    const sampling = sampleRss();
    try {
      const s = await page.evaluate(
        (count) => globalThis.samplePortfolio(count),
        count,
      );
      finished = true;
      await sampling;
      console.log(
        'PORTFOLIO_PROFILE',
        JSON.stringify({ ...s, peakBrowserRssKiB: peakBrowserRssKiB || null }),
      );
      assert.equal(s.totalSourceBars, 10000);
      assert.equal(s.curvePoints, 10000 / count + 1);
      assert.ok(
        s.sameHash && s.fills > 0 && s.bytes <= 32 * 1024 * 1024 && s.ticks > 1,
      );
    } finally {
      finished = true;
      await sampling;
      await page.close();
    }
  }
} finally {
  await browser?.close();
  await server?.close();
  await rm(outDir, { recursive: true, force: true });
}
