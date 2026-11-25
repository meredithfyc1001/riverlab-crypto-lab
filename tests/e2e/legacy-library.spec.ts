import { expect, test } from '@playwright/test';
import { exerciseLegacyLibrary } from '../../scripts/legacy-library-browser.mjs';

test('四库保存、混合损坏列表、健康记录重开及导出后逐库比对原始数据', async ({
  page,
  baseURL,
}) => {
  await exerciseLegacyLibrary(page, baseURL!);
});

test('区分库级读取失败与空库，其他库仍能正常保存及列出', async ({ page }) => {
  await page.addInitScript(() => {
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (name, version) {
      if (name === 'riverlab-crypto-lab-risk')
        throw new DOMException('risk unavailable', 'SecurityError');
      return open.call(this, name, version);
    };
    const read = IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.getAll = function (...args) {
      const req = read.apply(this, args);
      if (this.transaction.db.name === 'riverlab-crypto-lab-replays')
        req.addEventListener('success', () => this.transaction.abort());
      return req;
    };
  });
  await page.goto('/#/risk');
  await expect(page.getByText(/风险报告库读取失败/)).toBeVisible();
  await expect(page.getByText('尚无保存的风险报告。')).toHaveCount(0);
  await page.goto('/#/replay');
  await expect(page.getByText(/历史回放库读取失败/)).toBeVisible();
  await expect(page.getByText('尚无保存快照。')).toHaveCount(0);
  await page.goto('/#/strategies');
  await page.getByLabel('策略名称').fill('独立库可用');
  await page.getByRole('button', { name: '保存策略版本', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '打开策略 独立库可用 v1' }),
  ).toBeVisible();
});
