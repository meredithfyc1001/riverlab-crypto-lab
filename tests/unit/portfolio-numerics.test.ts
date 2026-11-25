// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { runPortfolio } from '../../src/core/portfolio';
import type { PortfolioInput } from '../../src/core/portfolio/alignment';
import { readUnits } from '../../src/core/math';
import { START, INTERVAL, market } from '../fixtures/backtest';
import reference from '../fixtures/portfolio-reference.json';

function portfolio(
  prices = reference.assets.map((a) => a.prices),
): PortfolioInput {
  return {
    quoteCurrency: 'USDT',
    initialCash: reference.initialCash,
    rangeConfirmed: true,
    startUtcMs: START,
    endUtcMs: START + (prices[0].length - 1) * INTERVAL,
    completedThroughUtcMs: START + prices[0].length * INTERVAL,
    assets: prices.map((tape, i) => {
      const a = reference.assets[i % reference.assets.length];
      const base = String.fromCharCode('A'.charCodeAt(0) + i).repeat(3);
      return {
        dataset: { ...market(tape), id: base, symbol: base + '/USDT' },
        weightPercent:
          prices.length === 2 ? a.weightPercent : String(100 / prices.length),
        strategy: { kind: 'breakout', lookback: a.lookback },
        costs: { ...a.costs },
        risk: {},
      };
    }),
  };
}

