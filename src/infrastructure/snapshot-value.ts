// Portable projection of an IndexedDB value. The JSON bytes retain the emitted
// property order; the descriptor preserves allowed own undefined fields.
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { RepositoryKind } from './desktop-repository';

export type SnapshotRole = 'body' | 'summary';
export const MIB = 1024 * 1024;
const textEncoder = new TextEncoder();
const textChunk = 16 * 1024;

type Path = (string | number)[];
interface Alias {
  path: Path;
  target: Path;
}
interface Difference {
  path: Path;
  keys: string[];
  undefinedKeys: string[];
}

function* quoted(value: string): Generator<string> {
  yield '"';
  for (let offset = 0; offset < value.length;) {
    let end = Math.min(offset + textChunk, value.length);
    // JSON.stringify escapes unpaired surrogates. Never create an artificial
    // unpaired surrogate by splitting an original pair between chunks.
    if (end < value.length) {
      const last = value.charCodeAt(end - 1),
        next = value.charCodeAt(end);
      if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff)
        end--;
    }
    yield JSON.stringify(value.slice(offset, end)).slice(1, -1);
    offset = end;
  }
  yield '"';
}

function optionalField(
  kind: RepositoryKind,
  parent: Path,
  key: string,
): boolean {
  if (kind !== 'dataset') return false;
  if (parent.length === 1 && parent[0] === 'source')
    return key === 'url' || key === 'expectedSha256';
  return (
    parent.length === 3 &&
    parent[0] === 'quality' &&
    parent[1] === 'issues' &&
    typeof parent[2] === 'number' &&
    parent[2] >= 0 &&
    parent[2] < 1000 &&
    ['line', 'field', 'raw'].includes(key)
  );
}

function plainObject(value: object) {
  // IDB and Worker structured clones may originate from another JS realm.
  const proto: unknown = Object.getPrototypeOf(value);
  return (
    proto !== null &&
    typeof proto === 'object' &&
    Object.getPrototypeOf(proto) === null &&
    Object.hasOwn(proto, 'constructor') &&
    Function.prototype.toString.call(proto.constructor) ===
      Function.prototype.toString.call(Object)
  );
}

// Retain paths only for objects that actually have aliases. A large research
// record can contain hundreds of thousands of distinct candle/ledger objects.
function sharedObjects(value: unknown) {
  const seen = new WeakSet<object>(),
    shared = new WeakSet<object>();
  function scan(node: unknown, depth: number) {
    if (typeof node !== 'object' || node === null) return;
    if (depth > 64) throw new Error('结构化克隆层数超过 64。');
    if (seen.has(node)) {
      shared.add(node);
      return;
    }
    seen.add(node);
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const d = Object.getOwnPropertyDescriptor(node, i);
        if (!d || !('value' in d)) throw new Error('数组含空洞或访问器。');
        scan(d.value, depth + 1);
      }
    } else if (plainObject(node)) {
      for (const key of Object.getOwnPropertyNames(node)) {
        const d = Object.getOwnPropertyDescriptor(node, key)!;
        if (!('value' in d) || !d.enumerable)
          throw new Error('对象含访问器或不可枚举属性。');
        scan(d.value, depth + 1);
      }
    }
  }
  scan(value, 0);
  return shared;
}

