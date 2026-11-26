import { expect, test } from '@playwright/test';
import {
  prepareAdvancedResearch,
  runAdvancedResearch,
  exerciseAdvancedResearch,
} from '../../scripts/advanced-research-browser.mjs';

test('突破参数滚动选优与独立参考一致，候选另存、重开及空配置恢复', async ({
  page,
  baseURL,
}) => {
  const result = await exerciseAdvancedResearch(page, baseURL!);
  expect(result.selectedLookbacks).toEqual([1, 2]);
  expect(result.testReturns).toEqual(['-0.042', '0.096']);
});

test('实际随机搜索在不同并发下结果一致，取消后可重新开始', async ({
  page,
  baseURL,
}) => {
  await prepareAdvancedResearch(page, baseURL!);
  await page.getByLabel('搜索方式').selectOption('random');
  await page.getByLabel('随机种子').fill('73');
  await page.getByLabel('抽样候选数').fill('2');
  await page.getByLabel('并发上限（1–4）').fill('1');
  const serial = await runAdvancedResearch(page);
  await page.getByLabel('并发上限（1–4）').fill('4');
  await page.getByRole('button', { name: '预估候选与计算量' }).click();
  const start = page.getByRole('button', { name: '开始高级研究' });
  await expect(start).toBeEnabled();
  // Cancel at the first DOM commit following dispatch, before a fast small
  // workload can finish during Playwright's actionability polling.
  await start.evaluate(
    (node) =>
      new Promise<void>((resolve, reject) => {
        const observer = new MutationObserver(() => {
          const cancel = Array.from(document.querySelectorAll('button')).find(
            (b) => b.textContent === '取消高级研究任务',
          );
          if (cancel) {
            observer.disconnect();
            clearTimeout(timer);
            cancel.click();
            resolve();
          }
        });
        const timer = setTimeout(() => {
          observer.disconnect();
          reject(new Error('取消控件未显示'));
        }, 3000);
        observer.observe(document.body, { childList: true, subtree: true });
        (node as HTMLButtonElement).click();
      }),
  );
  await expect(page.getByText('任务已取消。', { exact: true })).toBeVisible();
  await expect(page.getByTestId('advanced-report-hash')).toHaveCount(0);
  const parallel = await runAdvancedResearch(page);
  expect(parallel.result).toEqual(serial.result);
  expect(parallel.input).toEqual(serial.input);
  await expect(page.getByTestId('advanced-report-hash')).toHaveText(
    parallel.reportHash,
  );
  await expect(
    page.getByRole('button', { name: '重开 规则参数研究' }),
  ).toHaveCount(0);
});

test('参数超限在运行前阻断，训练筛除仍保存结果并跳过测试', async ({
  page,
  baseURL,
}) => {
  await prepareAdvancedResearch(page, baseURL!);
  const preview = page.getByRole('button', { name: '预估候选与计算量' });
  await page.getByLabel('最大值', { exact: true }).fill('50000');
  await preview.click();
  await expect(
    page.getByRole('alert').filter({ hasText: '预算' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '开始高级研究' })).toHaveCount(
    0,
  );
  await page.getByLabel('最大值', { exact: true }).fill('3');
  await page.getByLabel('最少完成交易次数', { exact: true }).fill('10');
  const result = await runAdvancedResearch(page);
  for (const fold of result.result.folds) {
    expect(fold.test).toBeNull();
    expect(fold.selectedId).toBeNull();
    expect(fold.train).toHaveLength(3);
    for (const row of fold.train) {
      expect(row.metrics).not.toBeNull();
      expect(row.reasons.join('')).toContain('10');
    }
  }
});
