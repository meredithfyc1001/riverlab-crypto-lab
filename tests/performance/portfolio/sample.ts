import { analyzeCsv } from '../../../src/core/data';
import { makeDataset } from '../../../src/core/data/dataset';
import type { PortfolioInput } from '../../../src/core/portfolio';
import { portfolioTask } from '../../../src/infrastructure/portfolio-worker';
import { options } from '../../fixtures/dataset';

async function sample(assetCount: number) {
  const start = 1735689600000;
  const bars = 10000 / assetCount;
  const assets: PortfolioInput['assets'] = [];
  for (let a = 0; a < assetCount; a++) {
    const rows = Array.from({ length: bars }, (_, i) => {
      const cycle = (i + a) % 8;
      const price = 20 + a + Math.min(cycle, 8 - cycle);
      return [start + i * 60000, price, price + 1, price - 1, price, 1].join(
        ',',
      );
    });
    const csv = ['timestamp,open,high,low,close,volume', ...rows].join('\n');
    const bytes = new TextEncoder().encode(csv);
    const sha256 = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
      (b) => b.toString(16).padStart(2, '0'),
    ).join('');
    const dataset = makeDataset(
      {
        id: 'profile-' + a,
        name: '人工合成 ' + a,
        symbol: 'S' + a + '/USDT',
        createdUtcMs: start,
        source: { kind: 'synthetic', label: '人工合成', note: '组合容量测量' },
        file: {
          name: 'sample.csv',
          bytes: bytes.length,
          sha256,
          parserVersion: 'csv-v1',
        },
        parsing: options,
        warningsAcknowledged: true,
      },
      analyzeCsv(csv, options),
    );
    assets.push({
      dataset,
      weightPercent: String(100 / assetCount),
      costs: {
        feeBps: 10,
        buySlippageBps: 10,
        sellSlippageBps: 10,
        quantityDecimals: 8,
        minNotional: '0',
      },
      strategy: { kind: 'ma', fastPeriod: 2, slowPeriod: 4 },
      risk: {},
    });
  }
  const input: PortfolioInput = {
    assets,
    initialCash: '10000',
    quoteCurrency: 'USDT',
    startUtcMs: start,
    endUtcMs: start + (bars - 1) * 60000,
    completedThroughUtcMs: start + bars * 60000,
    rangeConfirmed: true,
  };
  const perf = performance as Performance & {
    memory?: { usedJSHeapSize: number };
  };
  let maxMainHeapBytes = 0,
    maxMainTimerGapMs = 0,
    ticks = 0;
  let last = performance.now();
  function tick() {
    const now = performance.now();
    maxMainTimerGapMs = Math.max(maxMainTimerGapMs, now - last);
    maxMainHeapBytes = Math.max(
      maxMainHeapBytes,
      perf.memory?.usedJSHeapSize ?? 0,
    );
    last = now;
    ticks++;
  }
  const timer = setInterval(tick, 20);
  try {
    const begin = performance.now();
    const { record } = await portfolioTask({
      kind: 'run',
      input,
      name: '容量测量',
    }).promise;
    const ran = performance.now();
    const { file } = await portfolioTask({
      kind: 'export',
      record,
      format: 'json',
    }).promise;
    const exported = performance.now();
    const { record: restored } = await portfolioTask({ kind: 'import', file })
      .promise;
    const end = performance.now();
    tick();
    return {
      assetCount,
      bars,
      totalSourceBars: assetCount * bars,
      curvePoints: record.result.curve.length,
      fills: record.result.fillCount,
      bytes: file.size,
      runMs: Math.round(ran - begin),
      exportMs: Math.round(exported - ran),
      restoreMs: Math.round(end - exported),
      sameHash: record.payloadHash === restored.payloadHash,
      maxMainHeapBytes,
      maxMainTimerGapMs: Math.round(maxMainTimerGapMs),
      ticks,
    };
  } finally {
    clearInterval(timer);
  }
}
Object.assign(globalThis, { samplePortfolio: sample });
