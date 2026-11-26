import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';

const resultHash =
  'e3fb4410dc0bac12ca6dc1d108d4a6ae2f56107a47fc20bbda789469cbaf5d6b';
const sqliteHash =
  '34429675a4ac768482806ffe80475cb5e601bf1f2ffa8069cac2a0076f0c0f55';
const downloadName = 'riverlab-6a-synthetic-50000.json';

function applicationEnvironment(profileId) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/^(path|node_path|node_options|webview2_.*|riverlab_6a_test_profile|riverlab_6a_native_verify)$/i.test(
          key,
        ),
    ),
  );
  return {
    ...env,
    Path:
      join(process.env.SystemRoot, 'System32') + ';' + process.env.SystemRoot,
    RIVERLAB_6A_TEST_PROFILE: profileId,
    RIVERLAB_6A_NATIVE_VERIFY: '1',
  };
}

// The producer writes receipts to new names in a unique profile. Ignore only
// Windows file sharing delays or a file that has not been published yet.
async function receipt(directory, name) {
  const path = join(directory, name + '.json');
  try {
    const content = await readFile(path, 'utf8');
    const data = JSON.parse(content);
    const { mtimeMs } = await stat(path);
    return { data, mtimeMs };
  } catch (error) {
    if (['ENOENT', 'EBUSY', 'EPERM'].includes(error.code)) return null;
    throw error;
  }
}

async function stopWindow(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode) return;
  const closer = spawn(
    'pwsh.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '$p = Get-Process -Id ([int]$env:RIVERLAB_6A_CLOSE_PID) -ErrorAction SilentlyContinue; if ($p) { [void]$p.CloseMainWindow() }',
    ],
    {
      env: { ...process.env, RIVERLAB_6A_CLOSE_PID: String(child.pid) },
      windowsHide: true,
      stdio: 'ignore',
    },
  );
  closer.on('error', () => {});
  const deadline = Date.now() + 8000;
  while (child.exitCode === null && !child.signalCode && Date.now() < deadline)
    await pause(100);
  if (closer.exitCode === null) closer.kill();
  if (child.exitCode === null && !child.signalCode) {
    child.kill();
    const killDeadline = Date.now() + 3000;
    while (
      child.exitCode === null &&
      !child.signalCode &&
      Date.now() < killDeadline
    )
      await pause(100);
  }
}

async function verifiedDownload(directory, evidenceDir, probe) {
  assert.equal(probe.downloadName, downloadName);
  assert.match(probe.downloadSha256, /^[a-f\d]{64}$/);
  assert(Number.isSafeInteger(probe.downloadBytes) && probe.downloadBytes > 0);
  const path = join(directory, downloadName);
  const deadline = Date.now() + 30000;
  let last = 'file unavailable';
  do {
    try {
      const actual = await stat(path);
      last = actual.size + ' bytes';
      if (actual.size === probe.downloadBytes) {
        const bytes = await readFile(path);
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        last = sha256;
        if (
          bytes.length === probe.downloadBytes &&
          sha256 === probe.downloadSha256
        ) {
          await writeFile(join(evidenceDir, downloadName), bytes);
          return { filename: downloadName, bytes: bytes.length, sha256 };
        }
      }
    } catch (error) {
      if (!['ENOENT', 'EBUSY', 'EPERM'].includes(error.code)) throw error;
    }
    await pause(150);
  } while (Date.now() < deadline);
  throw new Error(
    'Downloaded Blob did not match the WebView report; last observation: ' +
      last,
  );
}

function checkWorkload({ navigation, replay, probe, sqlite }) {
  assert.equal(navigation.lang, 'zh-CN');
  assert.equal(new Set(navigation.headings).size, 11);
  assert.equal(new Set(navigation.sections).size, 11);
  assert.equal(replay.candles, 8);
  assert.equal(replay.restoredReplayCursor, 2);
  assert.equal(probe.candles, 50000);
  assert.equal(probe.evaluations, 100000);
  assert.equal(probe.workers, 2);
  assert.equal(probe.completedTrades, 2082);
  assert.equal(probe.idb, true);
  assert(probe.chart.upPixels > 0 && probe.chart.downPixels > 0);
  assert.equal(new Set(probe.moduleWorkers).size, 10);
  for (const hash of [
    probe.resultHash,
    probe.serialHash,
    probe.poolHash,
    probe.phase5eResultHash,
  ])
    assert.equal(hash, resultHash);
  assert.equal(sqlite.status, 'PASS');
  assert.deepEqual(
    [sqlite.committedRows, sqlite.rowsAfterRollback, sqlite.restoredRows],
    [1, 1, 1],
  );
  assert.equal(sqlite.integrityCheck, 'ok');
  assert.equal(sqlite.fixtureSha256, sqliteHash);
  assert.equal(sqlite.restoredPayloadSha256, sqliteHash);
}

