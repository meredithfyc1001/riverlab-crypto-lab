// RLIDB001 consists of an eight-byte magic followed by u8 tag / u64be length
// frames. Stable content hashes include complete layout, row and row-seal frames.
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { layouts } from './database-layouts';
import { SNAPSHOT_FENCE } from './local-database';
import type {
  SnapshotLayout,
  SnapshotRow,
  SnapshotSourceReport,
} from './snapshot-source';
import { encodeSnapshotValue, MIB } from './snapshot-value';
import type { SnapshotRole } from './snapshot-value';
import type { RepositoryKind } from './desktop-repository';

export async function fingerprintSnapshotValue(
  kind: RepositoryKind,
  role: SnapshotRole,
  value: unknown,
) {
  return encodeSnapshotValue(kind, role, value);
}

const utf8 = new TextEncoder();
const magic = utf8.encode('RLIDB001');
const domain = utf8.encode('RLIDB001/content/v1\0');

export interface SnapshotSink {
  write(bytes: Uint8Array<ArrayBuffer>): Promise<void>;
}
export interface SnapshotReceipt {
  fileSha256: string;
  snapshotContentId: string;
  bytes: number;
  rows: number;
}

function structure(layout: SnapshotLayout) {
  const kinds = Object.keys(layouts) as RepositoryKind[];
  if (
    layout.scope !== 'all-databases' ||
    layout.missingDatabases.length ||
    layout.databases.length !== kinds.length
  )
    throw new Error('无法封存缺少来源库的完整快照。');
  const databases = layout.databases.map((source, index) => {
    const kind = kinds[index];
    const [name, bodyStore] = layouts[kind];
    const expected = kind === 'rule' ? [bodyStore] : [bodyStore, 'summaries'];
    if (
      source.name !== name ||
      source.kind !== kind ||
      source.version !== 1 ||
      source.stores.length !== expected.length
    )
      throw new Error('源数据库布局或版本不匹配。');
    const stores = source.stores.map((store, position) => {
      if (
        store.name !== expected[position] ||
        store.keyPath !== 'id' ||
        store.autoIncrement !== false ||
        store.indexes.length ||
        !Number.isSafeInteger(store.count) ||
        store.count < 0
      )
        throw new Error('源对象存储布局或行数无效。');
      const role: SnapshotRole = position === 0 ? 'body' : 'summary';
      return {
        name: store.name,
        role,
        keyPath: store.keyPath,
        autoIncrement: false,
        indexes: [],
        count: store.count,
      };
    });
    return { name, kind, version: source.version, stores };
  });
  return { databases };
}

function verifyBarrier(layout: SnapshotLayout) {
  const reads = layout.databases.flatMap((db) => [
    db.firstRead,
    db.postBarrierRead,
  ]);
  if (
    new Set(reads).size !== reads.length ||
    !Number.isSafeInteger(layout.startedUtcMs) ||
    layout.startedUtcMs < 0 ||
    !Number.isSafeInteger(layout.barrierUtcMs) ||
    layout.barrierUtcMs < layout.startedUtcMs ||
    !Number.isSafeInteger(layout.barrierSequence) ||
    layout.fenceName !== SNAPSHOT_FENCE ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(layout.fenceId) ||
    layout.fenceVersion !== 1 ||
    !layout.databases.every(
      (db) =>
        Number.isSafeInteger(db.firstRead) &&
        db.firstRead > 0 &&
        db.firstRead < layout.barrierSequence &&
        Number.isSafeInteger(db.postBarrierRead) &&
        layout.barrierSequence < db.postBarrierRead,
    )
  )
    throw new Error('缺少覆盖各源事务的共同屏障证据。');
}

function metadata(value: unknown) {
  const bytes = utf8.encode(JSON.stringify(value));
  if (bytes.length > MIB) throw new Error('快照帧元数据超过 1 MiB。');
  return bytes;
}

export class SnapshotWriter {
  private readonly physical = sha256.create();
  private readonly stable = sha256.create().update(domain);
  private readonly stores;
  private state: 'ready' | 'writing' | 'failed' | 'finished' = 'ready';
  private output = new Uint8Array(256 * 1024);
  private buffered = 0;
  private bytes = 0;
  private rows = 0;
  private position = 0;
  private previousKey: string | undefined;

  private constructor(
    private readonly sink: SnapshotSink,
    private readonly initial: SnapshotLayout,
    layout: ReturnType<typeof structure>,
    private readonly signal?: AbortSignal,
  ) {
    this.stores = layout.databases.flatMap((db) =>
      db.stores.map((store) => ({
        database: db.name,
        kind: db.kind,
        store: store.name,
        role: store.role,
        remaining: store.count,
      })),
    );
  }

