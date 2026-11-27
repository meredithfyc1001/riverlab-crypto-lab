import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function saveHistory(page: Page, symbol: string, offset: number) {
  await page.goto('/#/datasets');
  const prices = [11, 10, 9, 10, 13, 12, 8, 9, 12, 14, 13, 10];
  const records = prices.map((p, i) =>
    [1735689600000 + (i + offset) * 60000, p, p + 1, p - 1, p, 1].join(','),
  );
  await page.getByLabel('选择本地 CSV').setInputFiles({
    name: 'synthetic-' + symbol + '.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      ['timestamp,open,high,low,close,volume', ...records].join('\n'),
    ),
  });
  await expect(
    page.getByText('读到 12 条数据记录。', { exact: false }),
  ).toBeVisible();
  await page.getByLabel('预期固定周期（秒）').fill('60');
  await page.getByRole('button', { name: '检查并生成导入报告' }).click();
  await page
    .getByLabel('币种 / 交易对（自述，不认证来源）')
    .fill(symbol + '/USDT');
  await page.getByRole('checkbox', { name: /我已阅读 .* 项警告/ }).check();
  await page
    .getByRole('button', { name: '保存已检查数据集', exact: true })
    .click();
  await expect(
    page.getByText('已保存数据集（IndexedDB 事务已完成）。请另行备份。'),
  ).toBeVisible();
  // The previous import has the same receipt while the next CSV Worker prepares its candles.
  await expect(
    page
      .getByRole('combobox', { name: '已保存的数据集' })
      .locator('option')
      .filter({ hasText: symbol + '/USDT' }),
  ).toHaveCount(1);
}
async function download(page: Page, label: string) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: label, exact: true }).click();
  return readFile((await (await pending).path())!, 'utf8');
}
test('从已保存行情与规则运行组合，导出、空库恢复、重开与删除', async ({
  page,
  browser,
}) => {
  await saveHistory(page, 'ALPHA', 0);
  await saveHistory(page, 'BETA', 2);
  await page.goto('/#/strategies');
  await page.getByRole('button', { name: '保存策略版本', exact: true }).click();
  await expect(page.getByTestId('rule-version')).toContainText('浏览器已保存');
  await page.goto('/#/backtests');
  await page.getByRole('link', { name: /组合回测/ }).click();
  const first = page.getByRole('group', { name: '子账户 1', exact: true });
  const second = page.getByRole('group', { name: '子账户 2', exact: true });
  for (const [field, symbol] of [
    [first, 'ALPHA'],
    [second, 'BETA'],
  ] as const) {
    const select = field.getByLabel('历史数据集');
    const opt = select.locator('option').filter({ hasText: symbol });
    await expect(opt).toHaveCount(1);
    await select.selectOption((await opt.getAttribute('value'))!);
  }
  await second.getByLabel('策略类型').selectOption('rules');
  await second.getByLabel('规则版本').selectOption({ index: 1 });
  const run = page.getByRole('button', { name: '运行组合回测', exact: true });
  await expect(run).toBeDisabled();
  await page.getByRole('checkbox', { name: /我确认共同区间/ }).check();
  await run.click();
  const reportText = await download(page, '导出组合 JSON');
  const report = JSON.parse(reportText);
  expect(report.result.curve).toHaveLength(11);
  expect(
    report.result.alignment.assets.map(
      (a: { beforeCount: number; afterCount: number }) => [
        a.beforeCount,
        a.afterCount,
      ],
    ),
  ).toEqual([
    [2, 0],
    [0, 2],
  ]);
  expect(report.input.assets[1].ruleRecord.rule.revision).toBe(1);
  expect(reportText).toContain('ALPHA/USDT');
  expect(reportText).toContain('BETA/USDT');
  expect(reportText).toContain('ruleHash');
  expect(await download(page, '导出汇总 CSV')).toContain('ALPHA/USDT');
  await page.getByRole('button', { name: '保存组合实验', exact: true }).click();
  const fresh = await browser.newContext({
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 390, height: 844 },
  });
  const restored = await fresh.newPage();
  try {
    await restored.goto('/#/portfolio');
    const upload = restored.getByLabel(/导入组合 JSON/);
    await upload.setInputFiles({
      name: 'portfolio.json',
      mimeType: 'application/json',
      buffer: Buffer.from(reportText),
    });
    await restored
      .getByRole('button', { name: '保存组合实验', exact: true })
      .click();
    await expect(
      restored.getByText('组合实验已保存。', { exact: true }),
    ).toBeVisible();
    await restored.reload();
    await restored.getByRole('button', { name: /重新打开/ }).click();
    await restored
      .getByRole('button', { name: '完整复现', exact: true })
      .click();
    expect(JSON.parse(await download(restored, '导出组合 JSON'))).toEqual(
      report,
    );
    expect(
      await restored.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const broken = reportText.replace('ALPHA/USDT', 'XLPHA/USDT');
    await upload.setInputFiles({
      name: 'damaged.json',
      mimeType: 'application/json',
      buffer: Buffer.from(broken),
    });
    await expect(restored.getByRole('alert')).toContainText(/Hash|校验|损坏/i);
    await restored.getByRole('button', { name: /删除组合实验/ }).click();
    await restored.getByRole('button', { name: /确认删除/ }).click();
    await expect(
      restored.getByRole('button', { name: /重新打开/ }),
    ).toHaveCount(0);
  } finally {
    await fresh.close();
  }
});

