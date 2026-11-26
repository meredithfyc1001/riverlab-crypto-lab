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

test('桌面下载失败清除旧路径，重试保留同一报告原件并显示新回执', async ({
  desktopOrigin,
  page,
}) => {
  test.setTimeout(180_000);
  // UI contract fixtures. Actual filesystem and Windows sharing errors are tested in download.rs.
  const failures = [
    '文件被占用，请关闭占用程序后重试。 (os error 32)',
    '下载目录权限不足，请检查写入权限后重试。 (os error 5)',
    '无法保存报告，请检查下载目录和磁盘空间后重试。 (os error 112)',
  ];
  await page.addInitScript((errors: string[]) => {
    let attempt = 0;
    let initialHash: string | undefined;
    Object.defineProperty(window, '__TAURI__', {
      value: {
        core: {
          async invoke(
            command: string,
            body: ArrayBuffer,
            options: { headers: Record<string, string> },
          ) {
            if (
              command !== 'save_report_download' ||
              !(body instanceof ArrayBuffer)
            )
              throw new Error('下载命令或报告字节无效');
            const digest = Array.from(
              new Uint8Array(await crypto.subtle.digest('SHA-256', body)),
              (byte) => byte.toString(16).padStart(2, '0'),
            ).join('');
            initialHash ??= digest;
            if (
              digest !== initialHash ||
              options.headers['x-report-sha256'] !== digest
            )
              throw new Error('重试时的报告字节或摘要发生变化');
            const n = attempt++;
            if (n % 2 === 1) {
              // Rust commands reject with their serialized string, not a DOM Error.
              return Promise.reject(errors[(n - 1) / 2]);
            }
            return {
              path: 'C:\\合成验收\\报告-' + n / 2 + '.json',
              sha256: digest,
            };
          },
        },
      },
    });
  }, failures);
  await page.goto(desktopOrigin + '/tests/desktop-6a/index.html');
  const status = page.locator('#status');
  const download = page.locator('#download');
  await page.locator('#run').click();
  await expect(status).toHaveAttribute('data-state', 'passed', {
    timeout: 120_000,
  });
  const digest = JSON.parse(
    await page.locator('#result').innerText(),
  ).downloadSha256;
  await download.click();
  await expect(status).toHaveAttribute(
    'data-saved-path',
    'C:\\合成验收\\报告-0.json',
  );
  for (const [i, failure] of failures.entries()) {
    await download.click();
    await expect(status).toHaveAttribute('data-download-state', 'failed');
    await expect(status).toHaveText('下载失败：' + failure);
    await expect(status).not.toHaveAttribute('data-saved-path', /.*/);
    await expect(download).toBeEnabled();
    await expect(page.locator('#run')).toBeEnabled();

    await download.click();
    const path = 'C:\\合成验收\\报告-' + (i + 1) + '.json';
    await expect(status).toHaveAttribute('data-download-state', 'verified');
    await expect(status).toHaveAttribute('data-saved-path', path);
    await expect(status).toHaveText(
      '已保存并校验：' + path + ' · SHA-256：' + digest,
    );
  }
});
