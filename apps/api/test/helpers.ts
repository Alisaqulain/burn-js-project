import { aggregateRun } from "@bunbench/benchmark-core";
import type { BenchmarkOutcome, DetectedRuntime, ExecuteOptions, ExecutionResult } from "@bunbench/benchmark-core/orchestrator";
import { getRunnerPaths } from "@bunbench/benchmark-core/orchestrator";
import type { BenchmarkConfig, RuntimeName } from "@bunbench/shared";
import { createApp } from "../src/app.ts";
import type { AppConfig } from "../src/config.ts";
import { migrate, openDatabase } from "../src/db/database.ts";
import { RunRepository } from "../src/db/repository.ts";
import { BenchmarkService } from "../src/services/benchmark-service.ts";
import { RunEventBus } from "../src/services/event-bus.ts";
import { RuntimeService } from "../src/services/runtime-service.ts";

export const ENV = {
  runtime: "bun" as RuntimeName,
  version: "1.4.4",
  platform: "linux",
  osRelease: "6.0",
  arch: "x64",
  cpuModel: "Test CPU",
  cpuCount: 4,
  totalMemoryBytes: 8e9,
  pid: 1,
  timer: "test",
};

/** Builds a deterministic outcome without spawning processes (route tests only). */
export function fakeOutcome(config: BenchmarkConfig, available: RuntimeName[] = config.runtimes): BenchmarkOutcome {
  const executions: ExecutionResult[] = config.runtimes.map((runtime, i) => {
    const isAvailable = available.includes(runtime);
    const base = runtime === "bun" ? 10 : 12;
    return {
      runtime,
      round: 1,
      orderIndex: isAvailable ? i : -1,
      status: isAvailable ? "completed" : "unavailable",
      exitCode: isAvailable ? 0 : null,
      errorMessage: isAvailable ? null : "not installed (test)",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 5,
      peakRssBytes: 50_000_000,
      env: isAvailable ? { ...ENV, runtime } : null,
      clientEnv: config.type === "http" && isAvailable ? ENV : null,
      measurements: isAvailable
        ? Array.from({ length: config.iterations }, (_, k) => ({
            type: "measurement" as const,
            phase: "measured" as const,
            iteration: k + 1,
            elapsedMs: base + k * 0.1,
            ops: 1_000,
            rssBytes: 40_000_000,
            heapUsedBytes: 10_000_000,
            checksum: "abc",
            ...(config.type === "http"
              ? { http: { requestsOk: 1_000, requestsFailed: 0, latencyMeanMs: 1, latencyP50Ms: 1, latencyP90Ms: 2, latencyP95Ms: 2, latencyP99Ms: 3 } }
              : {}),
          }))
        : [],
      inputChecksum: "in",
      outputChecksum: isAvailable ? "out" : null,
      opsUnit: "ops",
      latenciesMs: config.type === "http" && isAvailable ? [0.5, 1, 1.5, 2] : [],
      errorSamples: [],
      serverRssAfterBytes: config.type === "http" ? 30_000_000 : null,
    };
  });
  const { aggregates, latencyHistogram, warnings } = aggregateRun(config.type, config.runtimes, executions);
  return {
    status: "completed",
    errorMessage: null,
    executionOrder: [available],
    executions,
    aggregates,
    latencyHistogram,
    warnings,
  };
}

export const fakeExecutor = async (opts: ExecuteOptions): Promise<BenchmarkOutcome> => {
  opts.onEvent?.({ type: "plan", order: [opts.config.runtimes], executionsTotal: opts.config.runtimes.length });
  return fakeOutcome(opts.config);
};

/** Executor that blocks until aborted, then reports cancellation (for cancel tests). */
export const blockingExecutor = (opts: ExecuteOptions): Promise<BenchmarkOutcome> =>
  new Promise((resolve) => {
    opts.onEvent?.({ type: "execution-start", runtime: opts.config.runtimes[0]!, round: 1, index: 0 });
    opts.signal.addEventListener("abort", () => {
      const outcome = fakeOutcome(opts.config, []);
      resolve({ ...outcome, status: "cancelled", errorMessage: "Cancelled by user" });
    });
  });

const fakeDetector = async (name: RuntimeName): Promise<DetectedRuntime> =>
  name === "bun"
    ? { name, available: true, version: "1.4.4", execPath: "/opt/bun", source: "current-process", reason: null }
    : { name, available: false, version: null, execPath: null, source: "none", reason: "Node.js was not found on PATH" };

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    host: "127.0.0.1",
    port: 3001,
    corsOrigins: ["http://localhost:5173"],
    dbPath: ":memory:",
    bunPathOverride: undefined,
    nodePathOverride: undefined,
    rateLimitPerMinute: 100,
    exposePaths: true,
    repoRoot: process.cwd(),
    webDistDir: "/nonexistent-web-dist",
    ...overrides,
  };
}

export function createTestApp(options: { executor?: (o: ExecuteOptions) => Promise<BenchmarkOutcome>; config?: Partial<AppConfig> } = {}) {
  const db = openDatabase(":memory:");
  migrate(db);
  const repo = new RunRepository(db);
  const bus = new RunEventBus();
  const runtimes = new RuntimeService({ exposePaths: true }, fakeDetector);
  const service = new BenchmarkService({ repo, bus, runtimes, paths: getRunnerPaths(), executor: options.executor ?? fakeExecutor });
  const config = testConfig(options.config);
  const app = createApp({ config, repo, bus, runtimes, service, clientKey: () => "test-client" });
  return { app, repo, bus, service, db, config };
}

export const validCpuBody = {
  type: "cpu",
  params: { limit: 10_000 },
  runtimes: ["bun", "node"],
  iterations: 5,
  warmups: 1,
  maxDurationMs: 10_000,
  label: "unit test",
};

export function jsonRequest(method: string, body: unknown, headers: Record<string, string> = {}): RequestInit {
  return { method, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) };
}
