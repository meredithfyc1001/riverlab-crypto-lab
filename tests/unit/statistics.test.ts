// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { runBacktest } from '../../src/core/backtests';
import {
  calculateStatistics,
  fraction,
  YEAR_MS,
} from '../../src/core/statistics';
import {
  buy,
  sell,
  input,
  market,
  INTERVAL,
  START,
} from '../fixtures/backtest';
import reference from '../fixtures/statistics-reference.json';
const stats = (x: ReturnType<typeof input>) =>
  calculateStatistics(runBacktest(x), String(x.dataset.candles[0].open));
describe('pure fixed18 statistics / independent references', () => {
  it('independent Decimal90 reference includes fees, adverse slippage, two completed trades and an open lot', () => {
    const x = input(
      [100, 100, 120, 100, 80, 100, 110],
      [buy(0, '2'), sell(1), buy(2, '1'), sell(3), buy(4, '1')],
    );
    x.config = { feeBps: 100, buySlippageBps: 100, sellSlippageBps: 100 };
    const r = runBacktest(x),
      s = calculateStatistics(r, '100');
    for (const key of [
      'netPnl',
      'realizedPnl',
      'unrealizedPnl',
      'fees',
      'remainingCostBasis',
    ] as const)
      expect(s[key]).toBe(reference[key]);
    expect(r.final).toMatchObject({
      cash: reference.cash,
      position: { quantity: reference.quantity },
      equity: reference.equity,
    });
    expect(s.totalReturn.value).toBe(reference.totalReturn);
    expect(s.winRate.value).toBe(reference.winRate);
    expect(s.profitFactor.value).toBe(reference.profitFactor);
    expect(s.completedTrades).toHaveLength(2);
    expect(s.benchmark).toMatchObject({
      quantity: reference.benchmark.quantity,
      cash: reference.benchmark.cash,
      fee: reference.benchmark.fee,
      finalEquity: { value: reference.benchmark.finalEquity },
      return: { value: reference.benchmark.return_ },
      netPnl: { value: reference.benchmark.netPnl },
    });
  });
  it('hand reference: close equities [1000,1200,900,1200,1100,1300,1000] yields 25% max drawdown and 2 intervals recovery', () => {
    const s = stats(
      input(
        [100, 100, 90, 120, 110, 130, 100],
        [buy(0)],
        [100, 120, 90, 120, 110, 130, 100],
      ),
    );
    expect(s.curve.map((c) => c.equity)).toEqual([
      '1000',
      '1000',
      '1200',
      '900',
      '1200',
      '1100',
      '1300',
      '1000',
    ]);
    expect(s.maxDrawdown.value).toBe('0.25');
    expect(s.maxDrawdownAmount).toBe('300');
    expect(s.maxDrawdownDurationMs).toBe(2 * INTERVAL);
    expect(s.ongoingDrawdownMs).toBe(INTERVAL);
    expect(s.netPnl).toBe('0');
    expect(s.completedTrades).toEqual([]);
    expect(s.winRate.value).toBeNull();
  });
  it('initial cash anchor catches an immediate fee/slippage drawdown and open loss is not a losing trade', () => {
    const x = input([100, 100], [buy(0, '1')]);
    x.config = { feeBps: 100, buySlippageBps: 100, sellSlippageBps: 0 };
    const s = stats(x);
    expect(s.netPnl).toBe('-2.01');
    expect(s.realizedPnl).toBe('0');
    expect(s.unrealizedPnl).toBe('-2.01');
    expect(s.maxDrawdown.value).toBe('0.00201');
    expect(s.winRate).toMatchObject({ value: null, reason: '没有已完成交易' });
  });
  it('partial exits realize net basis proportionally, but do not complete the episode', () => {
    const s = stats(input([3, 3, 4], [buy(0, '3'), sell(1, '1')]));
    expect(s.realizedPnl).toBe('1');
    expect(s.remainingCostBasis).toBe('6');
    expect(s.unrealizedPnl).toBe('2');
    expect(s.netPnl).toBe('3');
    expect(s.completedTrades).toEqual([]);
  });
  it('final sell allocates all cost remainder; completed winner includes buy and sell costs', () => {
    const s = stats(input([3, 3, 4, 2], [buy(0, '3'), sell(1, '1'), sell(2)]));
    expect(s.remainingCostBasis).toBe('0');
    expect(s.unrealizedPnl).toBe('0');
    expect(s.realizedPnl).toBe('-1');
    expect(s.winRate.value).toBe('0');
    expect(s.profitFactor.value).toBe('0');
  });
  it('no completed net loss is NA, break-even remains in win-rate denominator', () => {
    const s = stats(input([100, 100, 100], [buy(0, '1'), sell(1)]));
    expect(s.winRate.value).toBe('0');
    expect(s.profitFactor.value).toBeNull();
    expect(s.profitFactor.reason).toContain('分母');
  });
  it('passive benchmark buys at first open before strategy warmup, does not charge a fictional exit', () => {
    const s = stats(input([100, 200], []));
    expect(s.benchmark.return.value).toBe('1');
    expect(s.benchmark.finalEquity.value).toBe('2000');
    expect(s.netPnl).toBe('0');
  });
  it('rejected benchmark is NA with reason, not zero return', () => {
    const x = input([100, 200]);
    x.config = {
      feeBps: 0,
      buySlippageBps: 0,
      sellSlippageBps: 0,
      minNotional: '1001',
    };
    const s = stats(x);
    expect(s.benchmark.return.value).toBeNull();
    expect(s.benchmark.return.reason).toContain('below-min-notional');
    expect(s.benchmark.finalEquity.value).toBeNull();
  });
  it('zero initial cash gives return/annual/drawdown NA, never 0%', () => {
    const x = input([100]);
    x.config = { initialCash: '0' };
    const s = stats(x);
    expect(s.totalReturn.value).toBeNull();
    expect(s.maxDrawdown.value).toBeNull();
    expect(s.annualizedReturn.value).toBeNull();
  });
  it('365 days and 252 close samples are both necessary for CAGR', () => {
    const d = market(Array.from({ length: 365 }, () => 100));
    d.parsing = { ...d.parsing, intervalMs: 86400000 };
    d.quality.intervalMs = 86400000;
    d.candles = d.candles.map((c, i) => ({
      ...c,
      timestampUtcMs: START + i * 86400000,
    }));
    d.quality.range = { startUtcMs: START, endUtcMs: START + 364 * 86400000 };
    const r = runBacktest({
      dataset: d,
      completedThroughUtcMs: START + YEAR_MS,
      signals: [],
      config: { feeBps: 0, buySlippageBps: 0, sellSlippageBps: 0 },
    });
    expect(calculateStatistics(r, '100').annualizedReturn.value).toBe(
      '0.000000000000',
    );
    const s = stats(input(Array.from({ length: 1000 }, () => 100)));
    expect(s.annualizedReturn.value).toBeNull();
    expect(s.annualizedReturn.reason).toContain('365');
  });
  it('exposure is zero when flat, open exits exclude their bar, intrabar unknown exit includes full interval', () => {
    expect(stats(input([100, 100, 100], [])).exposedMs).toBe(0);
    expect(stats(input([100, 100, 100], [buy(0), sell(1)])).exposedMs).toBe(
      INTERVAL,
    );
    const x = {
      ...input([100, 100], [buy(0)]),
      risk: { stopLossBps: 1000, takeProfitBps: 1000 },
    };
    x.dataset.candles[1] = { ...x.dataset.candles[1], high: 120, low: 80 };
    const r = runBacktest(x);
    expect(r.fills[1].timestampUtcMs).toBeNull();
    expect(calculateStatistics(r, '100').exposedMs).toBe(INTERVAL);
  });
  it.each(['empty', 'invalid', 'duplicate', 'gap', 'unconfirmed'] as const)(
    'blocks %s input before stats',
    (kind) => {
      const x = input([100, 100]);
      if (kind === 'empty') x.dataset.candles = [];
      if (kind === 'invalid')
        x.dataset.candles[0] = { ...x.dataset.candles[0], close: NaN };
      if (kind === 'duplicate')
        x.dataset.candles[1] = {
          ...x.dataset.candles[1],
          timestampUtcMs: START,
        };
      if (kind === 'gap')
        x.dataset.candles[1] = {
          ...x.dataset.candles[1],
          timestampUtcMs: START + 3 * INTERVAL,
        };
      if (kind === 'unconfirmed')
        Object.assign(x.dataset, { warningsAcknowledged: false });
      expect(() => stats(x)).toThrow();
    },
  );
  it('fraction uses truncation and exact BigInt large integers', () => {
    expect(fraction(-1n, 3n)).toBe('-0.333333333333');
    expect(fraction(10n ** 90n, 10n ** 90n)).toBe('1');
  });
  it('fractional partial basis preserves the last 1e-18 remainder exactly', () => {
    const x = input(
      [1e-18, 1e-18, 1e-18, 1e-18],
      [buy(0, '3'), sell(1, '1'), sell(2)],
    );
    x.config = {
      initialCash: '1e-17',
      feeBps: 1,
      buySlippageBps: 0,
      sellSlippageBps: 0,
      quantityDecimals: 18,
    };
    const s = stats(x);
    expect(s.realizedPnl).toBe('-0.000000000000000003');
    expect(s.netPnl).toBe(s.realizedPnl);
    expect(s.remainingCostBasis).toBe('0');
    expect(s.fees).toBe('0.000000000000000003');
  });
  it('empty snapshots cannot create any misleading statistics', () => {
    const r = runBacktest(input([100]));
    r.closes = [];
    expect(() => calculateStatistics(r, '100')).toThrow('空样本');
  });
});
