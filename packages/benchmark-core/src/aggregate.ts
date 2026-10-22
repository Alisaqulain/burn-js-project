import {
  type BenchmarkType,
  type ExecutionStatus,
  type LatencyBucket,
  METRIC_DEFINITIONS,
  MIN_SAMPLES_FOR_CONFIDENCE,
  type MetricKey,
  RUNTIME_LABELS,
  type RuntimeAggregate,
  type RuntimeName,
  type RunWarning,
} from "@bunbench/shared";
import type { ExecutionResult, MetricMap } from "./orchestrator/types.ts";
import { histogram, LATENCY_BUCKETS_MS, mean, percentile, sortAscending, summarize } from "./stats.ts";

/** Coefficient of variation above which a measurement is flagged as noisy. */
export const NOISY_CV_PCT = 10;

function put(map: MetricMap, metric: MetricKey, value: number | null | undefined, sampleCount: number) {
  if (value == null || !Number.isFinite(value)) return;
  const def = METRIC_DEFINITIONS[metric];
  map[metric] = { metric, value, unit: def.unit, better: def.better, sampleCount };
}

function maxOf(values: (number | null)[]): number | null {
  const finite = values.filter((v): v is number => v != null && Number.isFinite(v));
  return finite.length ? Math.max(...finite) : null;
}

/** Computes aggregate metrics for one runtime from its successful executions (pooled across rounds). */
export function aggregateRuntime(type: BenchmarkType, executions: readonly ExecutionResult[]): MetricMap {
  const metrics: MetricMap = {};
  const measured = executions.flatMap((e) => e.measurements.filter((m) => m.phase === "measured"));
  if (measured.length === 0) return metrics;
  const n = measured.length;

  const elapsed = summarize(measured.map((m) => m.elapsedMs));
  put(metrics, "sample_count", n, n);
  put(metrics, "elapsed_mean_ms", elapsed.mean, n);
  put(metrics, "elapsed_median_ms", elapsed.median, n);
  put(metrics, "elapsed_min_ms", elapsed.min, n);
  put(metrics, "elapsed_max_ms", elapsed.max, n);
  put(metrics, "elapsed_stddev_ms", elapsed.stddev, n);
  put(metrics, "elapsed_cv_pct", elapsed.cvPct, n);
  put(metrics, "elapsed_ci95_ms", elapsed.ci95, n);
  put(metrics, "elapsed_p90_ms", elapsed.p90, n);
  put(metrics, "elapsed_p95_ms", elapsed.p95, n);
  put(metrics, "peak_rss_bytes", maxOf(executions.map((e) => e.peakRssBytes)), executions.length);

  if (type === "http") {
    const ok = measured.reduce((acc, m) => acc + (m.http?.requestsOk ?? 0), 0);
    const failed = measured.reduce((acc, m) => acc + (m.http?.requestsFailed ?? 0), 0);
    const rates = measured.filter((m) => m.elapsedMs > 0).map((m) => (m.http?.requestsOk ?? 0) / (m.elapsedMs / 1_000));
    put(metrics, "http_rps", rates.length ? mean(rates) : null, n);
    put(metrics, "ops_per_sec", rates.length ? mean(rates) : null, n);
    put(metrics, "http_requests_ok", ok, n);
    put(metrics, "http_requests_failed", failed, n);
    put(metrics, "http_error_rate_pct", ok + failed > 0 ? (failed / (ok + failed)) * 100 : null, n);
    const latencies = sortAscending(executions.flatMap((e) => e.latenciesMs));
    if (latencies.length > 0) {
      put(metrics, "http_latency_mean_ms", mean(latencies), latencies.length);
      put(metrics, "http_latency_p50_ms", percentile(latencies, 50), latencies.length);
      put(metrics, "http_latency_p90_ms", percentile(latencies, 90), latencies.length);
      put(metrics, "http_latency_p95_ms", percentile(latencies, 95), latencies.length);
      put(metrics, "http_latency_p99_ms", percentile(latencies, 99), latencies.length);
    }
    put(metrics, "server_rss_after_bytes", maxOf(executions.map((e) => e.serverRssAfterBytes)), executions.length);
  } else {
    const rates = measured.filter((m) => m.elapsedMs > 0).map((m) => m.ops / (m.elapsedMs / 1_000));
    put(metrics, "ops_per_sec", rates.length ? mean(rates) : null, n);
    put(metrics, "inproc_rss_max_bytes", maxOf(measured.map((m) => m.rssBytes)), n);
    put(metrics, "heap_used_max_bytes", maxOf(measured.map((m) => m.heapUsedBytes)), n);
  }
  return metrics;
}

