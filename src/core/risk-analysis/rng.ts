export const RNG_VERSION = 'pcg32-xsh-rr-stream54-rejection-v1';
const MASK64 = (1n << 64n) - 1n;
/** Reference PCG-XSH-RR 64/32, stream54, initstate=uint32 seed. Not cryptographic. */
export function pcg32(seed: number) {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new Error('种子必须为0–4294967295整数。');
  let state = 0n;
  function next(): number {
    const old = state;
    state = (old * 6364136223846793005n + 109n) & MASK64;
    const x = Number((((old >> 18n) ^ old) >> 27n) & 0xffffffffn);
    const rotation = Number(old >> 59n);
    return ((x >>> rotation) | (x << (-rotation & 31))) >>> 0;
  }
  next();
  state = (state + BigInt(seed)) & MASK64;
  next();
  return {
    next,
    bounded(bound: number) {
      if (!Number.isSafeInteger(bound) || bound < 1 || bound > 50000)
        throw new Error('抽样范围必须为1–50000整数。');
      const threshold = 4294967296 % bound;
      let word: number;
      do {
        word = next();
      } while (word < threshold);
      return word % bound;
    },
  };
}
