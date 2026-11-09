import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { cpus, platform, release } from 'node:os';
async function prepareBacktest(page: Page, rows = 24) {
  await page.goto('/#/datasets');
  if (rows === 24)
    await page
      .getByRole('button', { name: '真实历史样本 · BTCUSDT · 1 小时' })
      .click();
  else {
    const csv =
      'timestamp,open,high,low,close,volume\n' +
      Array.from({ length: rows }, (_, i) => {
        const p = 100 + (i % 12 < 6 ? i % 6 : 6 - (i % 6));
        return `${1735689600000 + i * 60000},${p},${p + 2},${p - 2},${p},1`;
      }).join('\n');
    await page.getByLabel('选择本地 CSV').setInputFiles({
      name: `synthetic-${rows}.csv`,
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    });
  }
  await expect(
    page.getByText(`读到 ${rows} 条数据记录。`, { exact: false }),
  ).toBeVisible();
  await page.getByLabel('预期固定周期（秒）').fill(rows === 24 ? '3600' : '60');
  await page.getByRole('button', { name: '检查并生成导入报告' }).click();
  await expect(page.getByText('检查完成（仅文件内）')).toBeVisible();
  await page
    .getByLabel('币种 / 交易对（自述，不认证来源）')
    .fill(rows === 24 ? 'BTC/USDT' : 'SYNTHETIC/USDT');
  await page.getByRole('checkbox', { name: /我已阅读 .* 项警告/ }).check();
  await page
    .getByRole('button', { name: '保存已检查数据集', exact: true })
    .click();
  await expect(
    page.getByText('已保存数据集（IndexedDB 事务已完成）。请另行备份。'),
  ).toBeVisible();
  await page
    .getByRole('navigation')
    .getByRole('link', { name: '回测中心' })
    .click();
  await page.getByLabel('回测数据集').selectOption({ index: 1 });
  await expect(
    page.getByText('已读取并校验保存的数据集，请确认收盘状态。'),
  ).toBeVisible();
}

async function prepare(page: Page, rows = 24) {
  await prepareBacktest(page, rows);
  await page
    .getByRole('navigation')
    .getByRole('link', { name: '策略中心' })
    .click();
  await page.getByLabel('研究数据集').selectOption({ index: 1 });
  await expect(page.getByLabel('研究数据集')).not.toHaveValue('');
}
async function run(page: Page) {
  await page
    .getByRole('checkbox', {
      name: '我确认研究数据全部已收盘，已阅读质量、成本与过拟合警告',
    })
    .check();
  await page.getByRole('button', { name: '运行策略研究', exact: true }).click();
  await expect(page.getByTestId('research-results')).toBeVisible({
    timeout: 20000,
  });
}
async function report(page: Page) {
  const download = page.waitForEvent('download');
  await page
    .getByRole('button', { name: '导出研究 JSON', exact: true })
    .click();
  const path = (await (await download).path())!;
  return { path, value: JSON.parse(await readFile(path, 'utf8')) };
}
for (const kind of ['ma', 'rsi', 'breakout'])
  test(
    '参数网格 ' + kind + '：离线Worker、热力图、账本、JSON重算与CSV',
    async ({ page }) => {
      const external: string[] = [],
        errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.context().route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (url.origin === 'http://127.0.0.1:4173') return route.continue();
        external.push(url.href);
        return route.abort();
      });
      await prepare(page);
      await page.getByLabel('研究模式').selectOption('grid');
      await page.getByLabel('网格策略').selectOption(kind);
      await run(page);
      await expect(
        page.getByRole('table', { name: '参数敏感度热力图' }),
      ).toBeVisible();
      await expect(
        page.getByRole('table', { name: '收益回撤比较' }),
      ).toContainText('NA');
      const saved = await report(page);
      expect(
        saved.value.input.candidates.every(
          (s: { kind: string }) => s.kind === kind,
        ),
      ).toBe(true);
      expect(saved.value.input.dataset.candles).toHaveLength(24);
      expect(saved.value.disclaimer).toBe(
        '仅供学习研究，历史表现不代表未来表现',
      );
      const csv = page.waitForEvent('download');
      await page.getByRole('button', { name: '导出比较 CSV' }).click();
      expect(await readFile((await (await csv).path())!, 'utf8')).toContain(
        saved.value.payloadHash,
      );
      await page.setViewportSize({ width: 390, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.getByRole('button', { name: '切换为浅色主题' }).click();
      await page.reload();
      await expect(page.getByTestId('research-results')).toHaveCount(0);
      await expect(page.getByLabel('研究数据集')).toHaveValue('');
      await expect(page.getByLabel('研究数据集').locator('option')).toHaveCount(
        2,
      );
      await page
        .getByLabel('重新打开研究 JSON（25MiB以内，校验并重算）')
        .setInputFiles(saved.path);
      await expect(page.getByTestId('research-results')).toBeVisible();
      const restored = await report(page);
      expect(restored.value).toEqual(saved.value);
      expect(external).toEqual([]);
      expect(errors).toEqual([]);
    },
  );
