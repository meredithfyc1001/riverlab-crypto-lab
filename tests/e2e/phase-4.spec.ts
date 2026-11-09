import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { cpus, platform, release } from 'node:os';
const origin = 'http://127.0.0.1:4173';
async function prepare(page: Page, rows = 8, gap = false) {
  await page.goto('/#/datasets');
  const prices =
    rows === 8
      ? [100, 100, 120, 80, 90, 110, 95, 987654.321]
      : Array.from(
          { length: rows },
          (_, i) => 100 + (i % 12 < 6 ? i % 6 : 6 - (i % 6)),
        );
  const csv =
    'timestamp,open,high,low,close,volume\n' +
    prices
      .map((p, i) =>
        [
          1735689600000 + (i + (gap && i >= 4 ? 1 : 0)) * 60000,
          p,
          p,
          p,
          p,
          1,
        ].join(','),
      )
      .join('\n');
  await page.getByLabel('选择本地 CSV').setInputFiles({
    name: 'synthetic-replay.csv',
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
    .getByRole('link', { name: '历史回放' })
    .click();
  const select = page.getByLabel('回放数据集');
  await expect(select).toBeVisible();
  const option = select
    .locator('option')
    .filter({ hasText: 'SYNTHETIC/USDT' })
    .last();
  await expect(option).toBeAttached();
  await select.selectOption((await option.getAttribute('value'))!);
}
async function start(page: Page) {
  await page
    .getByRole('checkbox', {
      name: '我确认回放数据全部已收盘，已阅读质量、费用、滑点与保护假设',
    })
    .check();
  await page.getByRole('button', { name: '开始历史回放', exact: true }).click();
  await expect(page.getByTestId('replay-cursor')).toContainText('已播放 1 /');
  await expect(page.getByTestId('replay-chart')).toHaveAttribute(
    'data-ready',
    'true',
  );
}
const metric = (page: Page, label: string) =>
  page.locator('[data-replay-metric="' + label + '"]');
async function step(page: Page, cursor: number) {
  await page.getByRole('button', { name: '前进一根', exact: true }).click();
  await expect(page.getByTestId('replay-cursor')).toContainText(
    '已播放 ' + cursor + ' /',
  );
}
async function downloadJson(page: Page) {
  const d = page.waitForEvent('download');
  await page
    .getByRole('button', { name: '导出回放 JSON', exact: true })
    .click();
  const path = (await (await d).path())!;
  return { path, report: JSON.parse(await readFile(path, 'utf8')) };
}

test('无未来消息/图表/DOM/状态导出；下一开盘成交、日记、保存刷新/JSON恢复/删除与离线', async ({
  page,
}) => {
  const external: string[] = [],
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.context().route('**/*', (route) => {
    if (new URL(route.request().url()).origin === origin)
      return route.continue();
    external.push(route.request().url());
    return route.abort();
  });
  await page.addInitScript(() => {
    const w = window as unknown as { replayMessages: string[] };
    w.replayMessages = [];
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        this.addEventListener('message', (event) => {
          if (event.data?.view?.version === 'interactive-prefix-replay-v1')
            w.replayMessages.push(JSON.stringify(event.data));
        });
      }
    };
  });
  await prepare(page);
  await start(page);
  await expect(page.getByTestId('replay-chart')).toHaveAttribute(
    'data-candles',
    '1',
  );
  await expect(page.locator('main')).not.toContainText('987654.321');
  expect(
    await page.evaluate(() =>
      (window as unknown as { replayMessages: string[] }).replayMessages.join(
        '\n',
      ),
    ),
  ).not.toContain('987654.321');
  await page.getByLabel('虚拟订单数量（all或币数量）').fill('1');
  await page.getByRole('button', { name: '排队虚拟买入' }).click();
  await expect(page.getByTestId('replay-pending')).toContainText('尚未成交');
  await expect(metric(page, '现金 USDT')).toHaveText('1000');
  await page
    .getByLabel('当前收盘交易日记（最多2000字符）')
    .fill('=HYPERLINK("offline")');
  await page.getByRole('button', { name: '加入当前日记' }).click();
  await expect(page.getByRole('list', { name: '回放交易日记' })).toContainText(
    '=HYPERLINK',
  );
  await page.getByRole('button', { name: '保存回放状态', exact: true }).click();
  await expect(
    page.getByText('回放状态已保存（事务已完成）。请另行导出JSON备份。'),
  ).toBeVisible();
  const saved = await downloadJson(page);
  expect(saved.report.payload.cursor).toBe(1);
  expect(saved.report.payload.decisions).toHaveLength(1);
  expect(saved.report.payload).not.toHaveProperty('candles');
  expect(JSON.stringify(saved.report)).not.toContain('987654.321');
  await page.reload();
  await expect(page.getByTestId('replay-cursor')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /打开回放/ })).toHaveCount(1);
  await page.getByRole('button', { name: /打开回放/ }).click();
  await expect(
    page.getByText('回放状态校验与重算一致；保持暂停，下一步从原游标继续。'),
  ).toBeVisible();
  await expect(page.getByTestId('replay-pending')).toBeVisible();
  await expect(page.getByTestId('replay-cursor')).toContainText(
    '当前状态已保存',
  );
  const restored = await downloadJson(page);
  expect(restored.report.payload).toEqual(saved.report.payload);
  await step(page, 2);
  await expect(metric(page, '现金 USDT')).toHaveText('899.7999');
  await expect(
    page.getByRole('table', { name: '回放逐笔成交' }).locator('tbody tr'),
  ).toHaveCount(1);
  const csv = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出回放交易 CSV' }).click();
  const text = await readFile((await (await csv).path())!, 'utf8');
  expect(text).toContain("'=HYPERLINK");
  expect(text).not.toContain('987654.321');
  expect(text).toContain('0.1001');
  await page.getByLabel('恢复回放 JSON（10MiB以内）').setInputFiles(saved.path);
  await expect(page.getByTestId('replay-cursor')).toContainText('已播放 1 /');
  await expect(metric(page, '现金 USDT')).toHaveText('1000');
  await expect(page.getByTestId('replay-cursor')).toContainText(
    '当前状态尚未保存',
  );
  await step(page, 2);
  await expect(
    page.getByRole('table', { name: '回放逐笔成交' }).locator('tbody tr'),
  ).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '切换为浅色主题' }).click();
  await expect(page.getByTestId('replay-chart')).toHaveAttribute(
    'data-ready',
    'true',
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: /删除回放/ }).click();
  await expect(page.getByText('已删除保存的回放快照。')).toBeVisible();
  await expect(page.getByRole('button', { name: /打开回放/ })).toHaveCount(0);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});
