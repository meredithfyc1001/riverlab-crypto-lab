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
export function contentHash(value: unknown): string {
  const hash = sha256.create();
  let parts: string[] = [];
  let length = 0;
  const flush = () => {
    const ascii = parts.join('');
    const bytes = new Uint8Array(ascii.length);
    for (let i = 0; i < ascii.length; i++) bytes[i] = ascii.charCodeAt(i);
    hash.update(bytes);
    parts = [];
    length = 0;
  };
  const quoted = new Map<string, string>();
  const quote = (text: string) => {
    const cached = quoted.get(text);
    if (cached !== undefined) return cached;
    const encoded = JSON.stringify(text).replace(
      /[\u007f-\uffff]/g,
      (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
    );
    if (quoted.size < 2048) quoted.set(text, encoded);
    return encoded;
  };
  const emit = (text: string) => {
    parts.push(text);
    length += text.length;
    if (length >= 64 * 1024) flush();
  };
  const encode = (v: unknown): void => {
    if (v === null) {
      emit('null');
      return;
    }
    if (typeof v === 'string') {
      emit(quote(v));
      return;
    }
    if (
      typeof v === 'boolean' ||
      (typeof v === 'number' && Number.isFinite(v))
    ) {
      emit(JSON.stringify(v));
      return;
    }
    if (Array.isArray(v)) {
      emit('[');
      for (let i = 0; i < v.length; i++) {
        if (i) emit(',');
        if (i in v) encode(v[i]);
      }
      emit(']');
      return;
    }
    if (
      v &&
      typeof v === 'object' &&
      Object.getPrototypeOf(v) === Object.prototype
    ) {
      emit('{');
      let first = true;
      for (const key of Object.keys(v).sort()) {
        if (!first) emit(',');
        first = false;
        emit(quote(key));
        emit(':');
        encode((v as Record<string, unknown>)[key]);
      }
      emit('}');
      return;
    }
    throw new Error('Identity requires finite, plain JSON values.');
  };
  encode(value);
  if (length) flush();
  return Array.from(hash.digest(), (b) => b.toString(16).padStart(2, '0')).join(
    '',
  );
}
