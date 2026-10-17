import type { SyntheticDataset } from '../core/data';

/** 固定人工合成值，只用于展示与工程烟测，不能用于策略研究。 */
export const syntheticExample = {
  id: 'synthetic-shell-v1',
  source: 'synthetic',
  label: '人工合成数据 · DEMO/USDT',
  disclaimer: '以下为人工合成数据，不是真实行情，不代表任何资产表现。',
  candles: [
    {
      timestampUtcMs: 1767225600000,
      open: 100,
      high: 104,
      low: 99,
      close: 102,
      volume: 20,
    },
    {
      timestampUtcMs: 1767229200000,
      open: 102,
      high: 103,
      low: 98,
      close: 100,
      volume: 24,
    },
    {
      timestampUtcMs: 1767232800000,
      open: 100,
      high: 106,
      low: 100,
      close: 105,
      volume: 18,
    },
    {
      timestampUtcMs: 1767236400000,
      open: 105,
      high: 107,
      low: 102,
      close: 103,
      volume: 22,
    },
  ],
} as const satisfies SyntheticDataset;
