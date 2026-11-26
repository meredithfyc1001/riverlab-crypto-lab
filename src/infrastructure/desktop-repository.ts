import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

export type RepositoryKind =
  | 'dataset'
  | 'experiment'
  | 'rule'
  | 'replay'
  | 'risk'
  | 'portfolio'
  | 'shared_pool'
  | 'regime'
  | 'advanced';

type Invoke = <T>(
  name: string,
  data: object | Uint8Array<ArrayBuffer>,
  options?: { headers: Record<string, string> },
) => Promise<T>;

const version = 1;
const chunkBytes = 1024 * 1024;
const maxBodyBytes = 256 * chunkBytes;
const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

interface Session {
  protocolVersion: number;
  minorVersion: number;
  schemaVersion: number;
  sessionId: string;
  chunkBytes: number;
  maxBodyBytes: number;
  capabilities: string[];
}

interface Frame {
  protocolVersion: number;
  sessionId: string;
  requestId: string;
}

type Command =
  | { op: 'load' | 'delete'; kind: RepositoryKind; id: string }
  | { op: 'list'; kind: RepositoryKind }
  | {
      op: 'beginSave';
      kind: RepositoryKind;
      id: string;
      summaryLength: number;
      length: number;
    }
  | { op: 'commit'; sha256: string }
  | { op: 'cancel' };

type Reply = { requestId: string } & (
  | { status: 'ready' | 'missing' | 'committed' | 'cancelled' }
  | { status: 'download'; length: number; sha256: string }
);

export function isDesktopRepository(): boolean {
  return (
    (typeof window !== 'undefined' && '__TAURI__' in window) ||
    globalThis.location?.origin === 'https://tauri.localhost'
  );
}

function getInvoke(): Invoke {
  if (typeof window === 'undefined')
    throw new Error('桌面存储请求须经工作台窗口。');
  const host = (
    window as Window & { __TAURI__?: { core?: { invoke?: Invoke } } }
  ).__TAURI__;
  if (!host?.core?.invoke)
    throw new Error('桌面服务连接不可用，请重新打开工作台。');
  return host.core.invoke;
}

class ServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function invoke<T>(
  name: string,
  data: object | Uint8Array<ArrayBuffer>,
  options?: { headers: Record<string, string> },
): Promise<T> {
  try {
    return await getInvoke()<T>(name, data, options);
  } catch (error) {
    if (
      typeof error === 'object' &&
      error &&
      'code' in error &&
      'message' in error
    ) {
      const message = String(error.message);
      if (error.code === 'conflict')
        throw new DOMException(message, 'ConstraintError');
      if (error.code === 'diskFull')
        throw new DOMException(message, 'QuotaExceededError');
      throw new ServiceError(String(error.code), message);
    }
    throw new Error('桌面数据服务未返回回执，请检查服务状态。', {
      cause: error,
    });
  }
}

let connecting: Promise<Session> | undefined;
function session(): Promise<Session> {
  connecting ??= invoke<Session>('repository_handshake', {
    protocolVersion: version,
  })
    .then((reply) => {
      if (
        reply?.protocolVersion !== version ||
        reply.schemaVersion !== 1 ||
        reply.chunkBytes !== chunkBytes ||
        reply.maxBodyBytes !== maxBodyBytes ||
        !uuid.test(reply.sessionId) ||
        !['read', 'list', 'write', 'delete'].every((capability) =>
          reply.capabilities?.includes(capability),
        )
      )
        throw new Error('桌面存储协议、schema 或能力不兼容，请核对应用版本。');
      return reply;
    })
    .catch((error: unknown) => {
      connecting = undefined;
      throw error;
    });
  return connecting;
}

async function newFrame(): Promise<Frame> {
  const { sessionId } = await session();
  return {
    protocolVersion: version,
    sessionId,
    requestId: crypto.randomUUID(),
  };
}

async function command(frame: Frame, operation: Command) {
  const result = await invoke<Reply>('repository_command', {
    frame,
    command: operation,
  });
  if (result?.requestId !== frame.requestId)
    throw new Error('桌面数据回执标识不匹配。');
  return result;
}

async function read(
  operation: Command,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer> | undefined> {
  const frame = await newFrame();
  signal?.throwIfAborted();
  try {
    const start = await command(frame, operation);
    if (start.status === 'missing') return undefined;
    if (
      start.status !== 'download' ||
      !Number.isSafeInteger(start.length) ||
      start.length < 1 ||
      start.length > maxBodyBytes ||
      !/^[a-f\d]{64}$/.test(start.sha256)
    )
      throw new Error('桌面数据长度或 SHA-256 回执无效。');
    const bytes = new Uint8Array(start.length);
    const hash = sha256.create();
    for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
      signal?.throwIfAborted();
      const buffer = await invoke<ArrayBuffer>('repository_read_chunk', {
        frame,
        offset,
      });
      if (
        Object.prototype.toString.call(buffer) !== '[object ArrayBuffer]' ||
        buffer.byteLength !== Math.min(chunkBytes, bytes.length - offset)
      )
        throw new Error('读取数据块不完整。');
      const chunk = new Uint8Array(buffer);
      bytes.set(chunk, offset);
      hash.update(chunk);
    }
    signal?.throwIfAborted();
    if (bytesToHex(hash.digest()) !== start.sha256)
      throw new Error('桌面数据 SHA-256 校验失败。');
    return bytes;
  } catch (error) {
    await command(frame, { op: 'cancel' }).catch(() => {});
    throw error;
  }
}

