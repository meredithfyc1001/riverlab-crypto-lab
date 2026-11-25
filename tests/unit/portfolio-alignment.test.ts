import { describe, expect, it } from 'vitest';
import { market, START, INTERVAL } from '../fixtures/backtest';
import { fixtureDataset } from '../fixtures/dataset';
import {
  preparePortfolio,
  previewAlignment,
} from '../../src/core/portfolio/alignment';
import type { PortfolioInput } from '../../src/core/portfolio/alignment';
import { defaultRule } from '../../src/core/strategies';
import { sealRule } from '../../src/core/rule-library';
import { DEFAULT_CONFIG } from '../../src/core/backtests';
import type { Dataset } from '../../src/core/data/dataset';

function source(
  symbol: string,
  start: number,
  count: number,
  delta = INTERVAL,
): Dataset {
  const dataset = market(Array.from({ length: count }, (_, i) => 10 + i));
  const startUtcMs = START + start;
  return {
    ...dataset,
    id: symbol,
    symbol,
    parsing: { ...dataset.parsing, intervalMs: delta },
    quality: {
      ...dataset.quality,
      intervalMs: delta,
      range: { startUtcMs, endUtcMs: startUtcMs + (count - 1) * delta },
    },
    candles: dataset.candles.map((c, i) => ({
      ...c,
      timestampUtcMs: startUtcMs + i * delta,
    })),
  };
}

function base(): PortfolioInput {
  const { initialCash, ...costs } = DEFAULT_CONFIG;
  return {
    initialCash,
    quoteCurrency: 'USDT',
    rangeConfirmed: true,
    startUtcMs: START + INTERVAL,
    endUtcMs: START + 2 * INTERVAL,
    completedThroughUtcMs: START + 3 * INTERVAL,
    assets: [source('AAA/USDT', 0, 5), source('BBB/USDT', INTERVAL, 3)].map(
      (dataset) => ({
        dataset,
        costs,
        risk: {},
        weightPercent: '50',
        strategy: { kind: 'ma' },
      }),
    ),
  };
}

describe('组合来源快照与确认区间', () => {
  it('reports both source spans, intersection and each excluded UTC range', () => {
    const input = base();
    const preview = previewAlignment(
      input.assets.map((a) => a.dataset),
      input.quoteCurrency,
    );
    expect(preview).toMatchObject({
      intervalMs: INTERVAL,
      commonStartUtcMs: START + INTERVAL,
      commonEndUtcMs: START + 3 * INTERVAL,
      barCount: 3,
      totalSourceBars: 8,
    });
    const { alignment, assets } = preparePortfolio(input);
    expect(alignment).toMatchObject({
      barCount: 2,
      assets: [
        {
          symbol: 'AAA/USDT',
          beforeCount: 1,
          afterCount: 2,
          beforeRange: { startUtcMs: START, endUtcMs: START },
          afterRange: {
            startUtcMs: START + 3 * INTERVAL,
            endUtcMs: START + 4 * INTERVAL,
          },
        },
        {
          symbol: 'BBB/USDT',
          beforeCount: 0,
          afterCount: 1,
          beforeRange: null,
          afterRange: {
            startUtcMs: START + 3 * INTERVAL,
            endUtcMs: START + 3 * INTERVAL,
          },
        },
      ],
    });
    for (const a of assets) {
      expect(a.dataset.candles.map((c) => c.timestampUtcMs)).toEqual([
        input.startUtcMs,
        input.endUtcMs,
      ]);
      expect(a.dataset.quality.range).toEqual({
        startUtcMs: input.startUtcMs,
        endUtcMs: input.endUtcMs,
      });
    }
    expect(input.assets[0].dataset.candles).toHaveLength(5);
  });
  it('resolves compact symbols only from the explicitly declared quote and supports alternate quotes', () => {
    const input = base();
    input.quoteCurrency = 'eur';
    input.assets[0].dataset.symbol = 'aaaEUR';
    input.assets[1].dataset.symbol = 'bbb-eur';
    expect(
      preparePortfolio(input).alignment.assets.map((a) => a.symbol),
    ).toEqual(['AAA/EUR', 'BBB/EUR']);
  });
  it.each([
    [
      'missing confirmation',
      (i: PortfolioInput) => Object.assign(i, { rangeConfirmed: false }),
      /确认/,
    ],
    [
      'undefined endpoints',
      (i: PortfolioInput) => Object.assign(i, { endUtcMs: undefined }),
      /UTC/,
    ],
    [
      'range outside intersection',
      (i: PortfolioInput) => {
        i.startUtcMs = START;
      },
      /共同历史区间/,
    ],
    [
      'uncompleted final close',
      (i: PortfolioInput) => {
        i.completedThroughUtcMs--;
      },
      /未完成/,
    ],
    [
      'no overlap',
      (i: PortfolioInput) => {
        i.assets[1].dataset = source('BBB/USDT', 10 * INTERVAL, 2);
      },
      /没有共同/,
    ],
    [
      'shifted UTC grids',
      (i: PortfolioInput) => {
        i.assets[1].dataset = source('BBB/USDT', 1, 4);
      },
      /未严格对齐/,
    ],
    [
      'different intervals',
      (i: PortfolioInput) => {
        i.assets[1].dataset = source('BBB/USDT', 0, 4, 2 * INTERVAL);
      },
      /周期/,
    ],
    [
      'duplicate pair across aliases',
      (i: PortfolioInput) => {
        i.assets[1].dataset.symbol = 'aaausdt';
      },
      /重复/,
    ],
    [
      'different quote',
      (i: PortfolioInput) => {
        i.assets[1].dataset.symbol = 'BBB/USDC';
      },
      /报价货币/,
    ],
    [
      'self pair',
      (i: PortfolioInput) => {
        i.assets[1].dataset.symbol = 'USDT/USDT';
      },
      /格式/,
    ],
    [
      'same source ID',
      (i: PortfolioInput) => {
        i.assets[1].dataset.id = i.assets[0].dataset.id;
      },
      /重复/,
    ],
    [
      'duplicate source timestamp',
      (i: PortfolioInput) => {
        i.assets[1].dataset.candles[1] = i.assets[1].dataset.candles[0];
      },
      /重复/,
    ],
    [
      'gap in original source',
      (i: PortfolioInput) => {
        i.assets[1].dataset = fixtureDataset(true);
      },
      /缺口/,
    ],
    [
      'excess full snapshots',
      (i: PortfolioInput) => {
        i.assets[1].dataset.candles = Array(9996).fill(
          i.assets[1].dataset.candles[0],
        );
      },
      /10000/,
    ],
    [
      'extra cost field',
      (i: PortfolioInput) =>
        Object.assign(i.assets[1].costs, { initialCash: '111' }),
      /未知/,
    ],
    [
      'extra source fields',
      (i: PortfolioInput) => Object.assign(i.assets[1].dataset, { future: [] }),
      /未知/,
    ],
    [
      'extra OHLCV fields',
      (i: PortfolioInput) =>
        Object.assign(i.assets[1].dataset.candles[0], { future: [] }),
      /未知/,
    ],
  ] as const)('blocks %s', (_, change, message) => {
    const input = base();
    change(input);
    expect(() => preparePortfolio(input)).toThrow(message);
  });
  it('requires the exact saved, verified rule revision in the snapshot', () => {
    const input = base();
    const existing = sealRule(defaultRule(), {
      familyId: 'family',
      name: '规则',
      createdUtcMs: START,
    });
    const a = input.assets[1];
    a.strategy = { kind: 'rules', rule: existing.rule };
    expect(() => preparePortfolio(input)).toThrow();
    a.ruleRecord = existing;
    expect(preparePortfolio(input).assets[1].strategy).toEqual(a.strategy);
    a.strategy = { kind: 'rules', rule: { ...existing.rule, revision: 2 } };
    expect(() => preparePortfolio(input)).toThrow(/规则版本不一致/);
    a.strategy = { kind: 'ma' };
    expect(() => preparePortfolio(input)).toThrow(/内置策略/);
  });
});

