/** 32-bit FNV-1a over UTF-16 code units. Deterministic across engines. */
export function fnv1aString(input: string, seed = 0x811c9dc5): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Mixes a 32-bit integer into an FNV-1a style running hash. */
export function fnv1aInt(hash: number, value: number): number {
  let h = hash >>> 0;
  let v = value | 0;
  for (let i = 0; i < 4; i++) {
    h ^= v & 0xff;
    h = Math.imul(h, 0x01000193);
    v >>>= 8;
  }
  return h >>> 0;
}

export const FNV_OFFSET = 0x811c9dc5;

export function toHex(hash: number): string {
  return (hash >>> 0).toString(16).padStart(8, "0");
}
