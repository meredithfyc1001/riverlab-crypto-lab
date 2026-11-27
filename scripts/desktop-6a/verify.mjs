import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import { basename, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import { preview } from 'vite';
import { exercise, firstWorker } from './exercise.mjs';

const windows = process.platform === 'win32';
const browserOnly = process.env.RIVERLAB_6A_BROWSER_ONLY === '1';
assert(
  windows || browserOnly,
  'The packaged Tauri verification requires Windows. Set RIVERLAB_6A_BROWSER_ONLY=1 for a separate browser baseline.',
);
const out = resolve(
  process.env.RIVERLAB_6A_OUTPUT || 'work/desktop-6b/evidence',
);
const dist = resolve(process.env.RIVERLAB_6A_DIST || 'work/desktop-6a/dist');
const exe = resolve(
  process.env.RIVERLAB_6A_EXE ||
    'src-tauri/target/release/riverlab-desktop.exe',
);
const installer = process.env.RIVERLAB_6A_INSTALLER;
const installFolder = process.env.RIVERLAB_6A_INSTALL_DIR;
const numberOfStarts = Number(process.env.RIVERLAB_6A_STARTS ?? 3);
assert(
  Number.isInteger(numberOfStarts) &&
    numberOfStarts >= (windows ? 3 : 1) &&
    numberOfStarts <= 20,
);
const scratch = await mkdtemp(join(os.tmpdir(), 'riverlab-6a-'));
await mkdir(out, { recursive: true });
const runDir = await mkdtemp(join(out, 'run-'));
const evidence = {
  status: 'INCOMPLETE',
  observedUtc: new Date().toISOString(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim(),
  environment: {
    platform: os.platform(),
    architecture: os.arch(),
    osVersion: os.release(),
    cpu: os.cpus()[0].model,
    logicalProcessors: os.cpus().length,
    physicalMemoryBytes: os.totalmem(),
    node: process.version,
  },
  scope: browserOnly ? 'browser-only' : 'Windows packaged application and Edge',
  runDirectory: basename(runDir),
  runs: [],
  parityRuns: [],
  startupMethod:
    'Milliseconds from process spawn to observed visible Chinese workbench, then to first real CSV Worker result, using receipt arrival from the packaged window or Playwright observation of standalone Edge. New empty profile each time, OS cache uncontrolled. Browser and native observation overhead can differ.',
  memoryMethod:
    'Windows Win32_Process descendants of the actual EXE/browser PID. WorkingSetSize includes shared pages; PrivatePageCount measures private committed bytes. Peaks are maxima of samples, not OS high-water marks. Vite/driver excluded.',
};

async function sizeOfTree(directory) {
  let size = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) size += await sizeOfTree(path);
    if (entry.isFile()) size += (await stat(path)).size;
  }
  return size;
}
async function identify(path) {
  const bytes = await readFile(path);
  return {
    file: basename(path),
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}
async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
function browserExecutable() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE)
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (!windows) return chromium.executablePath();
  const target = [
    process.env['ProgramFiles(x86)'],
    process.env.ProgramFiles,
    process.env.LOCALAPPDATA,
  ]
    .filter(Boolean)
    .map((root) => join(root, 'Microsoft/Edge/Application/msedge.exe'))
    .find(existsSync);
  assert(
    target,
    'System Microsoft Edge is required for the Windows comparison.',
  );
  return target;
}
async function attachBrowser(port, child, errors) {
  const url = 'http://127.0.0.1:' + port;
  const until = Date.now() + 60000;
  do {
    if (errors.length) throw errors[0];
    if (child.exitCode !== null || child.signalCode)
      throw new Error(
        'Comparator browser exited before automation was ready: ' +
          child.exitCode,
      );
    let response;
    try {
      response = await fetch(url + '/json/version', {
        signal: AbortSignal.timeout(700),
      });
    } catch {
      /* The test-owned browser is still starting. */
    }
    if (response?.ok) {
      const info = await response.json();
      return await chromium.connectOverCDP(info.webSocketDebuggerUrl, {
        timeout: 5000,
      });
    }
    await pause(60);
  } while (Date.now() < until);
  throw new Error('Comparator browser did not publish its DevTools endpoint.');
}
async function currentPage(browser, origin) {
  const until = Date.now() + 30000;
  do {
    const pages = browser.contexts().flatMap((context) => context.pages());
    const page = pages.find((p) => p.url().startsWith(origin + '/'));
    if (page) return page;
    await pause(50);
  } while (Date.now() < until);
  throw new Error('Did not find the comparator tab for the test origin.');
}
function startMemory(pid, record) {
  if (!windows) return null;
  const script = fileURLToPath(new URL('./memory.ps1', import.meta.url));
  const sampler = spawn(
    'pwsh.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      script,
      '-RootProcessId',
      String(pid),
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );
  const readings = (record.memorySamples = []);
  const state = { phase: 'startup', error: null };
  const lines = createInterface({ input: sampler.stdout });
  lines.on('line', (line) => {
    try {
      readings.push({ phase: state.phase, ...JSON.parse(line) });
    } catch {
      state.error = 'Invalid Windows memory reading: ' + line;
    }
  });
  sampler.stderr.on('data', (data) => {
    state.error = String(data);
  });
  sampler.on('error', (error) => {
    state.error = error.message;
  });
  return { state, sampler };
}
async function runBrowser(iteration, origin) {
  const record = {
    kind: 'browser',
    iteration,
    startupProfile: 'fresh',
    pageErrors: [],
    externalOrigins: [],
    workersObserved: [],
  };
  evidence.runs.push(record);
  const folder = join(runDir, 'browser-' + iteration);
  await mkdir(folder);
  const port = await freePort();
  const profile = 'ci-' + randomUUID();
  const flags = [
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=' + port,
  ];
  const command = browserExecutable();
  const args = [
    ...flags,
    '--user-data-dir=' + join(scratch, profile),
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    ...(windows
      ? []
      : [
          '--headless=new',
          ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
        ]),
    origin,
  ];
  // A separate browser process is launched for each sample; never attach to
  // an existing user browser or pass a user-supplied browser profile.
  const started = performance.now();
  const child = spawn(command, args, {
    stdio: 'ignore',
  });
  const errors = [];
  child.on('error', (error) => errors.push(error));
  let browser, page, memory;
  try {
    if (child.pid) memory = startMemory(child.pid, record);
    browser = await attachBrowser(port, child, errors);
    page = await currentPage(browser, origin);
    // The browser driver owns this new profile and origin for this run only.
    await page.addInitScript(() => {
      Object.defineProperty(globalThis, '__RIVERLAB_FRESH_BROWSER_QA__', {
        value: true,
      });
    });
    page.setDefaultTimeout(12000);
    page.context().on('request', (request) => {
      const u = new URL(request.url());
      if (['http:', 'https:'].includes(u.protocol) && u.origin !== origin)
        record.externalOrigins.push(u.origin);
    });
    page.on('worker', (w) =>
      record.workersObserved.push(new URL(w.url()).pathname),
    );
    page.on('pageerror', (error) => record.pageErrors.push(error.message));
    const heading = page.getByRole('heading', {
      level: 1,
      name: '工作台',
      exact: true,
    });
    await heading.waitFor();
    record.workbenchMs = Math.round(performance.now() - started);
    assert.equal(await page.evaluate(() => globalThis.isSecureContext), true);
    record.engineVersion = browser.version();
    await firstWorker(page, origin);
    record.firstCsvWorkerMs = Math.round(performance.now() - started);

    if (memory) {
      memory.state.phase = 'idle';
      await pause(4000);
      assert(!memory.state.error, memory.state.error);
      assert(
        record.memorySamples.some(
          (s) => s.phase === 'idle' && s.processCount >= 2,
        ),
        'Missing idle Edge process-tree samples.',
      );
      memory.state.phase = 'workload';
    }
    await exercise(page, origin, folder, record);
    if (memory) {
      assert(!memory.state.error, memory.state.error);
      const active = record.memorySamples.filter(
        (sample) => sample.phase === 'workload',
      );
      assert(
        active.length > 0 && active.some((s) => s.processCount >= 2),
        'Missing browser/render process tree samples.',
      );
      record.sampledPeakWorkingSetBytes = Math.max(
        ...active.map((s) => s.workingSetBytes),
      );
      record.sampledPeakPrivateBytes = Math.max(
        ...active.map((s) => s.privateBytes),
      );
      const research = active.filter(
        (s) =>
          s.utcMs >= record.researchWindow.startedUtcMs &&
          s.utcMs <= record.researchWindow.endedUtcMs,
      );
      assert(
        research.length > 0,
        'No process-tree readings during the 50,000-candle probe.',
      );
      record.researchWindowPeakPrivateBytes = Math.max(
        ...research.map((s) => s.privateBytes),
      );
      record.researchWindowPeakWorkingSetBytes = Math.max(
        ...research.map((s) => s.workingSetBytes),
      );
    }
    assert.deepEqual(record.pageErrors, []);
    assert.deepEqual(record.externalOrigins, []);
    record.status = 'PASS';
  } catch (error) {
    record.status = 'FAIL';
    record.error = error.message;
    if (page) {
      record.lastPage = page.url();
      await page
        .screenshot({
          path: join(folder, 'failure.png'),
          timeout: 3000,
        })
        .catch(() => {});
    }
    throw error;
  } finally {
    memory?.sampler.kill();
    if (browser) await browser.close().catch(() => {});
    if (child.pid && child.exitCode === null && !child.signalCode) {
      const exited = once(child, 'exit').catch(() => {});
      child.kill();
      await Promise.race([exited, pause(3000)]);
    }
    await writeFile(
      join(folder, 'browser-run.json'),
      JSON.stringify(record, null, 2) + '\n',
    );
  }
}

