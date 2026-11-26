import { chartColors } from '../../src/shared/chart-colors';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile, mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';

async function importHistorical(page: Page, save = false, symbol = 'BTC/USDT') {
  await page.goto('/#/datasets');
  await page
    .getByRole('button', { name: '真实历史样本 · BTCUSDT · 1 小时' })
    .click();
  await expect(
    page.getByText('读到 24 条数据记录。', { exact: false }),
  ).toBeVisible();
  await page.getByLabel('预期固定周期（秒）').fill('3600');
  await page.getByRole('button', { name: '检查并生成导入报告' }).click();
  await expect(page.getByText('检查完成（仅文件内）')).toBeVisible();
  await page.getByLabel('币种 / 交易对（自述，不认证来源）').fill(symbol);
  await page.getByRole('checkbox', { name: /我已阅读 .* 项警告/ }).check();
  await page
    .getByRole('button', {
      name: save ? '保存已检查数据集' : '用于行情中心',
      exact: true,
    })
    .click();
}
async function selectSaved(page: Page) {
  const select = page.getByRole('combobox', { name: '已保存的数据集' });
  await expect(select.locator('option')).toHaveCount(2);
  await select.selectOption({ index: 1 });
  return select;
}
const errorsFor = (page: Page) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
};

// The 24-bar fixture has both rising and falling volume bars. Inspect the
// bottom of the real price pane, after alpha compositing by the renderer.
async function expectVolumeColors(page: Page, theme: keyof typeof chartColors) {
  const canvas = page.getByTestId('market-canvas').locator('canvas').first();
  const colors = Object.values(chartColors[theme].volume);
  await expect
    .poll(() =>
      canvas.evaluate((element, colors) => {
        const pane = element as HTMLCanvasElement;
        if (!pane.width || !pane.height) return false;
        const pixels = pane
          .getContext('2d')!
          .getImageData(0, Math.floor(pane.height * 0.98), pane.width, 1).data;
        const rendered = new Set<number>();
        for (let i = 0; i < pixels.length; i += 4) {
          rendered.add(
            (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2],
          );
        }
        return colors.every((hex) => rendered.has(parseInt(hex.slice(1), 16)));
      }, colors),
    )
    .toBe(true);
}

