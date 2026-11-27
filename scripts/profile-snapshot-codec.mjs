// Exercise the browser codec at the real UTF-8 limit without a whole-file buffer.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';

const vite = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
});
try {
  const { encodeSnapshotValue } = await vite.ssrLoadModule(
    '/src/infrastructure/snapshot-value.ts',
  );
  const projectionLimit = 256 * 1024 * 1024;
  const prefix = '{"id":"capacity","padding":"';
  const suffix = '"}';
  const count = projectionLimit - Buffer.byteLength(prefix + suffix);
  const value = { id: 'capacity', padding: ' '.repeat(count) };
  const expected = createHash('sha256').update(prefix);
  const spaces = Buffer.alloc(64 * 1024, 32);
  for (let remaining = count; remaining > 0; remaining -= spaces.length)
    expected.update(spaces.subarray(0, Math.min(remaining, spaces.length)));
  const expectedSha = expected.update(suffix).digest('hex');
  let projectionBytes = 0;
  let chunks = 0;
  const actual = await encodeSnapshotValue(
    'experiment',
    'body',
    value,
    async (tag, bytes) => {
      if (tag === 3) {
        projectionBytes += bytes.byteLength;
        chunks++;
        assert(bytes.byteLength <= 1024 * 1024);
      }
    },
  );
  assert.equal(projectionBytes, projectionLimit);
  assert.equal(actual.projectionBytes, projectionLimit);
  assert.equal(actual.projectionSha256, expectedSha);
  value.padding += ' ';
  await assert.rejects(
    encodeSnapshotValue('experiment', 'body', value),
    /容量限制/,
  );
  // Arbitrary nested fields exercise the format independently of business schemas.
  let nested = 'synthetic';
  for (let level = 0; level < 63; level++) nested = { next: nested };
  const depth64 = await encodeSnapshotValue('experiment', 'body', {
    id: 'depth',
    nested,
  });
  await assert.rejects(
    encodeSnapshotValue('experiment', 'body', {
      id: 'depth',
      nested: { next: nested },
    }),
    /超过 64/,
  );
  console.log(
    JSON.stringify({
      check: 'synthetic codec byte boundary',
      projectionBytes,
      chunks,
      projectionSha256: expectedSha,
      extraByteRejected: true,
      depth64ProjectionSha256: depth64.projectionSha256,
      depth65Rejected: true,
      node: process.version,
      peakRssKiB: process.resourceUsage().maxRSS,
    }),
  );
} finally {
  await vite.close();
}
