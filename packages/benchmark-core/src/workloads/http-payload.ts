import { fnv1aString, toHex } from "../hash.ts";
import { createPrng, randomInt } from "../prng.ts";

export interface HttpPayload {
  service: string;
  seed: number;
  items: { id: number; sku: string; price: number; inStock: boolean; tags: string[] }[];
}

/** The object both HTTP servers serialize on every request. Identical on both runtimes. */
export function buildHttpPayload(items: number, seed: number): HttpPayload {
  const next = createPrng(seed);
  const list: HttpPayload["items"] = [];
  for (let i = 0; i < items; i++) {
    list.push({
      id: i,
      sku: `SKU-${(100_000 + randomInt(next, 900_000)).toString(36).toUpperCase()}`,
      price: randomInt(next, 100_000) / 100,
      inStock: next() < 0.7,
      tags: [`cat-${randomInt(next, 20)}`, `brand-${randomInt(next, 50)}`],
    });
  }
  return { service: "bunbench", seed, items: list };
}

/** The exact response body a correct server must return. */
export function expectedHttpBody(items: number, seed: number): string {
  return JSON.stringify(buildHttpPayload(items, seed));
}

export function httpPayloadChecksum(items: number, seed: number): string {
  return toHex(fnv1aString(expectedHttpBody(items, seed)));
}

export const HTTP_PATHS = {
  payload: "/payload",
  health: "/health",
  stats: "/__stats",
  shutdown: "/__shutdown",
} as const;
