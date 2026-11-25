// Build only the diagnostic page and its Worker. Product assets stay untouched.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { cpus, platform, release } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { build, normalizePath, preview } from 'vite';

const repo = fileURLToPath(new URL('..', import.meta.url));
const root = path.join(repo, 'tests/performance');
const pathOf = (file) => normalizePath(path.join(repo, file));
const modules = [
  [
    'core/experiments/index.ts',
    '../backtests',
    'core/backtests/index.ts',
    'runBacktest',
    'engine',
  ],
  [
    'core/experiments/index.ts',
    '../statistics',
    'core/statistics/index.ts',
    'calculateStatistics',
    'statistics',
  ],
  [
    'core/backtests/engine.ts',
    './identity',
    'core/backtests/identity.ts',
    'contentHash',
    'identity',
  ],
  [
    'core/backtests/engine.ts',
    '../strategies',
    'core/strategies/index.ts',
    'createStrategy',
    'strategy',
  ],
  [
    'infrastructure/backtest.worker.ts',
    './experiment-hash',
    'infrastructure/experiment-hash.ts',
    'sealWorkerExperiment',
    'seal',
  ],
];
// Wrap public imports in this diagnostic build. The functions, data, Worker
// implementation and all-point chart come directly from the checked out source.
function instrument() {
  const prefix = '\0riverlab-profile:';
  return {
    name: 'time-backtest-worker-imports',
    enforce: 'pre',
    resolveId(source, importer) {
      const match = modules.find(
        ([caller, spec]) =>
          importer &&
          normalizePath(importer).endsWith('/src/' + caller) &&
          source === spec,
      );
      if (match) return prefix + match[4];
    },
    load(id) {
      if (!id.startsWith(prefix)) return;
      const [, , file, fn, stage] = modules.find(
        (row) => row[4] === id.slice(prefix.length),
      );
      const original = JSON.stringify(pathOf('src/' + file));
      const header = `export * from ${original}; import { ${fn} as original } from ${original};
        import {measure,timings} from ${JSON.stringify(pathOf('tests/performance/timings.ts'))};`;
      if (stage === 'strategy')
        return (
          header +
          `export function ${fn}(...args) {
        const strategy=original(...args);
        return {...strategy, onClose(candle) {return measure('strategy',()=>strategy.onClose(candle));}};
      }`
        );
      if (stage === 'seal')
        return (
          header +
          `export async function ${fn}(...args) {
        const start=performance.now(); const record=await original(...args);
        timings.seal+=performance.now()-start;return record;
      }`
        );
      return (
        header +
        `export function ${fn}(...args){return measure('${stage}',()=>original(...args));}`
      );
    },
  };
}

const work = path.join(repo, 'work');
await mkdir(work, { recursive: true });
const outDir = await mkdtemp(path.join(work, 'backtest-profile-'));
const config = {
  root,
  configFile: false,
  logLevel: 'error',
  build: { outDir, target: ['chrome120', 'edge120'] },
  worker: { plugins: () => [instrument()] },
};
const channel = process.env.E2E_BROWSER ?? 'chromium';
assert.ok(
  ['chromium', 'chrome', 'msedge'].includes(channel),
  'Unsupported E2E_BROWSER',
);
let browser, server;
try {
  await build(config);
  server = await preview({
    ...config,
    preview: { host: '127.0.0.1', port: 0 },
  });
  const port = server.httpServer.address().port;
  browser = await chromium.launch({
    channel: channel === 'chromium' ? undefined : channel,
    executablePath:
      channel === 'chromium'
        ? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
        : undefined,
    args: ['--enable-precise-memory-info'],
  });
  console.log(
    'RC_PROFILE_ENV',
    JSON.stringify({
      cpu: cpus()[0]?.model,
      cores: cpus().length,
      os: platform() + ' ' + release(),
      node: process.version,
      browser: browser.version(),
      channel,
    }),
  );
  const samples = [];
  for (let i = 0; i < 3; i++) {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    try {
      await page.goto('http://127.0.0.1:' + port);
      await page.waitForFunction(() => typeof globalThis.sample === 'function');
      const sample = await page.evaluate(async () => {
        const timeout = new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  'Diagnostic setup, Worker or chart did not finish within 60 seconds',
                ),
              ),
            60000,
          ),
        );
        return Promise.race([globalThis.sample(), timeout]);
      });
      console.log('RC_PROFILE', JSON.stringify(sample));
      samples.push(sample);
    } finally {
      await page.close();
    }
  }
  for (const s of samples) {
    assert.equal(
      s.payloadHash,
      'de11ea4907b5315f40d60d91ce9b4eb403d5445757a1085b8b987dfdac710fa5',
    );
    assert.equal(
      s.runHash,
      'e841712a73ab91df555b7b3743a3e26df6db442b18cf975ebb4657c4fc7fe5bd',
    );
    for (const field of [
      'strategyMs',
      'ledgerAndPreparationMs',
      'identityMs',
      'statisticsMs',
      'sealMs',
      'inputMs',
      'outputMs',
      'chartMs',
    ]) {
      assert.ok(
        Number.isFinite(s[field]) && s[field] > 0,
        'Missing timing for ' + field,
      );
    }
    assert.equal(s.curvePoints, 50001);
    assert.equal(s.fills, 8331);
    assert.ok(
      s.timerSamples > 5 && s.elapsedMs < 20000 && s.maxDelayMs < 1000,
      '50k timing limits exceeded (see samples above)',
    );
  }
} finally {
  await browser?.close();
  await server?.close();
  await rm(outDir, { recursive: true, force: true });
}
