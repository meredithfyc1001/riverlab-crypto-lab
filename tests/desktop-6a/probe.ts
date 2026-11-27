import { contentHash } from '../../src/core/backtests/identity';
import type { AdvancedInput } from '../../src/core/advanced-research';
import { advancedTask } from '../../src/infrastructure/advanced-worker';
import { prepareBacktest } from '../performance/backtest-input';
import { advancedCapacityInput } from '../performance/capacity/advanced-input';
import { responsiveness } from '../performance/responsiveness';
import { runModuleWorkers } from './module-workers';
import { blobSha256, probeChart, probeDisposableIdb } from './platform';

const runButton = document.querySelector<HTMLButtonElement>('#run')!;
const download = document.querySelector<HTMLButtonElement>('#download')!;
const status = document.querySelector<HTMLElement>('#status')!;
const output = document.querySelector<HTMLElement>('#result')!;
const downloadName = 'riverlab-6a-synthetic-50000.json';
// Captured from the untouched Phase 5E browser's exported result, using its contentHash.
const phase5eResultHash =
  'e3fb4410dc0bac12ca6dc1d108d4a6ae2f56107a47fc20bbda789469cbaf5d6b';
let report: { file: Blob; sha256: string; url?: string } | undefined;
const desktop = (
  window as Window & {
    __TAURI__?: {
      core: {
        invoke<T>(
          command: string,
          body?: ArrayBuffer,
          options?: { headers: Record<string, string> },
        ): Promise<T>;
      };
    };
  }
).__TAURI__;
let inFlight: Promise<Awaited<ReturnType<typeof measure>>> | undefined;

async function measureResearch(
  input: AdvancedInput,
  mode: 'serial' | 'parallel',
  documentOwnsCandidates: boolean,
) {
  const OriginalWorker = window.Worker;
  let created = 0;
  // Observe successful construction in this test document only. A browser's
  // nested workers belong to its coordinator and cannot be counted here.
  if (documentOwnsCandidates) {
    window.Worker = class extends OriginalWorker {
      constructor(url: URL | string, options?: WorkerOptions) {
        super(url, options);
        if (options?.name === 'riverlab-advanced-candidate') {
          if (
            options.type !== 'module' ||
            new URL(url, location.href).origin !== location.origin
          ) {
            this.terminate();
            throw new Error('候选 Worker 不是同源模块。');
          }
          created++;
        }
      }
    };
  }
  try {
    const { record } = await advancedTask({
      kind: 'run',
      name: '6A 合成压力验证',
      input,
      concurrency: mode === 'serial' ? 1 : 4,
    }).promise;
    if (documentOwnsCandidates && created !== (mode === 'serial' ? 0 : 2)) {
      throw new Error(`页面实际创建了 ${created} 个候选 Worker。`);
    }
    return { record, created };
  } catch (error) {
    const phase = mode === 'serial' ? '串行研究' : '并行研究';
    throw new Error(phase + '失败：' + String(error), { cause: error });
  } finally {
    if (documentOwnsCandidates) window.Worker = OriginalWorker;
  }
}

async function measure() {
  const began = performance.now();
  const idb = await probeDisposableIdb();
  const storeSchema =
    '__RIVERLAB_FRESH_BROWSER_QA__' in window &&
    window.__RIVERLAB_FRESH_BROWSER_QA__ === true
      ? await (await import('./store-schema')).verifyPrototypeStoreSchema()
      : undefined;
  const repositoryParity = storeSchema
    ? await (await import('./repository-parity')).verifyRepositoryParity()
    : undefined;
  const chart = await probeChart();
  const moduleWorkers = await runModuleWorkers();
  const input = advancedCapacityInput(await prepareBacktest());
  const preview = await advancedTask({ kind: 'preview', input, concurrency: 4 })
    .promise;
  if (
    input.dataset.candles.length !== 50_000 ||
    preview.workers !== 2 ||
    preview.plan.bars !== 100_000
  )
    throw new Error('50,000 根研究输入或并发预算发生变化');
  const documentOwnsCandidates =
    import.meta.env.MODE === 'desktop-6a' && '__TAURI__' in window;
  const stopSampling = responsiveness();
  try {
    const start = performance.now();
    const serial = await measureResearch(
      input,
      'serial',
      documentOwnsCandidates,
    );
    const joined = performance.now();
    const pool = await measureResearch(
      input,
      'parallel',
      documentOwnsCandidates,
    );
    const ran = performance.now();
    const sample = stopSampling();
    const serialHash = contentHash(serial.record.result);
    const poolHash = contentHash(pool.record.result);
    const completedTrades =
      pool.record.result.folds[0]?.test?.metrics?.completedTrades;
    if (
      JSON.stringify(serial.record.result) !==
        JSON.stringify(pool.record.result) ||
      serialHash !== poolHash ||
      poolHash !== phase5eResultHash ||
      completedTrades !== 2082
    )
      throw new Error('单线程与多线程的完整结果或 5E 成交数不一致');
    const { file } = await advancedTask({
      kind: 'export',
      record: pool.record,
      format: 'json',
    }).promise;
    const downloadSha256 = await blobSha256(file);
    report = {
      file,
      sha256: downloadSha256,
      url: desktop ? undefined : URL.createObjectURL(file),
    };
    return {
      resultHash: poolHash,
      phase5eResultHash,
      serialHash,
      poolHash,
      workers: preview.workers,
      candidateWorkers: documentOwnsCandidates
        ? {
            owner: 'document',
            observed: { serial: serial.created, parallel: pool.created },
          }
        : { owner: 'coordinator', observed: null },
      candles: input.dataset.candles.length,
      completedTrades,
      evaluations: preview.plan.bars,
      moduleWorkers: [...moduleWorkers, 'advanced', 'advanced-candidate'],
      idb,
      storeSchema,
      repositoryParity,
      chart,
      reportHash: pool.record.reportHash,
      downloadSha256,
      downloadName,
      downloadBytes: file.size,
      timings: {
        serialMs: joined - start,
        poolMs: ran - joined,
        elapsedMs: performance.now() - began,
        ...sample,
      },
    };
  } finally {
    stopSampling();
  }
}

