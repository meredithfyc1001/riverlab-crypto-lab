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
import { createServer } from 'node:net';
import { request } from 'node:http';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
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
assert.equal(build.phase, 'V1.0 RC');
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
  second.child.stdin.write('\r\n');
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
  // The real Windows 0.5.1-test export must also survive the RC verification.
  const historicalPath = resolve(
    'tests/fixtures/windows-20261125/rules-v2.json',
  );
  const historical = JSON.parse(await readFile(historicalPath, 'utf8'));
  await restoreInput.setInputFiles(historicalPath);
  await preview.waitFor();
  await restorePage.getByRole('button', { name: '确认保存导入的实验' }).click();
  await restorePage
    .getByText('导入的实验已保存，可以刷新后重新打开。')
    .waitFor();
  await restorePage.reload();
  await restorePage
    .getByRole('button', { name: '打开实验 ' + historical.name, exact: true })
    .click();
  await restorePage.getByText('实验校验与重算一致，已重新打开结果。').waitFor();
  assert.deepEqual((await exportExperiment(restorePage)).record, historical);
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
    historicalRunHash: historical.payload.result.manifest.runHash,
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
      'Windows 0.5.1-test historical rule V2 export restored and compared in full',
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
  missing.child.stdin.write('\r\n');
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
  if (running) {
    running.child.stdin.write('\r\n');
    await Promise.race([running.exit, new Promise((r) => setTimeout(r, 1000))]);
    running.child.kill();
  }
}