test('行情中心真实图表：缩放、平移、十字准星、指标周期/开关、主题与窄屏', async ({
  page,
}, info) => {
  const errors = errorsFor(page);
  await importHistorical(page);
  const canvas = page.getByTestId('market-canvas');
  await expect(canvas.locator('canvas').first()).toBeVisible();
  await expectVolumeColors(page, 'dark');
  await page.mouse.move(0, 0);
  await expect(page.getByTestId('chart-readout')).toContainText(
    '2024-10-28 23:00:00.000 UTC',
  );
  await expect(page.getByTestId('chart-readout')).toContainText('收 69,962.21');
  await page.getByRole('button', { name: '放大图表' }).click();
  const zoomed = await page.getByTestId('visible-range').textContent();
  await page.getByRole('button', { name: '向历史平移' }).click();
  await expect(page.getByTestId('visible-range')).not.toHaveText(zoomed!);
  await page.getByRole('button', { name: '显示全部数据' }).click();
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 100);
  await expect(page.getByTestId('chart-readout')).toContainText('十字准星');
  await expect(page.getByTestId('chart-readout')).not.toContainText(
    '价格读取：移动指针',
  );
  const beforeWheel = await page.getByTestId('visible-range').textContent();
  await page.mouse.wheel(0, -350);
  await expect(page.getByTestId('visible-range')).not.toHaveText(beforeWheel!);
  const beforeDrag = await page.getByTestId('visible-range').textContent();
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + 100, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId('visible-range')).not.toHaveText(beforeDrag!);
  for (const key of ['MA', 'EMA', 'RSI'])
    await page.getByLabel(`${key} 周期`, { exact: true }).fill('3');
  await page.mouse.move(0, 0);
  await expect(page.getByTestId('chart-readout')).not.toContainText('NA');
  await page.getByRole('checkbox', { name: 'RSI', exact: true }).uncheck();
  await expect(canvas).toHaveCSS('height', '420px');
  await expect(page.getByTestId('chart-readout')).not.toContainText('RSI');
  await page.getByRole('checkbox', { name: 'MA', exact: true }).uncheck();
  await expect(page.getByTestId('ma-value')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'EMA', exact: true }).uncheck();
  await expect(page.getByTestId('ema-value')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'RSI', exact: true }).check();
  await page.getByLabel('RSI 周期', { exact: true }).fill('50000');
  await expect(page.getByTestId('chart-readout')).toContainText(
    'NA（样本不足）',
  );
  await page.getByLabel('MA 周期', { exact: true }).fill('0');
  await expect(page.getByRole('alert')).toContainText('1–50,000');
  await expect(page.getByTestId('market-canvas')).toHaveCount(0);
  await page.getByLabel('MA 周期', { exact: true }).fill('3');
  await page.getByRole('button', { name: '切换为浅色主题' }).click();
  await expect(canvas.locator('canvas').first()).toBeVisible();
  await expectVolumeColors(page, 'light');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath('chart-light-mobile.png'),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test('IndexedDB 保存、选择重开、JSON 导出/删除/显式恢复，断外网保持本机 HTTP', async ({
  page,
}, info) => {
  const errors = errorsFor(page),
    external: string[] = [];
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin === 'http://127.0.0.1:4173')
      await route.continue();
    else {
      external.push(route.request().url());
      await route.abort();
    }
  });
  await importHistorical(page, true);
  await expect(
    page.getByRole('status').filter({ hasText: '已保存数据集' }),
  ).toBeVisible();
  await page.reload();
  await selectSaved(page);
  await page.getByRole('button', { name: '打开选中数据集' }).click();
  await expect(
    page.getByTestId('market-canvas').locator('canvas').first(),
  ).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出当前数据 JSON' }).click();
  const download = await downloadPromise;
  const path = info.outputPath('backup.json');
  await download.saveAs(path);
  const backup = JSON.parse(await readFile(path, 'utf8'));
  expect(backup.dataset.candles).toHaveLength(24);
  expect(backup.dataset.file.sha256).toBe(
    '0cf21b6f475479a8b8918ed983e924cfce2057dde6ccd864aaa0d97fd14f9727',
  );
  expect(backup.dataset.source.kind).toBe('historical');
  expect(backup.dataset.quality.warningCount).toBeGreaterThan(0);
  await selectSaved(page);
  await expect(
    page.getByRole('button', { name: '删除选中数据集' }),
  ).toBeDisabled();
  await page.getByRole('checkbox', { name: /确认删除选中/ }).check();
  await page.getByRole('button', { name: '删除选中数据集' }).click();
  await expect(
    page.getByRole('heading', { name: '尚无可显示的数据' }),
  ).toBeVisible();
  await page.getByLabel('导入 JSON 备份', { exact: false }).setInputFiles(path);
  await expect(
    page.getByRole('heading', { name: '备份恢复预览' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '确认恢复备份' }),
  ).toBeDisabled();
  await page.getByRole('checkbox', { name: /我已阅读备份范围/ }).check();
  await page.getByRole('button', { name: '确认恢复备份' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: '备份已恢复为新副本' }),
  ).toBeVisible();
  await page.reload();
  await selectSaved(page);
  await page.getByRole('button', { name: '打开选中数据集' }).click();
  await expect(page.getByTestId('chart-readout')).toContainText(
    '2024-10-28 23:00:00.000 UTC',
  );
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test('持久浏览器配置：关闭浏览器进程、重新启动后可恢复数据', async ({
  browser,
}) => {
  test.setTimeout(60000);
  const channel = process.env.E2E_BROWSER;
  const options = {
    headless: true,
    channel: channel === 'chrome' || channel === 'msedge' ? channel : undefined,
    executablePath:
      !channel || channel === 'chromium'
        ? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
        : undefined,
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1440, height: 1000 },
  };
  await mkdir(resolve('work'), { recursive: true });
  // Keep Chromium's nested profile paths short on Windows. Never reuse a user's profile.
  const profile = await mkdtemp(resolve('work', 'e2e-profile-'));
  const first = await browser
    .browserType()
    .launchPersistentContext(profile, options);
  try {
    const page = await first.newPage();
    await importHistorical(page, true);
    await expect(
      page.getByRole('status').filter({ hasText: '已保存数据集' }),
    ).toBeVisible();
  } finally {
    await first.close();
  }
  const second = await browser
    .browserType()
    .launchPersistentContext(profile, options);
  try {
    const page = await second.newPage();
    await page.goto('/#/charts');
    await selectSaved(page);
    await page.getByRole('button', { name: '打开选中数据集' }).click();
    await expect(page.getByTestId('chart-readout')).toContainText(
      '2024-10-28 23:00:00.000 UTC',
    );
  } finally {
    await second.close();
  }
});

