import {
  computeRunnerConfigSchema,
  type ComputeRunnerConfig,
  type EnvironmentInfo,
  type RunnerEvent,
} from "@bunbench/shared";
import { EXIT_CODES } from "./protocol.ts";
import { prepareWorkload } from "./workloads/index.ts";

/**
 * Runtime-specific capabilities a runner script provides. The measured loop below is shared so
 * that Bun and Node.js execute exactly the same benchmark procedure; only the host differs.
 */
export interface RunnerHost {
  /** Monotonic high-resolution clock in milliseconds. */
  now(): number;
  memory(): { rss: number; heapUsed: number };
  emit(event: RunnerEvent): void;
  /** Yields to the event loop so output flushes; never called inside a timed region. */
  yieldToEventLoop(): Promise<void>;
  env: EnvironmentInfo;
}

export class RunnerError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode: number) {
    super(message);
    this.exitCode = exitCode;
  }
}

export function parseComputeConfig(raw: string): ComputeRunnerConfig {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new RunnerError("Configuration on stdin is not valid JSON", EXIT_CODES.invalidConfig);
  }
  const parsed = computeRunnerConfigSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new RunnerError(
      `Invalid configuration: ${issue ? `${issue.path.join(".")} ${issue.message}` : "unknown error"}`,
      EXIT_CODES.invalidConfig,
    );
  }
  return parsed.data;
}

/**
 * Executes warm-up iterations, then measured iterations, emitting a measurement per measured
 * iteration. Only `workload.run()` is inside the timed region. Verifies every iteration produced
 * the same output checksum (determinism), and enforces the deadline between iterations.
 */
export async function runComputeBenchmark(config: ComputeRunnerConfig, host: RunnerHost): Promise<void> {
  const started = host.now();
  const deadline = started + config.deadlineMs;
  const checkDeadline = () => {
    if (host.now() > deadline) {
      throw new RunnerError(`Deadline of ${config.deadlineMs} ms exceeded`, EXIT_CODES.deadlineExceeded);
    }
  };

  host.emit({ type: "hello", env: host.env });
  const workload = prepareWorkload(config);
  await host.yieldToEventLoop();
  checkDeadline();

  let expected: string | null = null;
  const verify = (checksum: string, phase: string, iteration: number) => {
    if (expected === null) expected = checksum;
    else if (checksum !== expected) {
      throw new RunnerError(
        `Non-deterministic output in ${phase} iteration ${iteration}: ${checksum} != ${expected}`,
        EXIT_CODES.workloadError,
      );
    }
  };

  for (let i = 1; i <= config.warmups; i++) {
    verify(workload.run(), "warm-up", i);
    host.emit({ type: "progress", phase: "warmup", iteration: i, total: config.warmups });
    await host.yieldToEventLoop();
    checkDeadline();
  }

  for (let i = 1; i <= config.iterations; i++) {
    const t0 = host.now();
    const checksum = workload.run();
    const t1 = host.now();
    const mem = host.memory();
    verify(checksum, "measured", i);
    host.emit({
      type: "measurement",
      phase: "measured",
      iteration: i,
      elapsedMs: t1 - t0,
      ops: workload.opsPerRun,
      rssBytes: mem.rss,
      heapUsedBytes: mem.heapUsed,
      checksum,
    });
    host.emit({ type: "progress", phase: "measured", iteration: i, total: config.iterations });
    await host.yieldToEventLoop();
    if (i < config.iterations) checkDeadline();
  }

  host.emit({
    type: "result",
    opsUnit: workload.opsUnit,
    inputChecksum: workload.inputChecksum,
    outputChecksum: expected ?? "",
  });
}
