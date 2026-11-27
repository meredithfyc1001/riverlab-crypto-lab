import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { layouts } from '../../src/infrastructure/database-layouts';
import type { RepositoryKind } from '../../src/infrastructure/desktop-repository';
import {
  fingerprintSnapshotValue,
  hashSnapshotFile,
  SnapshotWriter,
} from '../../src/infrastructure/snapshot-format';
import type {
  SnapshotLayout,
  SnapshotRow,
} from '../../src/infrastructure/snapshot-source';

const digest = (bytes: Uint8Array | string) =>
  createHash('sha256').update(bytes).digest('hex');

function layout(count: number, startedUtcMs = 1700000000000): SnapshotLayout {
  return {
    scope: 'all-databases',
    origin: 'http://127.0.0.1:4173',
    startedUtcMs,
    barrierUtcMs: startedUtcMs + 1,
    barrierSequence: 10,
    fenceName: 'riverlab-crypto-lab:snapshot-v1',
    fenceVersion: 1,
    fenceId: '7ed17e1a-8949-40ab-876d-05919802d254',
    missingDatabases: [],
    databases: (Object.keys(layouts) as RepositoryKind[]).map((kind, index) => {
      const [name, body] = layouts[kind];
      return {
        name,
        kind,
        version: 1,
        firstRead: index + 1,
        postBarrierRead: index + 11,
        stores: (kind === 'rule' ? [body] : [body, 'summaries']).map(
          (name) => ({
            name,
            keyPath: 'id',
            autoIncrement: false,
            indexes: [],
            count: kind === 'dataset' ? count : 0,
          }),
        ),
      };
    }),
  };
}

function completed(input: SnapshotLayout) {
  return {
    ...input,
    finishedUtcMs: input.barrierUtcMs + 20,
    databases: input.databases.map((db, i) => ({ ...db, completed: i + 21 })),
  };
}

function row(value: { id: string }, store = 'datasets'): SnapshotRow {
  return {
    kind: 'dataset',
    database: layouts.dataset[0],
    version: 1,
    store,
    primaryKey: value.id,
    id: value.id,
    value,
  };
}

function inspect(chunks: Uint8Array<ArrayBuffer>[]) {
  const file = Buffer.concat(chunks);
  expect(file.subarray(0, 8).toString()).toBe('RLIDB001');
  const frames: { tag: number; payload: Buffer }[] = [];
  let offset = 8;
  while (offset < file.length) {
    const tag = file[offset],
      n = Number(file.readBigUInt64BE(offset + 1));
    offset += 9;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(1024 * 1024);
    frames.push({ tag, payload: file.subarray(offset, offset + n) });
    offset += n;
  }
  expect(offset).toBe(file.length);
  return { file, frames };
}