test('存储拒绝与空间不足不显示成功；仍可导出内存数据备份', async ({ page }) => {
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      ...args: Parameters<typeof original>
    ) {
      if (this.name === 'datasets')
        throw new DOMException('full', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
  await importHistorical(page, true);
  await expect(page.getByRole('alert').first()).toContainText('空间不足');
  await expect(
    page.getByText('已保存数据集（IndexedDB 事务已完成）。请另行备份。'),
  ).toHaveCount(0);
  await expect(
    page.getByRole('combobox', { name: '已保存的数据集' }).locator('option'),
  ).toHaveCount(1);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出当前数据 JSON' }).click();
  await download;
});

test('无法访问 IndexedDB、损坏备份和有错误的 CSV 明确阻断', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', {
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
  });
  await page.goto('/#/datasets');
  await expect(page.getByRole('alert')).toContainText('浏览器拒绝');
  await page.getByLabel('导入 JSON 备份', { exact: false }).setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      '{"format":"riverlab-dataset","version":1,"payloadSha256":"bad","dataset":{}}',
    ),
  });
  await expect(page.getByRole('alert')).toContainText('校验和');
  await page.getByRole('button', { name: '错误测试样本 · 人工构造' }).click();
  await expect(
    page.getByText('读到 9 条数据记录。', { exact: false }),
  ).toBeVisible();
  await page.getByLabel('预期固定周期（秒）').fill('60');
  await page.getByRole('button', { name: '检查并生成导入报告' }).click();
  await expect(
    page.getByText('当前数据尚不可用', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '用于行情中心', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: '保存已检查数据集', exact: true }),
  ).toBeDisabled();
});