test('自动逐根播放、暂停、跨页面暂停与显式结束，不重复成交', async ({
  page,
}) => {
  await prepare(page, 36);
  await start(page);
  await page.getByLabel('播放间隔').selectOption('250');
  await page.getByRole('button', { name: '自动播放', exact: true }).click();
  await expect
    .poll(async () =>
      Number(
        (await page.getByTestId('replay-cursor').textContent())!.match(
          /已播放 (\d+)/,
        )![1],
      ),
    )
    .toBeGreaterThan(2);
  await page.getByRole('button', { name: '暂停回放', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '前进一根', exact: true }),
  ).toBeEnabled();
  const before = await page.getByTestId('replay-cursor').textContent();
  await page.waitForTimeout(800);
  expect(await page.getByTestId('replay-cursor').textContent()).toBe(before);
  await page.getByRole('button', { name: '自动播放', exact: true }).click();
  await page
    .getByRole('navigation')
    .getByRole('link', { name: '工作台', exact: true })
    .click();
  await page.waitForTimeout(800);
  await page
    .getByRole('navigation')
    .getByRole('link', { name: '历史回放' })
    .click();
  await expect(page.getByTestId('replay-cursor')).toContainText('已暂停');
  const paused = await page.getByTestId('replay-cursor').textContent();
  await page.waitForTimeout(800);
  expect(await page.getByTestId('replay-cursor').textContent()).toBe(paused);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '结束当前回放' }).click();
  await expect(
    page.getByRole('button', { name: '开始历史回放', exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('replay-cursor')).toHaveCount(0);
});
test('拒单与缺口阻断；损坏JSON不破坏当前内存回放', async ({ page }) => {
  await prepare(page);
  await start(page);
  await page.getByLabel('虚拟订单数量（all或币数量）').fill('1000');
  await page.getByRole('button', { name: '排队虚拟买入' }).click();
  await step(page, 2);
  await expect(page.getByRole('table', { name: '回放订单事件' })).toContainText(
    '资金不足',
  );
  await expect(metric(page, '现金 USDT')).toHaveText('1000');
  await page.getByLabel('恢复回放 JSON（10MiB以内）').setInputFiles({
    name: 'corrupt.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{}'),
  });
  await expect(page.getByRole('alert')).toContainText('损坏');
  await step(page, 3);
  await page.reload();
  await prepare(page, 8, true);
  await page
    .getByRole('checkbox', {
      name: '我确认回放数据全部已收盘，已阅读质量、费用、滑点与保护假设',
    })
    .check();
  await expect(
    page.getByRole('button', { name: '开始历史回放', exact: true }),
  ).toBeDisabled();
});
test('50,000根实际逐根会话推进和断点恢复性能，不运行N次前缀回测', async ({
  page,
  browser,
}, info) => {
  await prepare(page, 50000);
  await start(page);
  await page.getByLabel('虚拟订单数量（all或币数量）').fill('all');
  await page.getByRole('button', { name: '排队虚拟买入' }).click();
  await page.evaluate(() => {
    const w = window as unknown as { delays: number[]; timer: number };
    w.delays = [];
    let previous = performance.now();
    w.timer = window.setInterval(() => {
      const now = performance.now();
      w.delays.push(now - previous);
      previous = now;
    }, 20);
  });
  const startTime = Date.now();
  await page.getByRole('button', { name: '推进到末尾（逐根执行）' }).click();
  await expect(page.getByTestId('replay-cursor')).toContainText(
    '已播放 50000 / 50000',
    { timeout: 20000 },
  );
  await expect(page.getByTestId('replay-chart')).toHaveAttribute(
    'data-ready',
    'true',
  );
  const advanceMs = Date.now() - startTime;
  const saved = await downloadJson(page);
  const resumeStart = Date.now();
  await page.getByLabel('恢复回放 JSON（10MiB以内）').setInputFiles(saved.path);
  await expect(
    page.getByText('回放状态校验与重算一致；保持暂停，下一步从原游标继续。'),
  ).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('replay-chart')).toHaveAttribute(
    'data-ready',
    'true',
  );
  const resumeMs = Date.now() - resumeStart;
  const observations = await page.evaluate(() => {
    const w = window as unknown as { delays: number[]; timer: number };
    clearInterval(w.timer);
    return { maximum: Math.max(...w.delays), samples: w.delays.length };
  });
  const evidence = {
    bars: 50000,
    advanceMs,
    resumeMs,
    ...observations,
    cpu: cpus()[0].model,
    cores: cpus().length,
    platform: platform(),
    release: release(),
    browser: browser.version(),
    node: process.version,
    limitations:
      'synthetic; Worker persistent execution; one manual pending entry; full known prefix curves; resume by linear replay',
  };
  console.log('PHASE4_PERFORMANCE ' + JSON.stringify(evidence));
  await writeFile(
    info.outputPath('phase4-performance.json'),
    JSON.stringify(evidence, null, 2),
  );
  expect(advanceMs).toBeLessThan(20000);
  expect(resumeMs).toBeLessThan(20000);
  expect(observations.maximum).toBeLessThan(1000);
  expect(observations.samples).toBeGreaterThan(5);
  await expect(
    page.getByRole('table', { name: '回放逐笔成交' }).locator('tbody tr'),
  ).toHaveCount(1);
  expect((await downloadJson(page)).report.payload).toEqual(
    saved.report.payload,
  );
});

