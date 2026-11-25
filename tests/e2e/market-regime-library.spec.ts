import { expect, test } from '@playwright/test';
import { exerciseRegimeLibrary } from '../../scripts/market-regime-browser.mjs';

test('来源和报告库逐条隔离损坏摘要，健康报告重算并导出，原库保持完整', async ({
  page,
  baseURL,
}) => {
  await exerciseRegimeLibrary(page, baseURL!);
});

test('单库打开失败和另一库读取事务中止均提示错误，健康来源可用', async ({
  page,
}) => {
  await page.goto('/#/experiments');
  await page
    .getByLabel('导入回测实验 JSON（最多 256 MiB）')
    .setInputFiles('tests/fixtures/windows-20261125/ma-2-4.json');
  await page.getByRole('button', { name: '确认保存导入的实验' }).click();
  await expect(
    page.getByText('导入的实验已保存，可以刷新后重新打开。'),
  ).toBeVisible();
  await page.addInitScript(() => {
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (name, version) {
      if (name === 'riverlab-crypto-lab-shared-pool')
        throw new DOMException('模拟来源库读取受限', 'SecurityError');
      return open.call(this, name, version);
    };
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (stores, mode, options) {
      const tx = transaction.call(this, stores, mode, options);
      if (
        this.name === 'riverlab-crypto-lab-market-regime' &&
        mode === 'readonly'
      ) {
        queueMicrotask(() => tx.abort());
      }
      return tx;
    };
  });
  await page.goto('/#/market-regime');
  await page.reload();
  await page.getByLabel('原实验类型').selectOption('shared');
  await expect(page.getByText(/共享资金池.*读取失败/)).toBeVisible();
  await expect(page.getByText(/市场状态报告库.*读取失败/)).toBeVisible();
  await expect(
    page.getByText('当前类别尚无可选实验。', { exact: false }),
  ).toHaveCount(0);
  await expect(page.getByText('尚无已保存的市场状态报告。')).toHaveCount(0);
  await page.getByLabel('原实验类型').selectOption('single');
  await page.getByLabel('已保存的原实验').selectOption({ index: 1 });
  await page.getByRole('button', { name: '运行市场状态研究' }).click();
  await expect(page.getByTestId('regime-report-hash')).toHaveText(
    /^[a-f0-9]{64}$/,
  );
});
