import type { ArrayParams } from "@bunbench/shared";
import { FNV_OFFSET, fnv1aInt, toHex } from "../hash.ts";
import { createPrng, randomInt } from "../prng.ts";
import type { PreparedWorkload } from "./types.ts";

export function generateIntegers(size: number, seed: number): number[] {
  const next = createPrng(seed);
  const values: number[] = new Array(size);
  for (let i = 0; i < size; i++) values[i] = randomInt(next, 1_000_000);
  return values;
}

/**
 * copy -> map -> filter -> reduce -> numeric sort, then verifies sortedness and hashes a
 * strided sample of the output. Throws if the sort output is not ascending.
 */
export function processArray(source: readonly number[]): string {
  const mapped = source.slice().map((x) => ((x * 3) ^ 0x5bd1) % 2_000_003);
  const filtered = mapped.filter((x) => x % 3 !== 0);
  const sum = filtered.reduce((acc, x) => (acc + x) % 2_147_483_647, 0);
  const sorted = filtered.sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i - 1]! > sorted[i]!) throw new Error(`Sort verification failed at index ${i}`);
  }
  let hash = fnv1aInt(FNV_OFFSET, sorted.length);
  hash = fnv1aInt(hash, sum);
  const stride = Math.max(1, Math.floor(sorted.length / 1_024));
  for (let i = 0; i < sorted.length; i += stride) hash = fnv1aInt(hash, sorted[i]!);
  return toHex(hash);
}

export function prepareArray(params: ArrayParams, seed: number): PreparedWorkload {
  const data = generateIntegers(params.size, seed);
  let inputHash = fnv1aInt(FNV_OFFSET, data.length);
  for (let i = 0; i < data.length; i++) inputHash = fnv1aInt(inputHash, data[i]!);
  return {
    opsUnit: "elements",
    opsPerRun: params.size,
    inputChecksum: toHex(inputHash),
    run: () => processArray(data),
  };
}
