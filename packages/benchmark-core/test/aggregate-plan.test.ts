import { describe, expect, test } from "bun:test";
import type { RunnerMeasurementEvent } from "@bunbench/shared";
import { aggregateRun, aggregateRuntime } from "../src/aggregate.ts";
import { buildExecutionPlan, shuffle } from "../src/orchestrator/plan.ts";
import type { ExecutionResult } from "../src/orchestrator/types.ts";

function measurement(i: number, elapsedMs: number, extra: Partial<RunnerMeasurementEvent> = {}): RunnerMeasurementEvent {
  return { type: "measurement", phase: "measured", iteration: i, elapsedMs, ops: 1_000, rssBytes: 10 * i, heapUsedBytes: 5 * i, checksum: "x", ...extra };
}

function execution(overrides: Partial<ExecutionResult>): ExecutionResult {
  return {
    runtime: "bun",
    round: 1,
    orderIndex: 0,
    status: "completed",
    exitCode: 0,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
    durationMs: 1,
    peakRssBytes: 1_000,
    env: null,
    clientEnv: null,
    measurements: [],
    inputChecksum: "in",
    outputChecksum: "out",
    opsUnit: "ops",
    latenciesMs: [],
    errorSamples: [],
    serverRssAfterBytes: null,
    ...overrides,
  };
}

describe("execution plan", () => {
  test("shuffle is a permutation", () => {
    expect(shuffle([1, 2, 3, 4], () => 0.3).sort()).toEqual([1, 2, 3, 4]);
  });

  test("alternates order across rounds (ABBA)", () => {
    const plan = buildExecutionPlan(["bun", "node"], 4, () => 0.99);
    expect(plan).toHaveLength(4);
    expect(plan[0]).toEqual(plan[2]!);
    expect(plan[1]).toEqual(plan[0]!.slice().reverse());
    expect(plan[3]).toEqual(plan[1]!);
  });

  test("randomizes the first-round order", () => {
    const a = buildExecutionPlan(["bun", "node"], 1, () => 0.0)[0];
    const b = buildExecutionPlan(["bun", "node"], 1, () => 0.99)[0];
    expect(a).not.toEqual(b);
  });

  test("empty runtime list yields an empty plan", () => {
    expect(buildExecutionPlan([], 3)).toEqual([]);
  });
});

describe("aggregation", () => {
  test("pools measured iterations across rounds", () => {
    const m = aggregateRuntime("cpu", [
      execution({ measurements: [measurement(1, 10), measurement(2, 12)], peakRssBytes: 500 }),
      execution({ round: 2, measurements: [measurement(1, 14), measurement(2, 16)], peakRssBytes: 900 }),
    ]);
    expect(m.sample_count?.value).toBe(4);
    expect(m.elapsed_mean_ms?.value).toBe(13);
    expect(m.elapsed_median_ms?.value).toBe(13);
    expect(m.elapsed_min_ms?.value).toBe(10);
    expect(m.peak_rss_bytes?.value).toBe(900);
    expect(m.elapsed_mean_ms?.better).toBe("lower");
    expect(m.ops_per_sec?.better).toBe("higher");
    expect(m.elapsed_p90_ms).toBeUndefined();
  });

  test("ignores warm-up measurements", () => {
    const m = aggregateRuntime("cpu", [execution({ measurements: [measurement(1, 999, { phase: "warmup" }), measurement(1, 10)] })]);
    expect(m.sample_count?.value).toBe(1);
  });

  test("HTTP throughput excludes failed requests and computes error rate", () => {
    const http = (ok: number, failed: number) => ({ requestsOk: ok, requestsFailed: failed, latencyMeanMs: 1, latencyP50Ms: 1, latencyP90Ms: 1, latencyP95Ms: 1, latencyP99Ms: 1 });
    const m = aggregateRuntime("http", [
      execution({
        measurements: [measurement(1, 1_000, { http: http(90, 10) }), measurement(2, 500, { http: http(100, 0) })],
        latenciesMs: [1, 2, 3, 4],
      }),
    ]);
    expect(m.http_rps?.value).toBe((90 + 200) / 2);
    expect(m.http_requests_ok?.value).toBe(190);
    expect(m.http_requests_failed?.value).toBe(10);
    expect(m.http_error_rate_pct?.value).toBeCloseTo(5, 10);
    expect(m.http_latency_p50_ms?.value).toBe(2.5);
  });

  test("flags unavailable runtimes, incomplete comparisons and checksum mismatches", () => {
    const result = aggregateRun("cpu", ["bun", "node"], [
      execution({ runtime: "bun", measurements: [measurement(1, 10)], outputChecksum: "a" }),
      execution({ runtime: "node", status: "unavailable", errorMessage: "not found", measurements: [] }),
    ]);
    const codes = result.warnings.map((w) => w.code);
    expect(codes).toContain("runtime_unavailable");
    expect(codes).toContain("incomplete_comparison");
    expect(codes).toContain("few_samples");
    expect(result.aggregates.find((a) => a.runtime === "node")?.status).toBe("unavailable");
    expect(result.aggregates.find((a) => a.runtime === "node")?.metrics).toEqual({});

    const mismatch = aggregateRun("cpu", ["bun", "node"], [
      execution({ runtime: "bun", measurements: [measurement(1, 10)], outputChecksum: "a" }),
      execution({ runtime: "node", measurements: [measurement(1, 10)], outputChecksum: "b" }),
    ]);
    expect(mismatch.checksumMismatch).toBe(true);
  });

  test("builds a latency histogram per runtime for HTTP", () => {
    const result = aggregateRun("http", ["bun"], [execution({ measurements: [measurement(1, 10)], latenciesMs: [0.1, 0.3, 3] })]);
    const total = result.latencyHistogram.filter((b) => b.runtime === "bun").reduce((n, b) => n + b.count, 0);
    expect(total).toBe(3);
    expect(result.latencyHistogram.at(-1)?.upperMs).toBe(-1);
  });
});
