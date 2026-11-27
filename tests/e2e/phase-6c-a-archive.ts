import { deepStrictEqual } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FixtureDatabase } from './phase-6c-a-fixture';

// Only used on the small synthetic archive from the bundled browser exporter.
export function frames(bytes: Buffer) {
  if (bytes.subarray(0, 8).toString('ascii') !== 'RLIDB001')
    throw new Error('Unexpected migration archive');
  const out: { tag: number; start: number; end: number; payload: Buffer }[] =
    [];
  for (let pos = 8; pos < bytes.length;) {
    const start = pos;
    const tag = bytes[pos];
    const size = Number(bytes.readBigUInt64BE(pos + 1));
    pos += 9;
    if (!Number.isSafeInteger(size) || size > bytes.length - pos)
      throw new Error('Invalid frame size');
    const payload = bytes.subarray(pos, pos + size);
    pos += size;
    out.push({ tag, start, end: pos, payload });
  }
  return out;
}

export function sha256(bytes: Buffer | string) {
  return createHash('sha256').update(bytes).digest('hex');
}

// Python validates the full archive and decodes its members to a new test
// directory. This reader reconstructs the exact object property order,
// including own undefined, without importing an application decoder.
export async function decodedLibraries(
  bytes: Buffer,
  directory: string,
): Promise<FixtureDatabase[]> {
  const rows = frames(bytes);
  const layout = JSON.parse(
    rows.find((frame) => frame.tag === 16)!.payload.toString('utf8'),
  );
  const restored: FixtureDatabase[] = layout.databases.map(
    (db: FixtureDatabase) => ({
      name: db.name,
      version: db.version,
      stores: db.stores.map((store) => ({ name: store.name, values: [] })),
    }),
  );
  let ordinal = 0;
  for (const frame of rows.filter((item) => item.tag === 2)) {
    const meta = JSON.parse(frame.payload.toString('utf8'));
    const prefix = join(directory, String(++ordinal).padStart(8, '0'));
    const projection = JSON.parse(
      await readFile(prefix + '.projection.json', 'utf8'),
    );
    const descriptor = JSON.parse(
      await readFile(prefix + '.clone.json', 'utf8'),
    );
    if (descriptor.version !== 1)
      throw new Error('Unexpected clone descriptor');
    const at = (path: (string | number)[]) =>
      path.reduce<Record<string, unknown>>(
        (value, key) => value[key] as Record<string, unknown>,
        projection,
      );
    const aliases = descriptor.aliases as {
      path: (string | number)[];
      target: (string | number)[];
    }[];
    for (const alias of aliases)
      deepStrictEqual(at(alias.path), at(alias.target));
    for (const entry of descriptor.objects as {
      path: (string | number)[];
      keys: string[];
      undefinedKeys: string[];
    }[]) {
      const parent = entry.path.reduce<Record<string, unknown>>(
        (value, key) => value[key] as Record<string, unknown>,
        projection,
      );
      const present = { ...parent };
      for (const key of Object.keys(parent)) delete parent[key];
      for (const key of entry.keys) {
        Object.defineProperty(parent, key, {
          value: entry.undefinedKeys.includes(key) ? undefined : present[key],
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
    }
    for (const alias of aliases) {
      const parent = at(alias.path.slice(0, -1));
      parent[alias.path[alias.path.length - 1]] = at(alias.target);
    }
    const db = restored.find((db) => db.name === meta.database);
    const store = db?.stores.find((store) => store.name === meta.store);
    if (!store || projection.id !== meta.key || projection.id !== meta.id)
      throw new Error('Test decoder found an incomplete row identity');
    store.values.push(projection);
  }
  return restored;
}

// A value comparison alone cannot distinguish duplicated objects from shared
// ones. Count and locate all shared subobjects in the independent IDB reads.
export function aliasesOf(value: unknown) {
  const visited = new WeakMap<object, (string | number)[]>();
  const aliases: { path: (string | number)[]; target: (string | number)[] }[] =
    [];
  function visit(node: unknown, path: (string | number)[]) {
    if (!node || typeof node !== 'object') return;
    const target = visited.get(node);
    if (target) {
      aliases.push({ path, target });
      return;
    }
    visited.set(node, path);
    for (const [key, child] of Object.entries(node))
      visit(child, [...path, Array.isArray(node) ? Number(key) : key]);
  }
  visit(value, []);
  return aliases;
}
