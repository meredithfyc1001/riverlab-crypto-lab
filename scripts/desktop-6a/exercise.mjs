import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { readFile, mkdir } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { setTimeout as pause } from 'node:timers/promises';

import routes from '../../tests/desktop-6a/sections.json' with { type: 'json' };

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function firstWorker(page, origin) {
  await page.goto(origin + '/#/datasets');
  const prices = [100, 103, 99, 106, 102, 109, 104, 113];
  const csv = [
    'timestamp,open,high,low,close,volume',
    ...prices.map((p, i) =>
      [Date.UTC(2025, 0, 1) + i * 60000, p, p, p, p, 1].join(','),
    ),
  ].join('\n');
  await page.getByLabel('选择本地 CSV').setInputFiles({
    name: '桌面验证 人工合成.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  await page.getByText('读到 8 条数据记录。', { exact: false }).waitFor();
}

async function navigation(page, origin) {
  for (const [id, [title, feature]] of Object.entries(routes)) {
    await page.goto(origin + '/#/' + id);
    await page
      .getByRole('heading', { name: title, level: 1, exact: true })
      .waitFor();
    await page
      .getByRole('heading', { name: feature, level: 2, exact: true })
      .waitFor();
    await expect(page.getByLabel('研究风险提示')).toContainText(
      '不提供投资建议',
    );
  }
  const lang = await page.locator('html').getAttribute('lang');
  assert.equal(lang, 'zh-CN');
  // Capture the fonts the engine actually used to render the Chinese heading.
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: 'h1',
    });
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    assert(
      fonts.some((f) => f.glyphCount > 0),
      'Rendered heading has no platform font glyphs',
    );
    return {
      headings: Object.values(routes).map(([title]) => title),
      sections: Object.values(routes).map(([, feature]) => feature),
      lang,
      fonts,
    };
  } finally {
    await cdp.detach();
  }
}

async function researchUI(page, origin, folder) {
  await firstWorker(page, origin);
  await page.getByLabel('预期固定周期（秒）').fill('60');
  await page.getByRole('button', { name: '检查并生成导入报告' }).click();
  await page
    .getByLabel('币种 / 交易对（自述，不认证来源）')
    .fill('SYNTHETIC/USDT');
  await page.getByRole('checkbox', { name: /我已阅读 .* 项警告/ }).check();
  await page
    .getByRole('button', { name: '保存已检查数据集', exact: true })
    .click();
  await page
    .getByText('已保存数据集（IndexedDB 事务已完成）。请另行备份。')
    .waitFor();
  await page.getByRole('button', { name: '用于行情中心', exact: true }).click();
  await expect(
    page.getByTestId('market-canvas').locator('canvas').first(),
  ).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(page.getByTestId('chart-readout')).toContainText('2025-01-01');
  await page.getByRole('button', { name: '放大图表' }).click();
  await page.screenshot({ path: join(folder, 'market-chart.png') });
  await page.goto(origin + '/#/replay');
  const select = page.getByLabel('回放数据集');
  const option = select.locator('option').filter({ hasText: 'SYNTHETIC/USDT' });
  await option.waitFor({ state: 'attached' });
  await select.selectOption(await option.getAttribute('value'));
  await page
    .getByRole('checkbox', {
      name: '我确认回放数据全部已收盘，已阅读质量、费用、滑点与保护假设',
    })
    .check();
  await page.getByRole('button', { name: '开始历史回放', exact: true }).click();
  const cursor = page.getByTestId('replay-cursor');
  await expect(cursor).toContainText('已播放 1 / 8');
  await page.getByRole('button', { name: '前进一根', exact: true }).click();
  await expect(cursor).toContainText('已播放 2 / 8');
  await page.getByRole('button', { name: '保存回放状态', exact: true }).click();
  await page
    .getByText('回放状态已保存（事务已完成）。请另行导出JSON备份。')
    .waitFor();
  await page.reload();
  await page.getByRole('button', { name: /打开回放/ }).click();
  await expect(cursor).toContainText('已播放 2 / 8');
  return { dataset: 'SYNTHETIC/USDT', candles: 8, restoredReplayCursor: 2 };
}

async function diskDownload(page, probe, folder) {
  assert.equal(basename(probe.downloadName), probe.downloadName);
  const destination = join(folder, 'downloads');
  await mkdir(destination);
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: destination,
    });
    await page.locator('#download').click();
    const path = join(destination, probe.downloadName);
    const until = Date.now() + 30_000;
    do {
      let bytes;
      try {
        bytes = await readFile(path);
      } catch (error) {
        if (!['ENOENT', 'EBUSY', 'EPERM'].includes(error.code)) throw error;
      }
      if (bytes && sha256(bytes) === probe.downloadSha256) {
        return {
          filename: probe.downloadName,
          bytes: bytes.length,
          sha256: probe.downloadSha256,
        };
      }
      await pause(150);
    } while (Date.now() < until);
    throw new Error(
      'Blob download did not reach the isolated download directory with the expected SHA-256.',
    );
  } finally {
    await session.detach();
  }
}

export async function exercise(page, origin, folder, record) {
  record.navigation = await navigation(page, origin);
  record.replay = await researchUI(page, origin, folder);
  await page.goto(origin + '/tests/desktop-6a/index.html');
  await page.locator('#status[data-state=ready]').waitFor();
  const startedUtcMs = Date.now();
  await page.locator('#run').click();
  await page
    .locator('#status:is([data-state=passed],[data-state=failed])')
    .waitFor({ timeout: 180000 });
  const status = await page.locator('#status').getAttribute('data-state');
  assert.equal(status, 'passed', await page.locator('#status').innerText());
  record.researchWindow = { startedUtcMs, endedUtcMs: Date.now() };
  const probe = JSON.parse(await page.locator('#result').innerText());
  assert.match(probe.resultHash, /^[a-f0-9]{64}$/);
  assert.equal(probe.candles, 50000);
  assert.equal(probe.resultHash, probe.phase5eResultHash);
  assert.equal(probe.serialHash, probe.resultHash);
  assert.equal(probe.poolHash, probe.resultHash);
  assert.equal(probe.workers, 2);
  assert.equal(probe.completedTrades, 2082);
  assert.equal(probe.evaluations, 100000);
  record.probe = probe;
  record.download = await diskDownload(page, probe, folder);
}
