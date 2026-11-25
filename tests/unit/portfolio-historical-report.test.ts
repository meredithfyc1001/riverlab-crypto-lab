// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { runPortfolio } from '../../src/core/portfolio';
import {
  exportPortfolioFile,
  readPortfolioFile,
} from '../../src/infrastructure/portfolio-file';

it('restores the exact full fixed-account export produced by the merged 5C-A engine', async () => {
  // Exported once using fd4de40c32623eab3eb16555fc0df723d6e22357 and
  // public synthetic prices. Gzip preserves the original compact JSON bytes.
  const original = gunzipSync(
    readFileSync('tests/fixtures/phase-5c-a-synthetic.json.gz'),
  );
  expect(createHash('sha256').update(original).digest('hex')).toBe(
    '4245d698561691cea2da72d91c0aa533182752ae52885f398bcfafbe1001f5a5',
  );
  const json = original.toString('utf8');
  const observedUtcMs = 1735689600000 + 7 * 60000;
  const verified = await readPortfolioFile(new Blob([json]), observedUtcMs);
  expect(verified.payloadHash).toBe(
    'c2f5f47eec70cb0f6e2e24bc82b040690c3267cb67f0c707664df501f8a91de3',
  );
  expect(verified.recordHash).toBe(
    '61c82bbfe271f5e670a8fea168c40fb268ede26bc602f8048ed43cf78fe6c7db',
  );
  expect(verified.result).toEqual(runPortfolio(verified.input));
  expect(
    await exportPortfolioFile(verified, 'json', observedUtcMs).text(),
  ).toBe(json);
});
