import { MIN_SAMPLES_FOR_P90, MIN_SAMPLES_FOR_P95 } from "@bunbench/shared";

export function mean(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** Sample standard deviation (Bessel-corrected, n-1). Zero for fewer than two samples. */
export function sampleStdDev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  let acc = 0;
  for (const v of values) acc += (v - m) ** 2;
  return Math.sqrt(acc / (values.length - 1));
}

export function sortAscending(values: readonly number[]): number[] {
  return values.slice().sort((a, b) => a - b);
}

/**
 * Percentile with linear interpolation between closest ranks (Hyndman & Fan type 7, the
 * default in R and NumPy). `sorted` must be ascending. `p` is in [0, 100].
 */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  if (p <= 0) return sorted[0]!;
  if (p >= 100) return sorted[sorted.length - 1]!;
  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const weight = rank - lower;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * weight;
}

export function median(values: readonly number[]): number {
  return percentile(sortAscending(values), 50);
}

// Two-sided 95% Student t critical values for df = 1..30.
const T_95 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12,
  2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
];

export function tCritical95(df: number): number {
  if (df < 1) return Number.NaN;
  if (df <= 30) return T_95[df - 1]!;
  if (df <= 40) return 2.021;
  if (df <= 60) return 2.0;
  if (df <= 120) return 1.98;
  return 1.96;
}

export interface SampleSummary {
  count: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  stddev: number;
  /** Coefficient of variation in percent. */
  cvPct: number;
  /** Half-width of the 95% confidence interval of the mean; null with fewer than 2 samples. */
  ci95: number | null;
  /** Null when the sample is too small for a meaningful value. */
  p90: number | null;
  p95: number | null;
}

export function summarize(values: readonly number[]): SampleSummary {
  if (values.length === 0) throw new Error("Cannot summarize an empty sample");
  for (const v of values) {
    if (!Number.isFinite(v)) throw new Error("Sample contains a non-finite value");
  }
  const sorted = sortAscending(values);
  const m = mean(sorted);
  const sd = sampleStdDev(sorted);
  const n = sorted.length;
  return {
    count: n,
    mean: m,
    median: percentile(sorted, 50),
    min: sorted[0]!,
    max: sorted[n - 1]!,
    stddev: sd,
    cvPct: m === 0 ? 0 : (sd / m) * 100,
    ci95: n >= 2 ? (tCritical95(n - 1) * sd) / Math.sqrt(n) : null,
    p90: n >= MIN_SAMPLES_FOR_P90 ? percentile(sorted, 90) : null,
    p95: n >= MIN_SAMPLES_FOR_P95 ? percentile(sorted, 95) : null,
  };
}

/** Upper bounds (ms) of the latency histogram buckets; the last bucket is open-ended. */
export const LATENCY_BUCKETS_MS = [0.25, 0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 5000, Infinity];

/** Counts values into buckets with the given ascending upper bounds (inclusive). */
export function histogram(values: readonly number[], upperBounds: readonly number[] = LATENCY_BUCKETS_MS): number[] {
  const counts = new Array<number>(upperBounds.length).fill(0);
  for (const v of values) {
    let lo = 0;
    let hi = upperBounds.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (v <= upperBounds[mid]!) hi = mid;
      else lo = mid + 1;
    }
    counts[lo]!++;
  }
  return counts;
}

export type Direction = "lower" | "higher" | "neutral";

export interface MetricComparison<R extends string> {
  leader: R | null;
  /** How many times better the leader is (>= 1); null when not computable. */
  factor: number | null;
  /** False when the 95% confidence intervals overlap, i.e. the difference may be noise. */
  distinguishable: boolean | null;
}

/**
 * Compares two runtimes on one metric. With confidence intervals supplied, flags whether the
 * difference is distinguishable from measurement noise.
 */
export function compareValues<R extends string>(
  a: { runtime: R; value: number | null; ci95?: number | null },
  b: { runtime: R; value: number | null; ci95?: number | null },
  better: Direction,
): MetricComparison<R> {
  if (better === "neutral" || a.value == null || b.value == null || a.value <= 0 || b.value <= 0) {
    return { leader: null, factor: null, distinguishable: null };
  }
  const aWins = better === "lower" ? a.value < b.value : a.value > b.value;
  const winner = aWins ? a : b;
  const loser = aWins ? b : a;
  const factor = better === "lower" ? loser.value! / winner.value! : winner.value! / loser.value!;
  let distinguishable: boolean | null = null;
  if (a.ci95 != null && b.ci95 != null) {
    const aLo = a.value - a.ci95;
    const aHi = a.value + a.ci95;
    const bLo = b.value - b.ci95;
    const bHi = b.value + b.ci95;
    distinguishable = aHi < bLo || bHi < aLo;
  }
  if (a.value === b.value) return { leader: null, factor: 1, distinguishable: false };
  return { leader: winner.runtime, factor, distinguishable };
}
