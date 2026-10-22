import { describe, expect, test } from "bun:test";
import {
  benchmarkConfigSchema,
  checkConfigAgainstSettings,
  compareRequestSchema,
  DEFAULT_SETTINGS,
  HARD_LIMITS,
  listRunsQuerySchema,
  runnerEventSchema,
  settingsSchema,
} from "../src/index.ts";

const base = { runtimes: ["bun", "node"], iterations: 10, warmups: 2, maxDurationMs: 30_000 };

describe("benchmarkConfigSchema", () => {
  test("accepts each benchmark type with defaults applied", () => {
    const cases = [
      { type: "cpu", params: { limit: 1_000 } },
      { type: "json", params: { records: 10 } },
      { type: "array", params: { size: 100 } },
      { type: "memory", params: { objects: 1_000 } },
      { type: "http", params: { requests: 100, concurrency: 10, payloadItems: 5, warmupRequests: 10, requestTimeoutMs: 1_000 } },
    ];
    for (const c of cases) {
      const parsed = benchmarkConfigSchema.parse({ ...base, ...c });
      expect(parsed.rounds).toBe(1);
      expect(parsed.seed).toBe(1337);
    }
  });

  test("rejects out-of-range, unknown and mismatched params", () => {
    expect(benchmarkConfigSchema.safeParse({ ...base, type: "cpu", params: { limit: 999 } }).success).toBe(false);
    expect(benchmarkConfigSchema.safeParse({ ...base, type: "cpu", params: { limit: 5_000_001 } }).success).toBe(false);
    expect(benchmarkConfigSchema.safeParse({ ...base, type: "cpu", params: { records: 100 } }).success).toBe(false);
    expect(benchmarkConfigSchema.safeParse({ ...base, type: "cpu", params: { limit: 1_000.5 } }).success).toBe(false);
    expect(benchmarkConfigSchema.safeParse({ ...base, type: "cpu", params: { limit: 1_000 }, command: "rm -rf /" }).success).toBe(false);
    expect(benchmarkConfigSchema.safeParse({ ...base, type: "python", params: {} }).success).toBe(false);
  });

  test("enforces hard limits on iterations, warm-ups, duration and rounds", () => {
    const cpu = { ...base, type: "cpu", params: { limit: 1_000 } };
    expect(benchmarkConfigSchema.safeParse({ ...cpu, iterations: HARD_LIMITS.iterations.max + 1 }).success).toBe(false);
    expect(benchmarkConfigSchema.safeParse({ ...cpu, warmups: -1 }).success).toBe(false);
    expect(benchmarkConfigSchema.safeParse({ ...cpu, maxDurationMs: 999 }).success).toBe(false);
    expect(benchmarkConfigSchema.safeParse({ ...cpu, rounds: 7 }).success).toBe(false);
  });

  test("validates runtimes", () => {
    const cpu = { ...base, type: "cpu", params: { limit: 1_000 } };
    expect(benchmarkConfigSchema.safeParse({ ...cpu, runtimes: [] }).success).toBe(false);
    expect(benchmarkConfigSchema.safeParse({ ...cpu, runtimes: ["bun", "bun"] }).success).toBe(false);
    expect(benchmarkConfigSchema.safeParse({ ...cpu, runtimes: ["deno"] }).success).toBe(false);
    expect(benchmarkConfigSchema.safeParse({ ...cpu, runtimes: ["node"] }).success).toBe(true);
  });

  test("trims labels and rejects control characters and long labels", () => {
    const cpu = { ...base, type: "cpu", params: { limit: 1_000 } };
    expect(benchmarkConfigSchema.parse({ ...cpu, label: "  nightly  " }).label).toBe("nightly");
    expect(benchmarkConfigSchema.safeParse({ ...cpu, label: "bad\u0000label" }).success).toBe(false);
    expect(benchmarkConfigSchema.safeParse({ ...cpu, label: "x".repeat(81) }).success).toBe(false);
  });

  test("HTTP cross-field rules", () => {
    const http = { ...base, type: "http", params: { requests: 50, concurrency: 100, payloadItems: 5, warmupRequests: 0, requestTimeoutMs: 1_000 } };
    expect(benchmarkConfigSchema.safeParse(http).success).toBe(false);
    const tooMany = { ...base, iterations: 200, type: "http", params: { requests: 50_000, concurrency: 10, payloadItems: 5, warmupRequests: 0, requestTimeoutMs: 1_000 } };
    expect(benchmarkConfigSchema.safeParse(tooMany).success).toBe(false);
  });
});

describe("settings", () => {
  test("defaults are valid and limits are cross-checked", () => {
    expect(settingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
    expect(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, defaultWarmups: 30, maxWarmups: 10 }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, maxConcurrentRuns: 3 }).success).toBe(false);
  });

  test("checkConfigAgainstSettings reports each violation", () => {
    const config = benchmarkConfigSchema.parse({ ...base, iterations: 150, type: "http", params: { requests: 100, concurrency: 100, payloadItems: 5, warmupRequests: 0, requestTimeoutMs: 1_000 } });
    const issues = checkConfigAgainstSettings(config, DEFAULT_SETTINGS);
    expect(issues).toHaveLength(2);
    expect(issues.join(" ")).toContain("iterations");
    expect(issues.join(" ")).toContain("concurrency");
  });
});

describe("query and request schemas", () => {
  test("list query coerces numbers and validates dates", () => {
    expect(listRunsQuerySchema.parse({ page: "2" }).page).toBe(2);
    expect(listRunsQuerySchema.parse({}).pageSize).toBe(20);
    expect(listRunsQuerySchema.safeParse({ from: "2026-13-01" }).success).toBe(false);
    expect(listRunsQuerySchema.safeParse({ unknown: "x" }).success).toBe(false);
  });

  test("compare request requires unique UUIDs", () => {
    const id = crypto.randomUUID();
    expect(compareRequestSchema.safeParse({ ids: [id] }).success).toBe(true);
    expect(compareRequestSchema.safeParse({ ids: [id, id] }).success).toBe(false);
    expect(compareRequestSchema.safeParse({ ids: ["1; DROP TABLE runs"] }).success).toBe(false);
  });

  test("runner events are validated", () => {
    expect(runnerEventSchema.safeParse({ type: "progress", phase: "warmup", iteration: 1, total: 1 }).success).toBe(true);
    expect(runnerEventSchema.safeParse({ type: "progress", phase: "cooldown", iteration: 1, total: 1 }).success).toBe(false);
  });
});
