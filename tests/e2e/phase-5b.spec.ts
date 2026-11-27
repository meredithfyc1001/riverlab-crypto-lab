import { runAndExpectBacktestSuccess } from './backtest-success';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { cpus, platform, release } from 'node:os';
const navigate = async (page: Page, name: string) =>
  page.getByRole('navigation').getByRole('link', { name, exact: true }).click();
async function prepare(page: Page, rows = 48) {
  await page.goto('/#/datasets');
  const csv =
    'timestamp,open,high,low,close,volume\n' +
    Array.from({ length: rows }, (_, i) => {
      const p = 100 + (i % 12 < 6 ? i % 6 : 6 - (i % 6));
      return `${1735689600000 + i * 60000},${p},${p + 1},${p - 1},${p},1`;
    }).join('\n');
  await page.getByLabel('选择本地 CSV').setInputFiles({
    name: 'synthetic-rule.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  await expect(
    page.getByText(`读到 ${rows} 条数据记录。`, { exact: false }),
  ).toBeVisible();
  await page.getByLabel('预期固定周期（秒）').fill('60');
  await page.getByRole('button', { name: '检查并生成导入报告' }).click();
  await expect(page.getByText('检查完成（仅文件内）')).toBeVisible();
  await page
    .getByLabel('币种 / 交易对（自述，不认证来源）')
    .fill('SYNTHETIC/RULE');
  await page.getByRole('checkbox', { name: /我已阅读 .* 项警告/ }).check();
  await page
    .getByRole('button', { name: '保存已检查数据集', exact: true })
    .click();
  await expect(
    page.getByText('已保存数据集（IndexedDB 事务已完成）。请另行备份。'),
  ).toBeVisible();
  await navigate(page, '策略中心');
  await expect(page.getByTestId('rule-editor')).toBeVisible();
}
async function saveRule(page: Page) {
  await page.getByRole('button', { name: '保存策略版本', exact: true }).click();
  await expect(page.getByTestId('rule-version')).toContainText('浏览器已保存');
}
async function selectRule(page: Page) {
  await navigate(page, '回测中心');
  await expect(page.getByLabel('回测数据集')).toBeVisible();
  await page.getByLabel('回测数据集').selectOption({ index: 1 });
  await expect(
    page.getByText('已读取并校验保存的数据集，请确认收盘状态。'),
  ).toBeVisible();
  await page
    .getByRole('combobox', { name: '策略', exact: true })
    .selectOption('rules');
  await page.getByLabel('规则策略版本').selectOption({ index: 1 });
  await page.getByRole('checkbox', { name: /我确认本数据集全部 K 线/ }).check();
}
async function run(page: Page) {
  await runAndExpectBacktestSuccess(page);
  await expect(page.getByTestId('result-curves')).toHaveAttribute(
    'data-ready',
    'true',
  );
}
async function exported(page: Page, label = '导出实验 JSON') {
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: label, exact: true }).click();
  const path = (await (await event).path())!;
  return { path, record: JSON.parse(await readFile(path, 'utf8')) };
}
const group = (page: Page, side: string, n: number) =>
  page.getByRole('group', { name: `${side}条件${n}`, exact: true });

