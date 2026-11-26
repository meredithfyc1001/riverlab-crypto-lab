import { afterEach, describe, expect, it, vi } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

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
        expect(command.sha256).toBe(bytesToHex(sha256(body)));
        commits.push(frame.requestId);
        if (commits.length === 1) throw new Error('synthetic lost reply');
        return { requestId: frame.requestId, status: 'committed' };
      }
      return { requestId: frame.requestId, status: 'ready' };
    });
    await desktopRepository.saveBytes('advanced', 'id', body, '{}');
    expect(offsets).toEqual([0, chunk]);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toBe(commits[1]);
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
