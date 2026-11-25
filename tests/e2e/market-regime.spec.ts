import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { exerciseMarketRegime } from '../../scripts/market-regime-browser.mjs';

// The RC sample at N=2 / 5 bps contains all four attribution states.
// Sample a strip above the candles and compare its pixels to the legend
// blended over the pane. An empty chart background still has a visible canvas.
async function expectRenderedStateBands(page: Page) {
  const layer = page
    .getByRole('img', { name: /上一收盘市场状态/ })
    .locator('canvas')
    .first();
  await expect
    .poll(() =>
      layer.evaluate((canvas: HTMLCanvasElement) => {
        const pane = canvas.closest('.panel')!;
        const channels = (color: string) => color.match(/\d+/g)!.map(Number);
        const background = channels(getComputedStyle(pane).backgroundColor);
        const expected = Array.from(
          pane.querySelectorAll('.regime-legend i'),
          (swatch) => {
            const rgb = channels(getComputedStyle(swatch).backgroundColor);
            return rgb.map(
              (v, i) => background[i] + ((v - background[i]) * 56) / 255,
            );
          },
        );
        if (!canvas.width || canvas.height < 4) return 0;
        const pixels = canvas
          .getContext('2d')!
          .getImageData(0, 3, canvas.width, 1).data;
        return expected.filter((rgb) => {
          let matches = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            if (rgb.every((v, c) => Math.abs(pixels[i + c] - v) <= 3))
              matches++;
          }
          return matches >= 3;
        }).length;
      }),
    )
    .toBe(4);
}

test('历史单币实验的归因、窄屏、主题、保存和空配置恢复', async ({
  page,
  browser,
  baseURL,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/experiments');
  const path = 'tests/fixtures/windows-20261125/ma-2-4.json';
  const source = JSON.parse(await readFile(path, 'utf8'));
  await page
    .getByLabel('导入回测实验 JSON（最多 256 MiB）')
    .setInputFiles(path);
  await page.getByRole('button', { name: '确认保存导入的实验' }).click();
  await expect(
    page.getByText('导入的实验已保存，可以刷新后重新打开。'),
  ).toBeVisible();
  const hash = await exerciseMarketRegime(
    page,
    () => browser.newPage({ baseURL }),
    {
      kind: 'single',
      source: source.name,
      reference: null,
      expectedNetPnl: source.payload.statistics.netPnl,
    },
  );
  await expect(page.getByTestId('regime-report-hash')).toContainText(hash);
  await expectRenderedStateBands(page);
  await page.getByRole('button', { name: '切换为浅色主题' }).click();
  await expectRenderedStateBands(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(
    page
      .getByRole('img', { name: /上一收盘市场状态/ })
      .locator('canvas')
      .first(),
  ).toBeVisible();
  await expect(page.getByText(/收盘新标签/)).toContainText('UNKNOWN');
  await expect(
    page
      .getByRole('region', { name: '连续市场状态区间明细' })
      .getByRole('table'),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: '逐根收益分布' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test('固定子账户实验在用户选择参考资产后按共同时间轴归因', async ({
  page,
  browser,
  baseURL,
}) => {
  const frozen = gunzipSync(
    await readFile('tests/fixtures/phase-5c-a-synthetic.json.gz'),
  );
  const report = JSON.parse(frozen.toString());
  await page.goto('/#/portfolio');
  await page.getByLabel('导入组合 JSON').setInputFiles({
    name: 'portfolio.json',
    mimeType: 'application/json',
    buffer: frozen,
  });
  await page.getByRole('button', { name: '保存组合实验', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '重新打开 ' + report.name, exact: true }),
  ).toBeVisible();
  const hash = await exerciseMarketRegime(
    page,
    () => browser.newPage({ baseURL }),
    {
      kind: 'portfolio',
      source: report.name,
      reference: report.input.assets[1].dataset.symbol,
      expectedNetPnl: report.result.netPnl,
    },
  );
  await expect(page.getByTestId('regime-report-hash')).toContainText(hash);
});

for (const mode of ['shared-strategy', 'rebalance']) {
  test(
    '5C-B 冻结报告恢复、原格式复现与市场状态归因 · ' + mode,
    async ({ page, browser, baseURL }) => {
      const original = gunzipSync(
        await readFile('tests/fixtures/phase-5c-b-' + mode + '.json.gz'),
      );
      const record = JSON.parse(original.toString());
      await page.goto('/#/portfolio');
      await page.getByLabel('运行模式').selectOption(mode);
      await page.getByLabel('导入组合 JSON').setInputFiles({
        name: 'original.json',
        mimeType: 'application/json',
        buffer: original,
      });
      await page.getByRole('button', { name: '完整复现', exact: true }).click();
      await expect(page.getByText(/完整复现通过/)).toBeVisible();
      const pending = page.waitForEvent('download');
      await page
        .getByRole('button', { name: '导出组合 JSON', exact: true })
        .click();
      const file = await pending;
      expect(JSON.parse(await readFile((await file.path())!, 'utf8'))).toEqual(
        record,
      );
      await page
        .getByRole('button', { name: '保存组合实验', exact: true })
        .click();
      await expect(
        page.getByRole('button', {
          name: '重新打开 ' + record.name,
          exact: true,
        }),
      ).toBeVisible();
      await exerciseMarketRegime(page, () => browser.newPage({ baseURL }), {
        kind: 'shared',
        source: record.name,
        reference: record.input.assets[1].dataset.symbol,
        expectedNetPnl: record.result.netPnl,
      });
    },
  );
}