  static async create(
    sink: SnapshotSink,
    layout: SnapshotLayout,
    signal?: AbortSignal,
  ) {
    const initial = structuredClone(layout);
    const map = structure(initial);
    verifyBarrier(initial);
    const url = new URL(initial.origin);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.origin !== initial.origin
    )
      throw new Error('源 origin 无效。');
    const writer = new SnapshotWriter(sink, initial, map, signal);
    await writer.emit(magic);
    await writer.frame(
      1,
      metadata({
        version: 1,
        origin: initial.origin,
        startedUtcMs: initial.startedUtcMs,
      }),
    );
    await writer.frame(0x10, metadata(map));
    return writer;
  }

  private async emit(bytes: Uint8Array<ArrayBuffer>) {
    this.signal?.throwIfAborted();
    if (!Number.isSafeInteger(this.bytes + bytes.length))
      throw new Error('快照文件长度超过可表示范围。');
    this.physical.update(bytes);
    this.bytes += bytes.length;
    // File writers and cross-thread sinks acknowledge each write. Batch small
    // frames into bounded blocks so a catalogue of tiny rows remains practical.
    for (let offset = 0; offset < bytes.length;) {
      const count = Math.min(
        this.output.length - this.buffered,
        bytes.length - offset,
      );
      this.output.set(bytes.subarray(offset, offset + count), this.buffered);
      this.buffered += count;
      offset += count;
      if (this.buffered === this.output.length) await this.flush();
    }
  }

  private async flush() {
    if (!this.buffered) return;
    const bytes = this.output.subarray(0, this.buffered);
    this.output = new Uint8Array(256 * 1024);
    this.buffered = 0;
    this.signal?.throwIfAborted();
    await this.sink.write(bytes);
  }

  private async frame(tag: number, payload: Uint8Array<ArrayBuffer>) {
    if (payload.length < 1 || payload.length > MIB)
      throw new Error('快照帧长度无效。');
    const header = new Uint8Array(9);
    header[0] = tag;
    new DataView(header.buffer).setBigUint64(1, BigInt(payload.length), false);
    if (tag === 0x10 || tag === 2 || tag === 5)
      this.stable.update(header).update(payload);
    await this.emit(header);
    await this.emit(payload);
  }

  async writeRow(row: SnapshotRow) {
    if (this.state !== 'ready') throw new Error('快照写入次序无效。');
    this.state = 'writing';
    try {
      while (
        this.position < this.stores.length &&
        this.stores[this.position].remaining === 0
      ) {
        this.position++;
        this.previousKey = undefined;
      }
      const store = this.stores[this.position];
      if (
        !store ||
        row.database !== store.database ||
        row.kind !== store.kind ||
        row.store !== store.store ||
        row.version !== 1
      )
        throw new Error('实际读取与声明的对象存储或行数不符。');
      const key = row.primaryKey;
      if (
        typeof key !== 'string' ||
        !key.length ||
        row.id !== key ||
        (this.previousKey !== undefined && key <= this.previousKey) ||
        !row.value ||
        typeof row.value !== 'object' ||
        Object.getOwnPropertyDescriptor(row.value, 'id')?.value !== key
      )
        throw new Error('主键重复、乱序或与实际行 ID 不符。');
      const { database, role } = store;
      await this.frame(
        2,
        metadata({
          database,
          store: store.store,
          role,
          keyType: 'string',
          key,
          id: row.id,
        }),
      );
      const hashes = await encodeSnapshotValue(
        row.kind,
        role,
        row.value,
        (tag, bytes) => this.frame(tag, bytes),
        this.signal,
      );
      await this.frame(5, metadata(hashes));
      this.previousKey = key;
      store.remaining--;
      this.rows++;
      this.state = 'ready';
    } catch (error) {
      this.state = 'failed';
      if (this.signal?.aborted) throw error;
      throw new Error(
        `快照未封存：${row.database}/${row.store} [${row.primaryKey}]：${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  async finish(report: SnapshotSourceReport): Promise<SnapshotReceipt> {
    if (this.state !== 'ready')
      throw new Error('写入未完成或已失败，无法封存。');
    this.state = 'writing';
    try {
      this.signal?.throwIfAborted();
      const map = structure(report);
      verifyBarrier(report);
      const lastPost = Math.max(
        ...report.databases.map((db) => db.postBarrierRead),
      );
      if (
        new Set(report.databases.map((db) => db.completed)).size !==
          report.databases.length ||
        this.stores.some((store) => store.remaining !== 0) ||
        JSON.stringify(map) !== JSON.stringify(structure(this.initial)) ||
        report.origin !== this.initial.origin ||
        report.startedUtcMs !== this.initial.startedUtcMs ||
        report.fenceName !== this.initial.fenceName ||
        report.fenceId !== this.initial.fenceId ||
        report.barrierSequence !== this.initial.barrierSequence ||
        report.barrierUtcMs !== this.initial.barrierUtcMs ||
        !Number.isSafeInteger(report.finishedUtcMs) ||
        report.finishedUtcMs < report.barrierUtcMs ||
        report.databases.some(
          (db, i) =>
            db.firstRead !== this.initial.databases[i].firstRead ||
            db.postBarrierRead !== this.initial.databases[i].postBarrierRead ||
            !Number.isSafeInteger(db.completed) ||
            db.completed <= lastPost,
        )
      )
        throw new Error('读取范围、事务回执或源记录数不完整，拒绝封存快照。');
      const snapshotContentId = bytesToHex(this.stable.digest());
      await this.frame(
        255,
        metadata({ rows: this.rows, snapshotContentId, source: report }),
      );
      await this.flush();
      this.state = 'finished';
      return {
        fileSha256: bytesToHex(this.physical.digest()),
        snapshotContentId,
        bytes: this.bytes,
        rows: this.rows,
      };
    } catch (error) {
      this.state = 'failed';
      throw error;
    }
  }
}

export async function hashSnapshotFile(
  file: Blob,
  signal?: AbortSignal,
): Promise<string> {
  const hash = sha256.create();
  for (let position = 0; position < file.size; position += MIB) {
    signal?.throwIfAborted();
    const bytes = await file.slice(position, position + MIB).arrayBuffer();
    if (bytes.byteLength !== Math.min(MIB, file.size - position))
      throw new Error('快照复读不完整。');
    hash.update(new Uint8Array(bytes));
  }
  signal?.throwIfAborted();
  return bytesToHex(hash.digest());
}
