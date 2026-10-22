import {
  type BenchmarkConfig,
  type ComputeRunnerConfig,
  type HttpBenchmarkConfig,
  type HttpClientConfig,
  type HttpServerConfig,
  PROTOCOL_VERSION,
  RUNTIME_LABELS,
  type RuntimeName,
} from "@bunbench/shared";
import { aggregateRun } from "../aggregate.ts";
import { describeExitCode, EXIT_CODES, parseRunnerLine } from "../protocol.ts";
import { HTTP_PATHS } from "../workloads/http-payload.ts";
import type { RunnerPaths } from "./paths.ts";
import { buildExecutionPlan } from "./plan.ts";
import { buildChildEnv, ChildProcess, type ProcessOutcome } from "./process.ts";
import type { DetectedRuntime } from "./runtime-detect.ts";
import type { BenchmarkOutcome, ExecutionResult, OrchestratorEvent } from "./types.ts";

/** Extra wall-clock allowance on top of maxDurationMs for process start-up and input generation. */
export const STARTUP_GRACE_MS = 5_000;
export const SERVER_READY_TIMEOUT_MS = 15_000;
const SERVER_SHUTDOWN_TIMEOUT_MS = 3_000;

export interface ExecuteOptions {
  config: BenchmarkConfig;
  /** Detection results for every runtime in config.runtimes. */
  runtimes: Partial<Record<RuntimeName, DetectedRuntime>>;
  /** The Bun executable used for the HTTP load client (held constant across servers). */
  loadClient: DetectedRuntime;
  paths: RunnerPaths;
  signal: AbortSignal;
  onEvent?: (event: OrchestratorEvent) => void;
  random?: () => number;
  env?: Record<string, string>;
}

function emptyResult(runtime: RuntimeName, round: number, orderIndex: number): ExecutionResult {
  return {
    runtime,
    round,
    orderIndex,
    status: "pending",
    exitCode: null,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    peakRssBytes: null,
    env: null,
    clientEnv: null,
    measurements: [],
    inputChecksum: null,
    outputChecksum: null,
    opsUnit: null,
    latenciesMs: [],
    errorSamples: [],
    serverRssAfterBytes: null,
  };
}

/** Applies protocol events from a runner/client stdout line to the execution result. */
function collectLine(
  line: string,
  result: ExecutionResult,
  target: "runtime" | "client",
  emit: (e: OrchestratorEvent) => void,
  protocolErrors: string[],
) {
  const parsed = parseRunnerLine(line);
  if (!parsed.ok) {
    if (protocolErrors.length < 5) protocolErrors.push(`${parsed.error}: ${parsed.line}`);
    return;
  }
  const event = parsed.event;
  switch (event.type) {
    case "hello":
      if (target === "client") result.clientEnv = event.env;
      else result.env = event.env;
      break;
    case "progress":
      emit({ type: "progress", runtime: result.runtime, round: result.round, phase: event.phase, iteration: event.iteration, total: event.total });
      break;
    case "measurement":
      result.measurements.push(event);
      break;
    case "result":
      result.opsUnit = event.opsUnit;
      result.inputChecksum = event.inputChecksum;
      result.outputChecksum = event.outputChecksum;
      result.latenciesMs = event.latenciesMs ?? [];
      result.errorSamples = event.errorSamples ?? [];
      break;
    case "error":
      result.errorMessage = event.message;
      break;
    case "ready":
      break;
  }
}

/** Translates a finished process into an execution status and error message. */
function finalizeStatus(result: ExecutionResult, outcome: ProcessOutcome, expectedMeasurements: number, maxDurationMs: number, protocolErrors: string[]) {
  result.exitCode = outcome.exitCode;
  if (outcome.cancelled) {
    result.status = "cancelled";
    result.errorMessage = "Cancelled by user";
  } else if (outcome.timedOut || outcome.exitCode === EXIT_CODES.deadlineExceeded) {
    result.status = "timeout";
    result.errorMessage = `Exceeded the maximum duration of ${maxDurationMs} ms and was terminated. Reduce the workload size or iterations, or raise the limit.`;
  } else if (outcome.streamError) {
    result.status = "failed";
    result.errorMessage = `Output error: ${outcome.streamError}`;
  } else if (outcome.exitCode !== 0) {
    result.status = "failed";
    result.errorMessage =
      result.errorMessage ??
      (outcome.stderr ? outcome.stderr.slice(-800) : `Runner ${describeExitCode(outcome.exitCode)}`);
  } else if (!result.outputChecksum || result.measurements.length !== expectedMeasurements) {
    result.status = "failed";
    result.errorMessage = `Runner output incomplete: ${result.measurements.length}/${expectedMeasurements} measurements${
      protocolErrors.length ? `; ${protocolErrors[0]}` : ""
    }`;
  } else {
    result.status = "completed";
    result.errorMessage = null;
  }
}