interface CloneDetails {
  objects: Difference[];
  aliases: Alias[];
}
function projection(
  value: unknown,
  kind: RepositoryKind,
  details: CloneDetails,
) {
  const shared = sharedObjects(value);
  const firstPath = new WeakMap<object, Path>();
  const active = new WeakSet<object>();
  let descriptorMinimum = 0;
  const charge = (items: (string | number)[]) => {
    descriptorMinimum += items.reduce<number>(
      (n, item) => n + String(item).length + 1,
      2,
    );
    if (descriptorMinimum > 20 * MIB) throw new Error('克隆描述超过 20 MiB。');
  };
  const path: Path = [];
  function refuse(reason: string): never {
    throw new Error(
      `结构化克隆无法无损保存（${JSON.stringify(path)}）：${reason}。`,
    );
  }
  function* visit(node: unknown, capture: boolean): Generator<string> {
    if (path.length > 64) refuse('层数超过 64');
    if (typeof node === 'string') {
      yield* quoted(node);
      return;
    }
    if (node === null || typeof node === 'boolean') {
      yield String(node);
      return;
    }
    if (
      typeof node === 'number' &&
      Number.isFinite(node) &&
      !Object.is(node, -0)
    ) {
      yield JSON.stringify(node);
      return;
    }
    if (typeof node !== 'object' || node === null) refuse('无法表示的值或数值');
    if (active.has(node)) refuse('循环对象引用');
    if (capture && shared.has(node)) {
      const target = firstPath.get(node);
      if (target) {
        charge(path);
        charge(target);
        details.aliases.push({ path: [...path], target });
        capture = false;
      } else firstPath.set(node, [...path]);
    }
    active.add(node);
    if (Object.getOwnPropertySymbols(node).length) refuse('含 Symbol 属性');
    if (Array.isArray(node)) {
      // Check additional named properties without allocating an array of every index.
      for (const key in node) {
        if (
          Object.hasOwn(node, key) &&
          (String(Number(key)) !== key ||
            !Number.isInteger(Number(key)) ||
            Number(key) < 0 ||
            Number(key) >= node.length)
        )
          refuse('数组含非索引属性');
      }
      yield '[';
      for (let i = 0; i < node.length; i++) {
        if (!Object.hasOwn(node, i)) refuse('数组含空洞');
        if (i) yield ',';
        path.push(i);
        yield* visit(node[i], capture);
        path.pop();
      }
      yield ']';
      active.delete(node);
      return;
    }
    if (!plainObject(node)) refuse('仅支持普通对象和稠密数组');
    const record = node as Record<string, unknown>;
    const keys = Object.keys(record);
    const undefinedKeys: string[] = [];
    for (const key of keys) {
      if (['__proto__', 'constructor', 'prototype'].includes(key))
        refuse('含保留键');
      const descriptor = Object.getOwnPropertyDescriptor(record, key)!;
      if (!('value' in descriptor)) refuse('属性不是数据属性');
      if (descriptor.value === undefined) {
        if (!optionalField(kind, path, key))
          refuse(`不支持的 undefined 属性 ${key}`);
        undefinedKeys.push(key);
      }
    }
    if (capture && undefinedKeys.length) {
      charge(keys);
      charge(path);
      charge(undefinedKeys);
      details.objects.push({ path: [...path], keys, undefinedKeys });
    }
    yield '{';
    let emitted = false;
    for (const key of keys) {
      if (record[key] === undefined) continue;
      if (emitted) yield ',';
      emitted = true;
      yield* quoted(key);
      yield ':';
      path.push(key);
      yield* visit(record[key], capture);
      path.pop();
    }
    yield '}';
    active.delete(node);
  }
  return visit(value, true);
}

function* jsonArray(values: Path) {
  yield '[';
  for (let i = 0; i < values.length; i++) {
    if (i) yield ',';
    const value = values[i];
    if (typeof value === 'string') yield* quoted(value);
    else yield String(value);
  }
  yield ']';
}

function* descriptor(details: CloneDetails) {
  yield '{"version":1,"objects":[';
  for (const [i, item] of details.objects.entries()) {
    if (i) yield ',';
    yield '{"path":';
    yield* jsonArray(item.path);
    yield ',"keys":';
    yield* jsonArray(item.keys);
    yield ',"undefinedKeys":';
    yield* jsonArray(item.undefinedKeys);
    yield '}';
  }
  yield '],"aliases":[';
  for (const [i, item] of details.aliases.entries()) {
    if (i) yield ',';
    yield '{"path":';
    yield* jsonArray(item.path);
    yield ',"target":';
    yield* jsonArray(item.target);
    yield '}';
  }
  yield ']}';
}

export interface SnapshotValueFingerprint {
  projectionBytes: number;
  projectionSha256: string;
  cloneBytes: number;
  cloneSha256: string;
}

type Consume = (tag: 3 | 4, bytes: Uint8Array<ArrayBuffer>) => Promise<void>;
async function field(
  tag: 3 | 4,
  tokens: Iterable<string>,
  limit: number,
  consume: Consume | undefined,
  signal?: AbortSignal,
) {
  const hash = sha256.create();
  let length = 0;
  let buffer = '';
  const flush = async () => {
    signal?.throwIfAborted();
    const bytes = textEncoder.encode(buffer);
    buffer = '';
    length += bytes.length;
    if (length > limit) throw new Error('快照记录或克隆描述超过格式容量限制。');
    hash.update(bytes);
    await consume?.(tag, bytes);
  };
  for (const token of tokens) {
    buffer += token;
    if (buffer.length >= 64 * 1024) await flush();
  }
  if (buffer) await flush();
  return { length, digest: bytesToHex(hash.digest()) };
}

export async function encodeSnapshotValue(
  kind: RepositoryKind,
  role: SnapshotRole,
  value: unknown,
  consume?: Consume,
  signal?: AbortSignal,
): Promise<SnapshotValueFingerprint> {
  const details: CloneDetails = { objects: [], aliases: [] };
  const data = await field(
    3,
    projection(value, kind, details),
    (role === 'summary' ? 20 : 256) * MIB,
    consume,
    signal,
  );
  const sidecar = await field(
    4,
    descriptor(details),
    20 * MIB,
    consume,
    signal,
  );
  return {
    projectionBytes: data.length,
    projectionSha256: data.digest,
    cloneBytes: sidecar.length,
    cloneSha256: sidecar.digest,
  };
}