test('微秒/UTC 亚秒、缺口传递到图表，指标重新预热', async ({ page }) => {
  await page.goto('/#/datasets');
  const times = [
    1735689600001, 1735689601001, 1735689602001, 1735689605001, 1735689606001,
  ];
  const csv =
    'timestamp,open,high,low,close,volume\n' +
    times
      .map(
        (time, i) => `${BigInt(time) * 1000n},${100 + i},110,90,${100 + i},10`,
      )
      .join('\n');
  await page.getByLabel('选择本地 CSV').setInputFiles({
    name: 'synthetic-gap-us.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  await expect(
    page.getByText('读到 5 条数据记录。', { exact: false }),
  ).toBeVisible();
  await page.getByLabel('预期固定周期（秒）').fill('1');
  await page.getByRole('button', { name: '检查并生成导入报告' }).click();
  await expect(page.getByText('检查完成（仅文件内）')).toBeVisible();
  await page.getByLabel('币种 / 交易对（自述，不认证来源）').fill('DEMO');
  await page.getByRole('checkbox', { name: /我已阅读 .* 项警告/ }).check();
  await page.getByRole('button', { name: '用于行情中心', exact: true }).click();
  await expect(
    page.getByTestId('market-canvas').locator('canvas').first(),
  ).toBeVisible();
  await expect(page.getByText(/缺口 1 处、缺失 2 根/)).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(page.getByTestId('chart-readout')).toContainText(
    '00:00:06.001 UTC',
  );
  await page.getByLabel('RSI 周期', { exact: true }).fill('2');
  await page.getByLabel('MA 周期', { exact: true }).fill('2');
  await page.mouse.move(0, 0);
  await expect(page.getByTestId('chart-readout')).toContainText('RSI NA');
  await expect(page.getByTestId('chart-readout')).toContainText('MA 103.5');
});

test('50,000 根合成数据：实际 Worker、保存/重开、图表响应及备份', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const rows = 50000;
  const csv =
    'timestamp,open,high,low,close,volume\n' +
    Array.from(
      { length: rows },
      (_, i) => `${1735689600000 + i * 60000},100,105,95,${100 + (i % 5)},20`,
    ).join('\n');
  expect(Buffer.byteLength(csv)).toBeLessThanOrEqual(10 * 1024 * 1024);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const observedHeap: number[] = [];
  async function sampleHeap() {
    const { metrics } = await cdp.send('Performance.getMetrics');
    observedHeap.push(
      metrics.find(
        (m: { name: string; value: number }) => m.name === 'JSHeapUsedSize',
      )!.value,
    );
  }
  const timings: Record<string, number> = {
    rows,
    csvBytes: Buffer.byteLength(csv),
  };
  const errors = errorsFor(page);
  await page.goto('/#/datasets');
  await sampleHeap();
  await page.evaluate(() => {
    const samples: number[] = [];
    let previous = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      samples.push(now - previous);
      previous = now;
    }, 10);
    Object.assign(window, { __riverlabPerf: { samples, timer } });
  });
  let start = Date.now();
  await page.getByLabel('选择本地 CSV').setInputFiles({
    name: 'synthetic-50000.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  await expect(
    page.getByText('读到 50000 条数据记录。', { exact: false }),
  ).toBeVisible();
  timings.inspectionMs = Date.now() - start;
  await page.getByLabel('预期固定周期（秒）').fill('60');
  start = Date.now();
  await page.getByRole('button', { name: '检查并生成导入报告' }).click();
  await expect(page.getByText('检查完成（仅文件内）')).toBeVisible();
  timings.reportMs = Date.now() - start;
  await page
    .getByLabel('币种 / 交易对（自述，不认证来源）')
    .fill('SYNTHETIC/USDT');
  await page.getByRole('checkbox', { name: /我已阅读 .* 项警告/ }).check();
  start = Date.now();
  await page
    .getByRole('button', { name: '保存已检查数据集', exact: true })
    .click();
  await expect(
    page.getByRole('status').filter({ hasText: '已保存数据集' }),
  ).toBeVisible();
  timings.prepareAndSaveMs = Date.now() - start;
  await selectSaved(page);
  start = Date.now();
  await page.getByRole('button', { name: '打开选中数据集' }).click();
  await expect(
    page.getByTestId('market-canvas').locator('canvas').first(),
  ).toBeVisible();
  await expect(page.getByTestId('market-canvas')).toHaveAttribute(
    'data-ready',
    'true',
  );
  timings.reopenAndChartMs = Date.now() - start;
  await sampleHeap();
  start = Date.now();
  await page.getByRole('button', { name: '放大图表' }).click();
  await expect(page.getByTestId('visible-range')).not.toContainText('全部数据');
  timings.zoomMs = Date.now() - start;
  await page.getByLabel('MA 周期', { exact: true }).fill('50');
  await expect(page.getByTestId('chart-readout')).toContainText('MA 102');
  const downloadPromise = page.waitForEvent('download');
  start = Date.now();
  await page.getByRole('button', { name: '导出当前数据 JSON' }).click();
  const download = await downloadPromise;
  const path = info.outputPath('large-backup.json');
  await download.saveAs(path);
  timings.backupMs = Date.now() - start;
  const backup = await readFile(path);
  timings.backupBytes = backup.byteLength;
  expect(JSON.parse(backup.toString()).dataset.candles).toHaveLength(rows);
  await sampleHeap();
  start = Date.now();
  await page.getByLabel('导入 JSON 备份', { exact: false }).setInputFiles(path);
  await expect(
    page.getByRole('heading', { name: '备份恢复预览' }),
  ).toBeVisible();
  timings.backupInspectMs = Date.now() - start;
  await page.getByRole('checkbox', { name: /我已阅读备份范围/ }).check();
  start = Date.now();
  await page.getByRole('button', { name: '确认恢复备份' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: '备份已恢复为新副本' }),
  ).toBeVisible();
  await expect(
    page.getByRole('combobox', { name: '已保存的数据集' }).locator('option'),
  ).toHaveCount(3);
  timings.backupRestoreMs = Date.now() - start;
  await sampleHeap();
  timings.maxObservedJsHeapBytes = Math.max(...observedHeap);
  await cdp.detach();
  timings.maxEventLoopDelayMs = await page.evaluate(() => {
    const perf = (
      window as unknown as {
        __riverlabPerf: { samples: number[]; timer: number };
      }
    ).__riverlabPerf;
    clearInterval(perf.timer);
    return Math.max(...perf.samples);
  });
  await info.attach('performance-50000.json', {
    body: JSON.stringify(timings, null, 2),
    contentType: 'application/json',
  });
  console.log('PHASE1B_PERFORMANCE', JSON.stringify(timings));
  // Generous correctness/sanity ceilings for shared CI, not a hardware-independent SLA.
  expect(timings.reopenAndChartMs).toBeLessThan(15000);
  expect(timings.zoomMs).toBeLessThan(5000);
  expect(timings.maxEventLoopDelayMs).toBeLessThan(5000);
  expect(errors).toEqual([]);
});

