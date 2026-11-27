import type { Page } from '@playwright/test';

export async function blobEntry(page: Page) {
  await page.addInitScript(() =>
    Object.defineProperty(window, 'showSaveFilePicker', {
      value: undefined,
      configurable: true,
    }),
  );
  await page.goto('/export.html');
}

export async function start(page: Page) {
  await page.getByRole('checkbox', { name: /我确认从当前浏览器配置/ }).check();
  await page.getByRole('button', { name: /^(选择文件并)?开始导出$/ }).click();
}

export async function download(page: Page, name: string, path: string) {
  const button = page.getByRole('button', { name, exact: true });
  await button.or(page.getByRole('alert')).first().waitFor({ timeout: 30000 });
  if (await page.getByRole('alert').isVisible()) {
    throw new Error(
      'Export failed: ' + (await page.getByRole('alert').innerText()),
    );
  }
  const [artifact] = await Promise.all([
    page.waitForEvent('download'),
    button.click(),
  ]);
  await artifact.saveAs(path);
  return artifact.suggestedFilename();
}
