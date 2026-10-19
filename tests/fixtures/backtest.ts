import { createHash } from 'node:crypto';
import { analyzeCsv } from '../../src/core/data';
import { makeDataset } from '../../src/core/data/dataset';
import type { BacktestInput, Signal } from '../../src/core/backtests';
import { options } from './dataset';

export const START = 1735689600000;
export const INTERVAL = 60000;
/** All prices are artificial algorithm examples, never historical market data. */
export function market(
  opens: readonly number[],
  closes: readonly number[] = opens,
) {
  const csv =
    'timestamp,open,high,low,close,volume\n' +
    opens
      .map(
        (p, i) =>
          `${START + i * INTERVAL},${p},${Math.max(p, closes[i])},${Math.min(p, closes[i])},${closes[i]},1`,
      )
      .join('\n');
  return makeDataset(
    {
      id: 'backtest-fixture',
      name: '人工合成算法样本',
      symbol: 'SYNTHETIC/USDT',
      createdUtcMs: START,
      source: {
        kind: 'synthetic',
        label: '人工合成',
        note: '固定算法案例，非真实行情',
      },
      file: {
        name: 'synthetic.csv',
        bytes: Buffer.byteLength(csv),
        sha256: createHash('sha256').update(csv).digest('hex'),
        parserVersion: 'csv-v1',
      },
      parsing: options,
      warningsAcknowledged: true,
    },
    analyzeCsv(csv, options),
  );
}
export function input(
  opens: readonly number[],
  signals: readonly Signal[] = [],
  closes?: readonly number[],
): BacktestInput {
  return {
    dataset: market(opens, closes),
    completedThroughUtcMs: START + opens.length * INTERVAL,
    signals,
    config: { feeBps: 0, buySlippageBps: 0, sellSlippageBps: 0 },
  };
}
export const buy = (candleIndex: number, quantity = 'all'): Signal => ({
  candleIndex,
  action: 'buy',
  quantity,
  reason: 'fixed-buy',
});
export const sell = (candleIndex: number, quantity = 'all'): Signal => ({
  candleIndex,
  action: 'sell',
  quantity,
  reason: 'fixed-sell',
});