test('卡片编辑、实时边界、双侧组合、条件复制/禁用、版本复制/确认删除与键盘窄屏', async ({
  page,
}, info) => {
  await page.goto('/#/strategies');
  const editor = page.getByTestId('rule-editor');
  await expect(
    page.getByText('规则校验通过，可以保存并在回测中心选择具体版本。'),
  ).toBeVisible();
  await page.getByLabel('策略名称').fill('组合 中文 策略');
  await group(page, '买入', 1).getByLabel('快线周期').fill('5');
  await expect(editor.getByRole('alert')).toContainText('快线小于慢线');
  await group(page, '买入', 1).getByLabel('快线周期').fill('2');
  await group(page, '买入', 1).getByLabel('均线类型').selectOption('EMA');
  await page.getByLabel('买入组合方式').selectOption('OR');
  for (let n = 1; n < 5; n++)
    await page
      .getByRole('button', { name: `添加买入条件（${n}/5）`, exact: true })
      .click();
  await expect(
    page.getByRole('button', { name: '添加买入条件（5/5）' }),
  ).toBeDisabled();
  await group(page, '买入', 2).getByLabel('条件类型').selectOption('rsi');
  await group(page, '买入', 2).getByLabel('RSI阈值').fill('101');
  await expect(editor.getByRole('alert')).toContainText('0–100');
  await group(page, '买入', 2).getByLabel('RSI阈值').fill('50');
  await group(page, '买入', 3).getByLabel('条件类型').selectOption('breakout');
  await group(page, '买入', 4).getByLabel('启用此条件').uncheck();
  await group(page, '买入', 5)
    .getByRole('button', { name: '删除此条件' })
    .click();
  await group(page, '买入', 4)
    .getByRole('button', { name: '复制此条件' })
    .click();
  await expect(
    group(page, '买入', 5).getByLabel('启用此条件'),
  ).not.toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '切换为浅色主题' }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await saveRule(page);
  const first = (await exported(page, '导出策略 JSON')).record;
  expect(first.rule.buy.conditions).toHaveLength(5);
  expect(first.rule.buy.operator).toBe('OR');
  const input = page.getByLabel('策略名称');
  await input.focus();
  await input.press('End');
  await input.press('x');
  await expect(page.getByTestId('rule-version')).toContainText('v2');
  await saveRule(page);
  await page.getByRole('button', { name: '复制为新策略', exact: true }).click();
  await expect(page.getByTestId('rule-version')).toContainText('v1');
  await saveRule(page);
  await expect(
    page.getByRole('list', { name: '规则策略版本库' }).locator('li'),
  ).toHaveCount(3);
  const copied = (await exported(page, '导出策略 JSON')).record;
  expect(copied.familyId).not.toBe(first.familyId);
  await page.getByRole('button', { name: /删除策略 .*副本 v1/ }).click();
  await page.getByRole('button', { name: '取消删除', exact: true }).click();
  await expect(
    page.getByRole('list', { name: '规则策略版本库' }).locator('li'),
  ).toHaveCount(3);
  await page.getByRole('button', { name: /删除策略 .*副本 v1/ }).click();
  await page
    .getByRole('button', { name: '确认删除策略版本', exact: true })
    .click();
  await expect(
    page.getByRole('list', { name: '规则策略版本库' }).locator('li'),
  ).toHaveCount(2);
  await page.screenshot({
    path: info.outputPath('rule-editor-390.png'),
    fullPage: true,
  });
});

test('实际Worker规则→回测→保存导出→刷新重开与确定复现，规则库删除后旧实验仍可用，阻断外网', async ({
  page,
}) => {
  const external: string[] = [],
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.origin === 'http://127.0.0.1:4173') return route.continue();
    external.push(u.href);
    return route.abort();
  });
  await prepare(page);
  await saveRule(page);
  const rule = await exported(page, '导出策略 JSON');
  await selectRule(page);
  await run(page);
  const first = await exported(page);
  expect(first.record.payload.result.manifest.strategy.config.rule).toEqual(
    rule.record.rule,
  );
  expect(first.record.payload.result.fills.length).toBeGreaterThan(0);
  await page.getByRole('button', { name: '保存回测实验', exact: true }).click();
  await expect(
    page.getByText('实验已保存（事务已完成）。请另行导出JSON备份。'),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await navigate(page, '策略中心');
  await page
    .getByRole('button', { name: '打开策略 我的组合规则 v1', exact: true })
    .click();
  await group(page, '买入', 1).getByLabel('快线周期').fill('1');
  await saveRule(page);
  const next = (await exported(page, '导出策略 JSON')).record;
  expect(next.rule.revision).toBe(2);
  expect(next.ruleHash).not.toBe(rule.record.ruleHash);
  await page.reload();
  await expect(
    page.getByRole('list', { name: '规则策略版本库' }).locator('li'),
  ).toHaveCount(2);
  for (const rev of [1, 2]) {
    await page
      .getByRole('button', {
        name: `删除策略 我的组合规则 v${rev}`,
        exact: true,
      })
      .click();
    await page
      .getByRole('button', { name: '确认删除策略版本', exact: true })
      .click();
    await expect(
      page.getByRole('list', { name: '规则策略版本库' }).locator('li'),
    ).toHaveCount(2 - rev);
  }
  await page.getByLabel('导入策略 JSON（128KiB以内）').setInputFiles(rule.path);
  await expect(page.getByText('JSON已校验，仅在内存待保存。')).toBeVisible();
  await expect(page.getByTestId('rule-version')).toContainText('内存待保存');
  await saveRule(page);
  await navigate(page, '实验中心');
  await page.getByRole('button', { name: /打开实验/ }).click();
  await expect(
    page.getByText('实验校验与重算一致，已重新打开结果。'),
  ).toBeVisible();
  expect((await exported(page)).record.payload).toEqual(first.record.payload);
  await page.getByRole('button', { name: '复现本实验', exact: true }).click();
  await expect(
    page.getByText('回测成功；结果尚未保存，刷新会丢失。'),
  ).toBeVisible();
  expect((await exported(page)).record.payload).toEqual(first.record.payload);
  await navigate(page, '策略中心');
  await expect(
    page.getByText(
      '规则策略 V1 暂不支持 Phase3 网格/样本外研究，请在回测中心选择具体版本。',
    ),
  ).toBeVisible();
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test('坏JSON、版本、未知字段与不可覆盖冲突均明确失败；空规则不能保存', async ({
  page,
}) => {
  await page.goto('/#/strategies');
  await saveRule(page);
  const r = await exported(page, '导出策略 JSON');
  await page.getByLabel('导入策略 JSON（128KiB以内）').setInputFiles(r.path);
  await expect(page.getByTestId('rule-version')).toContainText('内存待保存');
  await page.getByRole('button', { name: '保存策略版本', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: '不可覆盖' }),
  ).toBeVisible();
  for (const bad of [
    '{',
    JSON.stringify({ ...r.record, schemaVersion: 2 }),
    JSON.stringify({ ...r.record, script: 'bad' }),
  ]) {
    await page.getByLabel('导入策略 JSON（128KiB以内）').setInputFiles({
      name: 'bad.json',
      mimeType: 'application/json',
      buffer: Buffer.from(bad),
    });
    await expect(
      page.getByTestId('rule-editor').getByRole('alert'),
    ).toContainText('无法导入');
  }
  await page.getByRole('button', { name: '新建规则策略', exact: true }).click();
  await group(page, '买入', 1)
    .getByRole('button', { name: '删除此条件' })
    .click();
  await expect(
    page.getByTestId('rule-editor').getByRole('alert'),
  ).toContainText('1–5');
  await expect(
    page.getByRole('button', { name: '保存策略版本', exact: true }),
  ).toBeDisabled();
});

