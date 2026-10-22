import { describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS, type LiveProgress, type RunDetail } from "@bunbench/shared";
import { formatBytes, formatMetric, formatMs, formatRelative } from "../src/lib/format";
import { toQueryString } from "../src/lib/api";
import { buildConfig, validateForm } from "../src/lib/benchmark-form";
import { overallProgress } from "../src/lib/progress";

const form = {
  type: "cpu" as const,
  runtimes: ["bun" as const, "node" as const],
  iterations: "10",
  warmups: "3",
  rounds: "1",
  maxDurationSec: "60",
  seed: "1337",
  label: "  test  ",
  params: { limit: "500000" },
};

describe("form validation (mirrors the API)", () => {
  test("builds a valid payload", () => {
    expect(buildConfig(form)).toEqual({
      type: "cpu",
      params: { limit: 500_000 },
      runtimes: ["bun", "node"],
      iterations: 10,
      warmups: 3,
      rounds: 1,
      maxDurationMs: 60_000,
      seed: 1337,
      label: "test",
    });
    expect(validateForm(form, DEFAULT_SETTINGS)).toEqual({});
  });

  test("reports field errors for invalid values", () => {
    const errors = validateForm({ ...form, iterations: "", params: { limit: "5" }, maxDurationSec: "0.5" }, DEFAULT_SETTINGS);
    expect(errors.iterations).toBe("Enter a whole number");
    expect(errors["params.limit"]).toBeDefined();
    expect(errors.maxDurationSec).toBeDefined();
  });

  test("enforces settings limits and runtime selection", () => {
    expect(validateForm({ ...form, iterations: "150" }, DEFAULT_SETTINGS).limits).toContain("iterations");
    expect(validateForm({ ...form, runtimes: [] }, DEFAULT_SETTINGS).runtimes).toBeDefined();
  });

  test("HTTP sends warmups as 0 (warm-up is a request count)", () => {
    const http = buildConfig({ ...form, type: "http", params: { requests: "100", concurrency: "4", payloadItems: "5", warmupRequests: "10", requestTimeoutMs: "1000" } });
    expect(http.warmups).toBe(0);
  });
});

describe("formatting", () => {
  test("units", () => {
    expect(formatMs(0.1234)).toBe("0.123 ms");
    expect(formatMs(12.345)).toBe("12.35 ms");
    expect(formatMs(12_345)).toBe("12.35 s");
    expect(formatBytes(1_048_576)).toBe("1 MB");
    expect(formatMetric("http_rps", 12_345)).toBe("12.3K req/s");
    expect(formatMetric("elapsed_cv_pct", 3.14159)).toBe("3.14%");
    expect(formatMetric("elapsed_mean_ms", null)).toBe("—");
    expect(formatRelative(new Date(Date.now() - 5 * 60_000).toISOString())).toBe("5 min ago");
  });

  test("query strings skip empty values", () => {
    expect(toQueryString({ a: "1", b: "", c: undefined, d: 2 })).toBe("?a=1&d=2");
    expect(toQueryString({})).toBe("");
  });
});

describe("live progress", () => {
  const live: LiveProgress = {
    status: "running",
    runtime: "bun",
    round: 1,
    phase: "measured",
    iteration: 5,
    total: 10,
    executionsDone: 1,
    executionsTotal: 2,
    startedAt: null,
    message: null,
  };
  const run = { type: "cpu", config: { type: "cpu", warmups: 10, iterations: 10, params: { limit: 1000 } } } as unknown as RunDetail;

  test("combines finished processes with measurable iteration progress", () => {
    // 1 of 2 processes done; current: 10 warm-ups + 5 of 10 measured = 15/20.
    expect(overallProgress(live, run)).toBeCloseTo((1 + 15 / 20) / 2, 10);
  });

  test("returns null when the plan is unknown (no invented percentages)", () => {
    expect(overallProgress({ ...live, executionsTotal: 0 }, run)).toBeNull();
  });
});
