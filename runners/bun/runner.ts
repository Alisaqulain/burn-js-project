/**
 * BunBench compute runner for Bun. Must be executed by the `bun` binary.
 *
 * Protocol: reads a JSON ComputeRunnerConfig from stdin, writes newline-delimited JSON events to
 * stdout, diagnostics to stderr. Exit codes are defined in benchmark-core/protocol.ts.
 */
import { EXIT_CODES, serializeEvent } from "@bunbench/benchmark-core/protocol";
import { parseComputeConfig, RunnerError, runComputeBenchmark, type RunnerHost } from "@bunbench/benchmark-core/runner-loop";
import { describeEnvironment } from "../common/environment.ts";

async function main(): Promise<number> {
  if (typeof Bun === "undefined" || !process.versions.bun) {
    console.error("bun runner: this script must be executed by Bun");
    return EXIT_CODES.wrongRuntime;
  }

  const host: RunnerHost = {
    // Bun.nanoseconds(): monotonic, nanoseconds since process start.
    now: () => Bun.nanoseconds() / 1e6,
    memory: () => {
      const m = process.memoryUsage();
      return { rss: m.rss, heapUsed: m.heapUsed };
    },
    emit: (event) => {
      process.stdout.write(serializeEvent(event));
    },
    yieldToEventLoop: () => new Promise((resolve) => setImmediate(resolve)),
    env: describeEnvironment("bun", Bun.version, "Bun.nanoseconds() (monotonic)"),
  };

  try {
    const config = parseComputeConfig(await Bun.stdin.text());
    await runComputeBenchmark(config, host);
    return EXIT_CODES.ok;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof RunnerError ? error.exitCode : EXIT_CODES.workloadError;
    host.emit({ type: "error", message: message.slice(0, 2_000) });
    console.error(`bun runner: ${message}`);
    return code;
  }
}

process.exitCode = await main();