test('模拟配额失败保留内存可导出；原数据集删除后恢复明确拒绝', async ({
  page,
}) => {
  await prepare(page);
  await start(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add;
    const w = window as unknown as { restoreAdd: () => void };
    w.restoreAdd = () => {
      IDBObjectStore.prototype.add = original;
    };
    IDBObjectStore.prototype.add = function (...args) {
      if (this.name === 'replays')
        throw new DOMException('simulated quota', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
  await page.getByRole('button', { name: '保存回放状态', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('空间不足');
  await expect(page.getByTestId('replay-cursor')).toContainText('已播放 1 /');
  await expect(page.getByRole('button', { name: /打开回放/ })).toHaveCount(0);
  expect((await downloadJson(page)).report.payload.cursor).toBe(1);
  await page.evaluate(() =>
    (window as unknown as { restoreAdd: () => void }).restoreAdd(),
  );
  await page.getByRole('button', { name: '保存回放状态', exact: true }).click();
  await expect(
    page.getByText('回放状态已保存（事务已完成）。请另行导出JSON备份。'),
  ).toBeVisible();
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('riverlab-crypto-lab', 1);
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction(['datasets', 'summaries'], 'readwrite');
          tx.objectStore('datasets').clear();
          tx.objectStore('summaries').clear();
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error);
          };
        };
        request.onerror = () => reject(request.error);
      }),
  );
  await page.reload();
  await page.getByRole('button', { name: /打开回放/ }).click();
  await expect(page.getByRole('alert')).toContainText(/不存在|删除|找不到/);
  await expect(page.getByTestId('replay-cursor')).toHaveCount(0);
});
