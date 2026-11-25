import { expect, it } from 'vitest';
import { decimal, parseDecimal, readUnits } from '../../src/core/math';
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

it('formats exact signed 18-place values before and after unrelated cached balances', () => {
  const balances = [
    [0n, '0'],
    [1n, '0.000000000000000001'],
    [-1n, '-0.000000000000000001'],
    [1234000000000000000n, '1.234'],
    [-1234000000000000000n, '-1.234'],
    [
      9007199254740993000000000000000001n,
      '9007199254740993.000000000000000001',
    ],
    [10n ** 96n - 1n, '9'.repeat(78) + '.' + '9'.repeat(18)],
    [10n ** 150n, '1' + '0'.repeat(132)],
  ] as const;
  const check = () => {
    for (const [units, expected] of balances)
      expect(decimal(units)).toBe(expected);
  };
  check();
  check();
  for (let i = 1n; i <= 5000n; i++) decimal(i);
  check();
});
