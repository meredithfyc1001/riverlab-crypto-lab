// @vitest-environment node
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, expect, it, vi } from 'vitest';
import type { AdvancedReport } from '../../src/core/advanced-research/report';
import { runExperiment, sealExperiment } from '../../src/core/experiments';
import { advancedTask } from '../../src/infrastructure/advanced-worker';
import { ExperimentStore } from '../../src/infrastructure/experiment-store';
import type { RiskRequest } from '../../src/infrastructure/risk-worker';
import {
  openWorkerSource,
  readWorkerSource,
} from '../../src/infrastructure/worker-source';
import { START, INTERVAL, market } from '../fixtures/backtest';

const mocks = vi.hoisted(() => ({
  desktop: vi.fn(() => true),
  getBytes:
    vi.fn<
      (
        kind: string,
        id: string,
        signal?: AbortSignal,
      ) => Promise<Uint8Array<ArrayBuffer> | undefined>
    >(),
  saveBytes:
    vi.fn<
      (
        ...args: [string, string, Uint8Array<ArrayBuffer>, string, AbortSignal]
      ) => Promise<void>
    >(),
}));
vi.mock('../../src/infrastructure/desktop-repository', () => ({
  isDesktopRepository: mocks.desktop,
  desktopRepository: {
    async getDomainBytes(kind: string, id: string, signal?: AbortSignal) {
      const bytes = await mocks.getBytes(kind, id, signal);
      return bytes && { bytes, structured: false };
    },
    saveBytes: mocks.saveBytes,
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  mocks.desktop.mockReturnValue(true);
});

it('reproduces the browser risk-source preview from bytes transferred by the desktop window', async () => {
  mocks.desktop.mockReturnValue(false);
  vi.stubGlobal('indexedDB', new IDBFactory());
  const dataset = market(
    Array.from({ length: 60 }, (_, i) => 100 + Math.min(i % 12, 12 - (i % 12))),
  );
  const observedUtcMs = START + 60 * INTERVAL;
  const record = sealExperiment(
    runExperiment({
      dataset,
      strategy: { kind: 'ma', fastPeriod: 2, slowPeriod: 4 },
      completedThroughUtcMs: observedUtcMs,
    }),
    {
      id: 'source',
      name: '中文 合成研究',
      createdUtcMs: observedUtcMs,
      elapsedMs: 3,
    },
  );
  await new ExperimentStore().save(record);
  const posted = vi.fn();
  vi.stubGlobal('postMessage', posted);
  vi.stubGlobal('onmessage', null);
  await import('../../src/infrastructure/risk.worker');
  const receive = globalThis.onmessage as unknown as (event: {
    data: RiskRequest;
    ports: MessagePort[];
  }) => Promise<void>;
  const data: RiskRequest = {
    kind: 'inspect',
    sourceId: record.id,
    observedUtcMs,
  };
  await receive({ data, ports: [] });
  const browser = posted.mock.lastCall?.[0];
  expect(browser).toMatchObject({
    kind: 'success',
    preview: { id: record.id },
  });
  mocks.desktop.mockReturnValue(true);
  const bytes = new TextEncoder().encode(JSON.stringify(record));
  mocks.getBytes.mockResolvedValueOnce(bytes);
  const source = openWorkerSource('experiment')!;
  try {
    // Any accidental attempt to open the browser library here fails the comparison.
    vi.stubGlobal('indexedDB', undefined);
    await receive({ data, ports: [source.port] });
    expect(posted.mock.lastCall?.[0]).toEqual(browser);
    expect(bytes.byteLength).toBe(0);
    expect(mocks.getBytes).toHaveBeenCalledWith(
      'experiment',
      record.id,
      expect.any(AbortSignal),
    );
  } finally {
    source.close();
  }
});

it('propagates missing records and malformed UTF-8 without opening a browser library', async () => {
  for (const [payload, message] of [
    [undefined, '找不到'],
    [new Uint8Array([0xff]), /encoded|encoding/i],
  ] as const) {
    mocks.getBytes.mockResolvedValueOnce(payload);
    const source = openWorkerSource('dataset')!;
    try {
      await expect(readWorkerSource(source.port, 'id')).rejects.toThrow(
        message,
      );
    } finally {
      source.close();
    }
  }
});

it('aborts a pending window read when the owning Worker closes', async () => {
  let signal: AbortSignal | undefined;
  mocks.getBytes.mockImplementationOnce(async (_kind, _id, requestSignal) => {
    signal = requestSignal;
    await new Promise<void>((resolve) =>
      signal?.addEventListener('abort', () => resolve()),
    );
    return undefined;
  });
  const source = openWorkerSource('shared_pool')!;
  source.port.postMessage('id');
  try {
    await vi.waitFor(() => expect(signal).toBeDefined());
  } finally {
    source.close();
  }
  expect(signal?.aborted).toBe(true);
});

it('allows only a verified advanced write and waits for the actual commit result when cancellation races it', async () => {
  const sent = vi.fn();
  let reply: (data: unknown) => void = () => {};
  vi.stubGlobal(
    'Worker',
    class {
      onmessage?: (e: { data: unknown }) => void;
      terminate = vi.fn();
      postMessage = sent;
      constructor() {
        reply = (data) => this.onmessage?.({ data });
      }
    },
  );
  const request = {
    kind: 'save',
    record: { id: 'report' } as AdvancedReport,
  } as const;
  const bytes = new TextEncoder().encode('{"id":"report"}');
  const ready = { write: { id: 'report', bytes, summary: '{"id":"report"}' } };
  const old = advancedTask(request);
  expect(sent).toHaveBeenLastCalledWith({
    kind: 'prepare-save',
    record: request.record,
  });
  old.cancel();
  reply(ready);
  await expect(old.promise).rejects.toThrow('取消');
  expect(mocks.saveBytes).not.toHaveBeenCalled();

  let committed: () => void = () => {};
  mocks.saveBytes.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      committed = resolve;
    }),
  );
  const next = advancedTask(request);
  reply(ready);
  reply(ready);
  expect(mocks.saveBytes).toHaveBeenCalledTimes(1);
  const signal = mocks.saveBytes.mock.calls[0][4];
  next.cancel();
  expect(signal.aborted).toBe(true);
  committed();
  await expect(next.promise).resolves.toEqual({ saved: true });
});
