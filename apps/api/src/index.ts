import { getRunnerPaths } from "@bunbench/benchmark-core/orchestrator";
import { createApp } from "./app.ts";
import { isLoopback, loadConfig } from "./config.ts";
import { migrate, openDatabase } from "./db/database.ts";
import { RunRepository } from "./db/repository.ts";
import { BenchmarkService } from "./services/benchmark-service.ts";
import { RunEventBus } from "./services/event-bus.ts";
import { RuntimeService } from "./services/runtime-service.ts";

const config = loadConfig();

if (!isLoopback(config.host)) {
  console.warn(
    `[bunbench] WARNING: binding to ${config.host}. BunBench has no authentication and launches processes.` +
      " Do not expose it to untrusted networks (see docs/security.md).",
  );
}

const db = openDatabase(config.dbPath);
const applied = migrate(db);
if (applied.length) console.log(`[bunbench] applied migrations: ${applied.join(", ")}`);

const repo = new RunRepository(db);
const recovered = repo.recoverInterrupted();
if (recovered) console.log(`[bunbench] marked ${recovered} interrupted run(s) as failed`);

const bus = new RunEventBus();
const runtimes = new RuntimeService({
  bunPathOverride: config.bunPathOverride,
  nodePathOverride: config.nodePathOverride,
  exposePaths: config.exposePaths,
});
const service = new BenchmarkService({ repo, bus, runtimes, paths: getRunnerPaths(config.repoRoot) });
const app = createApp({ config, repo, bus, runtimes, service });

const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  fetch: app.fetch,
  // SSE heartbeats are sent every 15 s, so connections stay inside this idle window.
  idleTimeout: 30,
});

const detected = await runtimes.info(true);
console.log(`[bunbench] API listening on http://${config.host}:${server.port}`);
for (const r of detected) {
  console.log(`[bunbench]   ${r.name}: ${r.available ? `v${r.version}` : `unavailable (${r.reason})`}`);
}

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[bunbench] ${signal} received: cancelling active benchmarks and shutting down`);
  await service.shutdown();
  await server.stop(true);
  db.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
