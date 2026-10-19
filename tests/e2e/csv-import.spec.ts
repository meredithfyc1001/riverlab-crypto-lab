import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

const sample = (file: string) => resolve('src/features/datasets/samples', file);
const synthetic =
  'timestamp,open,high,low,close,volume\n0,100,104,99,102,20\n60000,102,104,99,101,20';
test.beforeEach(async ({ page }) => {
  await page.goto('/#/datasets');
  await expect(
    page.getByRole('heading', { name: '导入历史 K 线 CSV' }),
  ).toBeVisible();
});

test('真实历史样本通过实际 Worker 解析并核对文件身份，断外部资源仍可运行', async ({
  page,
}, testInfo) => {
  const external: string[] = [],
    errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin === 'http://127.0.0.1:4173')
      await route.continue();
    else {
      external.push(route.request().url());
      await route.abort();
    }
  });
  await page
    .getByRole('button', { name: '真实历史样本 · BTCUSDT · 1 小时' })
    .click();
  await expect(
    page.getByText('读到 24 条数据记录。', { exact: false }),
  ).toBeVisible();
  await expect(page.locator('.file-hash')).toHaveText(
    '0cf21b6f475479a8b8918ed983e924cfce2057dde6ccd864aaa0d97fd14f9727',
  );
  await expect(
    page.getByRole('link', { name: /查看固定提交/ }),
  ).toHaveAttribute('href', /3ce38b587d6c7a1ea479fb3e59d724dee5195561/);
  await page.getByLabel('预期固定周期（秒）').fill('3600');
  await page.getByRole('button', { name: '检查并生成导入报告' }).click();
  await expect(page.getByText('检查完成（仅文件内）')).toBeVisible();
  await expect(page.getByText('ms → UTC 毫秒')).toBeVisible();
  await expect(
    page
      .locator('.quality-stats > div')
      .filter({ hasText: '有效候选行' })
      .locator('strong'),
  ).toHaveText('24');
  await expect(
    page.getByText(
      /2024-10-28 00:00:00.000 UTC 至 2024-10-28 23:00:00.000 UTC/,
    ),
  ).toBeVisible();
  await expect(page.getByText('COVERAGE_UNVERIFIED')).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('historical-report.png'),
    fullPage: true,
    animations: 'disabled',
  });
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test('本地微秒 CSV 需要周期确认，歧义时间单位不能猜测', async ({ page }) => {
  await page
    .getByLabel('选择本地 CSV')
    .setInputFiles(sample('synthetic-us.csv'));
  await expect(
    page.getByText('读到 4 条数据记录。', { exact: false }),
  ).toBeVisible();
  await expect(page.locator('.source-kind')).toHaveText(
    '用户文件 · 来源未核实',
  );
  await page.getByRole('button', { name: '检查并生成导入报告' }).click();
  await expect(page.getByText('需要确认：预期周期')).toBeVisible();
  await expect(page.getByText('us → UTC 毫秒')).toBeVisible();
  await page.getByRole('button', { name: /采用建议周期 60 秒/ }).click();
  await expect(page.getByRole('heading', { name: '数据质量报告' })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: '检查并生成导入报告' }).click();
  await expect(page.getByText('检查完成（仅文件内）')).toBeVisible();
  await expect(page.getByText(/2025-01-01 00:00:00.000 UTC 至/)).toBeVisible();

  await page.getByLabel('选择本地 CSV').setInputFiles({
    name: 'ambiguous.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(synthetic),
  });
  await expect(
    page.getByText('读到 2 条数据记录。', { exact: false }),
  ).toBeVisible();
  await page.getByLabel('预期固定周期（秒）').fill('60');
  await page.getByRole('button', { name: '检查并生成导入报告' }).click();
  await expect(page.getByText('需要确认：时间单位')).toBeVisible();
  await page
    .getByRole('combobox', { name: '时间单位', exact: true })
    .selectOption('ms');
  await page.getByRole('button', { name: '检查并生成导入报告' }).click();
  await expect(page.getByText('检查完成（仅文件内）')).toBeVisible();
  await expect(page.getByText(/1970-01-01 00:00:00.000 UTC 至/)).toBeVisible();
});

