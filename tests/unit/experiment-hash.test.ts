// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { sealWorkerExperiment } from '../../src/infrastructure/experiment-hash';
import { runExperiment, sealExperiment } from '../../src/core/experiments';
import { defaultRule } from '../../src/core/strategies';
import { market, START, INTERVAL } from '../fixtures/backtest';
const metadata = {
  id: 'native-hash',
  name: '中文 😀 实验',
  createdUtcMs: START,
  elapsedMs: 1,
};
describe('Worker native digest preserves the complete historical experiment contract', () => {
  it.each(['ma', 'rules'] as const)(
    'matches pure streaming core byte-for-byte: %s',
    async (kind) => {
      const dataset = market(
        Array.from(
          { length: 48 },
          (_, i) => 100 + (i % 12 < 6 ? i % 6 : 6 - (i % 6)),
        ),
      );
      const payload = runExperiment({
        dataset,
        strategy:
          kind === 'ma'
            ? { kind, fastPeriod: 2, slowPeriod: 4 }
            : { kind, rule: defaultRule() },
        completedThroughUtcMs: START + 48 * INTERVAL,
      });
      expect(await sealWorkerExperiment(payload, metadata)).toEqual(
        sealExperiment(payload, metadata),
      );
    },
  );
  it('retains the original streaming fallback when native digest is unavailable', async () => {
    const dataset = market([100, 110, 90, 120]);
    const payload = runExperiment({
      dataset,
      strategy: { kind: 'ma', fastPeriod: 1, slowPeriod: 2 },
      completedThroughUtcMs: START + 4 * INTERVAL,
    });
    vi.stubGlobal('crypto', {});
    try {
      expect(await sealWorkerExperiment(payload, metadata)).toEqual(
        sealExperiment(payload, metadata),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
