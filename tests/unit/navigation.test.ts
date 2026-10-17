import { describe, expect, it } from 'vitest';
import { pageFromHash } from '../../src/app/navigation';

describe('离线静态导航', () => {
  it.each([
    ['#/datasets', 'datasets'],
    ['#/risk', 'risk'],
    ['', 'overview'],
    ['#/missing-page', 'overview'],
    ['#/%E0%A4%A', 'overview'],
  ])('将 %s 安全解析为 %s', (hash, expected) => {
    expect(pageFromHash(hash)).toBe(expected);
  });
});
