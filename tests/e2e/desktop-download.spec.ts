import { expect } from '@playwright/test';
import { test } from './desktop-fixture';

test('报告保存时显示进度，权限错误可重试，回执通过校验后显示落盘路径及摘要', async ({
  desktopOrigin,
  page,
}) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    const firstFailure = new Promise<void>((resolve) => {
      window.addEventListener('finish-save', () => resolve(), { once: true });
    });
    let attempts = 0;
    Object.defineProperty(window, '__TAURI__', {
      value: {
        core: {
          async invoke(
            command: string,
            bytes: ArrayBuffer,
            options: { headers: Record<string, string> },
          ) {
            if (
              command !== 'save_report_download' ||
              !(bytes instanceof ArrayBuffer)
            )
              throw new Error('报告命令或二进制载荷不符');
            if (++attempts === 1) {
              await firstFailure;
              throw new Error('下载目录权限不足，请检查写入权限后重试。');
            }
            const hash = Array.from(
              new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
              (byte) => byte.toString(16).padStart(2, '0'),
            ).join('');
            if (options.headers['x-report-sha256'] !== hash)
              throw new Error('传输的原件与摘要不符');
            return {
              path: 'C:\\验收 下载\\riverlab-6a-synthetic-50000 (1).json',
              sha256: hash,
            };
          },
        },
      },
    });
  });
  await page.goto(desktopOrigin + '/tests/desktop-6a/index.html');
  await page.locator('#run').click();
  await expect(page.locator('#status')).toHaveAttribute(
    'data-state',
    'passed',
    { timeout: 120_000 },
  );
  const expectedHash = JSON.parse(
    await page.locator('#result').innerText(),
  ).downloadSha256;
  const download = page.locator('#download');
  const status = page.getByRole('status').first();
  await download.click();
  await expect(download).toBeDisabled();
  await expect(status).toContainText('正在保存');
  await page.evaluate(() => window.dispatchEvent(new Event('finish-save')));
  await expect(status).toContainText('权限不足');
  await expect(download).toBeEnabled();
  await download.click();
  await expect(status).toContainText(
    '已保存并校验：C:\\验收 下载\\riverlab-6a-synthetic-50000 (1).json',
  );
  await expect(status).toContainText(expectedHash);
});
