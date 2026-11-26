// Loaded only by the Windows build when the host has allocated a fresh test profile.
// The two full document navigations exercise recovery from disk and real download handling.
import sections from './sections.json';
import { verifyRepositoryParity } from './repository-parity';

type ReceiptName =
  | 'ready'
  | 'worker-ready'
  | 'research-start'
  | 'research-end'
  | 'result'
  | 'error';
type Host = {
  core: { invoke(command: string, data?: unknown): Promise<unknown> };
};
type Navigation = { lang: string; headings: string[]; sections: string[] };
type State = {
  phase: 'reopen' | 'probe';
  startUtcMs: number;
  workbenchMs: number;
  firstCsvWorkerMs: number;
  navigation: Navigation;
  chart: { readout: string; canvases: number };
  restored: boolean;
  repositoryParity?: Awaited<ReturnType<typeof verifyRepositoryParity>>;
};
const stateKey = 'riverlab-6a-private-native-acceptance-v1';
const symbol = 'SYNTHETIC/USDT';
const golden =
  'e3fb4410dc0bac12ca6dc1d108d4a6ae2f56107a47fc20bbda789469cbaf5d6b';
const sqliteGolden =
  '34429675a4ac768482806ffe80475cb5e601bf1f2ffa8069cac2a0076f0c0f55';