test('五个子账户校验重复交易对、报价、资金合计及变更区间后的确认', async ({
  page,
}) => {
  test.setTimeout(60000);
  const symbols = ['AX', 'BX', 'CX', 'DX', 'EX'];
  for (const symbol of symbols) await saveHistory(page, symbol, 0);
  await page.goto('/#/portfolio');
  const add = page.getByRole('button', { name: '添加子账户' });
  for (let i = 2; i < 5; i++) await add.click();
  await expect(add).toBeDisabled();
  const choose = async (index: number, symbol: string) => {
    const account = page.getByRole('group', {
      name: '子账户 ' + (index + 1),
      exact: true,
    });
    const select = account.getByRole('combobox', {
      name: '历史数据集',
      exact: true,
    });
    await select.selectOption(
      (await select
        .locator('option')
        .filter({ hasText: symbol + '/USDT' })
        .getAttribute('value'))!,
    );
    await account.getByLabel('初始分配比例 %').fill('20');
  };
  for (let i = 0; i < 5; i++) await choose(i, symbols[i]);
  const run = page.getByRole('button', { name: '运行组合回测', exact: true });
  const confirm = page.getByRole('checkbox', { name: /我确认共同区间/ });
  await choose(4, 'AX');
  await expect(page.getByRole('alert')).toContainText('重复');
  await expect(run).toBeDisabled();
  await choose(4, 'EX');
  await page.getByLabel('统一报价货币').fill('USD');
  await expect(page.getByRole('alert')).toContainText('报价');
  await page.getByLabel('统一报价货币').fill('USDT');
  await confirm.check();
  await page
    .getByLabel('末根开盘时间（UTC 毫秒）')
    .fill(String(1735689600000 + 10 * 60000));
  await expect(confirm).not.toBeChecked();
  const weight = page
    .getByRole('group', { name: '子账户 1', exact: true })
    .getByLabel('初始分配比例 %');
  await weight.fill('19.999999999999999999');
  await confirm.check();
  await expect(run).toBeDisabled();
  await weight.fill('20');
  await confirm.check();
  await run.click();
  const record = JSON.parse(await download(page, '导出组合 JSON'));
  expect(record.result.curve).toHaveLength(12);
  expect(record.result.assets).toHaveLength(5);
  expect(record.result.correlations).toHaveLength(5);
  await expect(
    page
      .getByRole('img', { name: '组合、基准及各子账户净值曲线' })
      .locator('canvas')
      .first(),
  ).toBeVisible();
});
