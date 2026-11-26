import { readFile, writeFile, mkdir, readdir, cp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
const root = resolve('work/local-package'),
  folder = join(root, 'RiverLab-Crypto-Lab-Local-Test');
await rm(root, { recursive: true, force: true });
await mkdir(folder, { recursive: true });
await cp('dist', join(folder, 'dist'), { recursive: true });
for (const file of ['server.mjs', 'start-local.bat', 'README-local-test.md']) {
  const data = await readFile(join('scripts/local-test', file));
  await writeFile(
    join(folder, file),
    file.endsWith('.bat') ? data.toString().replace(/\r?\n/g, '\r\n') : data,
  );
}
// The user can select all acceptance inputs directly from the extracted ZIP.
const acceptance = join(folder, 'acceptance');
const fixtures = join(acceptance, 'fixtures');
const references = join(acceptance, 'reference');
await mkdir(fixtures, { recursive: true });
await mkdir(references);
await cp(
  'scripts/local-test/acceptance-library-fixture.js',
  join(acceptance, 'acceptance-library-fixture.js'),
);
for (const phase of ['5d', '5e']) {
  const name = `phase-${phase}-acceptance.md`;
  await cp(join('docs', name), join(acceptance, name));
}
for (const name of [
  'advanced_research_reference.py',
  'market_regime_reference.py',
  'portfolio_reference.py',
  'shared_pool_reference.py',
])
  await cp(join('tests/reference', name), join(references, name));
for (const name of [
  'advanced-research-reference.json',
  'market-regime-reference.json',
  'phase-5e-rolling-synthetic.csv',
  'phase-5e-breakout-rule.json',
])
  await cp(join('tests/fixtures', name), join(fixtures, name));
for (const name of ['ma-2-4', 'rules-v1', 'rules-v2'])
  await cp(
    `tests/fixtures/windows-20261125/${name}.json`,
    join(fixtures, name + '.json'),
  );
for (const name of [
  'phase-5c-a-synthetic',
  'phase-5c-b-shared-strategy',
  'phase-5c-b-rebalance',
]) {
  await writeFile(
    join(fixtures, name + '.json'),
    gunzipSync(await readFile(`tests/fixtures/${name}.json.gz`)),
  );
}
const regime = JSON.parse(
  await readFile(join(fixtures, 'market-regime-reference.json'), 'utf8'),
).single;
const header = 'timestamp,open,high,low,close,volume';
const candleRow = (i, open, close) =>
  [
    1735689600000 + i * 60000,
    open,
    Math.max(open, close),
    Math.min(open, close),
    close,
    1,
  ].join(',');
await writeFile(
  join(fixtures, 'phase-5d-regime-synthetic.csv'),
  [
    header,
    ...regime.prices.map((close, i) => candleRow(i, regime.opens[i], close)),
  ].join('\n') + '\n',
);
for (const [name, bars, shift] of [
  ['single-50000', 50000, 0],
  ['alpha-5000', 5000, 0],
  ['beta-5000', 5000, 3],
]) {
  const rows = Array.from({ length: bars }, (_, i) => {
    const price = 100 + Math.abs(((i + shift) % 12) - 6);
    return candleRow(i, price, price);
  });
  await writeFile(
    join(fixtures, 'synthetic-' + name + '.csv'),
    [header, ...rows].join('\n') + '\n',
  );
}
const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim();
const dirty = Boolean(
  execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
);
if (process.env.CI && dirty)
  throw new Error('CI package must be built from a clean commit.');
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const phase = 'Phase 5E';
await writeFile(
  join(folder, 'build-info.json'),
  JSON.stringify(
    {
      product: 'RiverLab Crypto Lab',
      phase,
      version: pkg.version,
      commitSha: sha,
      dirty,
      node: process.version,
      builtUtc: new Date().toISOString(),
      disclaimer: '仅供学习研究，历史表现不代表未来表现',
    },
    null,
    2,
  ) + '\n',
);
async function files(dir, prefix = '') {
  let out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory())
      out.push(...(await files(join(dir, e.name), prefix + e.name + '/')));
    else if (e.isFile()) out.push(prefix + e.name);
    else throw new Error('Package cannot contain symlinks.');
  }
  return out.sort();
}
const hash = (b) => createHash('sha256').update(b).digest('hex');
const list = await files(folder);
await writeFile(
  join(folder, 'SHA256SUMS.txt'),
  (
    await Promise.all(
      list.map(async (f) => `${hash(await readFile(join(folder, f)))}  ${f}`),
    )
  ).join('\n') + '\n',
);
// Minimal ZIP32, stored bytes, UTF-8 names; no runtime/dependencies needed to build it.
function crc32(b) {
  let c = 0xffffffff;
  for (const v of b) {
    c ^= v;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
let offset = 0;
const local = [],
  central = [];
for (const file of await files(folder)) {
  const name = Buffer.from('RiverLab-Crypto-Lab-Local-Test/' + file),
    data = await readFile(join(folder, file)),
    crc = crc32(data);
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50);
  h.writeUInt16LE(20, 4);
  h.writeUInt16LE(0x800, 6);
  h.writeUInt16LE(33, 12);
  h.writeUInt32LE(crc, 14);
  h.writeUInt32LE(data.length, 18);
  h.writeUInt32LE(data.length, 22);
  h.writeUInt16LE(name.length, 26);
  local.push(h, name, data);
  const c = Buffer.alloc(46);
  c.writeUInt32LE(0x02014b50);
  c.writeUInt16LE(20, 4);
  c.writeUInt16LE(20, 6);
  c.writeUInt16LE(0x800, 8);
  c.writeUInt16LE(33, 14);
  c.writeUInt32LE(crc, 16);
  c.writeUInt32LE(data.length, 20);
  c.writeUInt32LE(data.length, 24);
  c.writeUInt16LE(name.length, 28);
  c.writeUInt32LE(offset, 42);
  central.push(c, name);
  offset += h.length + name.length + data.length;
}
const centralBuffer = Buffer.concat(central),
  end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50);
end.writeUInt16LE(central.length / 2, 8);
end.writeUInt16LE(central.length / 2, 10);
end.writeUInt32LE(centralBuffer.length, 12);
end.writeUInt32LE(offset, 16);
const zip = Buffer.concat([...local, centralBuffer, end]),
  zipName = 'RiverLab-Crypto-Lab-Local-Test.zip';
await writeFile(join(root, zipName), zip);
await writeFile(join(root, zipName + '.sha256'), `${hash(zip)}  ${zipName}\n`);
console.log(
  JSON.stringify({
    path: join(root, zipName),
    bytes: zip.length,
    sha256: hash(zip),
    commitSha: sha,
    phase,
    version: pkg.version,
    dirty,
  }),
);