function runtimeStatus(executions: readonly ExecutionResult[]): ExecutionStatus {
  if (executions.some((e) => e.status === "completed")) return "completed";
  return executions[executions.length - 1]?.status ?? "unavailable";
}

export interface AggregationResult {
  aggregates: RuntimeAggregate[];
  latencyHistogram: LatencyBucket[];
  warnings: RunWarning[];
  checksumMismatch: boolean;
}

/** Aggregates all executions of a run and derives fairness / quality warnings. */
export function aggregateRun(
  type: BenchmarkType,
  requested: readonly RuntimeName[],
  executions: readonly ExecutionResult[],
): AggregationResult {
  const aggregates: RuntimeAggregate[] = [];
  const latencyHistogram: LatencyBucket[] = [];
  const warnings: RunWarning[] = [];

  for (const runtime of requested) {
    const own = executions.filter((e) => e.runtime === runtime);
    const successful = own.filter((e) => e.status === "completed");
    const metrics = aggregateRuntime(type, successful);
    aggregates.push({ runtime, status: runtimeStatus(own), metrics });

    const label = RUNTIME_LABELS[runtime];
    const unavailable = own.find((e) => e.status === "unavailable");
    if (unavailable) {
      warnings.push({ code: "runtime_unavailable", message: `${label} was unavailable: ${unavailable.errorMessage ?? "unknown reason"}. No results were substituted.` });
    }
    const failedExecs = own.filter((e) => e.status === "failed" || e.status === "timeout");
    if (failedExecs.length > 0) {
      warnings.push({
        code: "execution_failed",
        message: `${failedExecs.length} of ${own.length} ${label} execution(s) did not complete (${failedExecs.map((e) => e.status).join(", ")}). Aggregates use successful executions only.`,
      });
    }
    const n = metrics.sample_count?.value ?? 0;
    if (successful.length > 0 && n < MIN_SAMPLES_FOR_CONFIDENCE) {
      warnings.push({ code: "few_samples", message: `${label}: only ${n} measured sample(s). Use at least ${MIN_SAMPLES_FOR_CONFIDENCE} iterations before drawing conclusions.` });
    }
    const cv = metrics.elapsed_cv_pct?.value;
    if (cv !== undefined && cv > NOISY_CV_PCT && n >= 2) {
      warnings.push({ code: "noisy", message: `${label}: iteration times vary by ${cv.toFixed(1)}% (coefficient of variation). Background activity or too-short iterations may be distorting results.` });
    }
    const failedRequests = metrics.http_requests_failed?.value ?? 0;
    if (failedRequests > 0) {
      warnings.push({ code: "http_failures", message: `${label}: ${failedRequests} HTTP request(s) failed and were excluded from throughput.` });
    }
    if (type === "http") {
      const latencies = successful.flatMap((e) => e.latenciesMs);
      const counts = histogram(latencies, LATENCY_BUCKETS_MS);
      counts.forEach((count, i) => {
        const upper = LATENCY_BUCKETS_MS[i]!;
        latencyHistogram.push({ runtime, upperMs: Number.isFinite(upper) ? upper : -1, count });
      });
    }
  }

  const measuredRuntimes = aggregates.filter((a) => a.status === "completed").map((a) => a.runtime);
  if (requested.length > 1 && measuredRuntimes.length < requested.length) {
    warnings.push({ code: "incomplete_comparison", message: "Comparison is incomplete: not every requested runtime produced results." });
  }
  if (requested.length === 1) {
    warnings.push({ code: "single_runtime", message: "Only one runtime was measured; this run cannot be used for a direct comparison." });
  }

  const checksums = new Set(
    executions.filter((e) => e.status === "completed" && e.outputChecksum).map((e) => e.outputChecksum),
  );
  const checksumMismatch = checksums.size > 1;
  if (checksumMismatch) {
    warnings.push({ code: "checksum_mismatch", message: `Result verification failed: runtimes produced different outputs (${[...checksums].join(" vs ")}).` });
  }
  if (type === "http") {
    warnings.push({ code: "http_client_overhead", message: "HTTP results include load-client overhead. The same Bun-based client is used for both servers, so overhead is constant but not zero." });
  }
  return { aggregates, latencyHistogram, warnings, checksumMismatch };
}
