import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const button = (page, name) => page.getByRole('button', { name, exact: true });

async function download(page, name) {
  const pending = page.waitForEvent('download');
  await button(page, name).click();
  const downloaded = await pending;
  assert.equal(await downloaded.failure(), null);
  return await downloaded.path();
}

export async function selectSharedAssets(page, mode, symbols) {
  await page
    .getByRole('combobox', { name: '运行模式', exact: true })
    .selectOption(mode);
  for (const [i, symbol] of symbols.entries()) {
    const group = page.getByRole('group', {
      name: '资产 ' + (i + 1),
      exact: true,
    });
    const select = group.getByLabel('历史数据集', { exact: true });
    const id = await select
      .locator('option')
      .filter({ hasText: symbol })
      .getAttribute('value');
    await select.selectOption(id);
    const strategy = mode === 'shared-strategy';
    await group
      .getByLabel(strategy ? '目标预算比例 %' : '目标权重 %', { exact: true })
      .fill('40');
    if (strategy) {
      await group.getByLabel('MA 快线周期').fill('2');
      await group.getByLabel('MA 慢线周期').fill('4');
    }
  }
  if (mode === 'rebalance') {
    await page.getByLabel('目标现金权重 %', { exact: true }).fill('20');
    await page
      .getByLabel('再平衡周期（已完成 K 线数）', { exact: true })
      .fill('1');
    assert.equal(await page.getByLabel('策略类型', { exact: true }).count(), 0);
  }
}

// Applied to both the production preview and the extracted Windows package.
export async function exerciseSharedModes(page, freshPage, symbols) {
  const portfolioUrl = new URL('/#/portfolio', page.url()).href;
  const hashes = {};
  let intervalMs;
  for (const mode of ['shared-strategy', 'rebalance']) {
    await page.goto(portfolioUrl);
    await selectSharedAssets(page, mode, symbols);
    let endUtcMs;
    if (mode === 'rebalance') {
      const end = page.getByLabel('末根开盘时间（UTC 毫秒）', { exact: true });
      endUtcMs = Number(await end.inputValue()) - intervalMs;
      await end.fill(String(endUtcMs));
    }
    const name = '验包 ' + mode;
    await page.getByLabel('实验名称', { exact: true }).fill(name);
    await page.getByRole('checkbox', { name: /我确认共同区间/ }).check();
    await button(page, '运行组合回测').click();
    await button(page, '保存组合实验').click();
    await button(page, '重新打开 ' + name).waitFor();

    const backupPath = await download(page, '导出组合 JSON');
    const report = JSON.parse(await readFile(backupPath, 'utf8'));
    intervalMs = report.result.alignment.intervalMs;
    assert.equal(report.input.mode, mode);
    for (const [view, title] of [
      ['equity', '组合净值与买入持有曲线'],
      ['drawdown', '组合回撤曲线'],
      ['weights', '资产与现金权重曲线'],
      ['contributions', '资产净盈亏贡献曲线'],
    ]) {
      await page
        .getByRole('combobox', { name: '显示曲线', exact: true })
        .selectOption(view);
      await page
        .getByRole('img', { name: title })
        .locator('canvas')
        .first()
        .waitFor();
    }
    if (endUtcMs !== undefined) {
      assert.equal(report.input.endUtcMs, endUtcMs);
      assert.equal(
        report.result.curve.at(-1).timestampUtcMs,
        endUtcMs + intervalMs,
      );
      assert.ok(report.result.alignment.assets.every((a) => a.afterCount > 0));
      assert.ok(
        report.input.assets.every(
          (a) => a.dataset.candles.at(-1).timestampUtcMs > endUtcMs,
        ),
      );
      assert.ok(report.result.orders.every((o) => o.barOpenUtcMs <= endUtcMs));
    }
    assert.equal(report.result.cashWeightPercent, '20');
    assert.equal(report.input.assets.length, 2);
    assert.ok(report.result.fillCount > 0);
    assert.equal(
      report.result.orders.filter((o) => o.status === 'filled').length,
      report.result.fillCount,
    );
    assert.ok(report.result.curve.length >= 4);
    assert.equal(
      report.result.curve.length,
      report.result.alignment.barCount + 1,
    );
    const csv = await readFile(await download(page, '导出明细 CSV'), 'utf8');
    for (const symbol of symbols) assert.ok(csv.includes(symbol));
    if (mode === 'rebalance') {
      assert.equal(
        report.result.rebalances.length,
        report.result.alignment.barCount - 1,
      );
      assert.ok(
        report.result.orders.some(
          (o) =>
            o.side === 'sell' &&
            o.status === 'filled' &&
            o.quantityAfter !== '0',
        ),
      );
    }

    const clean = await freshPage();
    await clean.goto(portfolioUrl);
    await clean
      .getByRole('combobox', { name: '运行模式', exact: true })
      .selectOption(mode);
    const reopen = button(clean, '重新打开 ' + name);
    assert.equal(await reopen.count(), 0);
    await clean.getByLabel(/导入组合 JSON/).setInputFiles(backupPath);
    await button(clean, '保存组合实验').click();
    await reopen.waitFor();
    await clean.reload();
    await clean
      .getByRole('combobox', { name: '运行模式', exact: true })
      .selectOption(mode);
    await reopen.click();
    await button(clean, '完整复现').click();
    const verified = JSON.parse(
      await readFile(await download(clean, '导出组合 JSON'), 'utf8'),
    );
    assert.deepEqual(verified, report);
    await clean.getByLabel(/导入组合 JSON/).setInputFiles({
      name: 'unsupported.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ ...report, schemaVersion: 999 })),
    });
    await clean
      .getByRole('alert')
      .filter({ hasText: /版本|格式/ })
      .waitFor();
    await reopen.click();
    assert.deepEqual(
      JSON.parse(
        await readFile(await download(clean, '导出组合 JSON'), 'utf8'),
      ),
      report,
    );
    hashes[mode] = report.payloadHash;
  }
  return hashes;
}
