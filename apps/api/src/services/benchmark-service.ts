import {
  type DetectedRuntime,
  executeBenchmark,
  type OrchestratorEvent,
  type RunnerPaths,
} from "@bunbench/benchmark-core/orchestrator";
import {
  type BenchmarkConfig,
  checkConfigAgainstSettings,
  type RunStatus,
  RUNTIME_LABELS,
  TERMINAL_RUN_STATUSES,
} from "@bunbench/shared";
import type { RunRepository } from "../db/repository.ts";
import { configHash } from "../lib/config-hash.ts";
import { ApiError, conflict, notFound } from "../lib/errors.ts";
import type { RunEventBus } from "./event-bus.ts";
import type { RuntimeService } from "./runtime-service.ts";

export interface BenchmarkServiceDeps {
  repo: RunRepository;
  bus: RunEventBus;
  runtimes: RuntimeService;
  paths: RunnerPaths;
  executor?: typeof executeBenchmark;
}

interface Job {
  id: string;
  config: BenchmarkConfig;
}

/** The API's Bun process doubles as the HTTP load client, so the client runtime never varies. */
function currentBunAsLoadClient(): DetectedRuntime {
  return { name: "bun", available: true, version: Bun.version, execPath: process.execPath, source: "current-process", reason: null };
}

/**
 * Owns the benchmark queue. Runs execute strictly one at a time by default (configurable up to 2)
 * because concurrent benchmarks interfere with each other's measurements.
 */
export class BenchmarkService {
  private readonly queue: Job[] = [];
  private readonly running = new Map<string, { controller: AbortController; promise: Promise<void> }>();
  private readonly executor: typeof executeBenchmark;
  private stopped = false;
  private readonly deps: BenchmarkServiceDeps;

  constructor(deps: BenchmarkServiceDeps) {
    this.deps = deps;
    this.executor = deps.executor ?? executeBenchmark;
  }

  queueInfo() {
    return { running: this.running.size, queued: this.queue.length, maxConcurrent: this.deps.repo.getSettings().maxConcurrentRuns };
  }

  isActive(id: string): boolean {
    return this.running.has(id) || this.queue.some((j) => j.id === id);
  }

  /** Validates limits, persists a queued run and schedules it. Idempotent per Idempotency-Key. */
  submit(config: BenchmarkConfig, idempotencyKey: string | null): { id: string; created: boolean } {
    if (this.stopped) throw new ApiError(503, "SHUTTING_DOWN", "The server is shutting down");
    if (idempotencyKey) {
      const existing = this.deps.repo.findIdByIdempotencyKey(idempotencyKey);
      if (existing) return { id: existing, created: false };
    }
    const settings = this.deps.repo.getSettings();
    const issues = checkConfigAgainstSettings(config, settings);
    if (issues.length) throw new ApiError(400, "LIMIT_EXCEEDED", issues.join("; "), { issues });
    if (this.queue.length + this.running.size >= settings.queueLimit) {
      throw new ApiError(503, "QUEUE_FULL", `The benchmark queue is full (${settings.queueLimit} runs). Wait for running benchmarks to finish.`);
    }

    const id = crypto.randomUUID();
    try {
      this.deps.repo.createRun({ id, config, configHash: configHash(config), idempotencyKey, createdAt: new Date().toISOString() });
    } catch (error) {
      // A concurrent request with the same Idempotency-Key won the race.
      if (idempotencyKey && String(error).includes("UNIQUE")) {
        const existing = this.deps.repo.findIdByIdempotencyKey(idempotencyKey);
        if (existing) return { id: existing, created: false };
      }
      throw error;
    }
    this.deps.bus.updateLive(id, { status: "queued", message: "Waiting for a free benchmark slot" });
    this.queue.push({ id, config });
    this.pump();
    return { id, created: true };
  }

  /** Cancels a queued or running run. Returns the resulting status. */
  cancel(id: string): RunStatus | "cancelling" {
    const status = this.deps.repo.getStatus(id);
    if (!status) throw notFound("Benchmark run");
    if (TERMINAL_RUN_STATUSES.includes(status)) throw conflict(`Run is already ${status}`);
    const queuedIndex = this.queue.findIndex((j) => j.id === id);
    if (queuedIndex >= 0) {
      this.queue.splice(queuedIndex, 1);
      this.deps.repo.updateStatus(id, "cancelled", { finishedAt: new Date().toISOString(), errorMessage: "Cancelled before it started" });
      this.deps.bus.updateLive(id, { status: "cancelled", message: "Cancelled before it started" });
      this.deps.bus.publish(id, { type: "done", status: "cancelled" });
      return "cancelled";
    }
    const job = this.running.get(id);
    if (job) {
      job.controller.abort();
      this.deps.bus.updateLive(id, { message: "Cancelling: stopping child processes" });
      return "cancelling";
    }
    // Non-terminal in the DB but unknown to this process (should not happen after recovery).
    this.deps.repo.updateStatus(id, "cancelled", { finishedAt: new Date().toISOString(), errorMessage: "Cancelled" });
    return "cancelled";
  }