describe('RLIDB001', () => {
  it('waits for destination acknowledgement of the validated layout before reading rows', async () => {
    const source = layout(1);
    let begin!: (bytes: Uint8Array<ArrayBuffer>) => void;
    const started = new Promise<Uint8Array<ArrayBuffer>>((resolve) => {
      begin = resolve;
    });
    let rejectWrite!: (error: Error) => void;
    const ack = new Promise<void>((_, reject) => {
      rejectWrite = reject;
    });
    const creating = SnapshotWriter.create(
      {
        write: (bytes) => {
          begin(bytes);
          return ack;
        },
      },
      source,
    );
    // If creation returns before a write, fail immediately instead of timing out.
    const first = await Promise.race([started, creating.then(() => undefined)]);
    expect(first).toBeDefined();
    const { frames } = inspect([first!]);
    expect(frames.map((frame) => frame.tag)).toEqual([1, 16]);
    expect(JSON.parse(frames[1].payload.toString()).databases).toHaveLength(9);
    const failure = new Error('destination refused layout');
    rejectWrite(failure);
    await expect(creating).rejects.toBe(failure);
  });

  it('matches the independent fixed content fingerprint of nine existing empty databases', async () => {
    for (const now of [1700000000000, 1700086400000]) {
      const source = layout(0, now);
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      const writer = await SnapshotWriter.create(
        {
          write: async (b) => {
            chunks.push(b);
          },
        },
        source,
      );
      const receipt = await writer.finish(completed(source));
      const { file, frames } = inspect(chunks);
      expect(frames.map((f) => f.tag)).toEqual([1, 16, 255]);
      expect(receipt.rows).toBe(0);
      expect(receipt.bytes).toBe(file.length);
      expect(receipt.fileSha256).toBe(digest(file));
      expect(receipt.snapshotContentId).toBe(
        '79b2d398efb5e51f07034a9be772035387f6a9c293ab1d2674c6742a932a826d',
      );
      expect(await hashSnapshotFile(new Blob(chunks))).toBe(receipt.fileSha256);
    }
  });

  it('streams a large UTF-8 field across a surrogate boundary and records the order of own undefined properties', async () => {
    const record = {
      id: '行 1',
      source: {
        note: 'a'.repeat(16383) + '🌊' + '\ud800' + '\n中文'.repeat(160000),
        url: undefined,
        label: '合成',
        expectedSha256: undefined,
      },
      quality: {
        issues: [{ raw: undefined, message: '测试', line: undefined }],
      },
    };
    const summary = { id: record.id, source: { url: undefined } };
    const source = layout(1);
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    const writer = await SnapshotWriter.create(
      {
        write: async (b) => {
          chunks.push(b);
        },
      },
      source,
    );
    await writer.writeRow(row(record));
    await writer.writeRow(row(summary, 'summaries'));
    const receipt = await writer.finish(completed(source));
    const { frames, file } = inspect(chunks);
    const first = frames.slice(
      3,
      frames.findIndex((f) => f.tag === 5),
    );
    const projection = Buffer.concat(
      first.filter((f) => f.tag === 3).map((f) => f.payload),
    );
    expect(first.filter((f) => f.tag === 3).length).toBeGreaterThan(2);
    expect(projection.toString('utf8')).toBe(JSON.stringify(record));
    const detail = Buffer.concat(
      first.filter((f) => f.tag === 4).map((f) => f.payload),
    );
    expect(JSON.parse(detail.toString())).toEqual({
      version: 1,
      aliases: [],
      objects: [
        {
          path: ['source'],
          keys: ['note', 'url', 'label', 'expectedSha256'],
          undefinedKeys: ['url', 'expectedSha256'],
        },
        {
          path: ['quality', 'issues', 0],
          keys: ['raw', 'message', 'line'],
          undefinedKeys: ['raw', 'line'],
        },
      ],
    });
    expect(
      JSON.parse(frames.find((f) => f.tag === 5)!.payload.toString()),
    ).toEqual({
      projectionBytes: projection.length,
      projectionSha256: digest(projection),
      cloneBytes: detail.length,
      cloneSha256: digest(detail),
    });
    expect(receipt.fileSha256).toBe(digest(file));
    const absent = await fingerprintSnapshotValue('dataset', 'summary', {
      id: 'x',
      source: {},
    });
    const explicit = await fingerprintSnapshotValue('dataset', 'summary', {
      id: 'x',
      source: { url: undefined },
    });
    expect(explicit.projectionSha256).toBe(absent.projectionSha256);
    expect(explicit.cloneSha256).not.toBe(absent.cloneSha256);
  });

  it('preserves shared references emitted by the research engine, including nested aliases', async () => {
    const signal = { target: 5 },
      events = [signal, signal];
    const record = { id: 'x', source: events, results: [events, signal] };
    const cloned = {
      id: 'x',
      source: [{ target: 5 }, { target: 5 }],
      results: [[{ target: 5 }, { target: 5 }], { target: 5 }],
    };
    const src = layout(1),
      chunks: Uint8Array<ArrayBuffer>[] = [];
    const writer = await SnapshotWriter.create(
      {
        write: async (b) => {
          chunks.push(b);
        },
      },
      src,
    );
    await writer.writeRow(row(record));
    await writer.writeRow(row({ id: 'x' }, 'summaries'));
    await writer.finish(completed(src));
    const first = inspect(chunks).frames.find((f) => f.tag === 4)!;
    expect(JSON.parse(first.payload.toString()).aliases).toEqual([
      { path: ['source', 1], target: ['source', 0] },
      { path: ['results', 0], target: ['source'] },
      { path: ['results', 1], target: ['source', 0] },
    ]);
    const a = await fingerprintSnapshotValue('experiment', 'body', record),
      b = await fingerprintSnapshotValue('experiment', 'body', cloned);
    expect(a.projectionSha256).toBe(b.projectionSha256);
    expect(a.cloneSha256).not.toBe(b.cloneSha256);
  });

  it('refuses nonportable clones rather than changing their values', async () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    for (const value of [
      new Date(),
      new Map(),
      -0,
      NaN,
      9n,
      [undefined],
      new Array(2),
      { value: undefined },

      cycle,
      { __proto__: null },
    ])
      await expect(
        fingerprintSnapshotValue('dataset', 'body', value),
      ).rejects.toThrow();
    await expect(
      fingerprintSnapshotValue('risk', 'body', { source: { url: undefined } }),
    ).rejects.toThrow();
  });

  it('cannot seal incomplete or repeated rows, a changed barrier or an aborted write', async () => {
    const source = layout(2);
    const sink = { write: async () => {} };
    const incomplete = await SnapshotWriter.create(sink, source);
    await expect(incomplete.finish(completed(source))).rejects.toThrow();
    const repeated = await SnapshotWriter.create(sink, source);
    await repeated.writeRow(row({ id: 'a' }));
    await expect(repeated.writeRow(row({ id: 'a' }))).rejects.toThrow('主键');
    await expect(repeated.finish(completed(source))).rejects.toThrow();
    const empty = layout(0);
    const stale = await SnapshotWriter.create(sink, empty);
    await expect(
      stale.finish({ ...completed(empty), fenceId: 'other' }),
    ).rejects.toThrow();
    const controller = new AbortController();
    const cancelled = await SnapshotWriter.create(
      sink,
      empty,
      controller.signal,
    );
    controller.abort();
    await expect(cancelled.finish(completed(empty))).rejects.toThrow();
  });
});
