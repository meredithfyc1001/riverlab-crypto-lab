import { analyzeCsv } from '../../../src/core/data';
import { makeDataset } from '../../../src/core/data/dataset';
import type { SharedPoolInput } from '../../../src/core/shared-pool/types';
import { sharedPoolTask } from '../../../src/infrastructure/shared-pool-worker';
import { options } from '../../fixtures/dataset';

const start = 1735689600000;
type Mode = SharedPoolInput['mode'];

async function makeInput(
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

function measureResponsiveness() {
  const perf = performance as Performance & {
    memory?: { usedJSHeapSize: number };
  };
  let last = performance.now();
  let maxMainTimerGapMs = 0,
    maxMainHeapBytes = 0,
    ticks = 0;
  const sample = () => {
    const now = performance.now();
    ticks++;
    maxMainTimerGapMs = Math.max(maxMainTimerGapMs, now - last);
    maxMainHeapBytes = Math.max(
      maxMainHeapBytes,
      perf.memory?.usedJSHeapSize ?? 0,
    );
    last = now;
  };
  const timer = setInterval(sample, 20);
  return () => {
    sample();
    clearInterval(timer);
    return {
      maxMainTimerGapMs: Math.round(maxMainTimerGapMs),
      maxMainHeapBytes,
      ticks,
    };
  };
}

async function run(assetCount: number, mode: Mode) {
  const input = await makeInput(assetCount, mode);
  const stop = measureResponsiveness();
  try {
    const first = sharedPoolTask({ kind: 'run', input, name: '满载取消' });
    const scheduled = performance.now();
    const cancel = setTimeout(() => first.cancel(), 20);
    try {
      await first.promise;
      throw new Error('满载计算在取消前意外完成。');
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('取消'))
        throw error;
    } finally {
      clearTimeout(cancel);
    }
    const cancelled = performance.now();
    const { record } = await sharedPoolTask({
      kind: 'run',
      input,
      name: '共享容量测量',
    }).promise;
    const ran = performance.now();
    const { file } = await sharedPoolTask({
      kind: 'export',
      record,
      format: 'json',
    }).promise;
    const exported = performance.now();
    const live = stop();
    const { orders, alignment } = record.result;
    const fills = orders.filter((order) => order.status === 'filled');
    const partialSales = fills.filter(
      (order) => order.side === 'sell' && order.quantityAfter !== '0',
    ).length;
    const simultaneous = new Map<number, number>();
    for (const o of fills) {
      if (o.side === 'buy')
        simultaneous.set(o.barIndex, (simultaneous.get(o.barIndex) ?? 0) + 1);
    }
    // Save the exported bytes exactly, then feed the file to a fresh browser context.
    const a = document.createElement('a');
    a.download = 'shared-pool.json';
    a.href = URL.createObjectURL(file);
    a.click();
    return {
      mode,
      assetCount,
      bars: alignment.barCount,
      totalSourceBars: alignment.totalSourceBars,
      curvePoints: record.result.curve.length,
      fills: fills.length,
      partialSales,
      simultaneousBuys: [...simultaneous.values()].filter(
        (n) => n === assetCount,
      ).length,
      rebalances: record.result.rebalances.length,
      bytes: file.size,
      payloadHash: record.payloadHash,
      recordHash: record.recordHash,
      cancelMs: Math.round(cancelled - scheduled),
      runMs: Math.round(ran - cancelled),
      exportMs: Math.round(exported - ran),
      ...live,
    };
  } finally {
    stop();
  }
}
async function restore() {
  const file = document.querySelector('input')?.files?.[0];
  if (!file) throw new Error('缺少待恢复文件。');
  const stop = measureResponsiveness();
  try {
    const startTime = performance.now();
    const { record } = await sharedPoolTask({ kind: 'import', file }).promise;
    return {
      payloadHash: record.payloadHash,
      recordHash: record.recordHash,
      restoredFills: record.result.fillCount,
      restoreMs: Math.round(performance.now() - startTime),
      ...stop(),
    };
  } finally {
    stop();
  }
}
Object.assign(globalThis, {
  runSharedSample: run,
  restoreSharedSample: restore,
});