async function runComputeExecution(
  config: Exclude<BenchmarkConfig, HttpBenchmarkConfig>,
  runtime: DetectedRuntime,
  result: ExecutionResult,
  opts: ExecuteOptions,
  emit: (e: OrchestratorEvent) => void,
) {
  const runnerConfig: ComputeRunnerConfig = {
    protocolVersion: PROTOCOL_VERSION,
    type: config.type,
    params: config.params,
    iterations: config.iterations,
    warmups: config.warmups,
    seed: config.seed,
    deadlineMs: config.maxDurationMs,
  } as ComputeRunnerConfig;
  const protocolErrors: string[] = [];
  const child = new ChildProcess({
    cmd: [runtime.execPath!, opts.paths.compute[runtime.name]],
    cwd: opts.paths.cwd,
    env: opts.env ?? buildChildEnv(),
    stdin: JSON.stringify(runnerConfig),
    timeoutMs: config.maxDurationMs + STARTUP_GRACE_MS,
    signal: opts.signal,
    onLine: (line) => collectLine(line, result, "runtime", emit, protocolErrors),
  });
  const outcome = await child.wait();
  result.peakRssBytes = outcome.maxRssBytes;
  finalizeStatus(result, outcome, config.iterations, config.maxDurationMs, protocolErrors);
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(2_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function waitForHealth(base: string, attempts = 30): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(new URL(HTTP_PATHS.health, base), { signal: AbortSignal.timeout(1_000) });
      if (res.ok && (await res.text()) === "ok") return;
    } catch {
      // not ready yet
    }
    await Bun.sleep(100);
  }
  throw new Error("Server did not pass its health check");
}

async function runHttpExecution(
  config: HttpBenchmarkConfig,
  runtime: DetectedRuntime,
  result: ExecutionResult,
  opts: ExecuteOptions,
  emit: (e: OrchestratorEvent) => void,
) {
  const serverConfig: HttpServerConfig = { protocolVersion: PROTOCOL_VERSION, payloadItems: config.params.payloadItems, seed: config.seed };
  const protocolErrors: string[] = [];
  emit({ type: "phase", runtime: runtime.name, round: result.round, phase: "server-start" });

  // The server's own lifetime is bounded too: it can never outlive maxDuration + grace periods.
  const server = new ChildProcess({
    cmd: [runtime.execPath!, opts.paths.server[runtime.name]],
    cwd: opts.paths.cwd,
    env: opts.env ?? buildChildEnv(),
    stdin: JSON.stringify(serverConfig),
    timeoutMs: config.maxDurationMs + STARTUP_GRACE_MS + SERVER_READY_TIMEOUT_MS,
    signal: opts.signal,
  });

  let port: number | null = null;
  try {
    try {
      port = await server.waitForLine((line) => {
        const parsed = parseRunnerLine(line);
        if (parsed.ok && parsed.event.type === "ready") {
          result.env = parsed.event.env;
          return parsed.event.port;
        }
        return undefined;
      }, SERVER_READY_TIMEOUT_MS);
    } catch (error) {
      result.status = opts.signal.aborted ? "cancelled" : "failed";
      result.errorMessage = opts.signal.aborted ? "Cancelled by user" : `${RUNTIME_LABELS[runtime.name]} HTTP server failed to start: ${(error as Error).message}`;
      return;
    }
    const base = `http://127.0.0.1:${port}/`;
    try {
      await waitForHealth(base);
    } catch (error) {
      result.status = "failed";
      result.errorMessage = (error as Error).message;
      return;
    }

    const clientConfig: HttpClientConfig = {
      protocolVersion: PROTOCOL_VERSION,
      url: base,
      params: config.params,
      iterations: config.iterations,
      seed: config.seed,
      deadlineMs: config.maxDurationMs,
    };
    const client = new ChildProcess({
      cmd: [opts.loadClient.execPath!, opts.paths.loadClient],
      cwd: opts.paths.cwd,
      env: opts.env ?? buildChildEnv(),
      stdin: JSON.stringify(clientConfig),
      timeoutMs: config.maxDurationMs + STARTUP_GRACE_MS,
      signal: opts.signal,
      onLine: (line) => collectLine(line, result, "client", emit, protocolErrors),
    });
    const outcome = await client.wait();

    if (!server.exited && !opts.signal.aborted) {
      try {
        const stats = (await fetchJson(new URL(HTTP_PATHS.stats, base).toString())) as { rss?: unknown };
        if (typeof stats.rss === "number") result.serverRssAfterBytes = stats.rss;
      } catch {
        // stats are best-effort
      }
    }
    const serverCrashed = server.exited && !opts.signal.aborted;
    finalizeStatus(result, outcome, config.iterations, config.maxDurationMs, protocolErrors);
    if (serverCrashed && result.status === "completed") {
      result.status = "failed";
      result.errorMessage = `${RUNTIME_LABELS[runtime.name]} HTTP server exited during the benchmark${server.stderr ? `: ${server.stderr.slice(-500)}` : ""}`;
    }
  } finally {
    const serverOutcome = await shutdownServer(server, port);
    result.peakRssBytes = serverOutcome.maxRssBytes;
  }
}

