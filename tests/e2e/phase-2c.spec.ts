import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { cpus, platform, release } from 'node:os';
async function prepare(page: Page, rows = 24) {
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
async function run(page: Page, kind = 'ma') {
  await page
    .getByRole('combobox', { name: '策略', exact: true })
    .selectOption(kind);
  if (kind === 'ma') {
    await page.getByLabel('MA 快线周期').fill('2');
    await page.getByLabel('MA 慢线周期').fill('4');
  }
  if (kind === 'rsi') await page.getByLabel('RSI 周期').fill('3');
  if (kind === 'breakout') await page.getByLabel('突破回看周期').fill('2');
  await page.getByRole('checkbox', { name: /我确认本数据集全部 K 线/ }).check();
  await page.getByRole('button', { name: '运行回测', exact: true }).click();
  await expect(
    page.getByText('回测成功；结果尚未保存，刷新会丢失。'),
  ).toBeVisible();
  await expect(page.getByTestId('result-curves')).toHaveAttribute(
    'data-ready',
    'true',
  );
}
const pnl = (page: Page) => page.locator('[data-metric="总净盈亏 USDT"]');
for (const kind of ['ma', 'rsi', 'breakout'])
  test(`${kind} 完整Worker回测、曲线、账本、JSON/CSV、保存刷新重开与删除，外网阻断`, async ({
    page,
  }, info) => {
    const external: string[] = [],
      errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === 'http://127.0.0.1:4173') await route.continue();
      else {
        external.push(url.href);
        await route.abort();
      }
    });
    await prepare(page);
    await run(page, kind);
    await expect(page.locator('[data-metric="年化收益"]')).toContainText('NA');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole('button', { name: '切换为浅色主题' }).click();
    await expect(page.getByTestId('result-curves')).toHaveAttribute(
      'data-ready',
      'true',
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const before = await pnl(page).textContent();
    const j = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出实验 JSON' }).click();
    const json = JSON.parse(await readFile((await (await j).path())!, 'utf8'));
    expect(json.payload.disclaimer).toBe(
      '仅供学习研究，历史表现不代表未来表现',
    );
    expect(json.payload.result.manifest.strategy.config.kind).toBe(kind);
    expect(json.payload.statistics.netPnl).toBe(before);
    expect(json.payload.dataset.candles).toHaveLength(24);
    const c = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出交易 CSV' }).click();
    const csv = await readFile((await (await c).path())!, 'utf8');
    expect(csv).toContain(json.payload.result.manifest.runHash);
    expect(csv).toContain('timestampUtcMs');
    await page
      .getByRole('button', { name: '保存回测实验', exact: true })
      .click();
    await expect(
      page.getByText('实验已保存（事务已完成）。请另行导出JSON备份。'),
    ).toBeVisible();
    await page.reload();
    await expect(pnl(page)).toHaveCount(0);
    await expect(page.getByLabel('回测数据集')).toHaveValue('');
    await page
      .getByRole('navigation')
      .getByRole('link', { name: '实验中心' })
      .click();
    await page.getByRole('button', { name: /打开实验/ }).click();
    await expect(
      page.getByText('实验校验与重算一致，已重新打开结果。'),
    ).toBeVisible();
    await expect(pnl(page)).toHaveText(before!);
    await page.getByRole('button', { name: '复现本实验', exact: true }).click();
    await expect(
      page.getByText('回测成功；结果尚未保存，刷新会丢失。'),
    ).toBeVisible();
    await expect(pnl(page)).toHaveText(before!);
    const j2 = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出实验 JSON' }).click();
    const again = JSON.parse(
      await readFile((await (await j2).path())!, 'utf8'),
    );
    expect(again.payload).toEqual(json.payload);
    expect(again.payloadHash).toBe(json.payloadHash);
    await page.getByRole('button', { name: /删除实验 / }).click();
    await page
      .getByRole('button', { name: '确认删除实验', exact: true })
      .click();
    await expect(page.getByText('尚无已保存实验。')).toBeVisible();
    await page.reload();
    await expect(page.getByText('尚无已保存实验。')).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(external).toEqual([]);
    expect(errors).toEqual([]);
    await info.attach('report-metadata', {
      body: JSON.stringify({
        runHash: json.payload.result.manifest.runHash,
        payloadHash: json.payloadHash,
      }),
      contentType: 'application/json',
    });
  });
