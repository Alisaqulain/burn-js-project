/**
 * Integration tests: execute the real Bun and Node.js runner processes. These never assert which
 * runtime is faster; they assert successful execution, structure, equivalence and valid statistics.
 * When Node.js is unavailable the Node-specific tests are reported as skipped with a reason.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { benchmarkConfigSchema, type BenchmarkConfigInput, type RuntimeName } from "@bunbench/shared";
import {
  type DetectedRuntime,
  detectRuntime,
  executeBenchmark,
  getRunnerPaths,
  runProcess,
} from "../src/orchestrator/index.ts";
import { EXIT_CODES } from "../src/protocol.ts";

const paths = getRunnerPaths();
let bun: DetectedRuntime;
let node: DetectedRuntime;

beforeAll(async () => {
  bun = await detectRuntime("bun");
  node = await detectRuntime("node", { override: process.env.BUNBENCH_NODE_PATH });
  if (!node.available) {
    console.warn(`\n[integration] Node.js unavailable (${node.reason}). Node.js integration tests are SKIPPED, not passed.\n`);
  }
});

const nodeAvailable = async () => (await detectRuntime("node", { override: process.env.BUNBENCH_NODE_PATH })).available;
const hasNode = await nodeAvailable();

function config(input: Omit<BenchmarkConfigInput, "runtimes" | "iterations" | "warmups" | "maxDurationMs"> & Partial<BenchmarkConfigInput>, runtimes: RuntimeName[]) {
  return benchmarkConfigSchema.parse({ iterations: 3, warmups: 1, maxDurationMs: 60_000, ...input, runtimes });
}

async function run(cfg: ReturnType<typeof config>, signal = new AbortController().signal) {
  return executeBenchmark({ config: cfg, runtimes: { bun, node }, loadClient: bun, paths, signal });
}

const computeCases = [
  { type: "cpu", params: { limit: 100_000 } },
  { type: "json", params: { records: 500 } },
  { type: "array", params: { size: 20_000 } },
  { type: "memory", params: { objects: 10_000 } },
] as const;

describe("compute workloads on Bun", () => {
  for (const c of computeCases) {
    test(`${c.type} completes with valid measurements`, async () => {
      const outcome = await run(config(c as never, ["bun"]));
      expect(outcome.status).toBe("completed");
      const exec = outcome.executions[0]!;
      expect(exec.status).toBe("completed");
      expect(exec.env?.runtime).toBe("bun");
      expect(exec.env?.version).toBe(Bun.version);
      expect(exec.measurements).toHaveLength(3);
      for (const m of exec.measurements) {
        expect(m.elapsedMs).toBeGreaterThan(0);
        expect(Number.isFinite(m.elapsedMs)).toBe(true);
      }
      const metrics = outcome.aggregates[0]!.metrics;
      expect(metrics.elapsed_min_ms!.value).toBeLessThanOrEqual(metrics.elapsed_median_ms!.value);
      expect(metrics.elapsed_median_ms!.value).toBeLessThanOrEqual(metrics.elapsed_max_ms!.value);
      expect(metrics.ops_per_sec!.value).toBeGreaterThan(0);
    });
  }
});

describe.skipIf(!hasNode)("compute workloads on Bun and Node.js (equivalence)", () => {
  for (const c of computeCases) {
    test(`${c.type}: both runtimes produce identical inputs and outputs`, async () => {
      const outcome = await run(config({ ...(c as object), rounds: 2 } as never, ["bun", "node"]));
      expect(outcome.status).toBe("completed");
      expect(outcome.executions).toHaveLength(4);
      expect(outcome.executions.every((e) => e.status === "completed")).toBe(true);
      expect(new Set(outcome.executions.map((e) => e.inputChecksum)).size).toBe(1);
      expect(new Set(outcome.executions.map((e) => e.outputChecksum)).size).toBe(1);
      const nodeExec = outcome.executions.find((e) => e.runtime === "node")!;
      expect(nodeExec.env?.runtime).toBe("node");
      expect(nodeExec.env?.version).toBe(node.version!);
      // ABBA: the order of round 2 is the reverse of round 1.
      expect(outcome.executionOrder[1]).toEqual(outcome.executionOrder[0]!.slice().reverse());
    });
  }
});

describe("HTTP benchmark", () => {
  const httpParams = { requests: 200, concurrency: 8, payloadItems: 10, warmupRequests: 20, requestTimeoutMs: 5_000 };

  test("Bun server: all requests succeed and latency is recorded", async () => {
    const outcome = await run(config({ type: "http", params: httpParams }, ["bun"]));
    expect(outcome.status).toBe("completed");
    const exec = outcome.executions[0]!;
    expect(exec.env?.runtime).toBe("bun");
    expect(exec.clientEnv?.runtime).toBe("bun");
    expect(exec.latenciesMs).toHaveLength(600);
    const m = outcome.aggregates[0]!.metrics;
    expect(m.http_requests_ok!.value).toBe(600);
    expect(m.http_requests_failed!.value).toBe(0);
    expect(m.http_rps!.value).toBeGreaterThan(0);
    expect(m.http_latency_p50_ms!.value).toBeLessThanOrEqual(m.http_latency_p99_ms!.value);
    expect(outcome.latencyHistogram.reduce((n, b) => n + b.count, 0)).toBe(600);
  });

  test.skipIf(!hasNode)("Node.js server: all requests succeed with the same payload", async () => {
    const outcome = await run(config({ type: "http", params: httpParams }, ["bun", "node"]));
    expect(outcome.status).toBe("completed");
    const nodeExec = outcome.executions.find((e) => e.runtime === "node")!;
    expect(nodeExec.status).toBe("completed");
    expect(nodeExec.env?.runtime).toBe("node");
    expect(nodeExec.clientEnv?.runtime).toBe("bun");
    expect(new Set(outcome.executions.map((e) => e.outputChecksum)).size).toBe(1);
    const nodeAgg = outcome.aggregates.find((a) => a.runtime === "node")!;
    expect(nodeAgg.metrics.http_requests_failed!.value).toBe(0);
  });
});

describe("timeouts, cancellation and unavailable runtimes", () => {
  test("a runner exceeding maxDurationMs is stopped and marked timeout", async () => {
    const outcome = await run(config({ type: "cpu", params: { limit: 5_000_000 }, iterations: 200, warmups: 0, maxDurationMs: 1_000 }, ["bun"]));
    expect(outcome.executions[0]!.status).toBe("timeout");
    expect(outcome.status).toBe("failed");
    expect(outcome.executions[0]!.errorMessage).toContain("maximum duration");
  });

  test("aborting cancels the running process", async () => {
    const controller = new AbortController();
    const promise = executeBenchmark({
      config: config({ type: "cpu", params: { limit: 5_000_000 }, iterations: 200, warmups: 0, maxDurationMs: 120_000 }, ["bun"]),
      runtimes: { bun, node },
      loadClient: bun,
      paths,
      signal: controller.signal,
      onEvent: (e) => {
        if (e.type === "progress") controller.abort();
      },
    });
    const outcome = await promise;
    expect(outcome.status).toBe("cancelled");
    expect(outcome.executions[0]!.status).toBe("cancelled");
  });

  test("an unavailable runtime is recorded, never substituted", async () => {
    const missingNode: DetectedRuntime = { name: "node", available: false, version: null, execPath: null, source: "none", reason: "not found (test)" };
    const outcome = await executeBenchmark({
      config: config({ type: "cpu", params: { limit: 10_000 } }, ["bun", "node"]),
      runtimes: { bun, node: missingNode },
      loadClient: bun,
      paths,
      signal: new AbortController().signal,
    });
    expect(outcome.status).toBe("completed");
    const nodeExec = outcome.executions.find((e) => e.runtime === "node")!;
    expect(nodeExec.status).toBe("unavailable");
    expect(nodeExec.measurements).toHaveLength(0);
    expect(outcome.warnings.map((w) => w.code)).toContain("incomplete_comparison");
  });

  test("the Node runner refuses to run under Bun", async () => {
    const outcome = await runProcess({ cmd: [process.execPath, paths.compute.node], cwd: paths.cwd, stdin: "{}", timeoutMs: 15_000 });
    expect(outcome.exitCode).toBe(EXIT_CODES.wrongRuntime);
  });

  test("runners reject invalid configuration with exit code 2", async () => {
    const outcome = await runProcess({ cmd: [process.execPath, paths.compute.bun], cwd: paths.cwd, stdin: '{"type":"cpu"}', timeoutMs: 15_000 });
    expect(outcome.exitCode).toBe(EXIT_CODES.invalidConfig);
  });
});
