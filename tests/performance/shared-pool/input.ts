import { analyzeCsv } from '../../../src/core/data';
import { makeDataset } from '../../../src/core/data/dataset';
import type { SharedPoolInput } from '../../../src/core/shared-pool/types';
import { options } from '../../fixtures/dataset';

const start = 1735689600000;
export type Mode = SharedPoolInput['mode'];

export async function makeInput(
  assetCount: number,
  mode: Mode,
): Promise<SharedPoolInput> {
  const bars = 10000 / assetCount;
  const assets = [];
  for (let a = 0; a < assetCount; a++) {
    const rows = Array.from({ length: bars }, (_, i) => {
      const base = 100 + a;
      // Synchronous MA crossings, with opens at base to keep each cycle funded.
      // Rebalance markets alternate in opposing directions and require partial sales.
      const open =
        mode === 'shared-strategy' ? base : base + ((i + a) % 2 ? 2 : -2);
      const close =
        mode === 'shared-strategy'
          ? base + [0, 2, 3, 1, -1, -3, -2, 0][i % 8]
          : open;
      return [
        start + i * 60000,
        open,
        Math.max(open, close) + 1,
        Math.min(open, close) - 1,
        close,
        1,
      ].join(',');
    });
    const csv = ['timestamp,open,high,low,close,volume', ...rows].join('\n');
    const bytes = new TextEncoder().encode(csv);
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const dataset = makeDataset(
      {
        id: 'shared-profile-' + a,
        name: '人工合成 S' + a,
        symbol: 'S' + a + '/USDT',
        createdUtcMs: start,
        source: {
          kind: 'synthetic',
          label: '人工合成',
          note: '共享组合容量测量',
        },
        file: {
          name: 'market.csv',
          bytes: bytes.length,
          sha256: Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join(
            '',
          ),
          parserVersion: 'csv-v1',
        },
        parsing: options,
        warningsAcknowledged: true,
      },
      analyzeCsv(csv, options),
    );
    assets.push({
      dataset,
      weightPercent: String(90 / assetCount),
      costs: {
        feeBps: 5,
        buySlippageBps: 1,
        sellSlippageBps: 1,
        minNotional: '0',
        quantityDecimals: 8,
      },
    });
  }
  const base = {
    initialCash: '100000',
    quoteCurrency: 'USDT',
    startUtcMs: start,
    endUtcMs: start + (bars - 1) * 60000,
    completedThroughUtcMs: start + bars * 60000,
    rangeConfirmed: true as const,
  };
  return mode === 'rebalance'
    ? { ...base, mode, assets, cashWeightPercent: '10', rebalanceEvery: 1 }
    : {
        ...base,
        mode,
        assets: assets.map((asset) => ({
          ...asset,
          strategy: { kind: 'ma', fastPeriod: 2, slowPeriod: 4 },
          risk: {},
        })),
      };
}
