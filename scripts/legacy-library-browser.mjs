import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const button = (page, name) => page.getByRole('button', { name, exact: true });
const libraries = [
  ['riverlab-crypto-lab', 'datasets', 'summaries'],
  ['riverlab-crypto-lab-rules', 'versions'],
  ['riverlab-crypto-lab-replays', 'replays', 'summaries'],
  ['riverlab-crypto-lab-risk', 'studies', 'summaries'],
];

async function download(page, label) {
  const promise = page.waitForEvent('download');
  await button(page, label).click();
  return JSON.parse(await readFile(await (await promise).path(), 'utf8'));
}

// Only run against a new, disposable browser profile. Each store must start
// with exactly one genuine record saved via the UI before inserting a bad row.
async function inspect(page) {
  return page.evaluate(async (libraries) => {
    const snapshots = {};
    for (const [name, ...stores] of libraries) {
      const db = await new Promise((resolve, reject) => {
        const req = globalThis.indexedDB.open(name);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      try {
        snapshots[name] = await new Promise((resolve, reject) => {
          const tx = db.transaction(stores, 'readonly');
          const snapshot = {};
          tx.onabort = () =>
            reject(tx.error ?? new Error('验收配置必须为空白浏览器配置'));
          tx.oncomplete = () => resolve(snapshot);
          for (const key of stores) {
            const table = tx.objectStore(key);
            const req = table.getAll();
            req.onsuccess = () => {
              snapshot[key] = req.result;
            };
          }
        });
      } finally {
        db.close();
      }
    }
    return snapshots;
  }, libraries);
}

export async function exerciseLegacyLibrary(
  page,
  baseUrl,
  fixturePath = 'scripts/local-test/acceptance-library-fixture.js',
) {
  const snippet = await readFile(fixturePath, 'utf8');
  const goto = (route) => page.goto(new URL('/#/' + route, baseUrl).href);
  await goto('datasets');
  await button(page, '人工合成样本 · 毫秒').click();
  await page.getByText('读到 4 条数据记录。', { exact: false }).waitFor();
  await page.getByLabel('预期固定周期（秒）').fill('60');
  await button(page, '检查并生成导入报告').click();
  await page.getByLabel('币种 / 交易对（自述，不认证来源）').fill('ISOLATION');
  await page.getByRole('checkbox', { name: /我已阅读 .* 项警告/ }).check();
  await button(page, '保存已检查数据集').click();
  await page
    .getByText('已保存数据集（IndexedDB 事务已完成）。请另行备份。')
    .waitFor();

  await goto('replay');
  await page.getByLabel('回放数据集').selectOption({ index: 1 });
  await page
    .getByRole('checkbox', { name: /我确认回放数据全部已收盘/ })
    .check();
  await button(page, '开始历史回放').click();
  await button(page, '保存回放状态').click();
  await page.getByRole('button', { name: /^打开回放 / }).waitFor();

  await goto('strategies');
  await page.getByLabel('策略名称').fill('隔离验证');
  await button(page, '保存策略版本').click();
  await button(page, '打开策略 隔离验证 v1').waitFor();

  await goto('experiments');
  await page
    .getByLabel('导入回测实验 JSON（最多 256 MiB）')
    .setInputFiles('tests/fixtures/windows-20261125/ma-2-4.json');
  await button(page, '确认保存导入的实验').click();
  await page.getByText('导入的实验已保存，可以刷新后重新打开。').waitFor();
  await goto('risk');
  await page.getByLabel('源回测实验').selectOption({ index: 1 });
  await page.getByLabel('模拟路径数（20–2000）').fill('20');
  await page.getByLabel('每路径步数（1–50000）').fill('10');
  await page.getByRole('checkbox', { name: /我确认源成本/ }).check();
  await button(page, '运行风险分析').click();
  await button(page, '保存风险报告').click();
  await page.getByRole('button', { name: /^打开风险报告 / }).waitFor();

  const clean = await inspect(page);
  for (const [database, ...tables] of libraries)
    for (const table of tables) assert.equal(clean[database][table].length, 1);
  await page.evaluate(snippet);
  const seeded = await page.evaluate(() =>
    globalThis.riverlabAcceptanceFixtures('5E'),
  );
  assert.deepEqual(
    seeded.map((r) => r.note),
    Array(4).fill('已追加'),
  );
  const injected = await inspect(page);
  await page.reload();
  await page.getByText(/风险报告库已隔离 1 条损坏记录/).waitFor();
  await button(page, '打开风险报告 联合验收 · 正文损坏').click();
  await page
    .getByRole('alert')
    .filter({ hasText: /报告损坏|校验失败|版本/ })
    .first()
    .waitFor();
  await button(
    page,
    '打开风险报告 ' + clean['riverlab-crypto-lab-risk'].studies[0].name,
  ).click();
  await page.getByText(/风险报告校验与源重算\/重采样一致/).waitFor();
  const risk = await download(page, '导出风险 JSON');
  assert.deepEqual(risk, clean['riverlab-crypto-lab-risk'].studies[0]);

  await goto('replay');
  await page.getByText(/历史回放库已隔离 1 条损坏记录/).waitFor();
  await button(page, '打开回放 联合验收 · 正文损坏').click();
  await page
    .getByRole('alert')
    .filter({ hasText: /回放记录损坏/ })
    .waitFor();
  await button(
    page,
    '打开回放 ' + clean['riverlab-crypto-lab-replays'].replays[0].name,
  ).click();
  await page.getByText(/回放状态校验与重算一致/).waitFor();
  const replay = await download(page, '导出回放 JSON');
  assert.deepEqual(
    replay.payload,
    clean['riverlab-crypto-lab-replays'].replays[0].payload,
  );
  assert.equal(
    replay.payloadHash,
    clean['riverlab-crypto-lab-replays'].replays[0].payloadHash,
  );

  await goto('strategies');
  await page.getByText(/自定义策略版本库已隔离 1 条损坏记录/).waitFor();
  await button(page, '打开策略 隔离验证 v1').click();
  const rule = await download(page, '导出策略 JSON');
  assert.deepEqual(rule, clean['riverlab-crypto-lab-rules'].versions[0]);

  await goto('datasets');
  await page.getByText(/数据集库已隔离 1 条损坏记录/).waitFor();
  const choose = page.getByRole('combobox', {
    name: '已保存的数据集',
    exact: true,
  });
  await choose.selectOption(
    seeded.find((r) => r.database === 'riverlab-crypto-lab').badBodyId,
  );
  await button(page, '打开选中数据集').click();
  await page
    .getByRole('alert')
    .filter({ hasText: /数据集损坏或版本不支持/ })
    .waitFor();
  await choose.selectOption(clean['riverlab-crypto-lab'].datasets[0].id);
  await button(page, '打开选中数据集').click();
  await page.getByText('已重新打开并校验数据集。').waitFor();
  const dataset = await download(page, '导出当前数据 JSON');
  const datasetJson = JSON.stringify(clean['riverlab-crypto-lab'].datasets[0]);
  assert.deepEqual(dataset.dataset, JSON.parse(datasetJson));
  assert.equal(
    dataset.payloadSha256,
    createHash('sha256').update(datasetJson).digest('hex'),
  );

  await page.evaluate(snippet);
  const repeat = await page.evaluate(() =>
    globalThis.riverlabAcceptanceFixtures('5E'),
  );
  assert.deepEqual(
    repeat.map((r) => r.note),
    Array(4).fill('专用键已存在，本次跳过'),
  );
  assert.deepEqual(await inspect(page), injected);
  return {
    damagedRowsPerLibrary: 1,
    healthyRowsPerLibrary: 1,
    datasetSha256: dataset.payloadSha256,
    ruleHash: rule.recordHash,
    riskHash: risk.payloadHash,
    replayHash: replay.payloadHash,
    preservedDatabaseSha256: createHash('sha256')
      .update(JSON.stringify(injected))
      .digest('hex'),
  };
}
