// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { runExperiment, sealExperiment } from '../../src/core/experiments';
import {
  analyzeRegimes,
  classifyRegimes,
} from '../../src/core/market-regime/model';
import { captureSource } from '../../src/core/market-regime/source';
import { createSharedPoolExperiment } from '../../src/core/shared-pool/report';
import { INTERVAL, START, market } from '../fixtures/backtest';
import reference from '../fixtures/market-regime-reference.json';
import sharedPaths from '../fixtures/shared-pool-reference.json';

const metadata = {
  id: 'synthetic-oracle',
  name: '人工数值参考',
  createdUtcMs: START,
};

describe('independent Decimal market labels and lagged ledger attribution', () => {
  it.each(reference.classification)(
    '$name, with immutable prefixes',
    (test) => {
      const candles = test.closes.map((close, i) => ({
        timestampUtcMs: START + i * INTERVAL,
        close: Number(close),
      }));
      const params = {
        lookback: test.lookback,
        thresholdBps: test.thresholdBps,
      };
      for (let count = 1; count <= candles.length; count++) {
        expect(
          classifyRegimes(
            candles.slice(0, count),
            INTERVAL,
            START + count * INTERVAL,
            params,
          ),
        ).toEqual(test.expected.slice(0, count));
      }
    },
  );

  it('rejects the discontinuous reference tape without bridging the missing minute', () => {
    const candles = reference.invalidAxis.map((timestampUtcMs, i) => ({
      timestampUtcMs,
      close: i + 5,
    }));
    expect(() =>
      classifyRegimes(candles, INTERVAL, START + 4 * INTERVAL, {
        lookback: 1,
        thresholdBps: 100,
      }),
    ).toThrow();
  });

  it('matches the independent single-asset ledger and all effective period statistics', () => {
    const { prices, opens, initialCash, costs, params, bars, result } =
      reference.single;
    const end = START + prices.length * INTERVAL;
    const original = sealExperiment(
      runExperiment({
        dataset: market(opens, prices),
        completedThroughUtcMs: end,
        strategy: { kind: 'breakout', lookback: 1 },
        config: { ...costs, initialCash },
      }),
      { ...metadata, elapsedMs: 0 },
    );
    const { series } = captureSource('single', original, null, end);
    expect(series.bars).toEqual(bars);
    expect(analyzeRegimes(series, params)).toEqual(result);
  });

  it('attributes one partial-sale portfolio to either explicitly chosen asset', () => {
    const oracle = reference.shared;
    const { spec } = sharedPaths.find((p) => p.spec.name === oracle.scenario)!;
    const end = START + spec.assets[0].bars.length * INTERVAL;
    // Every bar of the selected independent rebalance tape has equal OHLC.
    const assets = spec.assets.map((a) => {
      expect(a.bars.every((row) => row.every((p) => p === row[0]))).toBe(true);
      const prices = a.bars.map((row) => Number(row[3]));
      return {
        dataset: { ...market(prices), id: a.symbol, symbol: a.symbol },
        costs: a.costs,
        weightPercent: a.weightPercent,
      };
    });
    const record = createSharedPoolExperiment(
      {
        mode: 'rebalance',
        assets,
        initialCash: spec.initialCash,
        cashWeightPercent: spec.cashWeightPercent,
        quoteCurrency: 'USDT',
        startUtcMs: START,
        endUtcMs: end - INTERVAL,
        completedThroughUtcMs: end,
        rebalanceEvery: spec.rebalanceEvery,
        rangeConfirmed: true,
      },
      metadata,
      end,
    );
    for (const { symbol, result } of oracle.references) {
      const { series } = captureSource('shared', record, symbol, end);
      expect(series.bars).toEqual(oracle.bars);
      expect(analyzeRegimes(series, oracle.params)).toEqual(result);
    }
    expect(oracle.references[0].result.labels).not.toEqual(
      oracle.references[1].result.labels,
    );
  });
});
