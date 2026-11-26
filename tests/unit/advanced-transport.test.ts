// @vitest-environment node
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { expect, it, vi } from 'vitest';
import {
  evaluateCandidate,
  prepareAdvanced,
  runAdvanced,
  type AdvancedInput,
} from '../../src/core/advanced-research';
import {
  advancedCsv,
  captureAdvancedInput,
  sealAdvancedReport,
  verifyAdvancedReport,
  type AdvancedReport,
} from '../../src/core/advanced-research/report';
import { normalizeConfig } from '../../src/core/backtests';
import { contentHash } from '../../src/core/backtests/identity';
import { sealRule } from '../../src/core/rule-library';
import { defaultRule } from '../../src/core/strategies';
import {
  readAdvancedFile,
  exportAdvancedFile,
} from '../../src/infrastructure/advanced-file';
import {
  advancedWorkerCount,
  scheduleAdvanced,
  type EvaluationLane,
} from '../../src/infrastructure/advanced-pool';
import { AdvancedStore } from '../../src/infrastructure/advanced-store';
import { advancedTask } from '../../src/infrastructure/advanced-worker';
import { START, INTERVAL, market } from '../fixtures/backtest';

const now = START + 100 * INTERVAL;
const metadata = { id: 'report', name: '人工成交示例', createdUtcMs: now };

function input(): AdvancedInput {
  const dataset = market([
    10, 11, 12, 9, 8, 10, 13, 9, 8, 11, 8, 7, 11, 12, 14, 10, 9, 20,
  ]);
  return {
    dataset,
    completedThroughUtcMs: START + dataset.candles.length * INTERVAL,
    ruleRecord: sealRule(defaultRule(), {
      familyId: 'trend',
      name: '人工',
      createdUtcMs: START,
    }),
    config: normalizeConfig({}),
    risk: {},
    axes: [
      {
        side: 'buy',
        condition: 0,
        field: 'fastPeriod',
        min: 1,
        max: 5,
        step: 1,
      },
    ],
    search: { kind: 'random', seed: 245, count: 3 },
    filters: {
      minReturn: null,
      maxDrawdown: null,
      minProfitFactor: null,
      minTrades: 0,
    },
    sort: ['maxDrawdown', 'totalReturn'],
    evaluation: { kind: 'rolling', trainBars: 10, testBars: 4 },
    regime: { lookback: 1, thresholdBps: 500 },
  };
}

function report() {
  const data = captureAdvancedInput(input(), now);
  return sealAdvancedReport(data, runAdvanced(data), metadata);
}
function resign(r: AdvancedReport) {
  const { reportHash, ...body } = r;
  void reportHash;
  return { ...body, reportHash: contentHash(body) };
}

it('joins out-of-order, bounded training jobs before selecting exactly one test per fold', async () => {
  const data = captureAdvancedInput(input(), now),
    plan = prepareAdvanced(data),
    expected = runAdvanced(data);
  let running = 0,
    peak = 0;
  const tests: number[] = [];
  const closed = vi.fn();
  const progress = vi.fn();
  const lane = (): EvaluationLane => ({
    async evaluate(c, w) {
      peak = Math.max(peak, ++running);
      if (w.role === 'test') {
        expect(running).toBe(1);
        tests.push(c.id);
      }
      // A later candidate can finish first without affecting the ranking or identity.
      await new Promise((resolve) =>
        setTimeout(resolve, c.id === plan.candidates[0].id ? 3 : 0),
      );
      running--;
      return evaluateCandidate(data, c, w);
    },
    close: closed,
  });
  const parallel = await scheduleAdvanced(data, plan, 3, progress, lane);
  const serial = await scheduleAdvanced(data, plan, 1, () => {});
  expect(parallel).toEqual(serial);
  expect(serial).toEqual(expected);
  expect(tests).toEqual(expected.folds.map((f) => f.selectedId));
  expect(peak).toBe(3);
  expect(closed).toHaveBeenCalledTimes(3);
  expect(progress.mock.calls.map(([n]) => n)).toEqual(
    Array.from({ length: plan.runs + 1 }, (_, i) => i),
  );
  expect(sealAdvancedReport(data, parallel, metadata).reportHash).toBe(
    sealAdvancedReport(data, serial, metadata).reportHash,
  );
});

it('limits concurrency by live windows and input size and stops an unfinished batch on worker failure', async () => {
  const data = input(),
    plan = prepareAdvanced(data);
  const longWindow = {
    ...plan,
    windows: [{ ...plan.windows[0], start: 0, end: 30_000 }],
  };
  expect(advancedWorkerCount(data, longWindow, 4)).toBe(1);
  for (const count of [0, 5, 1.5, NaN])
    expect(() => advancedWorkerCount(data, plan, count)).toThrow('并发');
  const closed = vi.fn();
  await expect(
    scheduleAdvanced(
      data,
      plan,
      2,
      () => {},
      () => ({
        evaluate: async () => {
          throw new Error('lost worker');
        },
        close: closed,
      }),
    ),
  ).rejects.toThrow('lost worker');
  expect(closed).toHaveBeenCalledTimes(2);
});

it('cancellation detaches the old worker, rejects the partial result and ignores its late messages', async () => {
  class MockWorker {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    postMessage = vi.fn();
    terminate = vi.fn();
    constructor() {
      workers.push(this);
    }
  }
  const workers: MockWorker[] = [];
  vi.stubGlobal('Worker', MockWorker);
  try {
    const progress = vi.fn();
    const old = advancedTask(
      { kind: 'run', name: 'old', input: input(), concurrency: 2 },
      progress,
    );
    const late = workers[0].onmessage!;
    late({ data: { progress: 1, total: 8 } });
    old.cancel();
    await expect(old.promise).rejects.toThrow('取消');
    const next = advancedTask({ kind: 'verify', record: {} });
    late({ data: { record: { id: 'old' } } });
    late({ data: { progress: 7, total: 8 } });
    expect(progress).toHaveBeenCalledTimes(1);
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    workers[1].onmessage!({ data: { record: { id: 'new' } } });
    await expect(next.promise).resolves.toEqual({ record: { id: 'new' } });
  } finally {
    vi.unstubAllGlobals();
  }
});