describe('组合固定 18 位资金分配', () => {
  it('uses the largest remainder, with stable ASCII tie breaking even after reorder', () => {
    const input = base();
    input.initialCash = '0.000000000000000007';
    input.assets.push({
      ...input.assets[0],
      dataset: source('CCC/USDT', 0, 5),
    });
    input.assets[0].weightPercent = '25';
    input.assets[1].weightPercent = '25';
    input.assets[2].weightPercent = '50';
    // Floors [1,1,3], remaining units go to the two .75 remainders.
    expect(preparePortfolio(input).assets.map((a) => a.initialCash)).toEqual([
      '0.000000000000000002',
      '0.000000000000000002',
      '0.000000000000000003',
    ]);
    input.initialCash = '0.000000000000000006';
    // Floors [1,1,3], AAA and BBB tie for the last atomic unit.
    input.assets.reverse();
    expect(preparePortfolio(input).assets.map((a) => a.initialCash)).toEqual([
      '0.000000000000000003',
      '0.000000000000000001',
      '0.000000000000000002',
    ]);
  });
  it('rejects an unfunded account after largest remainder distribution', () => {
    const input = base();
    input.initialCash = '0.000000000000000001';
    expect(() => preparePortfolio(input)).toThrow(
      /BBB\/USDT 的分配金额取整后为零/,
    );
  });
  it('validates an exact 100 percent at full precision', () => {
    const input = base();
    input.assets[0].weightPercent = '40.000000000000000001';
    input.assets[1].weightPercent = '59.999999999999999999';
    expect(preparePortfolio(input).assets.map((a) => a.initialCash)).toEqual([
      '400.00000000000000001',
      '599.99999999999999999',
    ]);
    input.assets[0].weightPercent = '40';
    expect(() => preparePortfolio(input)).toThrow(/100%/);
  });
  it('rejects zero weight, excess precision and zero capital', () => {
    const input = base();
    input.initialCash = '0';
    expect(() => preparePortfolio(input)).toThrow(/初始本金/);
    input.initialCash = '1';
    input.assets[0].weightPercent = '0';
    input.assets[1].weightPercent = '100';
    expect(() => preparePortfolio(input)).toThrow(/权重/);
    input.assets[0].weightPercent = '0.0000000000000000001';
    expect(() => preparePortfolio(input)).toThrow(/18/);
  });
});
