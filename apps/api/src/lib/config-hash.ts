import type { BenchmarkConfig } from "@bunbench/shared";

/** Stable JSON with sorted object keys. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Identifies runs whose measurements are directly comparable: same workload type, parameters,
 * iteration/warm-up counts, rounds and seed. Labels, runtimes and the duration limit are excluded
 * because they do not change what is measured.
 */
export function configHash(config: BenchmarkConfig): string {
  const material = stableStringify({
    type: config.type,
    params: config.params,
    iterations: config.iterations,
    warmups: config.warmups,
    rounds: config.rounds,
    seed: config.seed,
  });
  return new Bun.CryptoHasher("sha256").update(material).digest("hex").slice(0, 16);
}

/** Short human-readable description of workload parameters. */
export function describeParams(config: Pick<BenchmarkConfig, "type" | "params" | "iterations" | "warmups">): string {
  const params = Object.entries(config.params)
    .map(([k, v]) => `${k}=${typeof v === "number" ? v.toLocaleString("en-US") : String(v)}`)
    .join(", ");
  return `${params}; ${config.iterations} iterations, ${config.warmups} warm-ups`;
}