test('三策略在严格先后拆分及滚动窗口比较，参数始终锁定且测试不重叠', async ({
  page,
}) => {
  await prepare(page, 36);
  await page.getByLabel('评估方式').selectOption('split');
  await page.getByLabel('训练根数').fill('18');
  await run(page);
  const split = (await report(page)).value;
  expect(split.rows).toHaveLength(6);
  expect(
    split.rows
      .filter((r: { window: { role: string } }) => r.window.role === 'train')
      .every((r: { window: { end: number } }) => r.window.end === 18),
  ).toBe(true);
  await page.getByLabel('结果窗口').selectOption('0:test');
  await expect(page.getByRole('table', { name: '收益回撤比较' })).toContainText(
    'breakout',
  );
  await page.getByLabel('评估方式').selectOption('rolling');
  await page.getByLabel('训练根数').fill('12');
  await page.getByLabel('每窗测试根数').fill('6');
  await run(page);
  const rolling = (await report(page)).value;
  expect(rolling.rows).toHaveLength(24);
  expect(rolling.input.candidates).toEqual(split.input.candidates);
  expect(
    rolling.rows
      .filter(
        (r: { window: { role: string }; candidate: number }) =>
          r.window.role === 'test' && r.candidate === 0,
      )
      .map((r: { window: { start: number; end: number } }) => [
        r.window.start,
        r.window.end,
      ]),
  ).toEqual([
    [12, 18],
    [18, 24],
    [24, 30],
    [30, 36],
  ]);
});
test('非法网格整批阻断、损坏报告拒绝，取消不保留部分结果', async ({ page }) => {
  await prepare(page);
  await page.getByLabel('研究模式').selectOption('grid');
  await page.getByLabel('网格第一轴').fill('8');
  await page.getByLabel('网格第二轴').fill('5');
  await page
    .getByRole('checkbox', {
      name: '我确认研究数据全部已收盘，已阅读质量、成本与过拟合警告',
    })
    .check();
  await page.getByRole('button', { name: '运行策略研究', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByTestId('research-results')).toHaveCount(0);
  await page
    .getByLabel('重新打开研究 JSON（25MiB以内，校验并重算）')
    .setInputFiles({
      name: 'broken.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        '{"format":"riverlab-research","version":"unsupported"}',
      ),
    });
  await expect(
    page.getByRole('alert').filter({ hasText: '版本' }),
  ).toBeVisible();
});
test('50,000根三策略批量实际运行：记录硬件浏览器与主线程响应', async ({
  page,
  browser,
}, info) => {
  await prepare(page, 50000);
  await page.evaluate(() => {
    const w = window as unknown as { delays: number[]; timer: number };
    w.delays = [];
    let last = performance.now();
    w.timer = window.setInterval(() => {
      const now = performance.now();
      w.delays.push(now - last);
      last = now;
    }, 20);
  });
  const start = Date.now();
  await run(page);
  const elapsed = Date.now() - start;
  const observations = await page.evaluate(() => {
    const w = window as unknown as { delays: number[]; timer: number };
    clearInterval(w.timer);
    return { maximum: Math.max(...w.delays), samples: w.delays.length };
  });
  const evidence = {
    phase: '3',
    bars: 50000,
    candidates: 3,
    elapsedMs: elapsed,
    ...observations,
    cpu: cpus()[0].model,
    cores: cpus().length,
    platform: platform(),
    release: release(),
    browser: browser.version(),
    node: process.version,
    limits:
      'sequential Worker; independent full windows; 1,000,000 evaluation budget',
  };
  console.log('PHASE3_PERFORMANCE ' + JSON.stringify(evidence));
  await writeFile(
    info.outputPath('phase3-performance.json'),
    JSON.stringify(evidence, null, 2),
  );
  expect(elapsed).toBeLessThan(20000);
  expect(observations.maximum).toBeLessThan(1000);
  expect(observations.samples).toBeGreaterThan(5);
  await expect(
    page.getByRole('table', { name: '收益回撤比较' }).locator('tbody tr'),
  ).toHaveCount(3);
  // Cancellation is meaningful on this large actual workload.
  await page.getByRole('button', { name: '运行策略研究', exact: true }).click();
  await page.getByRole('button', { name: '取消策略研究' }).click();
  await expect(page.getByRole('alert')).toContainText('取消');
  await expect(page.getByTestId('research-results')).toHaveCount(0);
});