export async function runNative({ exe, iteration, runDir, startMemory }) {
  assert.equal(process.platform, 'win32');
  const profileId = 'ci-' + randomUUID();
  const profile = join(
    process.env.LOCALAPPDATA,
    'org.riverlab.cryptolab.prototype6a',
    'Profiles',
    'test-' + profileId,
  );
  await assert.rejects(lstat(profile), { code: 'ENOENT' });
  const directory = join(profile, 'acceptance');
  const evidenceDir = join(runDir, 'native-' + iteration);
  await mkdir(evidenceDir);
  const record = {
    kind: 'webview2',
    iteration,
    startupProfile: 'fresh',
    transport: 'packaged native acceptance receipts',
    status: 'INCOMPLETE',
    receipts: {},
  };
  const startUtc = Date.now();
  const app = spawn(exe, [], {
    env: applicationEnvironment(profileId),
    stdio: 'ignore',
  });
  let launchError;
  app.on('error', (error) => {
    launchError = error;
  });
  let memory;
  async function waitFor(name, timeout) {
    record.awaiting = name;
    const deadline = Date.now() + timeout;
    do {
      const failure = await receipt(directory, 'error');
      if (failure) {
        record.receipts.error = failure.data;
        throw new Error(
          'Native UI: ' + JSON.stringify(failure.data).slice(0, 2000),
        );
      }
      const data = await receipt(directory, name);
      if (data) {
        record.receipts[name] = data.data;
        return data;
      }
      if (launchError) throw launchError;
      if (app.exitCode !== null || app.signalCode)
        throw new Error(
          'Desktop exited while awaiting ' +
            name +
            ': ' +
            (app.exitCode ?? app.signalCode),
        );
      if (memory?.state.error) throw new Error(memory.state.error);
      await pause(80);
    } while (Date.now() < deadline);
    throw new Error('Timed out waiting for packaged UI receipt ' + name);
  }
  try {
    if (iteration === 1 && app.pid) memory = startMemory(app.pid, record);
    const ready = await waitFor('ready', 60000);
    record.workbenchMs = Math.round(ready.mtimeMs - startUtc);
    assert.equal(ready.data.lang, 'zh-CN');
    record.engineVersion = ready.data.engineVersion;
    assert.match(record.engineVersion, /^\d+\.\d+\.\d+\.\d+/);
    const worker = await waitFor('worker-ready', 45000);
    assert.equal(worker.data.rows, 8);
    assert.equal(worker.data.engineVersion, record.engineVersion);
    record.firstCsvWorkerMs = Math.round(worker.mtimeMs - startUtc);
    assert(
      record.workbenchMs >= 0 && record.firstCsvWorkerMs >= record.workbenchMs,
    );
    if (iteration === 1) {
      const researchStart = await waitFor('research-start', 120000);
      const researchEnd = await waitFor('research-end', 180000);
      const { data, mtimeMs: completed } = await waitFor('result', 60000);
      assert.equal(data.download.requested, true);
      assert.equal(data.engineVersion, record.engineVersion);
      checkWorkload(data);
      const { navigation, replay, probe, sqlite, chart } = data;
      Object.assign(record, { navigation, replay, probe, sqlite, chart });
      record.download = await verifiedDownload(directory, evidenceDir, probe);
      for (const sample of record.memorySamples) {
        const t = sample.utcMs;
        if (t >= worker.mtimeMs && t < worker.mtimeMs + 4000)
          sample.phase = 'idle';
        else if (t >= worker.mtimeMs + 4000 && t <= completed)
          sample.phase = 'workload';
        else sample.phase = t < worker.mtimeMs ? 'startup' : 'complete';
      }
      const active = record.memorySamples.filter((s) => s.phase === 'workload');
      const research = active.filter(
        (s) =>
          s.utcMs >= researchStart.mtimeMs && s.utcMs <= researchEnd.mtimeMs,
      );
      assert(
        research.some((s) => s.processCount >= 2),
        'Missing installed runtime process-tree samples during research',
      );
      record.researchWindowPeakWorkingSetBytes = Math.max(
        ...research.map((s) => s.workingSetBytes),
      );
      record.researchWindowPeakPrivateBytes = Math.max(
        ...research.map((s) => s.privateBytes),
      );
      assert(
        record.memorySamples.some(
          (s) => s.phase === 'idle' && s.processCount >= 2,
        ),
        'Missing installed runtime idle samples',
      );
      record.sampledPeakWorkingSetBytes = Math.max(
        ...active.map((s) => s.workingSetBytes),
      );
      record.sampledPeakPrivateBytes = Math.max(
        ...active.map((s) => s.privateBytes),
      );
    }
    delete record.awaiting;
    record.status = 'PASS';
    return record;
  } catch (error) {
    record.status = 'FAIL';
    record.nativePageLoads = {};
    for (const name of [
      'host-workbench-loaded',
      'host-probe-loaded',
      'host-unexpected-page',
    ]) {
      try {
        const diagnostic = await receipt(directory, name);
        if (diagnostic) record.nativePageLoads[name] = diagnostic.data;
      } catch (failure) {
        record.nativePageLoads[name] = { error: failure.message };
      }
    }
    record.processAtFailure = {
      exitCode: app.exitCode,
      signalCode: app.signalCode,
    };
    record.error = error.message;
    error.record = record;
    throw error;
  } finally {
    memory?.sampler.kill();
    await stopWindow(app);
    await writeFile(
      join(evidenceDir, 'native-run.json'),
      JSON.stringify(record, null, 2) + '\n',
    );
    // Only this newly allocated private CI profile can be removed. Receipts and
    // the verified synthetic download have already been copied into runDir.
    await rm(profile, {
      force: true,
      recursive: true,
      maxRetries: 3,
      retryDelay: 250,
    }).catch((error) =>
      console.warn('Native test profile cleanup:', error.code),
    );
  }
}
