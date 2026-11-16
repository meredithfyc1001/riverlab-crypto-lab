import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJson, contentHash } from '../../src/core/backtests/identity';
const native = (value: unknown) =>
  createHash('sha256').update(canonicalJson(value)).digest('hex');
describe('canonical arbitrary object shapes and exact byte equivalence', () => {
  it('preserves every canonical byte for repeated ledger shapes and arbitrary insertion orders', () => {
    const value = Array.from({ length: 5000 }, (_, i) =>
      i % 2
        ? { z: i, a: '中文', cash: '1000', nested: { x: i, enabled: true } }
        : { nested: { enabled: true, x: i }, cash: '1000', a: '中文', z: i },
    );
    expect(contentHash(value)).toBe(native(value));
  });
  it('does not alias empty keys, NUL-containing keys or delimiter-like names', () => {
    const shapes = [
      {},
      { '': 1 },
      { 'a\0b': 1 },
      { a: 1, b: 2 },
      { '\0': 1 },
      { 'a\0': 1, b: 2 },
      { a: 1, '\0b': 2 },
      { '': 1, a: 2 },
      { 'a:': 2, 'a"': 3 },
    ];
    const value = [...shapes, ...shapes.slice().reverse()];
    expect(contentHash(value)).toBe(native(value));
    for (const shape of shapes) expect(contentHash(shape)).toBe(native(shape));
  });
  it('preserves more than 256 shapes, large objects, unicode and 64KiB chunk boundaries', () => {
    const value = [
      ...Array.from({ length: 300 }, (_, i) => ({ ['field' + i]: i })),
      Object.fromEntries(
        Array.from({ length: 40 }, (_, i) => [
          'field' + i,
          'é😀\n'.repeat(1000),
        ]),
      ),
    ];
    expect(contentHash(value)).toBe(native(value));
  });
});
