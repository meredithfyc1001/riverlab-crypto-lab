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
  process.env.RIVERLAB_6A_OUTPUT || 'work/desktop-6a/evidence',
);
const dist = resolve(process.env.RIVERLAB_6A_DIST || 'work/desktop-6a/dist');
const exe = resolve(
  process.env.RIVERLAB_6A_EXE || 'src-tauri/target/release/riverlab-6a.exe',
);
const installer = process.env.RIVERLAB_6A_INSTALLER;
const installFolder = process.env.RIVERLAB_6A_INSTALL_DIR;
const numberOfStarts = Number(process.env.RIVERLAB_6A_STARTS ?? 3);
assert(
  Number.isInteger(numberOfStarts) &&
    numberOfStarts >= 1 &&
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
  startupMethod:
    'Milliseconds from process spawn to observed visible Chinese workbench, then to first real CSV Worker result, including local automation attach and UI. New empty profile each time, OS cache uncontrolled.',
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
function desktopEnvironment(profileId, debugArgs) {
  // The test process has no Node/npm in PATH. The installed EXE receives
  // the debugging feature only for this disposable profile and invocation.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        ![
          'path',
          'node_path',
          'node_options',
          'webview2_user_data_folder',
          'webview2_additional_browser_arguments',
          'webview2_browser_executable_folder',
        ].includes(name.toLowerCase()),
    ),
  );
  const system = process.env.SystemRoot;
  return {
    ...env,
    Path: join(system, 'System32') + ';' + system,
    RIVERLAB_6A_TEST_PROFILE: profileId,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: debugArgs.join(' '),
  };
}
async function attach(port, child, errors) {
  const url = 'http://127.0.0.1:' + port;
  const until = Date.now() + 60000;
  do {
    if (errors.length) throw errors[0];
    if (child.exitCode !== null || child.signalCode)
      throw new Error(
        'Test process exited before its WebView was accessible: ' +
          child.exitCode,
      );
    try {
      const response = await fetch(url + '/json/version', {
        signal: AbortSignal.timeout(700),
      });
      if (response.ok) {
        const info = await response.json();
        return await chromium.connectOverCDP(info.webSocketDebuggerUrl, {
          timeout: 5000,
        });
      }
    } catch {
      /* During startup the port is initially unavailable. */
    }
    await pause(60);
  } while (Date.now() < until);
  throw new Error('Timed out attaching to the test-owned WebView/browser.');
}
async function currentPage(browser, desktop) {
  const until = Date.now() + 30000;
  do {
    const pages = browser.contexts().flatMap((context) => context.pages());
    const page = pages.find((p) =>
      desktop
        ? p.url().startsWith('https://tauri.localhost/')
        : !p.url().startsWith('devtools:'),
    );
    if (page) return page;
    await pause(50);
  } while (Date.now() < until);
  throw new Error('Did not find the packaged window or comparator tab.');
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
  const state = { phase: 'idle', error: null };
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
async function run(kind, iteration, baselineOrigin) {
  const desktop = kind === 'webview2';
  const record = {
    kind,
    iteration,
    startupProfile: 'fresh',
    pageErrors: [],
    externalOrigins: [],
    workersObserved: [],
  };
  evidence.runs.push(record);
  const port = await freePort();
  const profile = 'ci-' + randomUUID();
  const flags = [
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=' + port,
  ];
  const command = desktop ? exe : browserExecutable();
  const args = desktop
    ? []
    : [
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
        baselineOrigin,
      ];
  const origin = desktop ? 'https://tauri.localhost' : baselineOrigin;
  // A separate browser process is launched for each sample; never attach to
  // an existing user browser or pass a user-supplied browser profile.
  const started = performance.now();
  const child = spawn(command, args, {
    env: desktop ? desktopEnvironment(profile, flags) : process.env,
    stdio: 'ignore',
  });
  const errors = [];
  child.on('error', (error) => errors.push(error));
  let browser, page, memory;
  try {
    browser = await attach(port, child, errors);
    page = await currentPage(browser, desktop);
    page.setDefaultTimeout(12000);
    page.context().on('request', (request) => {
      const u = new URL(request.url());
      if (
        ['http:', 'https:'].includes(u.protocol) &&
        u.origin !== origin &&
        !(desktop && u.origin === 'http://ipc.localhost') &&
        !(desktop && u.origin === 'https://ipc.localhost')
      )
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
    // Only the first launch executes the complete workload. The other
    // launches independently repeat startup and a genuine Worker response.
    if (iteration === 1) {
      const folder = join(runDir, kind);
      await mkdir(folder);
      await page.goto(origin + '/');
      await heading.waitFor();
      memory = startMemory(child.pid, record);
      if (memory) {
        const deadline = Date.now() + 15000;
        while (
          record.memorySamples.length < 3 &&
          Date.now() < deadline &&
          !memory.state.error
        )
          await pause(200);
        assert(!memory.state.error, memory.state.error);
        assert(
          record.memorySamples.length >= 3,
          'No stable idle process-tree samples.',
        );
        memory.state.phase = 'workload';
      }
      await exercise(page, origin, folder, desktop, record);
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
      }
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
          path: join(runDir, kind + '-' + iteration + '-failure.png'),
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
  }
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
  const kinds = browserOnly ? ['browser'] : ['webview2', 'browser'];
  const failures = [];
  for (let pass = 1; pass <= numberOfStarts; pass++) {
    for (const kind of pass % 2 ? kinds : [...kinds].reverse()) {
      try {
        await run(kind, pass, origin);
      } catch (error) {
        failures.push(kind + ' #' + pass + ': ' + error.message);
      }
    }
  }
  if (failures.length) throw new Error(failures.join('\n'));
  if (!browserOnly) {
    const app = evidence.runs.find((r) => r.kind === 'webview2').probe;
    const edge = evidence.runs.find((r) => r.kind === 'browser').probe;
    assert.equal(
      app.resultHash,
      edge.resultHash,
      '50,000-candle result differs between the packaged WebView2 app and Edge.',
    );
    evidence.parity = {
      bars: 50000,
      evaluations: 100000,
      engines: kinds,
      sha256: app.resultHash,
      completedTrades: app.completedTrades,
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