async function until<T>(
  label: string,
  read: () => T | null | undefined | false,
  limitMs = 15000,
): Promise<T> {
  const end = performance.now() + limitMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (performance.now() >= end) throw new Error('等待超时：' + label);
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}
function textOf(element: Element | null) {
  return (element?.textContent ?? '').trim().replace(/\s+/g, ' ');
}
function findText(selector: string, text: string, contains = false) {
  return [...document.querySelectorAll(selector)].find((el) =>
    contains ? textOf(el).includes(text) : textOf(el) === text,
  );
}
async function click(text: string, contains = false) {
  const button = await until(text, () => {
    const el = findText('button', text, contains);
    return el instanceof HTMLButtonElement && !el.matches(':disabled') && el;
  });
  button.click();
}
function labeled<T extends Element>(text: string, control: string) {
  return until(text, () =>
    findText('label', text, true)?.querySelector<T>(control),
  );
}
async function fill(label: string, value: string) {
  const input = await labeled<HTMLInputElement>(label, 'input');
  // Set the native form value before dispatching input, as a real user edit would.
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
async function check(label: string) {
  const input = await labeled<HTMLInputElement>(label, 'input[type=checkbox]');
  await until(label, () => !input.matches(':disabled'));
  if (!input.checked) input.click();
}
async function section(id: keyof typeof sections) {
  location.hash = '/' + id;
  const [title, feature] = sections[id];
  await until(
    title + ' / ' + feature,
    () =>
      findText('h1', title) &&
      findText('h2', feature) &&
      document
        .querySelector('[aria-label="研究风险提示"]')
        ?.textContent?.includes('不提供投资建议'),
  );
}
async function firstCsv() {
  await section('datasets');
  const prices = [100, 103, 99, 106, 102, 109, 104, 113];
  const csv = [
    'timestamp,open,high,low,close,volume',
    ...prices.map((price, i) =>
      [Date.UTC(2025, 0, 1) + i * 60000, price, price, price, price, 1].join(
        ',',
      ),
    ),
  ].join('\n');
  const files = new DataTransfer();
  files.items.add(
    new File([csv], '桌面验证 人工合成.csv', { type: 'text/csv' }),
  );
  const picker = await until('选择本地 CSV', () =>
    document.querySelector<HTMLInputElement>(
      'input[aria-label="选择本地 CSV"]',
    ),
  );
  picker.files = files.files;
  picker.dispatchEvent(new Event('change', { bubbles: true }));
  await until('CSV Worker 检查完成', () =>
    findText('p', '读到 8 条数据记录。', true),
  );
}
async function saveSyntheticReplay() {
  await fill('预期固定周期（秒）', '60');
  await click('检查并生成导入报告');
  await fill('币种 / 交易对（自述，不认证来源）', symbol);
  await check('我已阅读');
  await click('保存已检查数据集');
  await until('合成行情已提交', () =>
    document.body.textContent?.includes(
      '已保存数据集（SQLite 事务已完成）。请另行备份。',
    ),
  );
  await click('用于行情中心');
  const readout = await until('中文行情图及 UTC 日期', () => {
    const canvases = document.querySelectorAll(
      '[data-testid=market-canvas] canvas',
    );
    const readout = textOf(
      document.querySelector('[data-testid=chart-readout]'),
    );
    return (
      canvases.length > 0 &&
      canvases[0].getBoundingClientRect().width > 0 &&
      readout.includes('2025-01-01') && { readout, canvases: canvases.length }
    );
  });
  await click('放大图表');
  await section('replay');
  const select = await labeled<HTMLSelectElement>('回放数据集', 'select');
  const option = await until(symbol, () =>
    [...select.options].find((o) => textOf(o).includes(symbol)),
  );
  select.value = option.value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await check('我确认回放数据全部已收盘');
  await click('开始历史回放');
  await cursor(1);
  await click('前进一根');
  await cursor(2);
  await click('保存回放状态');
  await until('回放状态保存', () =>
    document.body.textContent?.includes(
      '回放状态已保存（事务已完成）。请另行导出JSON备份。',
    ),
  );
  return readout;
}
function cursor(n: number) {
  return until('回放游标 ' + n, () =>
    textOf(document.querySelector('[data-testid=replay-cursor]')).includes(
      `已播放 ${n} / 8`,
    ),
  );
}
async function readNavigation() {
  const result: Navigation = {
    lang: document.documentElement.lang,
    headings: [],
    sections: [],
  };
  if (result.lang !== 'zh-CN') throw new Error('工作台语言异常');
  for (const id of Object.keys(sections) as (keyof typeof sections)[]) {
    await section(id);
    result.headings.push(textOf(findText('h1', sections[id][0])!));
    result.sections.push(textOf(findText('h2', sections[id][1])!));
  }
  return result;
}
async function buttonResult(
  button: string,
  status: string,
  output: string,
  limit: number,
) {
  const start = await until(button, () => {
    const el = document.querySelector<HTMLButtonElement>(button);
    return el && !el.disabled && el;
  });
  start.click();
  const done = await until(
    status,
    () =>
      document.querySelector<HTMLElement>(
        status + ':is([data-state=passed],[data-state=failed])',
      ),
    limit,
  );
  if (done.dataset.state !== 'passed') throw new Error(textOf(done));
  return JSON.parse(document.querySelector<HTMLElement>(output)!.innerText);
}
async function engineIdentity() {
  const ua = navigator as Navigator & {
    userAgentData?: {
      getHighEntropyValues(
        keys: string[],
      ): Promise<{ fullVersionList?: { brand: string; version: string }[] }>;
    };
  };
  const brands = await ua.userAgentData
    ?.getHighEntropyValues(['fullVersionList'])
    .catch(() => undefined);
  const version =
    brands?.fullVersionList?.find((b) =>
      /Microsoft Edge|WebView2/i.test(b.brand),
    )?.version ??
    brands?.fullVersionList?.find((b) => b.brand === 'Chromium')?.version ??
    /(?:Edg|Chrome)\/([\d.]+)/.exec(navigator.userAgent)?.[1];
  return { engineVersion: version, userAgent: navigator.userAgent };
}
export async function runNativeAcceptance(host: Host) {
  const receipt = (name: ReceiptName, data: unknown) =>
    host.core.invoke('qa_record', { name, json: JSON.stringify(data) });
  let step = '启动';
  try {
    const previous = sessionStorage.getItem(stateKey);
    const state: State | null = previous ? JSON.parse(previous) : null;
    if (!state) {
      if (!['/', '/index.html'].includes(location.pathname))
        throw new Error('初次验收页面异常');
      await section('overview');
      const startUtcMs = performance.timeOrigin;
      const workbenchMs = Math.round(performance.now());
      const engine = await engineIdentity();
      // qa_record succeeds only in the native host's new, exclusive ci profile.
      // Stop before file selection / product store writes if the IPC denies the request.
      await receipt('ready', {
        ...engine,
        workbenchMs,
        lang: document.documentElement.lang,
      });
      step = 'CSV Worker';
      await firstCsv();
      const firstCsvWorkerMs = Math.round(performance.now());
      await receipt('worker-ready', { ...engine, firstCsvWorkerMs, rows: 8 });
      // Fixed idle observation window for the separate Windows process-tree sampler.
      await new Promise((resolve) => setTimeout(resolve, 4000));
      step = '合成行情、图表与回放';
      const chart = await saveSyntheticReplay();
      step = '工作台功能区';
      const navigation = await readNavigation();
      await section('replay');
      const next: State = {
        phase: 'reopen',
        startUtcMs,
        workbenchMs,
        firstCsvWorkerMs,
        navigation,
        chart,
        restored: false,
      };
      sessionStorage.setItem(stateKey, JSON.stringify(next));
      location.reload();
      return;
    }
    if (state.phase === 'reopen') {
      step = '重载后重开回放';
      await section('replay');
      if (document.querySelector('[data-testid=replay-cursor]'))
        throw new Error('新页面不应有未打开的回放');
      await click('打开回放', true);
      await cursor(2);
      const repositoryParity = await verifyRepositoryParity();
      sessionStorage.setItem(
        stateKey,
        JSON.stringify({
          ...state,
          phase: 'probe',
          restored: true,
          repositoryParity,
        }),
      );
      location.assign('/tests/desktop-6a/index.html');
      return;
    }
    if (
      state.phase !== 'probe' ||
      !state.restored ||
      location.pathname !== '/tests/desktop-6a/index.html'
    )
      throw new Error('验收导航异常');
    step = 'SQLite';
    const sqlite = await buttonResult(
      '#sqlite',
      '#sqlite-status',
      '#sqlite-result',
      30000,
    );
    if (
      sqlite.status !== 'PASS' ||
      sqlite.committedRows !== 1 ||
      sqlite.rowsAfterRollback !== 1 ||
      sqlite.restoredRows !== 1 ||
      sqlite.integrityCheck !== 'ok' ||
      sqlite.fixtureSha256 !== sqliteGolden ||
      sqlite.restoredPayloadSha256 !== sqliteGolden
    )
      throw new Error('SQLite 结果与合成夹具不符');
    step = '五万根高级研究';
    await receipt('research-start', { utcMs: Date.now() });
    const probe = await buttonResult('#run', '#status', '#result', 180000);
    await receipt('research-end', {
      utcMs: Date.now(),
      resultHash: probe.resultHash,
    });
    if (
      probe.resultHash !== golden ||
      probe.poolHash !== golden ||
      probe.serialHash !== golden ||
      probe.candles !== 50000 ||
      probe.completedTrades !== 2082 ||
      probe.evaluations !== 100000 ||
      probe.workers !== 2 ||
      probe.candidateWorkers?.owner !== 'document' ||
      probe.candidateWorkers.observed?.serial !== 0 ||
      probe.candidateWorkers.observed?.parallel !== 2
    )
      throw new Error('研究结果或实测候选 Worker 数与 6A 门槛不符');
    step = '桌面 SQLite 服务';
    const health = await host.core.invoke('local_service_health');
    const integrity = await host.core.invoke('local_service_integrity');
    // This is a host-created, previously nonexistent test profile. Opening,
    // saving and reopening the workbench must not create a browser-side library.
    const productIdb = (await indexedDB.databases())
      .map(({ name }) => name)
      .filter((name) => name?.startsWith('riverlab-crypto-lab'));
    if (productIdb.length || integrity !== 'ok')
      throw new Error('桌面存储隔离或完整性检查失败');
    step = '下载';
    const downloads: string[] = [];
    for (let i = 0; i < 2; i++) {
      await click('下载合成研究报告');
      const saved = await until(
        '落盘报告及 SHA-256',
        () => {
          const status = document.querySelector<HTMLElement>('#status')!;
          if (status.dataset.downloadState === 'failed')
            throw new Error(status.textContent ?? '下载失败');
          return (
            status.dataset.downloadState === 'verified' &&
            status.textContent?.includes(probe.downloadSha256) &&
            status.dataset.savedPath
          );
        },
        30000,
      );
      downloads.push(saved.split(/[\\/]/).pop()!);
    }
    const engine = await engineIdentity();
    await receipt('result', {
      ...engine,
      navigation: state.navigation,
      chart: state.chart,
      replay: { dataset: symbol, candles: 8, restoredReplayCursor: 2 },
      probe,
      service: { health, integrity, productIdb },
      repositoryParity: state.repositoryParity,
      sqlite,
      download: {
        filename: probe.downloadName,
        sha256: probe.downloadSha256,
        bytes: probe.downloadBytes,
        requested: true,
        verifiedFiles: downloads,
      },
      timings: {
        workbenchMs: state.workbenchMs,
        firstCsvWorkerMs: state.firstCsvWorkerMs,
        elapsedMs: Math.round(
          performance.timeOrigin + performance.now() - state.startUtcMs,
        ),
      },
    });
    sessionStorage.removeItem(stateKey);
  } catch (error) {
    await receipt('error', {
      step,
      message: String(error).slice(0, 2000),
      document: location.pathname,
      hash: location.hash,
    });
  }
}
