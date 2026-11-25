import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

const button = (page, name) => page.getByRole('button', { name, exact: true });
async function download(page, format) {
  const pending = page.waitForEvent('download');
  await button(page, '导出市场状态 ' + format).click();
  const file = await pending;
  assert.equal(await file.failure(), null);
  return file.path();
}

function fixed18(value) {
  const match = /^(-?)(\d+)(?:\.(\d{1,18}))?$/.exec(value);
  assert.ok(match, 'invalid fixed-point amount ' + value);
  return BigInt(match[1] + match[2] + (match[3] ?? '').padEnd(18, '0'));
}

// Used on both the production preview and a cleanly extracted package.
export async function exerciseMarketRegime(
  page,
  freshPage,
  { kind, source, reference, expectedNetPnl },
) {
  const url = new URL('/#/market-regime', page.url()).href;
  await page.goto(url);
  await page.getByLabel('原实验类型').selectOption(kind);
  const sources = page.getByLabel('已保存的原实验');
  const choice = sources.locator('option').filter({ hasText: source });
  await choice.waitFor({ state: 'attached' });
  await sources.selectOption(await choice.getAttribute('value'));
  const run = button(page, '运行市场状态研究');
  if (reference) {
    const select = page.getByLabel('组合参考资产');
    await select.waitFor();
    assert.equal(await select.inputValue(), '');
    assert.equal(await run.isEnabled(), false);
    await select.selectOption(reference);
  }
  await page.getByLabel('观察周期（根）').fill('2');
  await page.getByLabel('趋势阈值（基点）').fill('5');
  await page.getByLabel('报告名称').fill('验收 ' + source);
  await run.click();
  // A repeated run can leave the previous validated report visible while its
  // replacement is being computed. Read the hash of the requested report.
  await page
    .getByRole('heading', { name: '验收 ' + source, exact: true })
    .waitFor();
  const hashView = page.getByTestId('regime-report-hash');
  await hashView.waitFor();
  const hash = (await hashView.textContent()).trim();
  assert.match(hash, /^[0-9a-f]{64}$/);
  await page
    .getByRole('img', { name: '历史 K 线与上一收盘市场状态区间叠加图' })
    .locator('canvas')
    .first()
    .waitFor();
  await page.getByLabel('查看第几根 K 线').fill('1');
  await page
    .getByText(/本根归因状态/)
    .filter({ hasText: 'UNKNOWN' })
    .waitFor();
  const path = await download(page, 'JSON');
  const originalBytes = await readFile(path);
  const report = JSON.parse(originalBytes);
  assert.equal(
    report.reportHash,
    hash,
    'displayed and exported report: ' + source,
  );
  assert.equal(report.name, '验收 ' + source);
  if (expectedNetPnl !== undefined)
    assert.equal(report.result.netPnl, expectedNetPnl);
  assert.equal(report.reference, reference);
  assert.equal(report.source.kind, kind);
  assert.deepEqual(report.params, { lookback: 2, thresholdBps: 5 });
  const summaries = report.result.summaries;
  assert.deepEqual(summaries.map((s) => s.state).sort(), [
    'BEAR',
    'BULL',
    'SIDEWAYS',
    'UNKNOWN',
  ]);
  assert.equal(
    summaries.reduce((a, s) => a + fixed18(s.netPnl), 0n),
    fixed18(report.result.netPnl),
  );
  assert.ok(summaries.find((s) => s.state === 'UNKNOWN').bars >= 1);
  const csv = await readFile(await download(page, 'CSV'), 'utf8');
  for (const state of summaries) assert.ok(csv.includes(state.state));
  assert.ok(csv.includes(hash));
  await button(page, '保存市场状态报告').click();
  const clean = await freshPage();
  try {
    await clean.goto(url);
    await clean.getByLabel('导入市场状态 JSON').setInputFiles(path);
    await clean.getByTestId('regime-report-hash').waitFor();
    assert.equal(
      (await clean.getByTestId('regime-report-hash').textContent()).trim(),
      hash,
    );
    await button(clean, '保存市场状态报告').click();
    const reopen = button(clean, '重开');
    await reopen.waitFor();
    await clean.reload();
    await reopen.click();
    await clean.getByTestId('regime-report-hash').waitFor();
    assert.deepEqual(
      await readFile(await download(clean, 'JSON')),
      originalBytes,
    );
    await button(clean, '删除').click();
    await button(clean, '确认删除').click();
    await reopen.waitFor({ state: 'detached' });
  } finally {
    await clean.context().close();
  }
  return hash;
}

