import { sha256 } from '@noble/hashes/sha2.js';

/** JSON-compatible records only; ASCII JSON is also its UTF-8 byte representation. */
export function canonicalJson(value: unknown): string {
  const encode = (v: unknown): string => {
    if (v === null || typeof v === 'boolean' || typeof v === 'string')
      return JSON.stringify(v);
    if (typeof v === 'number' && Number.isFinite(v)) return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map(encode).join(',')}]`;
    if (
      v &&
      typeof v === 'object' &&
      Object.getPrototypeOf(v) === Object.prototype
    )
      return `{${Object.keys(v)
        .sort()
        .map(
          (k) =>
            `${JSON.stringify(k)}:${encode((v as Record<string, unknown>)[k])}`,
        )
        .join(',')}}`;
    throw new Error('Identity requires finite, plain JSON values.');
  };
  return encode(value).replace(
    /[\u007f-\uffff]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}
/** Same canonical ASCII byte stream as canonicalJson, without a full report-sized string. */
export function forEachCanonicalChunk(
  value: unknown,
  consume: (bytes: Uint8Array) => void,
): void {
  let ascii = '';
  const flush = () => {
    const bytes = new Uint8Array(ascii.length);
    for (let i = 0; i < ascii.length; i++) bytes[i] = ascii.charCodeAt(i);
    consume(bytes);
    ascii = '';
  };
  // Most report fields are plain ASCII keys, amounts, hashes or enum values.
  // Only strings that need escaping go through the JSON encoder.
  const escaped = new Map<string, string>();
  const plainAscii = /^[\x20-\x21\x23-\x5b\x5d-\x7e]*$/;
  const quote = (value: string) => {
    if (plainAscii.test(value)) return '"' + value + '"';
    const cached = escaped.get(value);
    if (cached !== undefined) return cached;
    const encoded = JSON.stringify(value).replace(
      /[\u007f-\uffff]/g,
      (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
    );
    if (escaped.size < 2048) escaped.set(value, encoded);
    return encoded;
  };
  const encode = (v: unknown): void => {
    if (typeof v === 'string') {
      ascii += quote(v);
    } else if (
      v === null ||
      typeof v === 'boolean' ||
      (typeof v === 'number' && Number.isFinite(v))
    ) {
      ascii += String(v);
    } else if (Array.isArray(v)) {
      ascii += '[';
      for (let i = 0; i < v.length; i++) {
        if (i) ascii += ',';
        if (i in v) encode(v[i]);
      }
      ascii += ']';
    } else if (
      v &&
      typeof v === 'object' &&
      Object.getPrototypeOf(v) === Object.prototype
    ) {
      ascii += '{';
      const keys = Object.keys(v).sort();
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (i) ascii += ',';
        ascii += quote(key) + ':';
        encode((v as Record<string, unknown>)[key]);
      }
      ascii += '}';
    } else {
      throw new Error('Identity requires finite, plain JSON values.');
    }
    if (ascii.length >= 64 * 1024) flush();
  };
  encode(value);
  if (ascii.length) flush();
}

export function contentHash(value: unknown): string {
  const hash = sha256.create();
  forEachCanonicalChunk(value, (bytes) => {
    hash.update(bytes);
  });
  return Array.from(hash.digest(), (b) => b.toString(16).padStart(2, '0')).join(
    '',
  );
}