/** Asks the server to stop gracefully; kills it if it does not exit in time. */
async function shutdownServer(server: ChildProcess, port: number | null): Promise<ProcessOutcome> {
  if (!server.exited && port !== null) {
    try {
      await fetch(`http://127.0.0.1:${port}${HTTP_PATHS.shutdown}`, { method: "POST", signal: AbortSignal.timeout(1_000) });
    } catch {
      // fall through to kill
    }
  } else if (!server.exited) {
    server.kill();
  }
  return server.wait(SERVER_SHUTDOWN_TIMEOUT_MS);
}

/**
 * Runs a full benchmark: every requested runtime, every round, in a randomized/alternating order.
 * Unavailable runtimes are recorded as such; nothing is ever substituted for missing results.
 */
export async function executeBenchmark(opts: ExecuteOptions): Promise<BenchmarkOutcome> {
  const { config } = opts;
  const emit = (event: OrchestratorEvent) => opts.onEvent?.(event);
  const executions: ExecutionResult[] = [];

  const available: RuntimeName[] = [];
  for (const name of config.runtimes) {
    const detected = opts.runtimes[name];
    if (detected?.available && detected.execPath) available.push(name);
    else {
      const r = emptyResult(name, 1, -1);
      r.status = "unavailable";
      r.errorMessage = detected?.reason ?? `${RUNTIME_LABELS[name]} is not available`;
      executions.push(r);
      emit({ type: "execution-end", result: r });
    }
  }
  if (config.type === "http" && !opts.loadClient.available) {
    return finish(opts, executions, [], "failed", `The HTTP load client requires Bun: ${opts.loadClient.reason ?? "unavailable"}`);
  }

  const order = buildExecutionPlan(available, config.rounds, opts.random);
  const total = order.reduce((n, round) => n + round.length, 0);
  emit({ type: "plan", order, executionsTotal: total });
  if (total === 0) {
    return finish(opts, executions, order, "failed", "None of the requested runtimes are available on this machine.");
  }

  let orderIndex = 0;
  for (let r = 0; r < order.length; r++) {
    for (const name of order[r]!) {
      const result = emptyResult(name, r + 1, orderIndex);
      executions.push(result);
      if (opts.signal.aborted) {
        result.status = "cancelled";
        result.errorMessage = "Cancelled before start";
        orderIndex++;
        continue;
      }
      emit({ type: "execution-start", runtime: name, round: r + 1, index: orderIndex });
      result.status = "running";
      result.startedAt = new Date().toISOString();
      const t0 = performance.now();
      try {
        if (config.type === "http") await runHttpExecution(config, opts.runtimes[name]!, result, opts, emit);
        else await runComputeExecution(config, opts.runtimes[name]!, result, opts, emit);
      } catch (error) {
        result.status = opts.signal.aborted ? "cancelled" : "failed";
        result.errorMessage = error instanceof Error ? error.message : String(error);
      }
      result.durationMs = performance.now() - t0;
      result.finishedAt = new Date().toISOString();
      emit({ type: "execution-end", result });
      orderIndex++;
    }
  }

  if (opts.signal.aborted) return finish(opts, executions, order, "cancelled", "Cancelled by user");
  emit({ type: "phase", runtime: available[0]!, round: order.length, phase: "verifying" });
  return finish(opts, executions, order, null, null);
}

function finish(
  opts: ExecuteOptions,
  executions: ExecutionResult[],
  order: RuntimeName[][],
  forcedStatus: BenchmarkOutcome["status"] | null,
  forcedMessage: string | null,
): BenchmarkOutcome {
  const { aggregates, latencyHistogram, warnings, checksumMismatch } = aggregateRun(opts.config.type, opts.config.runtimes, executions);
  let status: BenchmarkOutcome["status"];
  let errorMessage = forcedMessage;
  if (forcedStatus) status = forcedStatus;
  else if (checksumMismatch) {
    status = "failed";
    errorMessage = "Result verification failed: the runtimes produced different outputs for the same inputs.";
  } else if (!executions.some((e) => e.status === "completed")) {
    status = "failed";
    const firstError = executions.find((e) => e.errorMessage)?.errorMessage;
    errorMessage = `No execution completed successfully${firstError ? `: ${firstError}` : "."}`;
  } else status = "completed";
  return { status, errorMessage, executionOrder: order, executions, aggregates, latencyHistogram, warnings };
}
