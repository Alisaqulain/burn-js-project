/**
 * End-to-end through the HTTP API with the real orchestrator and real runner processes.
 * Asserts structure and correctness only, never which runtime is faster.
 */
import { describe, expect, test } from "bun:test";
import { detectRuntime, getRunnerPaths } from "@bunbench/benchmark-core/orchestrator";
import type { ApiSuccess, RunDetail } from "@bunbench/shared";
import { createApp } from "../src/app.ts";
import { migrate, openDatabase } from "../src/db/database.ts";
import { RunRepository } from "../src/db/repository.ts";
import { BenchmarkService } from "../src/services/benchmark-service.ts";
import { RunEventBus } from "../src/services/event-bus.ts";
import { RuntimeService } from "../src/services/runtime-service.ts";
import { testConfig } from "../test/helpers.ts";

const nodeAvailable = (await detectRuntime("node", { override: process.env.BUNBENCH_NODE_PATH })).available;
if (!nodeAvailable) console.warn("\n[integration] Node.js unavailable: the API end-to-end test runs Bun only and reports Node as unavailable.\n");

function setup() {
  const db = openDatabase(":memory:");
  migrate(db);
  const repo = new RunRepository(db);
  const bus = new RunEventBus();
  const runtimes = new RuntimeService({ exposePaths: true, nodePathOverride: process.env.BUNBENCH_NODE_PATH });
  const service = new BenchmarkService({ repo, bus, runtimes, paths: getRunnerPaths() });
  const app = createApp({ config: testConfig(), repo, bus, runtimes, service });
  return { app, service };
}

describe("API with real runners", () => {
  test("a real JSON benchmark on both runtimes persists measurements and metadata", async () => {
    const { app, service } = setup();
    const res = await app.request("/api/benchmarks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "json", params: { records: 300 }, runtimes: ["bun", "node"], iterations: 3, warmups: 1, maxDurationMs: 60_000 }),
    });
    expect(res.status).toBe(202);
    const { data } = (await res.json()) as ApiSuccess<RunDetail>;
    await service.waitForIdle();
    const detail = ((await (await app.request(`/api/benchmarks/${data.id}`)).json()) as ApiSuccess<RunDetail>).data;
    expect(detail.status).toBe("completed");
    const bun = detail.executions.find((e) => e.runtime === "bun")!;
    expect(bun.status).toBe("completed");
    expect(bun.measurements).toHaveLength(3);
    expect(bun.metadata?.runtimeVersion).toBe(Bun.version);
    expect(bun.peakRssBytes).toBeGreaterThan(0);
    const node = detail.executions.find((e) => e.runtime === "node")!;
    if (nodeAvailable) {
      expect(node.status).toBe("completed");
      expect(node.outputChecksum).toBe(bun.outputChecksum);
      expect(node.metadata?.runtimeVersion).toMatch(/^\d+\.\d+\.\d+/);
    } else {
      expect(node.status).toBe("unavailable");
      expect(node.measurements).toHaveLength(0);
    }
  });
});
