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
export function contentHash(value: unknown): string {
  const ascii = canonicalJson(value);
  return Array.from(
    sha256(Uint8Array.from(ascii, (c) => c.charCodeAt(0))),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
}
