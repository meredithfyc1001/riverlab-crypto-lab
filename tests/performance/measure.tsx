import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { analyzeCsv } from '../../src/core/data';
import { makeDataset } from '../../src/core/data/dataset';
import { ResultCurves } from '../../src/features/backtests/ResultCurves';
import type {
  WorkerRequest,
  WorkerResponse,
} from '../../src/infrastructure/backtest-worker';
import type { timings } from './timings';
import { options } from '../fixtures/dataset';

async function prepare() {
  const start = 1735689600000;
  const rows = Array.from({ length: 50000 }, (_, i) => {
    const p = 100 + (i % 12 < 6 ? i % 6 : 6 - (i % 6));
    return [start + i * 60000, p, p + 2, p - 2, p, 1].join(',');
  });
  const csv = 'timestamp,open,high,low,close,volume\n' + rows.join('\n');
  const bytes = new TextEncoder().encode(csv);
  const sha256 = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
  const dataset = makeDataset(
    {
      id: 'rc-perf',
      name: 'RC 50k',
      symbol: 'SYNTHETIC/USDT',
      createdUtcMs: start,
      source: { kind: 'synthetic', label: '人工合成', note: '性能样本' },
      file: {
        name: 'synthetic.csv',
        bytes: bytes.length,
        sha256,
        parserVersion: 'csv-v1',
      },
      parsing: options,
      warningsAcknowledged: true,
    },
    analyzeCsv(csv, options),
  );
  const request: WorkerRequest = {
    kind: 'run',
    id: 'rc-test',
    name: 'MA',
    createdUtcMs: start,
    input: {
      dataset,
      completedThroughUtcMs: start + 50000 * 60000,
      strategy: { kind: 'ma', fastPeriod: 2, slowPeriod: 4 },
    },
  };
  return request;
}

function heapSample() {
  return (
    (performance as Performance & { memory?: { usedJSHeapSize: number } })
      .memory?.usedJSHeapSize ?? null
  );
}

async function sample() {
  const request = await prepare();
  const root = createRoot(document.getElementById('root')!);
  const worker = new Worker(new URL('./profile.worker.ts', import.meta.url), {
    type: 'module',
  });
  let last = performance.now(),
    maxDelayMs = 0,
    timerSamples = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    maxDelayMs = Math.max(maxDelayMs, now - last);
    last = now;
    timerSamples++;
  }, 20);
  try {
    const reply = new Promise<{
      response: WorkerResponse;
      timings: typeof timings;
      receivedAt: number;
      sentAt: number;
    }>((resolve, reject) => {
      worker.onmessage = (e) => resolve(e.data);
      worker.onerror = () => reject(new Error('诊断 Worker 运行失败'));
      worker.onmessageerror = () =>
        reject(new Error('诊断 Worker 无法传输结果'));
    });
    const inputAt = performance.timeOrigin + performance.now();
    worker.postMessage(request);
    const { response, timings: t, receivedAt, sentAt } = await reply;
    const delivered = performance.timeOrigin + performance.now();
    worker.terminate();
    if (!response.ok) throw new Error(response.message);
    if (!('record' in response)) throw new Error('诊断未收到实验');
    const { record } = response;
    const afterTransfer = heapSample();
    const host = document.getElementById('root')!;
    const ready = new Promise<void>((resolve, reject) => {
      const observer = new MutationObserver(() => {
        const error = host.querySelector('[role=alert]');
        if (error) {
          observer.disconnect();
          reject(new Error(error.textContent ?? '曲线错误'));
          return;
        }
        if (
          host.querySelector('[data-testid="result-curves"][data-ready="true"]')
        ) {
          observer.disconnect();
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }
      });
      observer.observe(host, {
        subtree: true,
        childList: true,
        attributes: true,
      });
    });
    root.render(
      createElement(ResultCurves, {
        statistics: record.payload.statistics,
        theme: 'light',
      }),
    );
    await ready;
    const rendered = performance.timeOrigin + performance.now();
    return {
      strategyMs: t.strategy,
      ledgerAndPreparationMs: t.engine - t.strategy - t.identity,
      identityMs: t.identity,
      statisticsMs: t.statistics,
      sealMs: t.seal,
      inputMs: receivedAt - inputAt,
      outputMs: delivered - sentAt,
      chartMs: rendered - delivered,
      elapsedMs: rendered - inputAt,
      maxDelayMs,
      timerSamples,
      heapAfterTransferBytes: afterTransfer,
      heapAfterChartBytes: heapSample(),
      runHash: record.payload.result.manifest.runHash,
      payloadHash: record.payloadHash,
      fills: record.payload.result.fills.length,
      curvePoints: record.payload.statistics.curve.length,
    };
  } finally {
    clearInterval(timer);
    worker.terminate();
    root.unmount();
  }
}

Object.assign(window, { sample });