test('删除事务失败保留数据；重新打开时拒绝已损坏的存储记录', async ({
  page,
}) => {
  await page.addInitScript(() => {
    IDBObjectStore.prototype.delete = function () {
      throw new DOMException('denied', 'NotAllowedError');
    };
  });
  await importHistorical(page, true);
  await expect(
    page.getByRole('status').filter({ hasText: '已保存数据集' }),
  ).toBeVisible();
  await selectSaved(page);
  await page.getByRole('checkbox', { name: /确认删除选中/ }).check();
  await page.getByRole('button', { name: '删除选中数据集' }).click();
  await expect(page.getByRole('alert')).toContainText('浏览器拒绝');
  await expect(
    page.getByRole('combobox', { name: '已保存的数据集' }).locator('option'),
  ).toHaveCount(2);
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('riverlab-crypto-lab', 1);
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction('datasets', 'readwrite'),
            store = tx.objectStore('datasets'),
            get = store.getAll();
          get.onsuccess = () => {
            const d = get.result[0];
            d.candles[0].high = -1;
            store.put(d);
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      }),
  );
  await page.goto('/#/charts');
  await page.reload();
  await selectSaved(page);
  await page.getByRole('button', { name: '打开选中数据集' }).click();
  await expect(page.getByRole('alert')).toContainText('数据集损坏');
  await expect(
    page.getByRole('heading', { name: '尚无可显示的数据' }),
  ).toBeVisible();
});

test('两个已保存数据集间明确选择，图表与指标使用对应数据', async ({ page }) => {
  await importHistorical(page, true);
  await expect(
    page.getByRole('status').filter({ hasText: '已保存数据集' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '人工合成样本 · 毫秒' }).click();
  await expect(
    page.getByText('读到 4 条数据记录。', { exact: false }),
  ).toBeVisible();
  await page.getByLabel('预期固定周期（秒）').fill('60');
  await page.getByRole('button', { name: '检查并生成导入报告' }).click();
  await expect(page.getByText('检查完成（仅文件内）')).toBeVisible();
  await page.getByLabel('币种 / 交易对（自述，不认证来源）').fill('DEMO/USDT');
  await page.getByRole('checkbox', { name: /我已阅读 .* 项警告/ }).check();
  await page
    .getByRole('button', { name: '保存已检查数据集', exact: true })
    .click();
  const select = page.getByRole('combobox', { name: '已保存的数据集' });
  await expect(select.locator('option')).toHaveCount(3);
  await select.selectOption(
    (await select
      .locator('option')
      .filter({ hasText: 'DEMO/USDT' })
      .getAttribute('value'))!,
  );
  await page.getByRole('button', { name: '打开选中数据集' }).click();
  await page.mouse.move(0, 0);
  await expect(page.getByTestId('chart-readout')).toContainText('2025-01-01');
  await expect(page.getByTestId('rsi-value')).toContainText('NA');
  await select.selectOption(
    (await select
      .locator('option')
      .filter({ hasText: 'BTC/USDT' })
      .getAttribute('value'))!,
  );
  await page.getByRole('button', { name: '打开选中数据集' }).click();
  await page.mouse.move(0, 0);
  await expect(page.getByTestId('chart-readout')).toContainText('2024-10-28');
  await expect(page.getByTestId('rsi-value')).not.toContainText('NA');
});

test('已保存长名称数据集在390px下不会撑宽数据中心或行情中心', async ({
  page,
}) => {
  await importHistorical(page, true, 'ACCEPTANCE' + 'X'.repeat(68));
  await expect(
    page.getByRole('status').filter({ hasText: '已保存数据集' }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await selectSaved(page);
  await page.getByRole('button', { name: '打开选中数据集' }).click();
  await expect(page.getByTestId('market-canvas')).toHaveAttribute(
    'data-ready',
    'true',
  );
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
});
