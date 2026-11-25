import { expect, test } from '@playwright/test';

test('空库在窄屏深浅主题可用键盘到达八页并找到下一步', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: '主要导航' });
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') {
      const switchTheme = page.getByRole('button', { name: '切换为浅色主题' });
      await switchTheme.focus();
      await page.keyboard.press('Enter');
    }
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    for (const [label, content] of [
      ['工作台', '研究路径'],
      ['行情中心', '尚无可显示的数据'],
      ['策略中心', '策略研究配置'],
      ['回测中心', '回测配置'],
      ['风险中心', 'Monte Carlo 风险分析'],
      ['实验中心', '已保存回测实验'],
      ['历史回放', '历史逐根回放与模拟账户'],
      ['数据中心', '尚无已保存的数据集'],
    ]) {
      const link = nav.getByRole('link', { name: label, exact: true });
      await link.focus();
      await page.keyboard.press('Enter');
      await expect(link).toHaveAttribute('aria-current', 'page');
      await expect(
        page.getByRole('heading', { name: content, exact: true }),
      ).toBeVisible();
      if (['策略中心', '回测中心', '风险中心', '历史回放'].includes(label))
        await expect(
          page.getByRole('link', { name: '前往数据中心选择样本' }),
        ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  }
});

test('从内置样本检查、确认、保存到回测，重开后仍保留原有长中文数据名', async ({
  context,
  page,
}) => {
  const symbol = '人工合成教学对照数据'.repeat(8);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/backtests');
  await page.getByRole('link', { name: '前往数据中心选择样本' }).click();
  await page.getByRole('button', { name: '人工合成样本 · 毫秒' }).click();
  await expect(
    page.getByText('读到 4 条数据记录。', { exact: false }),
  ).toBeVisible();
  const datasetList = page.getByRole('combobox', {
    name: '已保存的数据集',
    exact: true,
  });
  await expect(datasetList.locator('option')).toHaveCount(1);
  await page.getByLabel('预期固定周期（秒）').fill('60');
  await page.getByRole('button', { name: '检查并生成导入报告' }).click();
  await page.getByLabel('币种 / 交易对（自述，不认证来源）').fill(symbol);
  const save = page.getByRole('button', { name: '保存已检查数据集' });
  await expect(save).toBeDisabled();
  await page.getByRole('checkbox', { name: /我已阅读 .* 项警告/ }).check();
  await save.click();
  await page
    .getByRole('link', { name: '前往回测中心选择已保存数据集' })
    .click();
  const choose = page.getByLabel('回测数据集', { exact: true });
  await choose.selectOption({ index: 1 });
  await expect(
    page.getByText('已读取并校验保存的数据集，请确认收盘状态。'),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto('/#/datasets');
  const saved = reopened.getByRole('combobox', {
    name: '已保存的数据集',
    exact: true,
  });
  await expect(saved.locator('option')).toHaveCount(2);
  await expect(saved.locator('option').nth(1)).toContainText(symbol);
  await reopened
    .getByRole('button', { name: '真实历史样本 · BTCUSDT · 1 小时' })
    .click();
  await expect(
    reopened.getByText('读到 24 条数据记录。', { exact: false }),
  ).toBeVisible();
  await expect(saved.locator('option')).toHaveCount(2);
  await expect(saved.locator('option').nth(1)).toContainText(symbol);
});

test('首次进入功能页时显示载入状态，分包读取失败后可从同一路径重开', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '研究路径' })).toBeVisible();
  let finishRequest!: () => void;
  const pending = new Promise<void>((resolve) => {
    finishRequest = resolve;
  });
  await page.route('**/assets/*.js', async (route) => {
    await pending;
    await route.fulfill({ status: 404, body: 'missing local asset' });
  });
  await page
    .getByRole('navigation')
    .getByRole('link', { name: '数据中心' })
    .click();
  try {
    await expect(
      page.getByRole('status').filter({ hasText: '正在载入数据中心' }),
    ).toBeVisible();
  } finally {
    finishRequest();
  }
  await expect(page.getByRole('alert')).toContainText('页面载入失败');
  await page.unroute('**/assets/*.js');
  await page.getByRole('button', { name: '重新载入页面' }).click();
  await expect(
    page.getByRole('heading', { name: '导入历史 K 线 CSV' }),
  ).toBeVisible();
  await expect(page.getByLabel('已保存的数据集').locator('option')).toHaveCount(
    1,
  );
});