test('严格参数/确认阻断、存储配额失败保留内存导出、损坏记录拒绝重开', async ({
  page,
}) => {
  await prepare(page);
  await expect(
    page.getByRole('button', { name: '运行回测', exact: true }),
  ).toBeDisabled();
  await page.getByRole('checkbox', { name: /我确认本数据集全部 K 线/ }).check();
  await page.getByLabel('MA 快线周期').fill('0');
  await page.getByRole('button', { name: '运行回测', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('无法运行');
  await expect(pnl(page)).toHaveCount(0);
  await run(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args) {
      if (this.name === 'experiments')
        throw new DOMException('full', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
  await page.getByRole('button', { name: '保存回测实验', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('空间不足');
  await expect(pnl(page)).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出实验 JSON' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.json$/);
  await page.reload();
  await page
    .getByRole('navigation')
    .getByRole('link', { name: '回测中心' })
    .click();
  await page.getByLabel('回测数据集').selectOption({ index: 1 });
  await run(page);
  await page.getByRole('button', { name: '保存回测实验', exact: true }).click();
  await expect(
    page.getByText('实验已保存（事务已完成）。请另行导出JSON备份。'),
  ).toBeVisible();
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('riverlab-crypto-lab-experiments', 1);
        req.onsuccess = () => {
          const db = req.result,
            tx = db.transaction('experiments', 'readwrite'),
            store = tx.objectStore('experiments'),
            all = store.getAll();
          all.onsuccess = () => {
            const e = all.result[0];
            e.payload.result.final.cash = '999999';
            store.put(e);
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => reject(tx.error);
        };
      }),
  );
  await page
    .getByRole('navigation')
    .getByRole('link', { name: '实验中心' })
    .click();
  await page.getByRole('button', { name: /打开实验/ }).click();
  await expect(page.getByRole('alert')).toContainText('损坏');
  await expect(pnl(page)).toHaveCount(0);
});
test('保护配置进入manifest，止盈止损事件保留根内未知时间和保守假设', async ({
  page,
}) => {
  await prepare(page, 36);
  await page.getByLabel('止损 bps（留空关闭）').fill('1');
  await page.getByLabel('止盈 bps（留空关闭）').fill('1');
  await page.getByLabel('买入滑点 bps').fill('0');
  await run(page, 'ma');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出实验 JSON' }).click();
  const report = JSON.parse(
    await readFile((await (await download).path())!, 'utf8'),
  );
  expect(report.payload.result.manifest.risk).toEqual({
    stopLossBps: 1,
    takeProfitBps: 1,
  });
  const protection = report.payload.result.fills.filter(
    (f: { trigger?: unknown }) => f.trigger,
  );
  expect(protection.length).toBeGreaterThan(0);
  expect(
    protection.some(
      (f: { trigger: { assumption: string } }) =>
        f.trigger.assumption === 'ambiguous-stop-first',
    ),
  ).toBe(true);
  await expect(page.getByRole('table', { name: '逐笔成交账本' })).toContainText(
    '止损',
  );
  await expect(page.getByRole('table', { name: '逐笔成交账本' })).toContainText(
    '根内时间未知',
  );
});

test('有缺口但已保存的完整数据仍然禁止回测，不截取子集', async ({ page }) => {
  await page.goto('/#/datasets');
  const csv =
    'timestamp,open,high,low,close,volume\n1735689600000,100,100,100,100,1\n1735689720000,100,100,100,100,1\n1735689780000,100,100,100,100,1';
  await page.getByLabel('选择本地 CSV').setInputFiles({
    name: 'synthetic-gap.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  await page.getByLabel('预期固定周期（秒）').fill('60');
  await page.getByRole('button', { name: '检查并生成导入报告' }).click();
  await page.getByLabel('币种 / 交易对（自述，不认证来源）').fill('GAP/USDT');
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
  await page.getByRole('checkbox', { name: /我确认本数据集全部 K 线/ }).check();
  await expect(
    page.getByRole('button', { name: '运行回测', exact: true }),
  ).toBeDisabled();
  await expect(page.getByText('缺口 1；警告', { exact: false })).toBeVisible();
  await expect(pnl(page)).toHaveCount(0);
});

test('50,000根真实策略成交统计Worker性能与主线程响应', async ({
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
  await run(page, 'ma');
  const elapsed = Date.now() - start;
  const observations = await page.evaluate(() => {
    const w = window as unknown as { delays: number[]; timer: number };
    clearInterval(w.timer);
    return {
      maxDelayMs: Math.max(...w.delays),
      samples: w.delays.length,
      hardwareConcurrency: navigator.hardwareConcurrency,
      userAgent: navigator.userAgent,
    };
  });
  expect(observations.samples).toBeGreaterThan(5);
  expect(elapsed).toBeLessThan(20000);
  expect(observations.maxDelayMs).toBeLessThan(1000);
  await expect(page.getByText(/全部 50001 点/)).toBeVisible();
  const result = {
    rows: 50000,
    elapsedMs: elapsed,
    ...observations,
    os: `${platform()} ${release()}`,
    cpu: cpus()[0].model,
    browser: browser.version(),
    limitations:
      '人工合成；回测到全点曲线就绪含Worker传输/绘图，不是无限数据保证',
  };
  console.log('PHASE2C_PERFORMANCE ' + JSON.stringify(result));
  await writeFile(
    info.outputPath('phase2c-performance.json'),
    JSON.stringify(result, null, 2),
  );
});
