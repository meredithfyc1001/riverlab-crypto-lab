import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const fixture = 'tests/fixtures/windows-20261125/rules-v2.json';
const uploadLabel = '导入回测实验 JSON（最多 256 MiB）';
const preview = { name: '实验恢复预览' };
const confirm = { name: '确认保存导入的实验', exact: true };

test('全新浏览器从 Windows V2 JSON 预览、放弃、保存和重开，拒绝冲突与损坏文件', async ({
  page,
  context,
}) => {
  const original = JSON.parse(await readFile(fixture, 'utf8'));
  await page.goto('/#/experiments');
  await page.getByLabel(uploadLabel).setInputFiles(fixture);
  await expect(page.getByRole('region', preview)).toContainText(
    '1020.8545652013870588',
  );
  await expect(page.getByRole('region', preview)).toContainText(
    '3.0081585394557412',
  );
  await expect(page.getByRole('region', preview)).toContainText(
    original.payload.result.manifest.runHash,
  );
  await expect(page.getByText('尚无已保存实验。')).toBeVisible();
  await page.getByRole('button', { name: '放弃恢复预览' }).click();
  await expect(page.getByRole('region', preview)).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('尚无已保存实验。')).toBeVisible();

  // Both tabs validate before either save; the IDB transaction must arbitrate.
  const other = await context.newPage();
  await other.goto('/#/experiments');
  await other.getByLabel(uploadLabel).setInputFiles({
    name: 'another-copy.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({ ...original, name: '并发的同 ID 副本' }),
    ),
  });
  await expect(other.getByRole('region', preview)).toBeVisible();
  await page.getByLabel(uploadLabel).setInputFiles(fixture);
  await page.getByRole('button', confirm).click();
  await expect(
    page.getByText('导入的实验已保存，可以刷新后重新打开。'),
  ).toBeVisible();
  await other.getByRole('button', confirm).click();
  await expect(other.getByRole('alert')).toContainText('拒绝覆盖');
  await other.close();

  await page.getByLabel(uploadLabel).setInputFiles({
    name: 'damaged.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({ ...original, payloadHash: '0'.repeat(64) }),
    ),
  });
  await expect(page.getByRole('alert')).toContainText('校验和');
  await expect(page.getByRole('region', preview)).toHaveCount(0);
  await page.reload();
  const saved = page.getByRole('button', { name: /^打开实验 / });
  await expect(saved).toHaveCount(1);
  await saved.click();
  await expect(
    page.getByText('实验校验与重算一致，已重新打开结果。'),
  ).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出实验 JSON' }).click();
  const path = await (await download).path();
  expect(JSON.parse(await readFile(path!, 'utf8'))).toEqual(original);
});
