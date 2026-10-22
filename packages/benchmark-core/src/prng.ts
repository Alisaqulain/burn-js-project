/**
 * Mulberry32: a tiny, fast, deterministic 32-bit PRNG. Uses only integer ops and Math.imul,
 * so it produces bit-identical sequences on V8 (Node.js) and JavaScriptCore (Bun).
 */
export function createPrng(seed: number): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic integer in [0, maxExclusive). */
export function randomInt(next: () => number, maxExclusive: number): number {
  return Math.floor(next() * maxExclusive);
}