test('自定义字段顺序和带时区日期正确规范化到 UTC', async ({ page }) => {
  const file =
    'c,v,t,l,o,h\n102,20,2025-01-01T08:00:00+08:00,99,100,104\n101,21,2025-01-01T08:01:00+08:00,99,102,104';
  await page.getByLabel('选择本地 CSV').setInputFiles({
    name: 'mapped.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(file),
  });
  await expect(
    page.getByText('读到 2 条数据记录。', { exact: false }),
  ).toBeVisible();
  for (const [field, index] of [
    ['时间戳列', '2'],
    ['开盘价列', '4'],
    ['最高价列', '5'],
    ['最低价列', '3'],
    ['收盘价列', '0'],
    ['成交量列', '1'],
  ])
    await page.getByLabel(field).selectOption(index);
  await page
    .getByRole('combobox', { name: '时间单位', exact: true })
    .selectOption('iso');
  await page.getByLabel('预期固定周期（秒）').fill('60');
  await page.getByRole('button', { name: '检查并生成导入报告' }).click();
  await expect(page.getByText('检查完成（仅文件内）')).toBeVisible();
  await expect(
    page.getByText(
      /2025-01-01 00:00:00.000 UTC 至 2025-01-01 00:01:00.000 UTC/,
    ),
  ).toBeVisible();
  await page.getByLabel('开盘价列').selectOption('0');
  await expect(page.getByRole('heading', { name: '数据质量报告' })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: '检查并生成导入报告' }).click();
  await expect(page.getByText('存在阻断错误')).toBeVisible();
  await expect(page.getByText('MAPPING')).toBeVisible();
});

test('错误样本保留错误行、重复和缺口，390px 报告无页面溢出', async ({
  page,
}, testInfo) => {
  await page.getByRole('button', { name: '错误测试样本 · 人工构造' }).click();
  await expect(
    page.getByText('读到 9 条数据记录。', { exact: false }),
  ).toBeVisible();
  await page.getByLabel('预期固定周期（秒）').fill('60');
  await page.getByRole('button', { name: '检查并生成导入报告' }).click();
  await expect(page.getByText('存在阻断错误')).toBeVisible();
  for (const code of [
    'INVALID_PRICE',
    'INVALID_VOLUME',
    'INVALID_OHLC',
    'INVALID_TIMESTAMP',
    'COLUMN_COUNT',
    'MISSING_CANDLES',
  ])
    await expect(page.getByText(code, { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText('DUPLICATE_TIMESTAMP', { exact: true }),
  ).toHaveCount(2);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('quality-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  });
  const quotedRow = '1735689600000,"bad""quote",104,99,102,20';
  await page.getByLabel('选择本地 CSV').setInputFiles({
    name: 'quoted-error.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('timestamp,open,high,low,close,volume\n' + quotedRow),
  });
  await expect(
    page.getByText('读到 1 条数据记录。', { exact: false }),
  ).toBeVisible();
  await page.getByLabel('预期固定周期（秒）').fill('60');
  await page.getByRole('button', { name: '检查并生成导入报告' }).click();
  await expect(
    page
      .locator('.issue-table tr')
      .filter({ hasText: 'INVALID_PRICE' })
      .locator('td')
      .last(),
  ).toHaveText(quotedRow);
});

test('空文件、非法 UTF-8 与超限文件清楚阻断并清除旧结果', async ({ page }) => {
  await page.getByLabel('选择本地 CSV').setInputFiles({
    name: 'empty.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(''),
  });
  await expect(
    page.getByText('没有数据记录：文件为空、只有空白或只有表头。'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '检查并生成导入报告' }),
  ).toBeDisabled();
  await page.getByLabel('选择本地 CSV').setInputFiles({
    name: 'invalid-encoding.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from([0xff, 0xfe, 0xff]),
  });
  await expect(page.getByRole('alert')).toContainText('有效 UTF-8');
  await page.getByLabel('选择本地 CSV').setInputFiles({
    name: 'oversized.csv',
    mimeType: 'text/csv',
    buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 32),
  });
  await expect(page.getByRole('alert')).toContainText('超过 10 MiB');
  await expect(page.getByRole('heading', { name: '数据质量报告' })).toHaveCount(
    0,
  );
});
