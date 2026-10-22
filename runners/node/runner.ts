/**
 * BunBench compute runner for Node.js. Must be executed by the `node` binary (>= 22.18, which
 * runs TypeScript via built-in type stripping, so this file and the shared workloads execute as-is).
 *
 * Protocol: reads a JSON ComputeRunnerConfig from stdin, writes newline-delimited JSON events to
 * stdout, diagnostics to stderr. Exit codes are defined in benchmark-core/protocol.ts.
 */
import { EXIT_CODES, serializeEvent } from "@bunbench/benchmark-core/protocol";
import { parseComputeConfig, RunnerError, runComputeBenchmark, type RunnerHost } from "@bunbench/benchmark-core/runner-loop";
import { describeEnvironment } from "../common/environment.ts";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<number> {
  if (process.versions.bun || !process.versions.node) {
    console.error("node runner: this script must be executed by Node.js");
    return EXIT_CODES.wrongRuntime;
  }

  const host: RunnerHost = {
    // process.hrtime.bigint(): monotonic, nanosecond resolution.
    now: () => Number(process.hrtime.bigint()) / 1e6,
    memory: () => {
      const m = process.memoryUsage();
      return { rss: m.rss, heapUsed: m.heapUsed };
    },
    emit: (event) => {
      process.stdout.write(serializeEvent(event));
    },
    yieldToEventLoop: () => new Promise((resolve) => setImmediate(resolve)),
    env: describeEnvironment("node", process.versions.node, "process.hrtime.bigint() (monotonic)"),
  };

  try {
    const config = parseComputeConfig(await readStdin());
    await runComputeBenchmark(config, host);
    return EXIT_CODES.ok;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof RunnerError ? error.exitCode : EXIT_CODES.workloadError;
    host.emit({ type: "error", message: message.slice(0, 2_000) });
    console.error(`node runner: ${message}`);
    return code;
  }
}

process.exitCode = await main();
