import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { cpus, platform, release } from 'node:os';
async function prepare(page: Page, rows = 60, flat = false) {
  await page.goto('/#/datasets');
  const csv =
    'timestamp,open,high,low,close,volume\n' +
    Array.from({ length: rows }, (_, i) => {
      const p = flat ? 100 : 100 + (i % 12 < 6 ? i % 6 : 6 - (i % 6));
      return [1735689600000 + i * 60000, p, p, p, p, 1].join(',');
    }).join('\n');
  await page.getByLabel('选择本地 CSV').setInputFiles({
    name: 'synthetic-risk.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  await expect(
    page.getByText('读到 ' + rows + ' 条数据记录。', { exact: false }),
  ).toBeVisible();
  await page.getByLabel('预期固定周期（秒）').fill('60');
  await page.getByRole('button', { name: '检查并生成导入报告' }).click();
  await page
    .getByLabel('币种 / 交易对（自述，不认证来源）')
    .fill('SYNTHETIC/USDT');
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
  await page.getByLabel('MA 快线周期').fill('2');
  await page.getByLabel('MA 慢线周期').fill('4');
  await page.getByRole('checkbox', { name: /我确认本数据集全部 K 线/ }).check();
  await page.getByRole('button', { name: '运行回测', exact: true }).click();
  await expect(
    page.getByText('回测成功；结果尚未保存，刷新会丢失。'),
  ).toBeVisible();
  await page.getByRole('button', { name: '保存回测实验', exact: true }).click();
  await expect(
    page.getByText('实验已保存（事务已完成）。请另行导出JSON备份。'),
  ).toBeVisible();
  await page
    .getByRole('navigation')
    .getByRole('link', { name: '风险中心' })
    .click();
  await page.getByLabel('源回测实验').selectOption({ index: 1 });
  await expect(
    page.getByText('源实验校验与重算一致；请确认成本和重采样假设。'),
  ).toBeVisible({ timeout: 20000 });
}
async function run(page: Page) {
  await page
    .getByRole('checkbox', {
      name: '我确认源成本、浮动盈亏、抽样假设和分位并非未来保证',
    })
    .check();
  await page.getByRole('button', { name: '运行风险分析', exact: true }).click();
  await expect(page.getByTestId('risk-results')).toBeVisible({
    timeout: 20000,
  });
  await expect(page.getByTestId('risk-plots')).toBeVisible();
}
async function report(page: Page) {
  const d = page.waitForEvent('download');
  await page
    .getByRole('button', { name: '导出风险 JSON', exact: true })
    .click();
  const path = (await (await d).path())!;
  return { path, record: JSON.parse(await readFile(path, 'utf8')) };
}
for (const method of ['iid', 'block'])
  test(
    method + ' 固定种子报告、分位/频率/图形、保存刷新重开/JSON与CSV，阻断外网',
    async ({ page }) => {
      const external: string[] = [],
        errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.context().route('**/*', (route) => {
        if (new URL(route.request().url()).origin === 'http://127.0.0.1:4173')
          return route.continue();
        external.push(route.request().url());
        return route.abort();
      });
      await prepare(page);
      await page.getByLabel('抽样方法').selectOption(method);
      await run(page);
      await expect(
        page.getByRole('table', { name: '风险分位摘要' }),
      ).toContainText('50%');
      await expect(page.getByTestId('risk-results')).toContainText(
        '非未来置信区间',
      );
      const first = await report(page);
      expect(first.record.payload.simulation.settings.method).toBe(method);
      expect(first.record.payload.source.input.dataset.candles).toHaveLength(
        60,
      );
      expect(first.record.payload.preview.fees).not.toBe('0');
      const csv = page.waitForEvent('download');
      await page
        .getByRole('button', { name: '导出风险 CSV', exact: true })
        .click();
      const text = await readFile((await (await csv).path())!, 'utf8');
      expect(text).toContain(first.record.payloadHash);
      expect(text).toContain('仅供学习研究，历史表现不代表未来表现');
      await page
        .getByRole('checkbox', { name: '显示首5条示例路径（不是分位路径）' })
        .check();
      await page.setViewportSize({ width: 390, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.getByRole('button', { name: '切换为浅色主题' }).click();
      await page
        .getByRole('button', { name: '保存风险报告', exact: true })
        .click();
      await expect(
        page.getByText('风险报告已保存（事务已完成）。请导出JSON备份。'),
      ).toBeVisible();
      await page.reload();
      await expect(page.getByTestId('risk-results')).toHaveCount(0);
      await page.getByRole('button', { name: /打开风险报告/ }).click();
      await expect(
        page.getByText('风险报告校验与源重算/重采样一致；已重新打开。'),
      ).toBeVisible();
      expect((await report(page)).record.payload).toEqual(first.record.payload);
      await page
        .getByLabel('恢复风险 JSON（25MiB以内）')
        .setInputFiles(first.path);
      await expect(page.getByTestId('risk-results')).toContainText(
        '当前报告尚未保存',
      );
      expect((await report(page)).record.payload).toEqual(first.record.payload);
      page.once('dialog', (d) => d.accept());
      await page.getByRole('button', { name: /删除风险报告/ }).click();
      await expect(page.getByText('已删除保存的风险报告。')).toBeVisible();
      expect(external).toEqual([]);
      expect(errors).toEqual([]);
    },
  );
test('参数预算、常量源、损坏报告明确拒绝，不生成假0%风险', async ({ page }) => {
  await prepare(page, 24, true);
  await page
    .getByRole('checkbox', {
      name: '我确认源成本、浮动盈亏、抽样假设和分位并非未来保证',
    })
    .check();
  await page.getByRole('button', { name: '运行风险分析', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('恒定');
  await expect(page.getByTestId('risk-results')).toHaveCount(0);
  await page.getByLabel('模拟路径数（20–2000）').fill('2000');
  await page.getByLabel('每路径步数（1–50000）').fill('1001');
  await page.getByRole('button', { name: '运行风险分析', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: '200万' }),
  ).toBeVisible();
  await page.getByLabel('恢复风险 JSON（25MiB以内）').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{}'),
  });
  await expect(
    page.getByRole('alert').filter({ hasText: '风险报告' }),
  ).toBeVisible();
});
test('源实验/数据删除后，完整风险JSON仍可重建源并复现', async ({ page }) => {
  await prepare(page);
  await run(page);
  const saved = await report(page);
  await page.evaluate(async () => {
    for (const item of [
      {
        name: 'riverlab-crypto-lab-experiments',
        stores: ['experiments', 'summaries'],
      },
      { name: 'riverlab-crypto-lab', stores: ['datasets', 'summaries'] },
    ]) {
      await new Promise<void>((resolve, reject) => {
        const r = indexedDB.open(item.name, 1);
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction(item.stores, 'readwrite');
          item.stores.forEach((name) => tx.objectStore(name).clear());
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => reject(tx.error);
        };
        r.onerror = () => reject(r.error);
      });
    }
  });
  await page.reload();
  await page.getByLabel('恢复风险 JSON（25MiB以内）').setInputFiles(saved.path);
  await expect(
    page.getByText('风险报告校验与源重算/重采样一致；已重新打开。'),
  ).toBeVisible();
  expect((await report(page)).record.payload).toEqual(saved.record.payload);
});
test('50,000根源+200万步真实风险Worker、取消与主线程响应', async ({
  page,
  browser,
}, info) => {
  await prepare(page, 50000);
  await page.getByLabel('模拟路径数（20–2000）').fill('1000');
  await page.getByLabel('每路径步数（1–50000）').fill('2000');
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
  const elapsedMs = Date.now() - start;
  const observation = await page.evaluate(() => {
    const w = window as unknown as { delays: number[]; timer: number };
    clearInterval(w.timer);
    return { maximum: Math.max(...w.delays), samples: w.delays.length };
  });
  const evidence = {
    sourceBars: 50000,
    evaluations: 2_000_000,
    elapsedMs,
    ...observation,
    cpu: cpus()[0].model,
    cores: cpus().length,
    os: platform() + ' ' + release(),
    browser: browser.version(),
    node: process.version,
    limitations:
      'synthetic MA source; verify source then IID equity-ratio resampling; 101 display points, all steps in risk statistics',
  };
  console.log('PHASE5A_PERFORMANCE ' + JSON.stringify(evidence));
  await writeFile(
    info.outputPath('phase5a-performance.json'),
    JSON.stringify(evidence, null, 2),
  );
  expect(elapsedMs).toBeLessThan(20000);
  expect(observation.maximum).toBeLessThan(1000);
  expect(observation.samples).toBeGreaterThan(5);
  await page.getByRole('button', { name: '运行风险分析', exact: true }).click();
  await page.getByRole('button', { name: '取消风险任务', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('取消');
  await expect(page.getByTestId('risk-results')).toHaveCount(0);
});
