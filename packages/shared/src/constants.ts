export const BENCHMARK_TYPES = ["cpu", "json", "array", "http", "memory"] as const;
export type BenchmarkType = (typeof BENCHMARK_TYPES)[number];

export const RUNTIMES = ["bun", "node"] as const;
export type RuntimeName = (typeof RUNTIMES)[number];

export const RUN_STATUSES = ["queued", "preparing", "running", "completed", "failed", "cancelled"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = ["completed", "failed", "cancelled"];

export const EXECUTION_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
  "timeout",
  "cancelled",
  "unavailable",
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export const RUNTIME_LABELS: Record<RuntimeName, string> = {
  bun: "Bun",
  node: "Node.js",
};

export const BENCHMARK_TYPE_INFO: Record<
  BenchmarkType,
  { label: string; description: string; opsUnit: string }
> = {
  cpu: {
    label: "CPU computation",
    description:
      "Sieve of Eratosthenes up to a limit followed by an integer hash over the primes. Pure integer math and typed arrays.",
    opsUnit: "numbers sieved/s",
  },
  json: {
    label: "JSON serialize + parse",
    description:
      "JSON.stringify then JSON.parse of a deterministic array of nested records, followed by a field checksum.",
    opsUnit: "records/s",
  },
  array: {
    label: "Array processing + sort",
    description:
      "Copy, map, filter, reduce and numeric sort of a seeded integer array; the sorted output is verified and hashed.",
    opsUnit: "elements/s",
  },
  http: {
    label: "HTTP throughput + latency",
    description:
      "A dedicated HTTP server on the runtime under test serves a JSON payload; a fixed Bun load client measures throughput and latency.",
    opsUnit: "requests/s",
  },
  memory: {
    label: "Memory allocation",
    description:
      "Allocates many small objects (strings, arrays, nested objects), processes them, then releases them.",
    opsUnit: "objects/s",
  },
};

/**
 * Absolute limits enforced by the API regardless of user settings. Settings may only lower them.
 * Workload sizes are bounded so that the largest allowed workload stays well under ~1 GB of memory.
 */
export const HARD_LIMITS = {
  iterations: { min: 1, max: 200 },
  warmups: { min: 0, max: 50 },
  maxDurationMs: { min: 1_000, max: 300_000 },
  rounds: { min: 1, max: 6 },
  labelMaxLength: 80,
  seed: { min: 0, max: 2 ** 31 - 1 },
  maxConcurrentRuns: { min: 1, max: 2 },
  queueLimit: { min: 1, max: 50 },
  /** HTTP: requests per measured iteration multiplied by iterations. Bounds client-side latency memory. */
  httpTotalMeasuredRequests: 400_000,
} as const;

export const WORKLOAD_LIMITS = {
  cpu: { limit: { min: 1_000, max: 5_000_000, default: 500_000 } },
  json: { records: { min: 10, max: 50_000, default: 5_000 } },
  array: { size: { min: 100, max: 2_000_000, default: 200_000 } },
  memory: { objects: { min: 1_000, max: 500_000, default: 100_000 } },
  http: {
    requests: { min: 10, max: 50_000, default: 2_000 },
    concurrency: { min: 1, max: 128, default: 16 },
    payloadItems: { min: 1, max: 1_000, default: 50 },
    warmupRequests: { min: 0, max: 5_000, default: 200 },
    requestTimeoutMs: { min: 100, max: 30_000, default: 5_000 },
  },
} as const;

export const DEFAULT_SEED = 1_337;

/** Below this many measured samples per runtime, the UI warns that conclusions are weak. */
export const MIN_SAMPLES_FOR_CONFIDENCE = 5;
/** Percentiles of per-iteration timings are only reported with at least this many samples. */
export const MIN_SAMPLES_FOR_P90 = 10;
export const MIN_SAMPLES_FOR_P95 = 20;

export type MetricDirection = "lower" | "higher" | "neutral";

export interface MetricDefinition {
  label: string;
  unit: string;
  better: MetricDirection;
  description: string;
}

/** Every aggregate metric BunBench stores, with its unit and which direction is better. */
export const METRIC_DEFINITIONS = {
  elapsed_mean_ms: { label: "Mean time", unit: "ms", better: "lower", description: "Arithmetic mean of measured iteration wall time." },
  elapsed_median_ms: { label: "Median time", unit: "ms", better: "lower", description: "Median of measured iteration wall time." },
  elapsed_min_ms: { label: "Min time", unit: "ms", better: "lower", description: "Fastest measured iteration." },
  elapsed_max_ms: { label: "Max time", unit: "ms", better: "lower", description: "Slowest measured iteration." },
  elapsed_stddev_ms: { label: "Std deviation", unit: "ms", better: "lower", description: "Sample standard deviation (n-1) of iteration time." },
  elapsed_p90_ms: { label: "P90 time", unit: "ms", better: "lower", description: "90th percentile of iteration time (reported with >= 10 samples)." },
  elapsed_p95_ms: { label: "P95 time", unit: "ms", better: "lower", description: "95th percentile of iteration time (reported with >= 20 samples)." },
  elapsed_ci95_ms: { label: "95% CI half-width", unit: "ms", better: "lower", description: "Half-width of the 95% confidence interval of the mean (Student t)." },
  elapsed_cv_pct: { label: "Coefficient of variation", unit: "%", better: "lower", description: "Std deviation / mean. Above ~10% indicates a noisy measurement." },
  ops_per_sec: { label: "Operations/s", unit: "ops/s", better: "higher", description: "Workload units processed per second, from the mean of per-iteration rates." },
  peak_rss_bytes: { label: "Peak RSS (OS)", unit: "bytes", better: "lower", description: "Peak resident set size reported by the OS after exit (runner process; the server process for HTTP)." },
  inproc_rss_max_bytes: { label: "Max RSS (in-process)", unit: "bytes", better: "lower", description: "Largest process.memoryUsage().rss sampled after each measured iteration." },
  heap_used_max_bytes: { label: "Max heap used", unit: "bytes", better: "lower", description: "Largest engine-reported heapUsed after an iteration. V8 and JavaScriptCore count differently; do not compare directly." },
  http_rps: { label: "Throughput", unit: "req/s", better: "higher", description: "Successful responses per second, mean of measured iterations. Failed requests are excluded." },
  http_error_rate_pct: { label: "Error rate", unit: "%", better: "lower", description: "Failed or invalid responses as a share of all measured requests." },
  http_requests_ok: { label: "Successful requests", unit: "count", better: "neutral", description: "Measured requests that returned 200 with the exact expected body." },
  http_requests_failed: { label: "Failed requests", unit: "count", better: "lower", description: "Measured requests that errored, timed out, or returned an unexpected status/body." },
  http_latency_p50_ms: { label: "Latency P50", unit: "ms", better: "lower", description: "Median request latency measured by the load client." },
  http_latency_p90_ms: { label: "Latency P90", unit: "ms", better: "lower", description: "90th percentile request latency." },
  http_latency_p95_ms: { label: "Latency P95", unit: "ms", better: "lower", description: "95th percentile request latency." },
  http_latency_p99_ms: { label: "Latency P99", unit: "ms", better: "lower", description: "99th percentile request latency." },
  http_latency_mean_ms: { label: "Latency mean", unit: "ms", better: "lower", description: "Mean request latency." },
  server_rss_after_bytes: { label: "Server RSS after load", unit: "bytes", better: "lower", description: "process.memoryUsage().rss reported by the server right after the measured load." },
  sample_count: { label: "Measured samples", unit: "count", better: "neutral", description: "Number of measured iterations pooled across rounds." },
} as const satisfies Record<string, MetricDefinition>;

export type MetricKey = keyof typeof METRIC_DEFINITIONS;