  private pump() {
    if (this.stopped) return;
    const max = this.deps.repo.getSettings().maxConcurrentRuns;
    while (this.running.size < max && this.queue.length > 0) {
      const job = this.queue.shift()!;
      const controller = new AbortController();
      const promise = this.runJob(job, controller).finally(() => {
        this.running.delete(job.id);
        this.pump();
      });
      this.running.set(job.id, { controller, promise });
    }
  }

  private async runJob({ id, config }: Job, controller: AbortController): Promise<void> {
    const { repo, bus } = this.deps;
    const started = new Date();
    repo.updateStatus(id, "preparing", { startedAt: started.toISOString() });
    bus.publish(id, { type: "status", status: "preparing", message: "Detecting runtimes" });
    bus.updateLive(id, { status: "preparing", phase: "preparing", startedAt: started.toISOString(), message: "Detecting runtimes" });

    try {
      const detected = await this.deps.runtimes.detectAll(true);
      repo.updateStatus(id, "running");
      bus.publish(id, { type: "status", status: "running", message: null });
      bus.updateLive(id, { status: "running", message: null });

      let done = 0;
      const onEvent = (event: OrchestratorEvent) => this.forward(id, event, () => ++done);
      const outcome = await this.executor({
        config,
        runtimes: detected,
        loadClient: currentBunAsLoadClient(),
        paths: this.deps.paths,
        signal: controller.signal,
        onEvent,
      });
      const finished = new Date();
      repo.saveOutcome(id, outcome, finished.toISOString(), finished.getTime() - started.getTime());
      bus.updateLive(id, { status: outcome.status, phase: null, message: outcome.errorMessage });
      bus.publish(id, { type: "done", status: outcome.status });
    } catch (error) {
      const message = `Internal error while running the benchmark: ${error instanceof Error ? error.message : String(error)}`;
      console.error(`[bunbench] run ${id}: ${message}`);
      const finished = new Date();
      repo.updateStatus(id, "failed", { finishedAt: finished.toISOString(), errorMessage: message, durationMs: finished.getTime() - started.getTime() });
      bus.updateLive(id, { status: "failed", phase: null, message });
      bus.publish(id, { type: "done", status: "failed" });
    }
  }

  private forward(id: string, event: OrchestratorEvent, incrementDone: () => number) {
    const { bus } = this.deps;
    switch (event.type) {
      case "plan":
        bus.updateLive(id, { executionsTotal: event.executionsTotal, executionsDone: 0 });
        break;
      case "execution-start":
        bus.updateLive(id, {
          runtime: event.runtime,
          round: event.round,
          phase: null,
          iteration: null,
          total: null,
          message: `Running ${RUNTIME_LABELS[event.runtime]} (round ${event.round})`,
        });
        bus.publish(id, { type: "execution", runtime: event.runtime, round: event.round, status: "running", message: null });
        break;
      case "phase":
        bus.updateLive(id, {
          phase: event.phase,
          message: event.phase === "server-start" ? `Starting ${RUNTIME_LABELS[event.runtime]} HTTP server` : "Verifying results and computing statistics",
        });
        break;
      case "progress":
        bus.updateLive(id, { runtime: event.runtime, round: event.round, phase: event.phase, iteration: event.iteration, total: event.total });
        break;
      case "execution-end": {
        const r = event.result;
        const executionsDone = r.orderIndex >= 0 ? incrementDone() : undefined;
        if (executionsDone !== undefined) bus.updateLive(id, { executionsDone });
        bus.publish(id, { type: "execution", runtime: r.runtime, round: r.round, status: r.status, message: r.errorMessage });
        if (r.status === "failed" || r.status === "timeout" || r.status === "unavailable") {
          bus.publish(id, { type: "log", level: r.status === "unavailable" ? "warn" : "error", message: `${RUNTIME_LABELS[r.runtime]}: ${r.errorMessage ?? r.status}` });
        }
        break;
      }
      case "log":
        bus.publish(id, { type: "log", level: event.level, message: event.message });
        break;
    }
  }

  /** Resolves when no run is executing or queued (used by tests and graceful shutdown). */
  async waitForIdle(): Promise<void> {
    // Each stored promise settles after its `finally` has already started the next queued job.
    while (this.running.size > 0) {
      await Promise.all([...this.running.values()].map((r) => r.promise));
    }
  }

  /** Cancels everything and waits for child processes to stop. */
  async shutdown(): Promise<void> {
    this.stopped = true;
    for (const job of this.queue.splice(0)) {
      this.deps.repo.updateStatus(job.id, "cancelled", { finishedAt: new Date().toISOString(), errorMessage: "Server shut down before the run started" });
    }
    for (const { controller } of this.running.values()) controller.abort();
    await Promise.all([...this.running.values()].map((r) => r.promise));
  }
}
