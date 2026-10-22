/**
 * Smoke benchmark: runs a small real CPU benchmark and a small HTTP benchmark through the full
 * stack (queue → orchestrator → runner processes → SQLite) using a temporary database, then
 * prints the measured results. Uses Node.js too when it is installed.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getRunnerPaths } from "@bunbench/benchmark-core/orchestrator";
import { benchmarkConfigSchema, METRIC_DEFINITIONS, RUNTIME_LABELS, type RuntimeName } from "@bunbench/shared";
import { migrate, openDatabase } from "../apps/api/src/db/database.ts";
import { RunRepository } from "../apps/api/src/db/repository.ts";
import { BenchmarkService } from "../apps/api/src/services/benchmark-service.ts";
import { RunEventBus } from "../apps/api/src/services/event-bus.ts";
import { RuntimeService } from "../apps/api/src/services/runtime-service.ts";

const dir = mkdtempSync(join(tmpdir(), "bunbench-smoke-"));
const db = openDatabase(join(dir, "smoke.sqlite"));
migrate(db);
const repo = new RunRepository(db);
const runtimes = new RuntimeService({ exposePaths: false, nodePathOverride: process.env.BUNBENCH_NODE_PATH });
const service = new BenchmarkService({ repo, bus: new RunEventBus(), runtimes, paths: getRunnerPaths() });

const detected = await runtimes.detectAll(true);
const available = (Object.values(detected) as { name: RuntimeName; available: boolean; version: string | null; reason: string | null }[]);
for (const r of available) console.log(`${RUNTIME_LABELS[r.name]}: ${r.available ? `v${r.version}` : `UNAVAILABLE (${r.reason})`}`);
const use = available.filter((r) => r.available).map((r) => r.name);

const configs = [
  benchmarkConfigSchema.parse({ type: "cpu", params: { limit: 200_000 }, runtimes: use, iterations: 5, warmups: 2, maxDurationMs: 60_000, label: "smoke cpu" }),
  benchmarkConfigSchema.parse({
    type: "http",
    params: { requests: 500, concurrency: 16, payloadItems: 20, warmupRequests: 100, requestTimeoutMs: 5_000 },
    runtimes: use,
    iterations: 3,
    warmups: 0,
    maxDurationMs: 60_000,
    label: "smoke http",
  }),
];

let failed = false;
for (const config of configs) {
  const { id } = service.submit(config, null);
  await service.waitForIdle();
  const run = repo.getRun(id)!;
  console.log(`\n${config.label}: ${run.status}${run.errorMessage ? ` (${run.errorMessage})` : ""}`);
  if (run.status !== "completed") failed = true;
  const metrics = config.type === "http" ? (["http_rps", "http_latency_p95_ms", "http_requests_failed"] as const) : (["elapsed_median_ms", "elapsed_cv_pct", "ops_per_sec"] as const);
  for (const agg of run.aggregates) {
    const parts = metrics.map((m) => `${METRIC_DEFINITIONS[m].label}=${agg.metrics[m] ? `${agg.metrics[m]!.value.toFixed(2)} ${METRIC_DEFINITIONS[m].unit}` : "—"}`);
    console.log(`  ${RUNTIME_LABELS[agg.runtime].padEnd(8)} ${agg.status.padEnd(11)} ${parts.join("  ")}`);
  }
  for (const w of run.warnings) console.log(`  note: ${w.message}`);
}

db.close();
rmSync(dir, { recursive: true, force: true });
if (use.length < 2) console.warn("\n⚠ Only one runtime was available; the smoke run did not compare runtimes.");
process.exit(failed ? 1 : 0);
