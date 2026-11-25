// @vitest-environment node
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { Experiment } from '../../src/core/experiments';
import { analyzeRegimes } from '../../src/core/market-regime/model';
import {
  captureSource,
  replaySource,
} from '../../src/core/market-regime/source';
import { decimal, readUnits } from '../../src/core/math';
import type { PortfolioExperiment } from '../../src/core/portfolio/report';
import type { SharedPoolExperiment } from '../../src/core/shared-pool/report';

function windowsSingle(file: string): Experiment {
  return JSON.parse(
    readFileSync('tests/fixtures/windows-20261125/' + file, 'utf8'),
  );
}
function frozenPortfolio(
  file: string,
): PortfolioExperiment | SharedPoolExperiment {
  return JSON.parse(
    gunzipSync(readFileSync('tests/fixtures/' + file)).toString('utf8'),
  );
}
const params = { lookback: 1, thresholdBps: 100 };

describe('source identity and chronological account attribution', () => {
  it.each(['ma-2-4.json', 'rules-v1.json', 'rules-v2.json'])(
    'rebuilds the original RC source and its marks from %s without a local dataset or result',
    (file) => {
      const original = windowsSingle(file);
      const { result, statistics } = original.payload;
      const now = result.manifest.completedThroughUtcMs;
      const captured = captureSource('single', original, null, now);
      const snapshot = JSON.parse(JSON.stringify(captured.source));
      expect(snapshot.input).not.toHaveProperty('result');
      const { source, series } = replaySource(snapshot, null, now);
      expect(source).toEqual(captured.source);
      expect(series.bars.map((b) => b.equity)).toEqual(
        result.closes.map((c) => c.account.equity),
      );
      expect(series.bars.reduce((n, b) => n + b.fills, 0)).toBe(
        result.fills.length,
      );
      expect(
        decimal(series.bars.reduce((n, b) => n + readUnits(b.fees), 0n)),
      ).toBe(statistics.fees);
      expect(
        series.bars.filter((b) => b.exposed).length * series.intervalMs,
      ).toBe(statistics.exposedMs);
      expect(analyzeRegimes(series, params).netPnl).toBe(statistics.netPnl);
    },
  );

  it.each([
    'phase-5c-a-synthetic.json.gz',
    'phase-5c-b-shared-strategy.json.gz',
    'phase-5c-b-rebalance.json.gz',
  ])(
    'uses either original asset in the common UTC range with identical portfolio marks from %s',
    (file) => {
      const original = frozenPortfolio(file),
        input = original.input;
      const kind = original.schemaVersion === 1 ? 'portfolio' : 'shared';
      const now = input.completedThroughUtcMs;
      const originalCurve = original.result.curve.slice(1).map((p) => p.equity);
      const holdings = input.assets.map((a) => a.dataset.symbol);
      const view = holdings.map((ref) =>
        captureSource(kind, original, ref, now),
      );
      for (const [i, { series, source, candles }] of view.entries()) {
        expect(candles).toEqual(
          input.assets[i].dataset.candles.filter(
            (c) =>
              c.timestampUtcMs >= input.startUtcMs &&
              c.timestampUtcMs <= input.endUtcMs,
          ),
        );
        expect(series.bars.map((b) => b.equity)).toEqual(originalCurve);
        expect(series.bars.reduce((n, b) => n + b.fills, 0)).toBe(
          original.result.fillCount,
        );
        expect(
          decimal(series.bars.reduce((n, b) => n + readUnits(b.fees), 0n)),
        ).toBe(original.result.fees);
        expect(analyzeRegimes(series, params).netPnl).toBe(
          original.result.netPnl,
        );
        expect(
          replaySource(JSON.parse(JSON.stringify(source)), holdings[i], now)
            .series,
        ).toEqual(series);
      }
      expect(view[0].series.bars).toEqual(view[1].series.bars);
      for (const ref of [null, 'NOT-IN-PORTFOLIO'])
        expect(() => captureSource(kind, original, ref, now)).toThrow(
          '参考资产',
        );
    },
  );

  it('rejects a source whose result is altered and a compact snapshot with a subsequent algorithm or inconsistent cash', () => {
    const original = windowsSingle('ma-2-4.json');
    const now = original.payload.result.manifest.completedThroughUtcMs;
    const { source } = captureSource('single', original, null, now);
    if (source.kind !== 'single') throw new Error('Unexpected source');
    expect(() =>
      replaySource(
        { ...source, versions: { ...source.versions, engine: 'future' } },
        null,
        now,
      ),
    ).toThrow('重算');
    expect(() =>
      replaySource(
        {
          ...source,
          input: {
            ...source.input,
            config: { ...source.input.config, initialCash: '1' },
          },
        },
        null,
        now,
      ),
    ).toThrow('重算');
    expect(() => replaySource(source, null, now - 1)).toThrow('晚于');
    original.payload.result.final.equity = '0';
    expect(() => captureSource('single', original, null, now)).toThrow('校验');
  });
});