it('reopens a portable report in a new storage factory, verifies and exports all candidates including exclusions', async () => {
  const r = report();
  const file = exportAdvancedFile(r, 'json', now);
  const fresh = new AdvancedStore(() => factory);
  const factory = new IDBFactory();
  const restored = await readAdvancedFile(file, now);
  await fresh.save(restored);
  await expect(fresh.save(restored)).rejects.toThrow();
  expect(verifyAdvancedReport(await fresh.load(r.id), now)).toEqual(r);
  expect((await fresh.list()).items.map((row) => row.reportHash)).toEqual([
    r.reportHash,
  ]);
  const csv = advancedCsv(r);
  for (const field of [
    r.reportHash,
    'invalidParameters',
    'trainingSelection',
    'completedTrades',
    'regime',
    'UNKNOWN',
  ])
    expect(csv).toContain(field);
  expect(await exportAdvancedFile(r, 'csv', now).text()).toContain('runHash');
});

it('rejects changed bytes, re-signed fabricated metrics, unsupported fields/versions and future windows', () => {
  const r = report();
  expect(() => verifyAdvancedReport({ ...r, name: 'changed' }, now)).toThrow(
    'Hash',
  );
  expect(() => verifyAdvancedReport({ ...r, schemaVersion: 2 }, now)).toThrow(
    '版本',
  );
  expect(() => verifyAdvancedReport(r, START)).toThrow('收盘');
  const changed = structuredClone(r);
  changed.result.folds[0].train[0].metrics!.totalReturn = '999';
  expect(() => verifyAdvancedReport(resign(changed), now)).toThrow('重算');
  expect(() =>
    verifyAdvancedReport(
      resign({ ...r, surplus: true } as AdvancedReport),
      now,
    ),
  ).toThrow('重算');
  expect(() =>
    verifyAdvancedReport(
      resign({
        ...r,
        versions: { ...r.versions, statistics: 'future' },
      } as unknown as AdvancedReport),
      now,
    ),
  ).toThrow('重算');
});

it('rejects oversize files before reading, malformed UTF-8, excessive nesting and aborted writes', async () => {
  const giant = {
    size: 32 * 1024 * 1024 + 1,
    arrayBuffer: vi.fn(),
  } as unknown as Blob;
  await expect(readAdvancedFile(giant, now)).rejects.toThrow('32 MiB');
  expect(giant.arrayBuffer).not.toHaveBeenCalled();
  await expect(
    readAdvancedFile(new Blob([new Uint8Array([0xff])]), now),
  ).rejects.toThrow('UTF-8');
  await expect(
    readAdvancedFile(new Blob(['['.repeat(100) + ']'.repeat(100)]), now),
  ).rejects.toThrow('嵌套');
  const factory = new IDBFactory(),
    store = new AdvancedStore(() => factory);
  const r = report();
  const add = IDBObjectStore.prototype.add;
  const spy = vi
    .spyOn(IDBObjectStore.prototype, 'add')
    .mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<typeof add>
    ) {
      if (this.name === 'summaries')
        throw new DOMException('quota', 'QuotaExceededError');
      return add.apply(this, args);
    });
  try {
    await expect(store.save(r)).rejects.toThrow('quota');
  } finally {
    spy.mockRestore();
  }
  expect(await store.list()).toEqual({ items: [], damagedCount: 0 });
  await expect(store.load(r.id)).rejects.toThrow('不存在');
  await store.save(r);
  await store.transaction<void>('readwrite', (tx, done) => {
    tx.objectStore('summaries').add({ ...metadata, id: 'bad', reportHash: '' });
    done(undefined);
  });
  expect(await store.list()).toMatchObject({
    items: [{ id: r.id }],
    damagedCount: 1,
  });
});

it('rejects malformed candidate replies and terminates every child without publishing a report', async () => {
  const workers: MockWorker[] = [];
  class MockWorker {
    constructor() {
      workers.push(this);
    }
    onmessage: ((e: { data: unknown }) => void) | null = null;
    terminate = vi.fn();
    postMessage(message: { kind: string }) {
      if (message.kind === 'evaluate')
        queueMicrotask(() => this.onmessage?.({ data: null }));
    }
  }
  const data = input();
  vi.stubGlobal('Worker', MockWorker);
  try {
    await expect(
      scheduleAdvanced(data, prepareAdvanced(data), 2, () => {}),
    ).rejects.toThrow('响应无效');
    expect(workers).toHaveLength(2);
    for (const w of workers) expect(w.terminate).toHaveBeenCalledOnce();
  } finally {
    vi.unstubAllGlobals();
  }
});

it('rejects a corrupt report before occupying its ID, even with an attacker-recomputed digest', async () => {
  const r = report();
  const copy = structuredClone(r);
  copy.result.folds.length = 0;
  const factory = new IDBFactory(),
    store = new AdvancedStore(() => factory);
  await expect(store.save(resign(copy), now)).rejects.toThrow('重算');
  expect(await store.list()).toEqual({ items: [], damagedCount: 0 });
  const pending = store.save(r, now);
  r.input.ruleRecord.name = 'changed after verification';
  await expect(pending).resolves.toBeUndefined();
  expect(verifyAdvancedReport(await store.load(r.id), now).reportHash).toBe(
    r.reportHash,
  );
});