describe('Phase 5C-A independent portfolio accounting', () => {
  it('matches independent Decimal ledgers and benchmark at every aligned close, including the opening anchor', () => {
    const actual = runPortfolio(portfolio());
    expect(actual.curve).toEqual(reference.curve);
    expect(actual.netPnl).toBe(reference.netPnl);
    expect(actual.fees).toBe(reference.fees);
    expect(actual.fillCount).toBe(reference.fillCount);
    expect(actual.totalReturn).toEqual({
      value: reference.totalReturn,
      reason: null,
    });
    expect(actual.maxDrawdown).toEqual({
      value: reference.maxDrawdown,
      reason: null,
    });
    expect(actual.benchmarkReturn).toEqual({
      value: reference.benchmarkReturn,
      reason: null,
    });
    expect(actual.assets).toHaveLength(2);
    for (const [i, a] of actual.assets.entries()) {
      const expected = reference.assets[i];
      expect(a.symbol).toBe(expected.symbol);
      expect(a.initialCash).toBe(expected.initialCash);
      expect(a.weightPercent).toBe(expected.weightPercent);
      expect(a.equityWeight.value).toBe(expected.equityWeight);
      expect(a.holdingWeight.value).toBe(expected.holdingWeight);
      expect(a.fees).toBe(expected.fees);
      expect(a.netPnl).toBe(expected.netPnl);
      expect(a.result.fills.length).toBe(expected.fillCount);
      expect(a.result.closes.map((c) => c.account.equity)).toEqual(
        expected.equityCurve,
      );
    }
    expect(actual.correlations[0][1].value).toBe(reference.crossCorrelation);
    expect(actual.correlations[1][0]).toEqual(actual.correlations[0][1]);
  });

  it.each([
    { name: 'one rising asset', move: [10, 11, 12, 13, 14, 15] },
    { name: 'one falling asset', move: [15, 14, 13, 12, 11, 10] },
  ])('isolates $name from a flat independently funded account', ({ move }) => {
    const input = portfolio([move, Array(move.length).fill(10)]);
    input.initialCash = '100';
    for (const a of input.assets) {
      a.costs = {
        feeBps: 0,
        buySlippageBps: 0,
        sellSlippageBps: 0,
        minNotional: '0',
        quantityDecimals: 8,
      };
    }
    const actual = runPortfolio(input);
    expect(actual.assets[1].netPnl).toBe('0');
    expect(actual.assets[1].result.fills).toHaveLength(0);
    const rising = move[1] > move[0];
    expect(Number(actual.benchmarkReturn.value)).toBeCloseTo(
      0.4 * (move.at(-1)! / move[0] - 1),
      8,
    );
    expect(Number(actual.netPnl) > 0).toBe(rising);
    if (!rising) expect(actual.netPnl).toBe('0');
  });

  it('conserves the fixed18 ledger for five isolated accounts on the full clock', () => {
    const prices = [
      [10, 12, 11, 14, 9, 8, 10],
      [16, 11, 15, 9, 8, 7, 10],
      [3, 3, 3, 3, 3, 3, 3],
      [1, 20, 3, 40, 5, 60, 7],
      [15, 12, 10, 8, 6, 4, 2],
    ];
    const r = runPortfolio(portfolio(prices));
    expect(r.assets).toHaveLength(5);
    expect(r.correlations).toHaveLength(5);
    expect(r.correlations.every((row) => row.length === 5)).toBe(true);
    expect(
      r.assets.reduce((sum, a) => sum + readUnits(a.initialCash), 0n),
    ).toBe(readUnits(reference.initialCash));
    for (let i = 0; i < prices[0].length; i++) {
      const accounts = r.assets.map((a) => a.result.closes[i].account);
      const row = r.curve[i + 1];
      for (const field of ['cash', 'marketValue', 'equity'] as const)
        expect(accounts.reduce((sum, a) => sum + readUnits(a[field]), 0n)).toBe(
          readUnits(row[field]),
        );
      for (const a of accounts) {
        expect(readUnits(a.cash)).toBeGreaterThanOrEqual(0n);
        expect(readUnits(a.position.quantity)).toBeGreaterThanOrEqual(0n);
      }
      expect(readUnits(row.cash) + readUnits(row.marketValue)).toBe(
        readUnits(row.equity),
      );
    }
  });

  it('uses aligned market returns for positive/negative relationships and detects zero variance even with changing prices', () => {
    const r = runPortfolio(
      portfolio([
        [100, 125, 100, 125],
        [20, 25, 20, 25],
        [100, 75, 90, 67.5],
        [30, 30, 30, 30],
        [1, 2, 4, 8],
      ]),
    );
    expect(r.correlationSamples).toBe(3);
    expect(r.correlations[0][1]).toEqual({ value: '1', reason: null });
    expect(r.correlations[0][2]).toEqual({ value: '-1', reason: null });
    for (const index of [3, 4]) {
      expect(r.correlations[0][index].value).toBeNull();
      expect(r.correlations[index][index].value).toBeNull();
      expect(r.correlations[0][index].reason).toMatch(/方差/);
    }
    for (const [i, row] of r.correlations.entries())
      for (const [j, cell] of row.entries())
        expect(cell).toEqual(r.correlations[j][i]);
  });

  it('reports insufficient observations with a reason on and off the diagonal', () => {
    const r = runPortfolio(
      portfolio([
        [10, 11],
        [5, 6],
      ]),
    );
    expect(r.correlationSamples).toBe(1);
    for (const cell of r.correlations.flat()) {
      expect(cell.value).toBeNull();
      expect(cell.reason).toMatch(/样本|收益|至少/);
    }
  });

  it('starts each sleeve cold and leaves every historical prefix unchanged by extreme future prices', () => {
    const tapes = reference.assets.map((a) => [...a.prices, 1e-12, 1e10]);
    const full = runPortfolio(portfolio(tapes));
    for (let bars = 2; bars < tapes[0].length; bars++) {
      const short = runPortfolio(portfolio(tapes.map((p) => p.slice(0, bars))));
      expect(short.curve).toEqual(full.curve.slice(0, bars + 1));
      for (const [i, a] of short.assets.entries()) {
        expect(a.result.signals).toEqual(
          full.assets[i].result.signals.slice(0, bars),
        );
        expect(a.result.fills).toEqual(
          full.assets[i].result.fills.filter((f) => f.candleIndex < bars),
        );
      }
    }
    const cropped = portfolio();
    cropped.startUtcMs += INTERVAL * 4;
    const r = runPortfolio(cropped);
    for (const a of r.assets) {
      expect(a.result.signals[0].signal.action).toBe('hold');
      expect(a.result.closes[0].account.cash).toBe(a.initialCash);
    }
  });

  it('applies dual-trigger protection only within its funded sleeve', () => {
    const accountInput = portfolio();
    const protectedAsset = accountInput.assets[0];
    protectedAsset.dataset.candles[2] = {
      ...protectedAsset.dataset.candles[2],
      high: 20,
      low: 6,
    };
    const baseline = runPortfolio(accountInput);
    protectedAsset.risk = { stopLossBps: 1000, takeProfitBps: 1000 };
    const protectedRun = runPortfolio(accountInput);
    const exit = protectedRun.assets[0].result.fills.find(
      (f) => f.candleIndex === 2 && f.side === 'sell',
    );
    expect(exit?.trigger).toMatchObject({
      kind: 'stop-loss',
      phase: 'intrabar',
      assumption: 'ambiguous-stop-first',
    });
    expect(protectedRun.assets[1]).toMatchObject({
      initialCash: baseline.assets[1].initialCash,
      result: baseline.assets[1].result,
      statistics: baseline.assets[1].statistics,
    });
  });

  it('gives the entire buy-and-hold comparison an explicit NA when one entry cannot meet its minimum', () => {
    const input = portfolio();
    input.assets[1].costs.minNotional = '5000';
    const r = runPortfolio(input);
    expect(r.benchmarkReturn.value).toBeNull();
    expect(r.benchmarkReturn.reason).toBeTruthy();
    expect(r.curve.every((p) => p.benchmarkEquity === null)).toBe(true);
    expect(r.assets[0].statistics.benchmark.finalEquity.value).not.toBeNull();
  });

  it('marks both one-atom positions to zero and explains undefined terminal weights', () => {
    const input = portfolio([
      [0.5, 0.8, 1],
      [0.5, 0.8, 1],
    ]);
    input.initialCash = '0.000000000000000002';
    for (const a of input.assets) {
      a.weightPercent = '50';
      a.strategy = { kind: 'breakout', lookback: 1 };
      a.costs = {
        feeBps: 0,
        buySlippageBps: 0,
        sellSlippageBps: 0,
        quantityDecimals: 18,
        minNotional: '0',
      };
      a.dataset = {
        ...market([0.5, 0.8, 1], [0.5, 0.8, 0.5]),
        id: a.dataset.id,
        symbol: a.dataset.symbol,
      };
    }
    const r = runPortfolio(input);
    expect(r.curve.at(-1)?.equity).toBe('0');
    expect(r.totalReturn.value).toBe('-1');
    expect(r.maxDrawdown.value).toBe('1');
    for (const asset of r.assets) {
      expect(asset.returnContribution.value).toBe('-0.5');
      expect(asset.equityWeight).toEqual({
        value: null,
        reason: expect.stringContaining('权益为零'),
      });
      expect(asset.holdingWeight).toEqual(asset.equityWeight);
      expect(asset.feeShare).toEqual({
        value: null,
        reason: expect.stringContaining('手续费为零'),
      });
    }
  });

  it('reproduces every output field from a separately reconstructed input', () => {
    expect(runPortfolio(portfolio())).toEqual(
      runPortfolio(JSON.parse(JSON.stringify(portfolio()))),
    );
  });
});
