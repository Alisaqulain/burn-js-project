import type { MemoryParams } from "@bunbench/shared";
import { FNV_OFFSET, fnv1aInt, fnv1aString, toHex } from "../hash.ts";
import { createPrng, randomInt } from "../prng.ts";
import type { PreparedWorkload } from "./types.ts";

const TAGS = ["red", "green", "blue", "cyan", "magenta", "yellow", "black", "white"];

interface Item {
  id: number;
  name: string;
  values: number[];
  meta: { even: boolean; tag: string; weight: number };
}

/**
 * Allocates `objects` small object graphs (object + string + array + nested object), walks them,
 * then drops every reference so the garbage collector can reclaim them.
 */
export function allocateAndProcess(objects: number, weights: Uint16Array): string {
  const items: Item[] = [];
  for (let i = 0; i < objects; i++) {
    items.push({
      id: i,
      name: `item-${i}`,
      values: [i, i * 2, i * 3],
      meta: { even: (i & 1) === 0, tag: TAGS[i & 7]!, weight: weights[i % weights.length]! },
    });
  }
  let total = 0;
  let evens = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    total = (total + it.values[2]! + it.name.length + it.meta.weight) % 2_147_483_647;
    if (it.meta.even) evens++;
  }
  // `items` becomes unreachable when this function returns, so the GC can reclaim the graph.
  const count = items.length;
  let hash = fnv1aInt(FNV_OFFSET, count);
  hash = fnv1aInt(hash, total);
  hash = fnv1aInt(hash, evens);
  return toHex(hash);
}

export function prepareMemory(params: MemoryParams, seed: number): PreparedWorkload {
  const next = createPrng(seed);
  const weights = new Uint16Array(4_096);
  for (let i = 0; i < weights.length; i++) weights[i] = randomInt(next, 65_536);
  return {
    opsUnit: "objects",
    opsPerRun: params.objects,
    inputChecksum: toHex(fnv1aString(`memory:${params.objects}:${weights.join(",")}`)),
    run: () => allocateAndProcess(params.objects, weights),
  };
}