function comparePair(native, browser) {
  const app = native.probe;
  const edge = browser.probe;
  for (const receipt of [native, browser]) {
    assert.equal(receipt.replay.restoredReplayCursor, 2);
    assert.equal(receipt.download.sha256, receipt.probe.downloadSha256);
    assert.equal(receipt.download.bytes, receipt.probe.downloadBytes);
    assert.equal(receipt.probe.resultHash, receipt.probe.phase5eResultHash);
  }
  assert.deepEqual(native.repositoryParity, browser.probe.repositoryParity);
  assert.deepEqual(native.repositoryParity, {
    runHash: 'ae81f9b7bea46c9ca783fcb80ad4358f97726bfb5b0e5fde6c8b2b59e3a7c1f7',
    payloadHash:
      'a4ced2d170b7d1bb7e790a4fb4d92c769848ed20ce79f5cbf60cb632d6218501',
    fills: 9,
    fees: '9.28719551797935',
    equity: '1209.64074296063065',
  });
  assert.equal(app.candles, edge.candles);
  assert.equal(app.evaluations, edge.evaluations);
  assert.equal(app.completedTrades, edge.completedTrades);
  assert.equal(app.workers, edge.workers);
  assert.deepEqual(
    [...native.navigation.headings].sort(),
    [...browser.navigation.headings].sort(),
  );
  assert.deepEqual(
    [...native.navigation.sections].sort(),
    [...browser.navigation.sections].sort(),
  );
  assert.equal(
    app.resultHash,
    edge.resultHash,
    '50,000-candle result differs between the packaged WebView2 app and Edge.',
  );
  return {
    iteration: native.iteration,
    status: 'PASS',
    bars: app.candles,
    evaluations: app.evaluations,
    completedTrades: app.completedTrades,
    sha256: app.resultHash,
    reopenedRepositoryParity: native.repositoryParity,
  };
}