// Run only in a fresh, disposable browser profile. Each damaged entry starts
// as a genuine saved record. Compare every row after all UI reads/exports.
async function libraryRows(page, database, stores, changes = []) {
  return page.evaluate(
    async ({ database, stores, changes }) => {
      const db = await new Promise((resolve, reject) => {
        const req = globalThis.indexedDB.open(
          'riverlab-crypto-lab-' + database,
        );
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      try {
        return await new Promise((resolve, reject) => {
          const tx = db.transaction(
            stores,
            changes.length ? 'readwrite' : 'readonly',
          );
          const rows = {};
          tx.oncomplete = () => resolve(rows);
          tx.onabort = () => reject(tx.error);
          for (const { store, id, field, value } of changes) {
            const table = tx.objectStore(store);
            const get = table.get(id);
            get.onsuccess = () => table.put({ ...get.result, [field]: value });
          }
          if (!changes.length)
            for (const store of stores) {
              const get = tx.objectStore(store).getAll();
              get.onsuccess = () => {
                rows[store] = get.result;
              };
            }
        });
      } finally {
        db.close();
      }
    },
    { database, stores, changes },
  );
}

export async function exerciseRegimeLibrary(page, origin) {
  const singlePath = 'tests/fixtures/windows-20261125/ma-2-4.json';
  const single = JSON.parse(await readFile(singlePath, 'utf8'));
  await page.goto(origin + '/#/experiments');
  await page
    .getByLabel('导入回测实验 JSON（最多 256 MiB）')
    .setInputFiles(singlePath);
  await button(page, '确认保存导入的实验').click();
  await page.getByText('导入的实验已保存，可以刷新后重新打开。').waitFor();
  const shared = [];
  await page.goto(origin + '/#/portfolio');
  for (const mode of ['shared-strategy', 'rebalance']) {
    const bytes = gunzipSync(
      await readFile('tests/fixtures/phase-5c-b-' + mode + '.json.gz'),
    );
    const original = JSON.parse(bytes);
    await page.getByLabel('运行模式').selectOption(mode);
    await page.getByLabel('导入组合 JSON').setInputFiles({
      name: 'fixture.json',
      mimeType: 'application/json',
      buffer: bytes,
    });
    await button(page, '保存组合实验').click();
    await button(page, '重新打开 ' + original.name).waitFor();
    shared.push(original);
  }
  await page.goto(origin + '/#/market-regime');
  const kind = page.getByLabel('原实验类型');
  const sources = page.getByLabel('已保存的原实验');
  await sources.selectOption(single.id);
  const makeStudy = async (name) => {
    await page.getByLabel('报告名称').fill(name);
    await button(page, '运行市场状态研究').click();
    await page.getByRole('heading', { name, exact: true }).waitFor();
  };
  const reportRow = (name) =>
    page
      .getByRole('listitem')
      .filter({ has: page.getByText(name, { exact: true }) });
  const names = ['健康报告一', '健康报告二', '摘要损坏案例', '正文损坏案例'];
  const reports = [];
  for (const name of names) {
    await makeStudy(name);
    const bytes = await readFile(await download(page, 'JSON'));
    const record = JSON.parse(bytes);
    await button(page, '保存市场状态报告').click();
    await reportRow(name).waitFor();
    reports.push({ id: record.id, hash: record.reportHash, bytes });
  }
  const sourceStores = ['experiments', 'summaries'];
  const reportStores = ['reports', 'summaries'];
  await libraryRows(page, 'shared-pool', sourceStores, [
    {
      store: 'summaries',
      id: shared[1].id,
      field: 'payloadHash',
      value: 'bad',
    },
  ]);
  await libraryRows(page, 'market-regime', reportStores, [
    {
      store: 'summaries',
      id: reports[2].id,
      field: 'reportHash',
      value: 'bad',
    },
    {
      store: 'reports',
      id: reports[3].id,
      field: 'params',
      value: { lookback: 3, thresholdBps: 10 },
    },
  ]);
  const snapshot = () =>
    Promise.all([
      libraryRows(page, 'shared-pool', sourceStores),
      libraryRows(page, 'market-regime', reportStores),
      libraryRows(page, 'experiments', sourceStores),
    ]);
  const before = await snapshot();
  await page.reload();
  await kind.selectOption('shared');
  await sources
    .locator('option')
    .filter({ hasText: shared[0].name })
    .waitFor({ state: 'attached' });
  assert.equal(
    await sources.locator('option').filter({ hasText: shared[1].name }).count(),
    0,
  );
  await page
    .getByText(/共享资金池.*可用摘要\s*1\s*条.*隔离\s*1\s*条/)
    .waitFor();
  await page
    .getByText(/市场状态报告库.*可用摘要\s*3\s*条.*隔离\s*1\s*条/)
    .waitFor();
  assert.equal(await reportRow(names[2]).count(), 0);
  await reportRow(names[3]).getByRole('button', { name: '重开' }).click();
  await page
    .getByRole('alert')
    .filter({ hasText: /Hash 不符/ })
    .waitFor();
  assert.equal(await page.getByTestId('regime-report-hash').count(), 0);
  assert.equal(await button(page, '导出市场状态 JSON').count(), 0);
  await kind.selectOption('single');
  await sources.selectOption(single.id);
  await makeStudy('跨来源可用');
  assert.equal(
    JSON.parse(await readFile(await download(page, 'JSON'))).source.payloadHash,
    single.payloadHash,
  );
  for (const i of [0, 1]) {
    await reportRow(names[i]).getByRole('button', { name: '重开' }).click();
    await page.getByRole('heading', { name: names[i], exact: true }).waitFor();
    assert.equal(
      (await page.getByTestId('regime-report-hash').textContent()).trim(),
      reports[i].hash,
    );
    assert.deepEqual(
      await readFile(await download(page, 'JSON')),
      reports[i].bytes,
    );
    assert(
      (await readFile(await download(page, 'CSV'), 'utf8')).includes(
        reports[i].hash,
      ),
    );
  }
  assert.deepEqual(await snapshot(), before);
  return {
    sourcePayloadHash: single.payloadHash,
    reopenedReportHashes: reports.slice(0, 2).map((r) => r.hash),
  };
}
