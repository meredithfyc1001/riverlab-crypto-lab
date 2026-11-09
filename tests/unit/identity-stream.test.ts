// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { canonicalJson, contentHash } from '../../src/core/backtests/identity';
describe('streaming canonical SHA-256 byte equivalence', () => {
  it.each([
    null,
    true,
    false,
    0,
    -0,
    1e-20,
    1e28,
    '汉字 中文 / 😀 \ud800 \udfff \u007f\u0080\n\t"\\',
    [],
    {},
    { z: 1, a: [null, '研究', true], b: { é: 3 } },
  ])('matches independent Node SHA of original canonical JSON %j', (value) => {
    expect(contentHash(value)).toBe(
      createHash('sha256').update(canonicalJson(value), 'ascii').digest('hex'),
    );
  });
  it('crosses 64KiB boundaries, escaped UTF16, repeated keys, and non-ASCII object keys', () => {
    const value = Array.from({ length: 3000 }, (_, i) => ({
      i,
      reason: '汉字😀',
      note: 'x'.repeat(70),
      nested: { '\u0080': i % 5 === 0 ? '\ud800' : 'é' },
    }));
    expect(contentHash(value)).toBe(
      createHash('sha256').update(canonicalJson(value), 'ascii').digest('hex'),
    );
  });
  it.each([undefined, NaN, Infinity, { a: undefined }, () => 1, new Date(0)])(
    'rejects the same non-JSON input %j',
    (value) => {
      expect(() => canonicalJson(value)).toThrow();
      expect(() => contentHash(value)).toThrow();
    },
  );
});
