import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const button = (page, name) => page.getByRole('button', { name, exact: true });
const status = (page, text) => page.getByText(text, { exact: true }).waitFor();
async function download(page, ext) {
  const pending = page.waitForEvent('download');
  await button(page, '导出高级研究 ' + ext).click();
  const file = await pending;
  assert.equal(await file.failure(), null);
  return file.path();
}

export async function prepareAdvancedResearch(
  page,
  baseUrl,
  fixturesDir = 'tests/fixtures',
) {
  await page.goto(new URL('/#/datasets', baseUrl).href);
  await page
    .getByLabel('选择本地 CSV')
    .setInputFiles(join(fixturesDir, 'phase-5e-rolling-synthetic.csv'));
  await page.getByText('读到 48 条数据记录。', { exact: false }).waitFor();
  await page.getByLabel('预期固定周期（秒）').fill('60');
  await button(page, '检查并生成导入报告').click();
  await status(page, '检查完成（仅文件内）');
  await page
    .getByLabel('币种 / 交易对（自述，不认证来源）')
    .fill('SYNTHETIC/5E');
  await page.getByRole('checkbox', { name: /我已阅读 .* 项警告/ }).check();
  await button(page, '保存已检查数据集').click();
  await page
    .getByRole('combobox', { name: '已保存的数据集' })
    .locator('option')
    .filter({ hasText: 'SYNTHETIC/5E' })
    .waitFor({ state: 'attached' });
  await page.goto(new URL('/#/strategies', baseUrl).href);
  await page
    .getByLabel('导入策略 JSON（128KiB以内）')
    .setInputFiles(join(fixturesDir, 'phase-5e-breakout-rule.json'));
  await status(page, 'JSON已校验，仅在内存待保存。');
  await button(page, '保存策略版本').click();
  await page
    .getByRole('button', { name: '打开策略 5E 合成突破验收 v1', exact: true })
    .waitFor();
  await page.getByRole('link', { name: '高级策略研究 →' }).click();
  // The previous strategy page also has a dataset picker while this route loads.
  const setup = page.locator('section').filter({
    has: page.getByRole('heading', { name: '配置参数搜索', exact: true }),
  });
  const data = setup.getByLabel('研究数据集'),
    option = data.locator('option').filter({ hasText: 'SYNTHETIC/5E' });
  await option.waitFor({ state: 'attached' });
  await data.selectOption(await option.getAttribute('value'));
  await setup.getByLabel('研究规则版本').selectOption('phase-5e-breakout@1');
  await setup.getByRole('checkbox', { name: /我确认所选数据集/ }).check();
  await page.getByLabel('最大值', { exact: true }).fill('3');
  await page.getByLabel('优化模式').selectOption('rolling');
  await page.getByLabel('训练长度（根）').fill('24');
  await page.getByLabel('测试长度（根）').fill('12');
  await page
    .getByText('本金、成交成本、保护与市场状态', { exact: true })
    .click();
  for (const label of [
    '手续费（基点）',
    '买入滑点（基点）',
    '卖出滑点（基点）',
    '数量小数位',
  ])
    await page.getByLabel(label, { exact: true }).fill('0');
  await page.getByLabel('状态观察周期（根）').fill('2');
}

export async function runAdvancedResearch(page) {
  await button(page, '预估候选与计算量').click();
  await status(page, '预算已校验，可以开始研究。');
  await button(page, '开始高级研究').click();
  await status(page, '高级研究已完成。');
  return JSON.parse(await readFile(await download(page, 'JSON'), 'utf8'));
}

// Also executed against the production files extracted from the Windows ZIP.
export async function exerciseAdvancedResearch(
  page,
  baseUrl,
  fixturesDir = 'tests/fixtures',
) {
  await prepareAdvancedResearch(page, baseUrl, fixturesDir);
  const expected = JSON.parse(
    await readFile(
      join(fixturesDir, 'advanced-research-reference.json'),
      'utf8',
    ),
  );
  const report = await runAdvancedResearch(page);
  const hash = report.reportHash;
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(
    await page.getByTestId('advanced-report-hash').textContent(),
    hash,
  );
  const { folds, plan } = report.result;
  assert.equal(folds.length, 2);
  assert.equal(plan.candidates.length, 3);
  const lookback = (id) => plan.candidates.find((c) => c.id === id).values[0];
  const selectedLookbacks = [],
    testReturns = [];
  for (const [i, f] of folds.entries()) {
    const ref = expected.rolling[i];
    selectedLookbacks.push(lookback(f.selectedId));
    testReturns.push(f.test.metrics.totalReturn);
    assert.equal(lookback(f.selectedId), ref.selectedLookback);
    assert.deepEqual(
      f.train.map((row) => ({
        lookback: lookback(row.candidateId),
        metrics: row.metrics,
      })),
      ref.train,
    );
    assert.deepEqual(f.test.metrics, ref.test);
    assert.deepEqual(
      f.test.regimes.map(({ state, bars, netPnl }) => ({
        state,
        bars,
        netPnl,
      })),
      ref.regimes,
    );
  }
  await page.getByLabel('查看训练 / 测试窗口').selectOption('1');
  await page
    .getByLabel('查看训练候选')
    .selectOption(String(folds[1].selectedId));
  await page
    .getByRole('table', {
      name: /测试窗口 .* 市场状态归因|测试窗口 · 候选 .*的市场状态归因/,
    })
    .waitFor();
  await button(page, '将选中候选保存为新规则版本').click();
  await page.getByText(/已保存候选 .* 为「5E 合成突破验收」v2/).waitFor();
  const versions = page.getByLabel('研究规则版本');
  assert.equal(
    await versions.locator('option[value="phase-5e-breakout@1"]').count(),
    1,
  );
  assert.equal(
    await versions.locator('option[value="phase-5e-breakout@2"]').count(),
    1,
  );
  const csv = await readFile(await download(page, 'CSV'), 'utf8');
  assert.ok(csv.includes(hash));
  await button(page, '保存高级研究报告').click();
  await status(page, '高级研究报告已保存。');
  await page.reload();
  await button(page, '重开 规则参数研究').click();
  await status(page, '已重开高级研究报告，完整重算一致。');
  const path = await download(page, 'JSON');
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), report);
  const browser = page.context().browser();
  const fresh = await browser.newContext();
  const external = [];
  try {
    const origin = new URL(baseUrl).origin;
    await fresh.route('**/*', (route) => {
      if (new URL(route.request().url()).origin === origin)
        return route.continue();
      external.push(route.request().url());
      return route.abort();
    });
    const clean = await fresh.newPage();
    await clean.goto(new URL('/#/advanced-research', baseUrl).href);
    await status(clean, '尚无已保存的高级研究报告。');
    assert.equal(
      await clean.getByLabel('研究规则版本').locator('option').count(),
      1,
    );
    assert.equal(
      await clean.getByLabel('研究数据集').locator('option').count(),
      1,
    );
    await clean.getByLabel('恢复高级研究 JSON').setInputFiles(path);
    await status(clean, '报告已恢复，完整重算一致。可保存到本机。');
    await button(clean, '保存高级研究报告').click();
    await status(clean, '高级研究报告已保存。');
    await clean.reload();
    await button(clean, '重开 规则参数研究').click();
    await status(clean, '已重开高级研究报告，完整重算一致。');
    assert.deepEqual(
      await readFile(await download(clean, 'JSON')),
      await readFile(path),
    );
    assert.deepEqual(external, []);
  } finally {
    await fresh.close();
  }
  return { reportHash: hash, selectedLookbacks, testReturns };
}
