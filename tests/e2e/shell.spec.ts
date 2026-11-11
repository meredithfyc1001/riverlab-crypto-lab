import { test, expect } from '@playwright/test';

test('生产包仅使用本机资源，可导航、刷新、后退并切换主题', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  const externalRequests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:4173') await route.continue();
    else {
      externalRequests.push(url.origin);
      await route.abort();
    }
  });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { level: 1, name: '工作台' }),
  ).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('table')).toContainText('2026-01-01 00:00');
  await page.screenshot({
    path: testInfo.outputPath('workspace-dark.png'),
    fullPage: true,
  });

  const nav = page.getByRole('navigation', { name: '主要导航' });
  for (const label of [
    '数据中心',
    '行情中心',
    '策略中心',
    '回测中心',
    '风险中心',
    '实验中心',
    '历史回放',
  ]) {
    await nav.getByRole('link', { name: label }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: label }),
    ).toBeVisible();
    if (label === '数据中心')
      await expect(
        page.getByRole('heading', { name: '导入历史 K 线 CSV' }),
      ).toBeVisible();
    else if (label === '行情中心')
      await expect(
        page.getByRole('heading', { name: '尚无可显示的数据' }),
      ).toBeVisible();
    else if (label === '策略中心')
      await expect(
        page.getByRole('heading', { name: '策略研究配置' }),
      ).toBeVisible();
    else if (label === '回测中心')
      await expect(
        page.getByRole('heading', { name: '回测配置' }),
      ).toBeVisible();
    else if (label === '风险中心')
      await expect(
        page.getByRole('heading', { name: 'Monte Carlo 风险分析' }),
      ).toBeVisible();
    else if (label === '历史回放')
      await expect(
        page.getByRole('heading', { name: '历史逐根回放与模拟账户' }),
      ).toBeVisible();
    else if (label === '实验中心')
      await expect(
        page.getByRole('heading', { name: '已保存回测实验' }),
      ).toBeVisible();
    else await expect(page.getByText(`${label}框架已就绪`)).toBeVisible();
    await expect(page.getByLabel('研究风险提示')).toContainText(
      '不提供投资建议',
    );
  }
  await page.reload();
  await expect(
    page.getByRole('heading', { level: 1, name: '历史回放' }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole('heading', { level: 1, name: '实验中心' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '切换为浅色主题' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: '切换为深色主题' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(externalRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('390px 窄屏可导航且页面没有横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { level: 1, name: '工作台' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole('navigation')
    .getByRole('link', { name: '风险中心' })
    .click();
  await expect(
    page.getByRole('heading', { level: 1, name: '风险中心' }),
  ).toBeVisible();
  await expect(page.getByLabel('研究风险提示')).toBeVisible();
});
