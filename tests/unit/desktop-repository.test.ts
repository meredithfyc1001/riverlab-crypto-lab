import { afterEach, describe, expect, it, vi } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { fixtureDataset } from '../fixtures/dataset';
import { assertDataset, summarizeDataset } from '../../src/core/data/dataset';

const chunk = 1024 * 1024;
const sessionId = '8bff6bb9-9479-413b-bfaf-10e867a2b7a5';
const handshake = {
  protocolVersion: 1,
  minorVersion: 0,
  schemaVersion: 1,
  sessionId,
  chunkBytes: chunk,
  maxBodyBytes: 256 * chunk,
  capabilities: ['read', 'write', 'list', 'delete'],
};

type Frame = { protocolVersion: number; sessionId: string; requestId: string };
interface Packet {
  frame: Frame;
  command: { op: string; sha256?: string };
  offset?: number;
}

async function adapter(
  call: (
    name: string,
    payload: Packet | Uint8Array,
    options?: { headers: Record<string, string> },
  ) => unknown,
) {
  vi.resetModules();
  Object.defineProperty(window, '__TAURI__', {
    configurable: true,
    value: { core: { invoke: vi.fn(call) } },
  });
  return import('../../src/infrastructure/desktop-repository');
}

afterEach(() => {
  Reflect.deleteProperty(window, '__TAURI__');
});

describe('Tauri SQLite Repository protocol V1', () => {
  it('rejects an incompatible handshake without sending data', async () => {
    const calls: string[] = [];
    const { desktopRepository, isDesktopRepository } = await adapter((name) => {
      calls.push(name);
      return { ...handshake, protocolVersion: 2 };
    });
    expect(isDesktopRepository()).toBe(true);
    await expect(desktopRepository.get('dataset', 'x')).rejects.toThrow(
      '不兼容',
    );
    expect(calls).toEqual(['repository_handshake']);
  });

  it('checks each raw block and the final digest across a UTF-8 boundary', async () => {
    const original = new TextEncoder().encode('a'.repeat(chunk - 1) + '汉 字');
    const offsets: number[] = [];
    const { desktopRepository } = await adapter((name, data) => {
      if (name === 'repository_handshake') return handshake;
      const { frame, offset } = data as Packet;
      expect(frame.sessionId).toBe(sessionId);
      if (name === 'repository_command')
        return {
          requestId: frame.requestId,
          status: 'download',
          sha256: bytesToHex(sha256(original)),
          length: original.length,
        };
      if (name !== 'repository_read_chunk' || offset === undefined)
        throw new Error('unknown request');
      offsets.push(offset);
      return original.slice(offset, offset + chunk).buffer;
    });
    const result = await desktopRepository.getBytes('experiment', '实验 1');
    expect(offsets).toEqual([0, chunk]);
    expect(result && bytesToHex(sha256(result))).toBe(
      bytesToHex(sha256(original)),
    );
  });

  it('acknowledges an upload in order and retries a lost commit with the same request id', async () => {
    const body = new TextEncoder().encode('a'.repeat(chunk) + '好');
    const offsets: number[] = [],
      commits: string[] = [];
    const { desktopRepository } = await adapter((name, data, options) => {
      if (name === 'repository_handshake') return handshake;
      if (name === 'repository_upload_chunk') {
        const offset = Number(options?.headers['x-riverlab-offset']);
        offsets.push(offset);
        expect(ArrayBuffer.isView(data)).toBe(true);
        return offset + (data as Uint8Array).length;
      }
      const { frame, command } = data as Packet;
      if (command.op === 'commit') {
        expect(command.sha256).toBe(
          bytesToHex(
            sha256
              .create()
              .update(body)
              .update(new TextEncoder().encode('{}'))
              .digest(),
          ),
        );
        commits.push(frame.requestId);
        if (commits.length === 1) throw new Error('synthetic lost reply');
        return { requestId: frame.requestId, status: 'committed' };
      }
      return { requestId: frame.requestId, status: 'ready' };
    });
    await desktopRepository.saveBytes('advanced', 'id', body, '{}');
    expect(offsets).toEqual([0, chunk, body.length]);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toBe(commits[1]);
  });

  it('streams both fields of a valid dataset with a summary larger than one chunk', async () => {
    const record = fixtureDataset();
    record.quality.issues = [
      { severity: 'warning', code: 'COVERAGE_UNVERIFIED', message: '合成' },
      ...Array.from({ length: 999 }, () => ({
        severity: 'warning' as const,
        code: 'SYNTHETIC',
        message: '中'.repeat(400),
      })),
    ];
    record.quality.warningCount = 1000;
    record.quality.issueCounts = { COVERAGE_UNVERIFIED: 1, SYNTHETIC: 999 };
    assertDataset(record);
    const chunks: Uint8Array[] = [];
    let seen = 0;
    const summary = JSON.stringify(summarizeDataset(record));
    const summaryBytes = new TextEncoder().encode(summary);
    expect(summaryBytes.length).toBeGreaterThan(chunk);
    const { desktopRepository } = await adapter((name, payload) => {
      if (name === 'repository_handshake') return handshake;
      if (name === 'repository_upload_chunk') {
        const bytes = payload as Uint8Array;
        expect(bytes.length).toBeLessThanOrEqual(chunk);
        chunks.push(bytes);
        seen += bytes.length;
        return seen;
      }
      const { frame, command } = payload as Packet;
      if (command.op === 'beginSave') {
        expect(command).toHaveProperty('summaryLength', summaryBytes.length);
        expect(JSON.stringify(command).length).toBeLessThan(256);
      }
      return {
        requestId: frame.requestId,
        status: command.op === 'commit' ? 'committed' : 'ready',
      };
    });
    await desktopRepository.save(
      'dataset',
      record.id,
      record,
      summarizeDataset(record),
    );
    expect(chunks).toHaveLength(4);
    expect(
      bytesToHex(sha256.create().update(chunks[2]).update(chunks[3]).digest()),
    ).toBe(bytesToHex(sha256(summaryBytes)));
  });

  it('isolates a damaged summary within a complete length-prefixed snapshot', async () => {
    const snapshot = new Uint8Array([
      2,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      123,
      7,
      0,
      0,
      0,
      ...new TextEncoder().encode('{"n":7}'),
    ]);
    const { desktopRepository } = await adapter((name, data) => {
      if (name === 'repository_handshake') return handshake;
      if (name === 'repository_read_chunk') return snapshot.buffer;
      return {
        requestId: (data as Packet).frame.requestId,
        status: 'download',
        length: snapshot.length,
        sha256: bytesToHex(sha256(snapshot)),
      };
    });
    expect(await desktopRepository.list('risk')).toEqual([null, { n: 7 }]);
  });

  it('discards a cancelled upload before commit', async () => {
    const controller = new AbortController();
    const steps: string[] = [];
    const { desktopRepository } = await adapter((name, data) => {
      if (name === 'repository_handshake') return handshake;
      if (name === 'repository_upload_chunk') {
        controller.abort();
        return (data as Uint8Array).length;
      }
      const { frame, command } = data as Packet;
      steps.push(command.op);
      return {
        requestId: frame.requestId,
        status: command.op === 'cancel' ? 'cancelled' : 'ready',
      };
    });
    await expect(
      desktopRepository.saveBytes(
        'advanced',
        'id',
        new Uint8Array([0]),
        '{}',
        controller.signal,
      ),
    ).rejects.toThrow();
    expect(steps).toEqual(['beginSave', 'cancel']);
  });
});

