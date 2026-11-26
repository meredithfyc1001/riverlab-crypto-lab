// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { desktopCandidateWorkers } from '../../src/infrastructure/advanced-desktop-workers';

// Real MessageChannels exercise transfer ownership. The synthetic candidate echoes
// over its dedicated port without running the numeric engine a second time here.
function mockCandidates() {
  const created: Candidate[] = [];
  class Candidate {
    onerror: ((e: { message: string }) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    terminate = vi.fn();
    constructor(
      readonly url: URL,
      readonly options: WorkerOptions,
    ) {
      created.push(this);
    }
    postMessage(kind: string, [port]: MessagePort[]) {
      expect(kind).toBe('attach-port');
      port.onmessage = ({ data }) => {
        port.postMessage({ id: data.id });
        port.close();
      };
    }
  }
  vi.stubGlobal('Worker', Candidate);
  return created;
}

it('allocates separate same-origin module candidates on demand and closes all peers after cancellation', async () => {
  const candidates = mockCandidates();
  const abort = vi.fn();
  const owner = desktopCandidateWorkers(2, abort);
  const endpoints = [new MessageChannel(), new MessageChannel()];
  try {
    expect(candidates).toHaveLength(0);
    const returned = await Promise.all(
      endpoints.map(({ port1, port2 }, i) => {
        owner.control.postMessage('create-candidate', [port2]);
        const reply = new Promise((resolve) => {
          port1.onmessage = ({ data }) => resolve(data);
        });
        port1.postMessage({ id: i });
        return reply;
      }),
    );
    expect(returned).toEqual([{ id: 0 }, { id: 1 }]);
    expect(candidates).toHaveLength(2);
    for (const worker of candidates) {
      expect(worker.url.pathname).toContain('advanced-candidate.worker');
      expect(worker.options.type).toBe('module');
    }
    expect(abort).not.toHaveBeenCalled();
  } finally {
    owner.close();
    for (const endpoint of endpoints) endpoint.port1.close();
    vi.unstubAllGlobals();
  }
  for (const worker of candidates)
    expect(worker.terminate).toHaveBeenCalledOnce();
});

it('propagates candidate startup failures and refuses a lane beyond the coordinator budget', async () => {
  const candidates = mockCandidates();
  const abort = vi.fn();
  const owner = desktopCandidateWorkers(1, abort);
  const first = new MessageChannel();
  const extra = new MessageChannel();
  try {
    owner.control.postMessage('create-candidate', [first.port2]);
    await vi.waitFor(() => expect(candidates).toHaveLength(1));
    candidates[0].onerror?.({ message: 'module failed' });
    expect(abort.mock.calls[0][0].message).toContain('module failed');
    owner.control.postMessage('create-candidate', [extra.port2]);
    await vi.waitFor(() => expect(abort).toHaveBeenCalledTimes(2));
    expect(abort.mock.calls[1][0].message).toContain('预算');
    expect(candidates).toHaveLength(1);
  } finally {
    owner.close();
    first.port1.close();
    extra.port1.close();
    vi.unstubAllGlobals();
  }
});