let host;
try {
  assert(
    existsSync(join(dist, 'tests', 'desktop-6a', 'index.html')),
    'Missing compiled verification page in desktop dist.',
  );
  evidence.frontendPayloadBytes = await sizeOfTree(dist);
  if (!browserOnly) {
    assert(installer, 'Set RIVERLAB_6A_INSTALLER to the tested NSIS artifact.');
    evidence.application = await identify(exe);
    evidence.installer = await identify(installer);
    if (installFolder)
      evidence.installedFilesBytes = await sizeOfTree(installFolder);
  }
  host = await preview({
    configFile: false,
    logLevel: 'error',
    build: { outDir: dist },
    preview: { host: '127.0.0.1', port: 0 },
  });
  const origin = 'http://127.0.0.1:' + host.httpServer.address().port;
  const nativeDriver = browserOnly ? null : await import('./native-verify.mjs');
  const kinds = browserOnly ? ['browser'] : ['webview2', 'browser'];
  const failures = [];
  for (let pass = 1; pass <= numberOfStarts; pass++) {
    for (const kind of pass % 2 ? kinds : [...kinds].reverse()) {
      try {
        if (kind === 'webview2') {
          const native = await nativeDriver.runNative({
            exe,
            iteration: pass,
            runDir,
            startMemory,
          });
          evidence.runs.push(native);
        } else {
          await runBrowser(pass, origin);
        }
      } catch (error) {
        if (kind === 'webview2')
          evidence.runs.push(
            error.record ?? {
              kind,
              iteration: pass,
              status: 'FAIL',
              error: error.message,
            },
          );
        failures.push(kind + ' #' + pass + ': ' + error.message);
      }
    }
    if (!browserOnly) {
      const pair = evidence.runs.filter((run) => run.iteration === pass);
      const native = pair.find((run) => run.kind === 'webview2');
      const browser = pair.find((run) => run.kind === 'browser');
      if (native?.status === 'PASS' && browser?.status === 'PASS') {
        try {
          evidence.parityRuns.push(comparePair(native, browser));
        } catch (error) {
          evidence.parityRuns.push({
            iteration: pass,
            status: 'FAIL',
            error: error.message,
          });
          failures.push(
            'Cross-engine comparison #' + pass + ': ' + error.message,
          );
        }
      } else {
        evidence.parityRuns.push({ iteration: pass, status: 'INCOMPLETE' });
      }
    }
  }
  if (failures.length) throw new Error(failures.join('\n'));
  if (!browserOnly) {
    assert.equal(evidence.parityRuns.length, numberOfStarts);
    const first = evidence.parityRuns[0];
    assert(
      evidence.parityRuns.every(
        (pair) => pair.status === 'PASS' && pair.sha256 === first.sha256,
      ),
    );
    evidence.parity = {
      bars: first.bars,
      evaluations: first.evaluations,
      engines: kinds,
      sha256: first.sha256,
      completedTrades: first.completedTrades,
      pairedRuns: evidence.parityRuns.length,
    };
  }
  evidence.status = 'PASS';
} catch (error) {
  evidence.status = 'FAIL';
  evidence.error = error.message;
  console.error(error);
  process.exitCode = 1;
} finally {
  if (host) await host.close();
  const json = JSON.stringify(evidence, null, 2) + '\n';
  await writeFile(join(runDir, 'verification.json'), json);
  await writeFile(join(out, 'verification.json'), json);
  await rm(scratch, {
    recursive: true,
    force: true,
    maxRetries: 4,
    retryDelay: 300,
  }).catch((error) =>
    console.warn('Temporary browser profile cleanup:', error.code),
  );
  console.log(
    'RIVERLAB_6A_VERIFY',
    evidence.status,
    join(out, 'verification.json'),
  );
}
