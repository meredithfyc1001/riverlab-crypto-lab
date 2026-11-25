import {
  readFile,
  readdir,
  mkdir,
  rm,
  writeFile,
  stat,
} from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { createServer } from 'node:net';
import { request } from 'node:http';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { exerciseMarketRegime } from './market-regime-browser.mjs';
import { exerciseSharedModes } from './shared-pool-browser.mjs';
const zip = resolve('work/local-package/RiverLab-Crypto-Lab-Local-Test.zip');
const target = resolve(
  `work/Windows 中文 空格测试 ${process.env.E2E_BROWSER ?? 'chromium'}`,
);
await rm(target, { force: true, recursive: true });
await mkdir(target, { recursive: true });
if (process.platform === 'win32') {
  // Windows tar can narrow Unicode argv to ANSI. Pass paths through the
  // Unicode environment block and extract with .NET's Unicode file APIs.
  execFileSync(
    'pwsh.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      [
        "$ErrorActionPreference = 'Stop'",
        '[System.IO.Compression.ZipFile]::ExtractToDirectory($env:RIVERLAB_TEST_ZIP, $env:RIVERLAB_TEST_DEST)',
        "$manifest = [System.IO.Path]::Combine($env:RIVERLAB_TEST_DEST, 'RiverLab-Crypto-Lab-Local-Test', 'SHA256SUMS.txt')",
        'if (-not [System.IO.File]::Exists($manifest)) { throw "Missing extracted manifest: $manifest" }',
      ].join('\n'),
    ],
    {
      env: {
        ...process.env,
        RIVERLAB_TEST_ZIP: zip,
        RIVERLAB_TEST_DEST: target,
      },
      stdio: 'inherit',
    },
  );
  const roots = await readdir(target);
  assert.deepEqual(
    roots,
    ['RiverLab-Crypto-Lab-Local-Test'],
    'Extracted ZIP root: ' + JSON.stringify(roots),
  );
  const entries = await readdir(join(target, roots[0]));
  assert(
    entries.includes('SHA256SUMS.txt'),
    'Missing extracted manifest; files: ' + JSON.stringify(entries),
  );
} else {
  // Windows uses a separate native ZIP extractor above.
  const data = await readFile(zip);
  let offset = 0;
  while (data.readUInt32LE(offset) === 0x04034b50) {
    const size = data.readUInt32LE(offset + 18),
      len = data.readUInt16LE(offset + 26),
      extra = data.readUInt16LE(offset + 28),
      name = data.subarray(offset + 30, offset + 30 + len).toString();
    assert(!name.includes('..'));
    const file = join(target, name);
    await mkdir(dirname(file), { recursive: true });
    const start = offset + 30 + len + extra;
    await writeFile(file, data.subarray(start, start + size));
    offset = start + size;
  }
}
const folder = join(target, 'RiverLab-Crypto-Lab-Local-Test');
const hash = (b) => createHash('sha256').update(b).digest('hex');
const zipSha256 = hash(await readFile(zip));
assert.equal(
  await readFile(zip + '.sha256', 'utf8'),
  zipSha256 + '  RiverLab-Crypto-Lab-Local-Test.zip\n',
);
const manifest = await readFile(join(folder, 'SHA256SUMS.txt'), 'utf8');
for (const row of manifest.trim().split('\n')) {
  const [expected, file] = row.split('  ');
  assert.equal(hash(await readFile(join(folder, file))), expected, file);
  assert(!/node_modules|\.env|\.git|^src\//.test(file));
}
const build = JSON.parse(
  await readFile(join(folder, 'build-info.json'), 'utf8'),
);
assert.equal(build.phase, 'Phase 5D');
assert.equal(
  build.version,
  JSON.parse(await readFile('package.json', 'utf8')).version,
);
assert.equal(
  build.commitSha,
  execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
);
if (process.env.CI) assert.equal(build.dirty, false);
const port = 4173,
  url = `http://127.0.0.1:${port}`;
function launch(extra = []) {
  const child =
    process.platform === 'win32'
      ? spawn(
          process.env.ComSpec ?? 'cmd.exe',
          [
            '/d',
            '/s',
            '/c',
            `""${join(folder, 'start-local.bat')}" --no-open ${extra.join(' ')}"`,
          ],
          {
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
            windowsVerbatimArguments: true,
          },
        )
      : spawn(
          process.execPath,
          [join(folder, 'server.mjs'), '--no-open', ...extra],
          { stdio: ['pipe', 'pipe', 'pipe'] },
        );
  let logs = '';
  child.stdout.on('data', (b) => {
    logs += b;
    process.stdout.write(b);
  });
  child.stderr.on('data', (b) => {
    logs += b;
    process.stdout.write(b);
  });
  const exit = new Promise((resolve) => {
    child.once('exit', (code) => resolve(code));
  });
  return { child, exit, logs: () => logs };
}
const pause = () => new Promise((r) => setTimeout(r, 50));
async function waitFor(predicate, description) {
  const deadline = Date.now() + 10000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timeout ${description}`);
    await pause();
  }
}
async function raw(path, method = 'GET', host = `127.0.0.1:${port}`) {
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname: '127.0.0.1', port, path, method, headers: { Host: host } },
      (res) => {
        let body = '';
        res.on('data', (b) => (body += b));
        res.on('end', () =>
          resolve({ status: res.statusCode, body, headers: res.headers }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}
async function exportExperiment(page) {
  const download = page.waitForEvent('download');
  await page
    .getByRole('button', { name: '导出实验 JSON', exact: true })
    .click();
  const path = await (await download).path();
  return { path, record: JSON.parse(await readFile(path, 'utf8')) };
}
async function downloadPortfolio(page, button) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: button, exact: true }).click();
  return (await pending).path();
}
async function checkPortfolio(page, freshPage, expectedRule) {
  // An independently generated 20-hour series shares the middle of the
  // historical BTC sample's 24-hour interval. Both must survive import.
  await page.goto(url + '/#/datasets');
  const prices = [
    8, 6, 5, 7, 8, 10, 12, 11, 9, 7, 6, 5, 9, 10, 11, 8, 6, 7, 9, 12,
  ];
  const start = Date.UTC(2024, 9, 28, 2);
  const csvRows = prices.map((p, i) =>
    [start + i * 3600000, p, p + 1, p - 1, p, 20].join(','),
  );
  await page.getByLabel('选择本地 CSV').setInputFiles({
    name: 'synthetic-portfolio-hourly.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      ['timestamp,open,high,low,close,volume', ...csvRows].join('\n'),
    ),
  });
  await page.getByText('读到 20 条数据记录。', { exact: false }).waitFor();
  await page
    .getByLabel('来源说明（自述，不认证真实性）')
    .fill('ZIP 测试人工合成行情');
  await page.getByLabel('预期固定周期（秒）').fill('3600');
  await page.getByRole('button', { name: '检查并生成导入报告' }).click();
  await page.getByLabel('币种 / 交易对（自述，不认证来源）').fill('DEMO/USDT');
  await page.getByRole('checkbox', { name: /我已阅读 .* 项警告/ }).check();
  await page
    .getByRole('button', { name: '保存已检查数据集', exact: true })
    .click();
  await page
    .getByText('已保存数据集（IndexedDB 事务已完成）。请另行备份。')
    .waitFor();

  await page.goto(url + '/#/portfolio');
  const btc = page.getByRole('group', { name: '子账户 1', exact: true });
  const demo = page.getByRole('group', { name: '子账户 2', exact: true });
  for (const [account, symbol] of [
    [btc, 'BTC/USDT'],
    [demo, 'DEMO/USDT'],
  ]) {
    const select = account.getByLabel('历史数据集');
    const id = await select
      .getByRole('option', { name: new RegExp(symbol) })
      .getAttribute('value');
    await select.selectOption(id);
  }
  await btc.getByLabel('初始分配比例 %').fill('60');
  await demo.getByLabel('初始分配比例 %').fill('40');
  await btc.getByLabel('MA 快线周期').fill('2');
  await btc.getByLabel('MA 慢线周期').fill('4');
  await demo.getByLabel('策略类型').selectOption('rules');
  await demo
    .getByRole('combobox', { name: /^规则版本/ })
    .selectOption({ index: 1 });
  await page.getByLabel('实验名称', { exact: true }).fill('Windows ZIP 双资产');
  await page.getByRole('checkbox', { name: /我确认共同区间/ }).check();
  await page.getByRole('button', { name: '运行组合回测', exact: true }).click();
  await page.getByRole('button', { name: '保存组合实验', exact: true }).click();
  const reopen = page.getByRole('button', {
    name: '重新打开 Windows ZIP 双资产',
    exact: true,
  });
  await reopen.waitFor();
  const backupPath = await downloadPortfolio(page, '导出组合 JSON');
  const record = JSON.parse(await readFile(backupPath, 'utf8'));
  assert.equal(record.input.startUtcMs, start);
  assert.equal(record.result.curve.length, prices.length + 1);
  assert.deepEqual(
    record.result.assets.map((child) => child.initialCash).sort(),
    ['400', '600'],
  );
  assert.deepEqual(
    record.input.assets.find((asset) => asset.strategy.kind === 'rules')
      .strategy.rule,
    expectedRule,
  );
  assert(record.result.fillCount > 0);
  const csv = await readFile(
    await downloadPortfolio(page, '导出汇总 CSV'),
    'utf8',
  );
  for (const expected of [record.payloadHash, 'BTC/USDT', 'DEMO/USDT'])
    assert(csv.includes(expected));
  await page.reload();
  await reopen.click();
  assert.deepEqual(
    JSON.parse(
      await readFile(await downloadPortfolio(page, '导出组合 JSON'), 'utf8'),
    ),
    record,
  );

  const clean = await freshPage();
  await clean.goto(url + '/#/portfolio');
  const openRestored = clean.getByRole('button', {
    name: '重新打开 Windows ZIP 双资产',
    exact: true,
  });
  await clean.getByLabel('导入组合 JSON').setInputFiles(backupPath);
  await clean
    .getByRole('button', { name: '保存组合实验', exact: true })
    .waitFor();
  assert.equal(await openRestored.count(), 0);
  await clean
    .getByRole('button', { name: '保存组合实验', exact: true })
    .click();
  await openRestored.waitFor();
  await clean.reload();
  await openRestored.click();
  await clean.getByRole('button', { name: '完整复现', exact: true }).click();
  await clean.getByText(/完整复现通过/).waitFor();
  const restored = JSON.parse(
    await readFile(await downloadPortfolio(clean, '导出组合 JSON'), 'utf8'),
  );
  assert.deepEqual(restored, record);
  return record.payloadHash;
}
let running, browser;
try {
  running = launch();
  await waitFor(() => running.logs().includes('READY '), 'server readiness');
  if (process.platform === 'win32') {
    const addresses = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-NetTCPConnection -LocalPort 4173 -State Listen | Select-Object -ExpandProperty LocalAddress',
      ],
      { encoding: 'utf8' },
    )
      .trim()
      .split(/\r?\n/);
    assert(
      addresses.length > 0 && addresses.every((a) => a.trim() === '127.0.0.1'),
      'Service must bind loopback only',
    );
  }
  assert.equal((await raw('/')).status, 200);
  assert.equal((await raw('/server.mjs')).status, 404);
  for (const path of [
    '/../build-info.json',
    '/%2e%2e/build-info.json',
    '/assets%5c..%5cindex.html',
    '/%252e%252e/index.html',
  ])
    assert.equal((await raw(path)).status, 403, path);
  assert.equal((await raw('/', 'POST')).status, 405);
  assert.equal((await raw('/', 'GET', 'evil.example')).status, 403);
  assert.equal((await raw('/', 'HEAD')).body, '');
  const second = launch();
  await waitFor(() => second.logs().includes('START FAILED'), 'port conflict');
  // Only the Windows BAT pauses after the server has reported startup failure.
  if (process.platform === 'win32') second.child.stdin.write('\r\n');
  assert.equal(await second.exit, 1);
  browser = await chromium.launch({
    channel:
      process.env.E2E_BROWSER === 'chromium'
        ? undefined
        : process.env.E2E_BROWSER,
    executablePath:
      process.env.E2E_BROWSER && process.env.E2E_BROWSER !== 'chromium'
        ? undefined
        : process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  });
  const external = [],
    errors = [],
    responses = [];
  async function freshPage() {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('response', (r) => {
      responses.push({ url: r.url(), status: r.status() });
    });
    await context.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.origin === url) return route.continue();
      external.push(u.href);
      return route.abort();
    });
    return page;
  }
  const page = await freshPage();
  await page.goto(url + '/#/datasets');
  await page
    .getByRole('button', { name: '真实历史样本 · BTCUSDT · 1 小时' })
    .click();
  await page.getByLabel('预期固定周期（秒）').fill('3600');
  await page.getByRole('button', { name: '检查并生成导入报告' }).click();
  await page.getByLabel('币种 / 交易对（自述，不认证来源）').fill('BTC/USDT');
  await page.getByRole('checkbox', { name: /我已阅读 .* 项警告/ }).check();
  await page
    .getByRole('button', { name: '保存已检查数据集', exact: true })
    .click();
  await page
    .getByText('已保存数据集（IndexedDB 事务已完成）。请另行备份。')
    .waitFor();
  await page
    .getByRole('navigation')
    .getByRole('link', { name: '回测中心' })
    .click();
  await page.getByLabel('回测数据集').selectOption({ index: 1 });
  await page.getByText('已读取并校验保存的数据集，请确认收盘状态。').waitFor();
  await page.getByLabel('MA 快线周期').fill('2');
  await page.getByLabel('MA 慢线周期').fill('4');
  await page.getByRole('checkbox', { name: /我确认本数据集全部 K 线/ }).check();
  await page.getByRole('button', { name: '运行回测', exact: true }).click();
  await page.getByText('回测成功；结果尚未保存，刷新会丢失。').waitFor();
  await page
    .locator('[data-testid="result-curves"][data-ready="true"]')
    .waitFor();
  await page.getByRole('button', { name: '保存回测实验', exact: true }).click();
  await page
    .getByText('实验已保存（事务已完成）。请另行导出JSON备份。')
    .waitFor();
  for (const format of ['JSON', 'CSV']) {
    const d = page.waitForEvent('download');
    await page
      .getByRole('button', {
        name: format === 'JSON' ? '导出实验 JSON' : '导出交易 CSV',
      })
      .click();
    const downloaded = await d;
    assert((await stat(await downloaded.path())).size > 0);
  }
  await page.reload();
  await page
    .getByRole('navigation')
    .getByRole('link', { name: '实验中心' })
    .click();
  await page.getByRole('button', { name: /打开实验/ }).click();
  await page.getByText('实验校验与重算一致，已重新打开结果。').waitFor();
  await page
    .getByRole('navigation')
    .getByRole('link', { name: '策略中心' })
    .click();
  await page.getByLabel('研究数据集').selectOption({ index: 1 });
  await page
    .getByRole('checkbox', {
      name: '我确认研究数据全部已收盘，已阅读质量、成本与过拟合警告',
    })
    .check();
  await page.getByRole('button', { name: '运行策略研究', exact: true }).click();
  await page.getByTestId('research-results').waitFor();
  for (const format of ['JSON', 'CSV']) {
    const download = page.waitForEvent('download');
    await page
      .getByRole('button', {
        name: format === 'JSON' ? '导出研究 JSON' : '导出比较 CSV',
      })
      .click();
    assert((await stat(await (await download).path())).size > 0);
  }
  await page
    .getByRole('navigation')
    .getByRole('link', { name: '风险中心' })
    .click();
  await page.getByLabel('源回测实验').selectOption({ index: 1 });
  await page
    .getByText('源实验校验与重算一致；请确认成本和重采样假设。')
    .waitFor();
  await page
    .getByRole('checkbox', {
      name: '我确认源成本、浮动盈亏、抽样假设和分位并非未来保证',
    })
    .check();
  await page.getByRole('button', { name: '运行风险分析', exact: true }).click();
  await page.getByTestId('risk-results').waitFor();
  await page.getByTestId('risk-plots').waitFor();
  await page.getByRole('button', { name: '保存风险报告', exact: true }).click();
  await page
    .getByText('风险报告已保存（事务已完成）。请导出JSON备份。')
    .waitFor();
  for (const format of ['JSON', 'CSV']) {
    const download = page.waitForEvent('download');
    await page
      .getByRole('button', {
        name: format === 'JSON' ? '导出风险 JSON' : '导出风险 CSV',
        exact: true,
      })
      .click();
    assert((await stat(await (await download).path())).size > 0);
  }
  await page.reload();
  await page.getByRole('button', { name: /打开风险报告/ }).click();
  await page
    .getByText('风险报告校验与源重算/重采样一致；已重新打开。')
    .waitFor();
  await page.screenshot({
    path: resolve(
      `work/local-package/package-${process.env.E2E_BROWSER ?? 'chromium'}-risk.png`,
    ),
    fullPage: true,
  });
  await page
    .getByRole('navigation')
    .getByRole('link', { name: '历史回放' })
    .click();
  await page.getByLabel('回放数据集').selectOption({ index: 1 });
  await page
    .getByRole('checkbox', {
      name: '我确认回放数据全部已收盘，已阅读质量、费用、滑点与保护假设',
    })
    .check();
  await page.getByRole('button', { name: '开始历史回放', exact: true }).click();
  await page
    .getByTestId('replay-cursor')
    .filter({ hasText: '已播放 1 /' })
    .waitFor();
  await page.getByLabel('虚拟订单数量（all或币数量）').fill('all');
  await page.getByRole('button', { name: '排队虚拟买入' }).click();
  await page.getByTestId('replay-pending').waitFor();
  await page.getByRole('button', { name: '前进一根', exact: true }).click();
  await page
    .getByRole('table', { name: '回放逐笔成交' })
    .locator('tbody tr')
    .waitFor();
  await page
    .getByLabel('当前收盘交易日记（最多2000字符）')
    .fill('Windows ZIP回放验证');
  await page.getByRole('button', { name: '加入当前日记' }).click();
  await page
    .getByRole('list', { name: '回放交易日记' })
    .getByText('Windows ZIP回放验证', { exact: false })
    .waitFor();
  await page.getByRole('button', { name: '保存回放状态', exact: true }).click();
  await page
    .getByText('回放状态已保存（事务已完成）。请另行导出JSON备份。')
    .waitFor();
  for (const format of ['JSON', 'CSV']) {
    const download = page.waitForEvent('download');
    await page
      .getByRole('button', {
        name: format === 'JSON' ? '导出回放 JSON' : '导出回放交易 CSV',
        exact: true,
      })
      .click();
    assert((await stat(await (await download).path())).size > 0);
  }
  await page.reload();
  await page.getByRole('button', { name: /打开回放/ }).click();
  await page
    .getByText('回放状态校验与重算一致；保持暂停，下一步从原游标继续。')
    .waitFor();
  await page
    .locator('[data-testid="replay-chart"][data-ready="true"]')
    .waitFor();
  await page
    .getByRole('navigation')
    .getByRole('link', { name: '策略中心', exact: true })
    .click();
  await page.getByLabel('策略名称').fill('Windows ZIP 自定义规则');
  await page.getByRole('button', { name: '保存策略版本', exact: true }).click();
  await page
    .getByTestId('rule-version')
    .filter({ hasText: '浏览器已保存' })
    .waitFor();
  const ruleDownload = page.waitForEvent('download');
  await page
    .getByRole('button', { name: '导出策略 JSON', exact: true })
    .click();
  const rulePath = await (await ruleDownload).path();
  const ruleRecord = JSON.parse(await readFile(rulePath, 'utf8'));
  assert.equal(ruleRecord.rule.schemaVersion, 1);
  await page
    .getByRole('navigation')
    .getByRole('link', { name: '回测中心', exact: true })
    .click();
  await page.getByLabel('回测数据集').selectOption({ index: 1 });
  await page.getByText('已读取并校验保存的数据集，请确认收盘状态。').waitFor();
  await page
    .getByRole('combobox', { name: '策略', exact: true })
    .selectOption('rules');
  await page.getByLabel('规则策略版本').selectOption({ index: 1 });
  await page.getByRole('checkbox', { name: /我确认本数据集全部 K 线/ }).check();
  await page.getByRole('button', { name: '运行回测', exact: true }).click();
  await page.getByText('回测成功；结果尚未保存，刷新会丢失。').waitFor();
  await page
    .locator('[data-testid="result-curves"][data-ready="true"]')
    .waitFor();
  await page.getByRole('button', { name: '保存回测实验', exact: true }).click();
  await page
    .getByText('实验已保存（事务已完成）。请另行导出JSON备份。')
    .waitFor();
  const { path: ruleExperimentPath, record: ruleExperiment } =
    await exportExperiment(page);
  assert.deepEqual(
    ruleExperiment.payload.result.manifest.strategy.config.rule,
    ruleRecord.rule,
  );
  await page.reload();
  await page
    .getByRole('navigation')
    .getByRole('link', { name: '实验中心', exact: true })
    .click();
  await page.getByRole('button', { name: /打开实验 .*rules/ }).click();
  await page.getByText('实验校验与重算一致，已重新打开结果。').waitFor();
  assert.deepEqual(
    (await exportExperiment(page)).record.payload,
    ruleExperiment.payload,
  );
  await page
    .getByRole('navigation')
    .getByRole('link', { name: '策略中心', exact: true })
    .click();
  await page.getByLabel('导入策略 JSON（128KiB以内）').setInputFiles(rulePath);
  await page.getByText('JSON已校验，仅在内存待保存。').waitFor();
  await page.screenshot({
    path: resolve(
      `work/local-package/package-${process.env.E2E_BROWSER ?? 'chromium'}-rules.png`,
    ),
    fullPage: true,
  });
  // An isolated profile has neither the source dataset nor the rule version.
  const restorePage = await freshPage();
  await restorePage.goto(url + '/#/experiments');
  const restoreInput = restorePage.getByLabel(
    '导入回测实验 JSON（最多 256 MiB）',
  );
  const preview = restorePage.getByRole('region', { name: '实验恢复预览' });
  const openRestored = restorePage.getByRole('button', { name: /打开实验/ });
  await restoreInput.setInputFiles(ruleExperimentPath);
  await preview.waitFor();
  assert.equal(await openRestored.count(), 0);
  // Refresh loses a preview. Importing the JSON again still requires confirmation.
  await restorePage.reload();
  await restoreInput.waitFor();
  assert.equal(await preview.count(), 0);
  assert.equal(await openRestored.count(), 0);
  await restoreInput.setInputFiles(ruleExperimentPath);
  await preview.waitFor();
  await restorePage.getByRole('button', { name: '确认保存导入的实验' }).click();
  await restorePage
    .getByText('导入的实验已保存，可以刷新后重新打开。')
    .waitFor();
  await restorePage.reload();
  await openRestored.click();
  await restorePage.getByText('实验校验与重算一致，已重新打开结果。').waitFor();
  const { record: restored } = await exportExperiment(restorePage);
  assert.deepEqual(restored, ruleExperiment);
  await restorePage
    .getByRole('button', { name: '复现本实验', exact: true })
    .click();
  await restorePage.getByText('回测成功；结果尚未保存，刷新会丢失。').waitFor();
  const { record: reproduced } = await exportExperiment(restorePage);
  assert.deepEqual(reproduced.payload, ruleExperiment.payload);
  const historicalRunHashes = {};
  for (const filename of ['ma-2-4', 'rules-v1', 'rules-v2']) {
    const historicalPath = resolve(
      `tests/fixtures/windows-20261125/${filename}.json`,
    );
    const historical = JSON.parse(await readFile(historicalPath, 'utf8'));
    const historicalPage = await freshPage();
    await historicalPage.goto(url + '/#/experiments');
    await historicalPage
      .getByLabel('导入回测实验 JSON（最多 256 MiB）')
      .setInputFiles(historicalPath);
    await historicalPage
      .getByRole('region', { name: '实验恢复预览' })
      .waitFor();
    await historicalPage
      .getByRole('button', { name: '确认保存导入的实验' })
      .click();
    await historicalPage
      .getByText('导入的实验已保存，可以刷新后重新打开。')
      .waitFor();
    await historicalPage.reload();
    await historicalPage
      .getByRole('button', { name: '打开实验 ' + historical.name, exact: true })
      .click();
    await historicalPage
      .getByText('实验校验与重算一致，已重新打开结果。')
      .waitFor();
    assert.deepEqual(
      (await exportExperiment(historicalPage)).record,
      historical,
    );
    await historicalPage
      .getByRole('button', { name: '复现本实验', exact: true })
      .click();
    await historicalPage
      .getByText('回测成功；结果尚未保存，刷新会丢失。')
      .waitFor();
    assert.deepEqual(
      (await exportExperiment(historicalPage)).record.payload,
      historical.payload,
    );
    historicalRunHashes[filename] = historical.payload.result.manifest.runHash;
    await historicalPage.context().close();
  }
  const portfolioHash = await checkPortfolio(page, freshPage, ruleRecord.rule);
  const frozen = gunzipSync(
    await readFile('tests/fixtures/phase-5c-a-synthetic.json.gz'),
  );
  assert.equal(
    hash(frozen),
    '4245d698561691cea2da72d91c0aa533182752ae52885f398bcfafbe1001f5a5',
  );
  const frozenPage = await freshPage();
  await frozenPage.goto(url + '/#/portfolio');
  await frozenPage.getByLabel('导入组合 JSON').setInputFiles({
    name: 'historical-5c-a.json',
    mimeType: 'application/json',
    buffer: frozen,
  });
  await frozenPage
    .getByRole('button', { name: '完整复现', exact: true })
    .click();
  await frozenPage.getByText(/完整复现通过/).waitFor();
  assert.deepEqual(
    await readFile(await downloadPortfolio(frozenPage, '导出组合 JSON')),
    frozen,
  );
  await frozenPage.context().close();
  const sharedPortfolioHashes = await exerciseSharedModes(page, freshPage, [
    'BTC/USDT',
    'DEMO/USDT',
  ]);
  const regimeHashes = {};
  for (const [kind, source, reference] of [
    ['single', ruleExperiment.name, null],
    ['portfolio', 'Windows ZIP 双资产', 'DEMO/USDT'],
    ['shared', '验包 shared-strategy', 'BTC/USDT'],
    ['shared', '验包 rebalance', 'DEMO/USDT'],
  ]) {
    regimeHashes[source] = await exerciseMarketRegime(page, freshPage, {
      kind,
      source,
      reference,
    });
  }
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  assert(
    responses
      .filter((r) => /\.(js|css|csv)$/.test(r.url))
      .every((r) => r.status === 200),
  );
  assert(responses.some((r) => r.url.includes('backtest.worker')));
  await page.screenshot({
    path: resolve(
      `work/local-package/package-${process.env.E2E_BROWSER ?? 'chromium'}.png`,
    ),
    fullPage: true,
  });
  const evidence = {
    platform: process.platform,
    node: process.version,
    browser: browser.version(),
    commitSha: build.commitSha,
    phase: build.phase,
    version: build.version,
    dirty: build.dirty,
    zipSha256,
    extractionDirectory: `Windows 中文 空格测试 ${process.env.E2E_BROWSER ?? 'chromium'}`,
    restoredRunHash: restored.payload.result.manifest.runHash,
    historicalRunHash: historicalRunHashes['rules-v2'],
    historicalRunHashes,
    portfolioHash,
    sharedPortfolioHashes,
    regimeHashes,
    externalRequests: external,
    errors,
    resources: responses,
    checks: [
      'ZIP hashes',
      process.platform === 'win32'
        ? 'BAT foreground launch'
        : 'Direct Node foreground launch; BAT not executed on Linux',
      'Chinese and space path',
      'read-only and traversal protection',
      'port conflict fails',
      'no external origins',
      'real Worker backtest and charts',
      'save reload reopen',
      'JSON CSV download',
      'strategy research batch and JSON CSV download',
      'seeded risk analysis, fan plot, snapshot reload and JSON CSV',
      'prefix replay, virtual next-open trade, journal, checkpoint reload and JSON CSV',
      'declarative rule creation, version save, Worker backtest, experiment reload/recompute and rule JSON import/export',
      'fresh profile experiment JSON preview, discard on refresh, confirmed restore, reload, full export equality and reproduced payload',
      'Windows 0.5.1-test historical MA 2/4 and rules V1, V2 exports restored and fully reproduced',
      'two-asset portfolio, confirmed 20-hour overlap, stored rule, real trades, save, JSON/CSV, reopen and fresh-profile full report equality',
      'frozen 5C-A baseline portfolio imported into a blank profile, replayed and re-exported byte-identical',
      'shared strategy pool with cash reserve, order ledger, JSON/CSV, save, fresh-profile restore and full replay',
      'periodic target-weight rebalancing, partial trades, JSON/CSV, save, fresh-profile restore and full replay',
      'market regimes on a single experiment and all three portfolio modes, explicit reference selection, net P&L conservation, JSON/CSV, fresh-profile restore and reopen',
      'Enter exits and frees port',
      'missing dist fails',
    ],
  };
  await browser.close();
  browser = null;
  running.child.stdin.write('\r\n');
  assert.equal(await running.exit, 0);
  assert(running.logs().includes('STOPPED'));
  running = null;
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', resolve);
  });
  await new Promise((resolve) => probe.close(resolve));
  await rm(join(folder, 'dist'), { recursive: true });
  const missing = launch();
  await waitFor(() => missing.logs().includes('START FAILED'), 'missing dist');
  if (process.platform === 'win32') missing.child.stdin.write('\r\n');
  assert.equal(await missing.exit, 1);
  await writeFile(
    resolve(
      `work/local-package/package-${process.env.E2E_BROWSER ?? 'chromium'}-evidence.json`,
    ),
    JSON.stringify(evidence, null, 2),
  );
  console.log('PACKAGE_VERIFIED ' + JSON.stringify(evidence));
} finally {
  await browser?.close();
  if (running && running.child.exitCode === null && !running.child.signalCode) {
    running.child.stdin.write('\r\n');
    await Promise.race([running.exit, new Promise((r) => setTimeout(r, 1000))]);
    running.child.kill();
  }
}