function run() {
  if (inFlight) return inFlight;
  runButton.disabled = download.disabled = true;
  if (report?.url) URL.revokeObjectURL(report.url);
  report = undefined;
  delete status.dataset.downloadState;
  delete status.dataset.savedPath;
  status.dataset.state = 'running';
  status.textContent = '正在运行合成研究与平台验证';
  output.textContent = '';
  inFlight = measure()
    .then((result) => {
      status.dataset.state = 'passed';
      status.textContent = '验证通过，可下载本次合成报告';
      output.textContent = JSON.stringify(result, null, 2);
      download.disabled = false;
      return result;
    })
    .catch((error: unknown) => {
      status.dataset.state = 'failed';
      status.textContent =
        error instanceof Error ? error.message : String(error);
      output.textContent = JSON.stringify({ error: status.textContent });
      throw error;
    })
    .finally(() => {
      runButton.disabled = false;
      inFlight = undefined;
    });
  return inFlight;
}

download.addEventListener('click', async () => {
  if (!report || download.disabled) return;
  download.disabled = runButton.disabled = true;
  delete status.dataset.savedPath;
  status.dataset.downloadState = 'saving';
  status.textContent = '正在保存下载并校验 SHA-256…';
  try {
    if (desktop) {
      const saved = await desktop.core.invoke<{ path: string; sha256: string }>(
        'save_report_download',
        await report.file.arrayBuffer(),
        { headers: { 'x-report-sha256': report.sha256 } },
      );
      if (saved.sha256 !== report.sha256 || !saved.path)
        throw new Error('保存回执与本次报告不符，请重试。');
      status.dataset.savedPath = saved.path;
      status.dataset.downloadState = 'verified';
      status.textContent = `已保存并校验：${saved.path} · SHA-256：${saved.sha256}`;
    } else {
      const link = document.createElement('a');
      link.href = report.url!;
      link.download = downloadName;
      link.click();
      status.dataset.downloadState = 'requested';
      status.textContent =
        '下载请求已交给浏览器，请在浏览器下载列表查看保存状态。';
    }
  } catch (error) {
    status.dataset.downloadState = 'failed';
    status.textContent =
      '下载失败：' + (error instanceof Error ? error.message : String(error));
  } finally {
    download.disabled = runButton.disabled = false;
  }
});
runButton.addEventListener('click', () => void run().catch(() => {}));
Object.assign(window, { riverlab6a: { run } });
runButton.disabled = false;
status.dataset.state = 'ready';
status.textContent = '可开始验证';

if (desktop) {
  document.querySelector<HTMLElement>('#sqlite-section')!.hidden = false;
  const button = document.querySelector<HTMLButtonElement>('#sqlite')!;
  const state = document.querySelector<HTMLElement>('#sqlite-status')!;
  const evidence = document.querySelector<HTMLElement>('#sqlite-result')!;
  button.addEventListener('click', async () => {
    button.disabled = true;
    state.dataset.state = 'running';
    state.textContent = '正在校验合成数据库';
    evidence.textContent = '';
    try {
      const result = await desktop.core.invoke('verify_sqlite');
      evidence.textContent = JSON.stringify(result, null, 2);
      state.dataset.state = 'passed';
      state.textContent = 'SQLite 验证通过';
    } catch (error) {
      state.dataset.state = 'failed';
      state.textContent =
        error instanceof Error ? error.message : String(error);
    } finally {
      button.disabled = false;
    }
  });
}

if (
  import.meta.env.MODE === 'desktop-6a' &&
  '__RIVERLAB_6A_NATIVE_VERIFY__' in window &&
  window.__RIVERLAB_6A_NATIVE_VERIFY__ === true &&
  '__TAURI__' in window
) {
  const host = window.__TAURI__;
  void import('./native-acceptance').then(({ runNativeAcceptance }) =>
    runNativeAcceptance(host as Parameters<typeof runNativeAcceptance>[0]),
  );
}
