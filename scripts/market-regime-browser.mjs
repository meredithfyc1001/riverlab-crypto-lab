import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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
  assert.equal(report.reportHash, hash);
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