async function write(
  kind: RepositoryKind,
  id: string,
  body: Blob | Uint8Array<ArrayBuffer>,
  summary: string,
  signal?: AbortSignal,
  onChunk?: (acceptedBytes: number) => void,
) {
  const length = ArrayBuffer.isView(body) ? body.byteLength : body.size;
  if (!length || length > maxBodyBytes)
    throw new Error('桌面记录超过 256 MiB 或为空。');
  const summaryBytes = new TextEncoder().encode(summary);
  if (!summaryBytes.length || summaryBytes.length > 20 * chunkBytes)
    throw new Error('桌面摘要超过 20 MiB 或为空。');
  const frame = await newFrame();
  signal?.throwIfAborted();
  let commitDispatched = false;
  try {
    const reply = await command(frame, {
      op: 'beginSave',
      kind,
      id,
      summaryLength: summaryBytes.length,
      length,
    });
    if (reply.status !== 'ready') throw new Error('服务未准备好接收正文。');
    const hash = sha256.create();
    let offset = 0;
    for (const field of [body, summaryBytes]) {
      const size = ArrayBuffer.isView(field) ? field.byteLength : field.size;
      for (let pos = 0; pos < size; pos += chunkBytes) {
        signal?.throwIfAborted();
        const end = Math.min(size, pos + chunkBytes);
        const chunk = ArrayBuffer.isView(field)
          ? field.subarray(pos, end)
          : new Uint8Array(await field.slice(pos, end).arrayBuffer());
        hash.update(chunk);
        const accepted = await invoke<number>(
          'repository_upload_chunk',
          chunk,
          {
            headers: {
              'x-riverlab-version': String(version),
              'x-riverlab-session': frame.sessionId,
              'x-riverlab-request': frame.requestId,
              'x-riverlab-offset': String(offset),
            },
          },
        );
        offset += chunk.length;
        if (accepted !== offset)
          throw new Error('服务确认的数据块位置不匹配。');
        onChunk?.(accepted);
      }
    }
    signal?.throwIfAborted();
    const commit = { op: 'commit', sha256: bytesToHex(hash.digest()) } as const;
    commitDispatched = true;
    const receipt = await command(frame, commit).catch((error: unknown) => {
      // Only a transport failure leaves the commit result unknown. Retry the same
      // transfer identity; the native service remembers successful transactions.
      if (error instanceof ServiceError || error instanceof DOMException)
        throw error;
      return command(frame, commit);
    });
    if (receipt.status !== 'committed')
      throw new Error('未收到 SQLite 提交回执。');
  } catch (error) {
    const status = await command(frame, { op: 'cancel' }).catch(
      () => undefined,
    );
    if (commitDispatched && status?.status === 'committed') return;
    throw error;
  }
}

const decoder = () => new TextDecoder('utf-8', { fatal: true });

export const desktopRepository = {
  async save(
    kind: RepositoryKind,
    id: string,
    body: unknown,
    summary: unknown,
  ) {
    await write(
      kind,
      id,
      new Blob([JSON.stringify(body)]),
      JSON.stringify(summary),
    );
  },
  saveBytes(
    kind: RepositoryKind,
    id: string,
    body: Uint8Array<ArrayBuffer>,
    summary: string,
    signal?: AbortSignal,
    onChunk?: (acceptedBytes: number) => void,
  ) {
    return write(kind, id, body, summary, signal, onChunk);
  },
  getBytes(kind: RepositoryKind, id: string, signal?: AbortSignal) {
    return read({ op: 'load', kind, id }, signal);
  },
  async get(kind: RepositoryKind, id: string): Promise<unknown> {
    const bytes = await read({ op: 'load', kind, id });
    return bytes && JSON.parse(decoder().decode(bytes));
  },
  async list(kind: RepositoryKind): Promise<unknown[]> {
    const bytes = await read({ op: 'list', kind });
    if (!bytes) throw new Error('未读取到摘要列表。');
    const header = new DataView(bytes.buffer);
    let offset = 0;
    function nextLength() {
      if (offset + 4 > header.byteLength) throw new Error('摘要列表帧不完整。');
      const value = header.getUint32(offset, true);
      offset += 4;
      return value;
    }
    const count = nextLength();
    const rows: unknown[] = [];
    const utf8 = decoder();
    for (let i = 0; i < count; i++) {
      const length = nextLength();
      const end = offset + length;
      if (end > bytes.length) throw new Error('摘要列表帧不完整。');
      try {
        rows.push(JSON.parse(utf8.decode(bytes.subarray(offset, end))));
      } catch {
        // The shared domain validator counts damaged rows without hiding healthy ones.
        rows.push(null);
      }
      offset = end;
    }
    if (offset !== bytes.length) throw new Error('摘要列表帧长度错误。');
    return rows;
  },
  async remove(kind: RepositoryKind, id: string) {
    const reply = await command(await newFrame(), { op: 'delete', kind, id });
    if (reply.status !== 'committed') throw new Error('未收到删除事务回执。');
  },
};
