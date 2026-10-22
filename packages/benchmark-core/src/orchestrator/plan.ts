import type { RuntimeName } from "@bunbench/shared";

/** Fisher-Yates shuffle with an injectable random source (for tests). */
export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Builds the per-round runtime order. Round 1 is randomized to avoid always favouring the runtime
 * that runs first (or second, e.g. due to thermal throttling); later rounds alternate the order
 * (A B, B A, A B, ...) so each runtime occupies each position equally often over even rounds.
 */
export function buildExecutionPlan(
  runtimes: readonly RuntimeName[],
  rounds: number,
  random: () => number = Math.random,
): RuntimeName[][] {
  if (runtimes.length === 0) return [];
  const first = shuffle(runtimes, random);
  const reversed = first.slice().reverse();
  return Array.from({ length: Math.max(1, rounds) }, (_, r) => (r % 2 === 0 ? first.slice() : reversed.slice()));
}