test('迟到的JSON读取不会覆盖新编辑的草稿', async ({ page }) => {
  await page.goto('/#/strategies');
  await saveRule(page);
  const old = await exported(page, '导出策略 JSON');
  await page.evaluate(() => {
    const original = File.prototype.text;
    File.prototype.text = async function () {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return original.call(this);
    };
  });
  await page.getByLabel('导入策略 JSON（128KiB以内）').setInputFiles(old.path);
  await page.getByLabel('策略名称').fill('新草稿不被覆盖');
  await page.waitForTimeout(650);
  await expect(page.getByLabel('策略名称')).toHaveValue('新草稿不被覆盖');
  await expect(page.getByTestId('rule-version')).toContainText('v2');
});

test('50,000根、双侧各5条件真实Worker与主线程响应', async ({
  page,
  browser,
}, info) => {
  await prepare(page, 50000);
  for (const side of ['买入', '卖出']) {
    await page.getByLabel(`${side}组合方式`).selectOption('OR');
    for (let n = 1; n < 5; n++)
      await page
        .getByRole('button', { name: `添加${side}条件（${n}/5）`, exact: true })
        .click();
    await group(page, side, 2).getByLabel('均线类型').selectOption('EMA');
    await group(page, side, 3).getByLabel('条件类型').selectOption('rsi');
    await group(page, side, 3).getByLabel('指标周期').fill('3');
    await group(page, side, 4).getByLabel('条件类型').selectOption('breakout');
    await group(page, side, 4).getByLabel('突破回看N').fill('3');
    await group(page, side, 5).getByLabel('条件类型').selectOption('cross');
    await group(page, side, 5).getByLabel('均线类型').selectOption('EMA');
    if (side === '卖出') {
      for (const n of [4, 5])
        await group(page, side, n).getByLabel('触发方向').selectOption('below');
      await group(page, side, 2).getByLabel('比较符号').selectOption('lt');
      await group(page, side, 3).getByLabel('比较符号').selectOption('gte');
      await group(page, side, 3).getByLabel('RSI阈值').fill('70');
    }
  }
  await saveRule(page);
  await selectRule(page);
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
    bars: 50000,
    conditions: 10,
    elapsedMs,
    ...observation,
    cpu: cpus()[0].model,
    cores: cpus().length,
    os: platform() + ' ' + release(),
    browser: browser.version(),
    node: process.version,
    limitations:
      'synthetic; full rules/backtest/statistics/hashes/Worker transfer and all-point charts; observed timer interval, not total memory or physical Windows acceptance',
  };
  console.log('PHASE5B_PERFORMANCE ' + JSON.stringify(evidence));
  await writeFile(
    info.outputPath('phase5b-performance.json'),
    JSON.stringify(evidence, null, 2),
  );
  expect(elapsedMs).toBeLessThan(20000);
  expect(observation.maximum).toBeLessThan(1000);
  expect(observation.samples).toBeGreaterThan(5);
});
