import { expect, it } from 'vitest';
import { parseDecimal, readUnits } from '../../src/core/math';
it('pure price conversion remains exact across unrelated histories and rejects every invalid boundary', () => {
  for (const value of [
    '0',
    '0.000000000000000001',
    '1.234567890123456789',
    '1e-18',
    '999999999999999999999999999999',
  ]) {
    const expected = readUnits(value);
    expect(parseDecimal(value)).toBe(expected);
    for (let i = 1; i <= 5000; i++) parseDecimal(String(i));
    expect(parseDecimal(value)).toBe(expected);
  }
  for (const value of [
    '1e30',
    '0.0000000000000000001',
    'NaN',
    'Infinity',
    '-1',
    '',
    ' 1',
    1,
    null,
  ]) {
    expect(() => parseDecimal(value as string)).toThrow();
    expect(() => parseDecimal(value as string)).toThrow();
  }
});