it('negotiates clone-preserving get, list and Worker reads while serving raw projection bytes on demand', async () => {
  const id = '迁移';
  const projection = JSON.stringify({
    id,
    source: { label: 'x' },
    second: { label: 'x' },
  });
  const descriptor = JSON.stringify({
    version: 1,
    objects: [
      { path: ['source'], keys: ['url', 'label'], undefinedKeys: ['url'] },
    ],
    aliases: [{ path: ['second'], target: ['source'] }],
  });
  const p = new TextEncoder().encode(projection),
    d = new TextEncoder().encode(descriptor);
  const framed = new Uint8Array(12 + p.length + d.length);
  const header = new DataView(framed.buffer);
  header.setUint32(0, 1, true);
  header.setUint32(4, p.length, true);
  header.setUint32(8, d.length, true);
  framed.set(p, 12);
  framed.set(d, 12 + p.length);
  let current = p;
  const ops: string[] = [];
  const { desktopRepository } = await adapter((name, data) => {
    if (name === 'repository_handshake')
      return {
        ...handshake,
        capabilities: [...handshake.capabilities, 'structured-read-v1'],
      };
    if (name === 'repository_read_chunk') return current.buffer;
    const { frame, command } = data as Packet;
    ops.push(command.op);
    current = command.op === 'load' ? p : framed;
    return {
      requestId: frame.requestId,
      status: current === p ? 'download' : 'structuredDownload',
      length: current.length,
      sha256: bytesToHex(sha256(current)),
    };
  });
  function check(value: unknown) {
    const body = value as { source: object; second: object };
    expect(Object.keys(body.source)).toEqual(['url', 'label']);
    expect(body.source).toBe(body.second);
  }
  check(await desktopRepository.get('dataset', id));
  check((await desktopRepository.list('dataset'))[0]);
  const raw = await desktopRepository.getBytes('dataset', id);
  expect(Array.from(raw!)).toEqual(Array.from(p));
  const { openWorkerSource, readWorkerSource } =
    await import('../../src/infrastructure/worker-source');
  const source = openWorkerSource('dataset')!;
  try {
    check(await readWorkerSource(source.port, id));
  } finally {
    source.close();
  }
  expect(ops).toEqual([
    'loadStructured',
    'listStructured',
    'load',
    'loadStructured',
  ]);
});
