import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';

const exec = promisify(execFile);
async function rssKiB(session) {
  const { processInfo } = await session.send('SystemInfo.getProcessInfo');
  const ids = processInfo.map((p) => p.id).filter(Number.isSafeInteger);
  if (process.platform === 'win32') {
    const command = `$p=Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue; [int64](($p | Measure-Object -Property WorkingSet64 -Sum).Sum / 1024)`;
    const { stdout } = await exec('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      command,
    ]);
    return Number(stdout.trim());
  }
  if (process.platform !== 'linux') return null;
  const rows = await Promise.all(
    ids.map(async (id) => {
      try {
        const status = await readFile('/proc/' + id + '/status', 'utf8');
        return Number(/^VmRSS:\s*(\d+)/m.exec(status)?.[1] ?? 0);
      } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ESRCH') return 0;
        throw error;
      }
    }),
  );
  return rows.reduce((a, b) => a + b, 0);
}

await mkdir('work', { recursive: true });
const outDir = await mkdtemp(resolve('work/regime-profile-'));
const config = {
  root: resolve('tests/performance/market-regime'),
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
  const url = 'http://127.0.0.1:' + server.httpServer.address().port;
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
    'REGIME_ENV',
    JSON.stringify({
      channel,
      version: browser.version(),
      os: process.platform,
      cpu: cpus()[0].model,
      node: process.version,
    }),
  );
  for (const mode of ['single', 'portfolio', 'shared-strategy', 'rebalance']) {
    const page = await browser.newPage(),
      clean = await browser.newPage();
    let sampling = true,
      peakBrowserRssKiB = 0;
    const samples = (async () => {
      do {
        peakBrowserRssKiB = Math.max(
          peakBrowserRssKiB,
          (await rssKiB(session)) ?? 0,
        );
        if (sampling) await new Promise((done) => setTimeout(done, 200));
      } while (sampling);
    })();
    try {
      await page.goto(url);
      await page.waitForFunction(
        () => typeof globalThis.runRegimeSample === 'function',
      );
      const [s, file] = await Promise.all([
        page.evaluate((mode) => globalThis.runRegimeSample(mode), mode),
        page.waitForEvent('download', { timeout: 120000 }),
      ]);
      assert.equal(await file.failure(), null);
      await clean.goto(url);
      await clean.getByLabel('恢复报告').setInputFiles(await file.path());
      const r = await clean.evaluate(() => globalThis.restoreRegimeSample());
      assert.equal(s.hash, r.hash);
      assert.equal(s.netPnl, r.netPnl);
      assert.equal(s.bars, r.bars);
      assert.equal(
        s.bars,
        mode === 'single' ? 50000 : mode === 'rebalance' ? 2000 : 5000,
      );
      assert(s.fills > 0 && s.switches > 0);
      assert(s.bytes > 0 && s.bytes <= 32 * 1024 * 1024);
      const maxMainTimerGapMs = Math.max(
        s.maxMainTimerGapMs,
        r.maxMainTimerGapMs,
      );
      console.log(
        'REGIME_PROFILE',
        JSON.stringify({
          ...s,
          restoreMs: r.restoreMs,
          maxMainTimerGapMs,
          maxMainHeapBytes: Math.max(s.maxMainHeapBytes, r.maxMainHeapBytes),
          peakBrowserRssKiB: peakBrowserRssKiB || null,
          totalSourceBars: mode === 'single' ? 50000 : 10000,
        }),
      );
      assert(s.ticks > 1 && r.ticks > 1);
      assert(
        maxMainTimerGapMs < 1000 && s.cancelMs < 1000,
        'main thread responsiveness or cancellation exceeded 1 s',
      );
      assert(
        Math.max(s.runMs, s.exportMs, r.restoreMs) < 20000,
        'full-size run, export or restore exceeded 20 s',
      );
    } finally {
      sampling = false;
      await samples;
      await clean.close();
      await page.close();
    }
  }
} finally {
  await browser?.close();
  await server?.close();
  await rm(outDir, { recursive: true, force: true });
}
