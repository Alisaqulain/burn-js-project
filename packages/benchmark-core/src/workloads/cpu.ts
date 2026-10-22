import type { CpuParams } from "@bunbench/shared";
import { FNV_OFFSET, fnv1aInt, fnv1aString, toHex } from "../hash.ts";
import type { PreparedWorkload } from "./types.ts";

/**
 * Sieve of Eratosthenes up to `limit`, then a running integer hash over every prime.
 * Exercises tight loops, typed-array access and 32-bit integer math.
 */
export function sievePrimes(limit: number): { count: number; hash: number } {
  const composite = new Uint8Array(limit + 1);
  let count = 0;
  let hash = FNV_OFFSET;
  for (let i = 2; i <= limit; i++) {
    if (composite[i] === 0) {
      count++;
      hash = fnv1aInt(hash, i);
      for (let j = i * i; j <= limit; j += i) composite[j] = 1;
    }
  }
  return { count, hash };
}

export function prepareCpu(params: CpuParams): PreparedWorkload {
  const { limit } = params;
  return {
    opsUnit: "numbers sieved",
    opsPerRun: limit,
    inputChecksum: toHex(fnv1aString(`cpu:${limit}`)),
    run() {
      const { count, hash } = sievePrimes(limit);
      return `${count}-${toHex(hash)}`;
    },
  };
}
