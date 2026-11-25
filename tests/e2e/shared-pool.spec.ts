import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  exerciseSharedModes,
  selectSharedAssets,
} from '../../scripts/shared-pool-browser.mjs';

async function saveMarket(page: Page, symbol: string, phase: number) {
  await page.goto('/#/datasets');
  const prices = [22, 20, 19, 21, 24, 25, 23, 20];
  const rows = Array.from({ length: 24 }, (_, i) => {
    const p = prices[(i + phase) % prices.length];
    return [1735689600000 + i * 60000, p, p + 1, p - 1, p, 1].join(',');
  });
  await page.getByLabel('选择本地 CSV').setInputFiles({
    name: 'synthetic-' + symbol + '.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      ['timestamp,open,high,low,close,volume', ...rows].join('\n'),
    ),
  });
  await expect(
    page.getByText('读到 24 条数据记录。', { exact: false }),
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
  // Both saves have the same status text. Wait for this dataset's committed
  // summary before leaving the page that owns the preparation Worker.
  await expect(
    page
      .getByLabel('已保存的数据集', { exact: true })
      .locator('option')
      .filter({ hasText: symbol + '/USDT' }),
  ).toHaveCount(1);
}

test('共享和调仓模式导出、刷新重开、空配置恢复、版本拒绝及原件保留', async ({
  page,
  browser,
  baseURL,
}) => {
  await saveMarket(page, 'ALPHA', 0);
  await saveMarket(page, 'BETA', 3);
  const contexts: BrowserContext[] = [];
  const freshPage = async () => {
    const context = await browser.newContext({
      baseURL,
      viewport: { width: 390, height: 844 },
    });
    contexts.push(context);
    return context.newPage();
  };
  try {
    const hashes = await exerciseSharedModes(page, freshPage, [
      'ALPHA/USDT',
      'BETA/USDT',
    ]);
    expect(hashes['shared-strategy']).not.toBe(hashes.rebalance);
    for (const ctx of contexts) {
      expect(
        await ctx
          .pages()[0]
          .evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      ).toBe(true);
    }
  } finally {
    for (const ctx of contexts) await ctx.close();
  }
});

test('共享资金上限与现金目标须精确有效，切换调仓移除策略和保护设置', async ({
  page,
}) => {
  await saveMarket(page, 'ALPHA', 0);
  await saveMarket(page, 'BETA', 3);
  await page.goto('/#/portfolio');
  await selectSharedAssets(page, 'shared-strategy', [
    'ALPHA/USDT',
    'BETA/USDT',
  ]);
  const run = page.getByRole('button', { name: '运行组合回测', exact: true });
  await page
    .getByLabel('目标预算比例 %', { exact: true })
    .first()
    .fill('60.000000000000000001');
  await page.getByRole('checkbox', { name: /我确认共同区间/ }).check();
  await expect(run).toBeDisabled();
  await selectSharedAssets(page, 'rebalance', ['ALPHA/USDT', 'BETA/USDT']);
  await page
    .getByLabel('目标现金权重 %', { exact: true })
    .fill('19.999999999999999999');
  await page.getByRole('checkbox', { name: /我确认共同区间/ }).check();
  await expect(run).toBeDisabled();
  await expect(page.getByLabel('止损 bps（留空关闭）')).toHaveCount(0);
});
