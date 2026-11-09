import { describe, expect, it } from 'vitest';
import {
  pcg32,
  simulateEquity,
  normalizeRiskSettings,
  analyzeExperiment,
  sealRiskStudy,
  verifyRiskStudy,
  riskCsv,
} from '../../src/core/risk-analysis';
import type { RiskSettings } from '../../src/core/risk-analysis';
import { runExperiment, sealExperiment } from '../../src/core/experiments';
import { contentHash } from '../../src/core/backtests/identity';
import { market, START, INTERVAL } from '../fixtures/backtest';
import ref from '../fixtures/risk-reference.json';
const config: RiskSettings = {
  method: 'iid',
  seed: 42,
  paths: 20,
  steps: 12,
  blockSize: 1,
  thresholdPct: 95,
};
function source() {
  const dataset = market(
    Array.from(
      { length: 60 },
      (_, i) => 100 + (i % 12 < 6 ? i % 6 : 6 - (i % 6)),
    ),
  );
  return sealExperiment(
    runExperiment({
      dataset,
      strategy: { kind: 'ma', fastPeriod: 2, slowPeriod: 4 },
      completedThroughUtcMs: START + 60 * INTERVAL,
    }),
    {
      id: 'risk-source',
      name: '人工合成正式MA参考',
      createdUtcMs: START,
      elapsedMs: 1,
    },
  );
}
describe('reproducible risk resampling', () => {
  it('matches official PCG32 stream54 vector and rejects invalid seed/bounds', () => {
    const r = pcg32(42);
    expect(Array.from({ length: 6 }, () => r.next())).toEqual(ref.pcg42);
    for (const n of [-1, NaN, Infinity, 0x100000000, 0.5])
      expect(() => pcg32(n)).toThrow();
    expect(() => r.bounded(0)).toThrow();
    expect(() => r.bounded(50001)).toThrow();
  });
  it.each(ref.cases)(
    'matches independent Decimal/Fraction paths, quantiles, bands: $config.method seed $config.seed',
    (r) => {
      const actual = simulateEquity(ref.equities, r.config as RiskSettings);
      expect(actual.paths).toEqual(r.paths);
      expect(actual.quantiles).toEqual(r.quantiles);
      expect(actual.bands).toEqual(r.bands);
      expect(actual.meanFinalEquity).toBe(r.meanFinalEquity);
      expect(actual.loss.count).toBe(r.lossCount);
      expect(actual.thresholdHits.count).toBe(r.thresholdHitCount);
      expect(actual.histogram.reduce((n, b) => n + b.count, 0)).toBe(
        r.config.paths,
      );
    },
  );
  it('uses contiguous nonwrapping blocks and truncates the final block only as defined', () => {
    const test = ref.cases[1],
      random = pcg32(test.config.seed),
      indices: number[][] = [];
    for (let p = 0; p < test.config.paths; p++) {
      const row: number[] = [];
      while (row.length < test.config.steps) {
        const first = random.bounded(
          ref.equities.length - test.config.blockSize,
        );
        for (let i = 0; i < test.config.blockSize; i++) row.push(first + i);
      }
      indices.push(row.slice(0, test.config.steps));
    }
    expect(indices).toEqual(test.indices);
    expect(indices.flat().every((i) => i >= 0 && i < 20)).toBe(true);
  });
  it('does not confuse absent information with zero risk, and guards whole-budget/overflow', () => {
    expect(() => simulateEquity([], config)).toThrow();
    expect(() => simulateEquity(ref.equities.slice(0, 20), config)).toThrow(
      '样本数',
    );
    expect(() => simulateEquity(Array(21).fill('1000'), config)).toThrow(
      '恒定',
    );
    const zero = [...ref.equities];
    zero[10] = '0';
    expect(() => simulateEquity(zero, config)).toThrow('严格为正');
    const bad = [...ref.equities];
    bad[2] = 'NaN';
    expect(() => simulateEquity(bad, config)).toThrow();
    expect(() =>
      normalizeRiskSettings({ ...config, paths: 2000, steps: 1001 }, 20),
    ).toThrow('200万');
    expect(() =>
      normalizeRiskSettings({ ...config, method: 'block', blockSize: 21 }, 20),
    ).toThrow();
    expect(() =>
      normalizeRiskSettings({ ...config, blockSize: 2 }, 20),
    ).toThrow('IID');
    expect(() =>
      normalizeRiskSettings({ ...config, thresholdPct: 100 }, 20),
    ).toThrow();
    const extreme: string[] = Array.from({ length: 21 }, (_, i) =>
      i % 2 ? '100000000000000000000000000000' : '0.000000000000000001',
    );
    extreme[0] = '1000';
    expect(() => simulateEquity(extreme, { ...config, steps: 100 })).toThrow(
      '整批终止',
    );
  });
  it('supports degenerate valid distributions and absorbs 18-place rounding zero without negative equity', () => {
    const eq = ['1', ...Array(20).fill('0.000000000000000001')];
    const s = simulateEquity(eq, { ...config, steps: 100 });
    expect(s.zeros.count).toBeGreaterThan(0);
    expect(s.paths.every((p) => !p.finalEquity.startsWith('-'))).toBe(true);
    const increasing = Array.from({ length: 21 }, (_, i) => String(2 ** i));
    const d = simulateEquity(increasing, { ...config, steps: 2 });
    expect(d.histogram).toEqual([{ lower: '4', upper: '4', count: 20 }]);
  });
  it('computes every step while retaining at most101 display points and five trace paths', () => {
    const s = simulateEquity(ref.equities, { ...config, steps: 305 });
    expect(s.bands).toHaveLength(101);
    expect(s.bands[0].step).toBe(0);
    expect(s.bands.at(-1)!.step).toBe(305);
    expect(s.traces).toHaveLength(5);
    expect(s.traces.every((t) => t.points.length === 101)).toBe(true);
    expect(s.paths).toHaveLength(config.paths);
  });
  it('is exactly reproducible and progress callbacks do not change random draws', () => {
    const a = simulateEquity(ref.equities, config),
      seen: number[] = [];
    expect(simulateEquity(ref.equities, config, (n) => seen.push(n))).toEqual(
      a,
    );
    expect(seen.at(-1)).toBe(config.paths);
    expect(
      simulateEquity(ref.equities, { ...config, seed: 43 }).paths,
    ).not.toEqual(a.paths);
  });
  it('verifies source fees/open pnl using the original experiment, saves full reproduction input and survives source deletion', () => {
    const e = source(),
      before = JSON.stringify(e),
      payload = analyzeExperiment(e, config);
    expect(payload.preview.fees).toBe(e.payload.statistics.fees);
    expect(payload.preview.unrealizedPnl).toBe(
      e.payload.statistics.unrealizedPnl,
    );
    expect(payload.preview.runHash).toBe(e.payload.result.manifest.runHash);
    const record = sealRiskStudy(payload, {
      id: 'risk-1',
      name: '风险参考',
      createdUtcMs: START,
      elapsedMs: 4,
    });
    expect(verifyRiskStudy(JSON.parse(JSON.stringify(record)))).toEqual(record);
    expect(JSON.stringify(e)).toBe(before);
    expect(riskCsv(record)).toContain(record.payloadHash);
    expect(riskCsv(record)).toContain('仅供学习研究，历史表现不代表未来表现');
    expect(analyzeExperiment(e, config)).toEqual(payload);
  });
  it('rejects corrupt/rehashed mismatched source and output versions, including invalid saved source experiments', () => {
    const e = source(),
      payload = analyzeExperiment(e, config),
      r = sealRiskStudy(payload, {
        id: 'risk-1',
        name: 'test',
        createdUtcMs: START,
        elapsedMs: 1,
      });
    const bad = structuredClone(r);
    bad.payload.simulation.paths[0].finalEquity = '999';
    expect(() => verifyRiskStudy(bad)).toThrow('校验');
    bad.payloadHash = contentHash(bad.payload);
    expect(() => verifyRiskStudy(bad)).toThrow('重算');
    const changed = structuredClone(r);
    changed.payload.source.input.dataset.candles[0] = {
      ...changed.payload.source.input.dataset.candles[0],
      close: 101,
      high: 101,
    };
    changed.payloadHash = contentHash(changed.payload);
    expect(() => verifyRiskStudy(changed)).toThrow('源实验');
    e.payload.result.final.cash = '123';
    expect(() => analyzeExperiment(e, config)).toThrow('损坏');
  });
});
