/**
 * HTTP load client. Always executed by Bun (the orchestrator's runtime) so that the client side is
 * held constant while the server runtime varies. Measures per-request latency with
 * performance.now(), validates every response (status 200 + exact expected body), and reports
 * failures separately from successful throughput.
 */
import { httpClientConfigSchema, type HttpClientConfig } from "@bunbench/shared";
import { expectedHttpBody, httpPayloadChecksum, HTTP_PATHS } from "@bunbench/benchmark-core/workloads";
import { EXIT_CODES, serializeEvent } from "@bunbench/benchmark-core/protocol";
import { RunnerError } from "@bunbench/benchmark-core/runner-loop";
import { mean, percentile, sortAscending } from "@bunbench/benchmark-core/stats";
import { describeEnvironment } from "../common/environment.ts";
import type { RunnerEvent } from "@bunbench/shared";

const emit = (event: RunnerEvent) => process.stdout.write(serializeEvent(event));

interface BatchResult {
  latencies: number[];
  ok: number;
  failed: number;
  elapsedMs: number;
}

function parseConfig(raw: string): HttpClientConfig {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new RunnerError("Client configuration on stdin is not valid JSON", EXIT_CODES.invalidConfig);
  }
  const parsed = httpClientConfigSchema.safeParse(json);
  if (!parsed.success) {
    throw new RunnerError(`Invalid client configuration: ${parsed.error.issues[0]?.message ?? "unknown"}`, EXIT_CODES.invalidConfig);
  }
  return parsed.data;
}

async function main(): Promise<number> {
  if (typeof Bun === "undefined") {
    console.error("load client: this script must be executed by Bun");
    return EXIT_CODES.wrongRuntime;
  }
  let config: HttpClientConfig;
  try {
    config = parseConfig(await Bun.stdin.text());
  } catch (error) {
    console.error(`load client: ${(error as Error).message}`);
    return error instanceof RunnerError ? error.exitCode : EXIT_CODES.invalidConfig;
  }

  const { params } = config;
  const target = new URL(HTTP_PATHS.payload, config.url).toString();
  const expected = expectedHttpBody(params.payloadItems, config.seed);
  const checksum = httpPayloadChecksum(params.payloadItems, config.seed);
  const deadline = performance.now() + config.deadlineMs;
  const errorSamples = new Set<string>();

  const recordError = (reason: string) => {
    if (errorSamples.size < 10) errorSamples.add(reason.slice(0, 300));
  };

  async function request(): Promise<number | null> {
    const t0 = performance.now();
    try {
      const res = await fetch(target, { signal: AbortSignal.timeout(params.requestTimeoutMs) });
      const body = await res.text();
      const latency = performance.now() - t0;
      if (res.status !== 200) {
        recordError(`HTTP ${res.status}`);
        return null;
      }
      if (body !== expected) {
        recordError(`Unexpected response body (${body.length} bytes, expected ${expected.length})`);
        return null;
      }
      return latency;
    } catch (error) {
      recordError(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
      return null;
    }
  }

  /** Issues `count` requests using `concurrency` workers that each loop until the budget is used. */
  async function batch(count: number): Promise<BatchResult> {
    let issued = 0;
    let ok = 0;
    let failed = 0;
    const latencies: number[] = [];
    const worker = async () => {
      while (issued < count) {
        issued++;
        const latency = await request();
        if (latency === null) failed++;
        else {
          ok++;
          latencies.push(latency);
        }
      }
    };
    const t0 = performance.now();
    await Promise.all(Array.from({ length: Math.min(params.concurrency, count) }, worker));
    return { latencies, ok, failed, elapsedMs: performance.now() - t0 };
  }

  emit({ type: "hello", env: describeEnvironment("bun", Bun.version, "performance.now() (monotonic)") });

  try {
    if (params.warmupRequests > 0) {
      const warm = await batch(params.warmupRequests);
      emit({ type: "progress", phase: "warmup", iteration: 1, total: 1 });
      if (warm.ok === 0) {
        throw new RunnerError(
          `All ${params.warmupRequests} warm-up requests failed: ${[...errorSamples].join("; ") || "unknown error"}`,
          EXIT_CODES.workloadError,
        );
      }
    }

    const allLatencies: number[] = [];
    for (let i = 1; i <= config.iterations; i++) {
      if (performance.now() > deadline) {
        throw new RunnerError(`Deadline of ${config.deadlineMs} ms exceeded`, EXIT_CODES.deadlineExceeded);
      }
      const result = await batch(params.requests);
      const sorted = sortAscending(result.latencies);
      const mem = process.memoryUsage();
      emit({
        type: "measurement",
        phase: "measured",
        iteration: i,
        elapsedMs: result.elapsedMs,
        ops: result.ok,
        rssBytes: mem.rss,
        heapUsedBytes: mem.heapUsed,
        checksum,
        http: {
          requestsOk: result.ok,
          requestsFailed: result.failed,
          latencyMeanMs: sorted.length ? mean(sorted) : 0,
          latencyP50Ms: sorted.length ? percentile(sorted, 50) : 0,
          latencyP90Ms: sorted.length ? percentile(sorted, 90) : 0,
          latencyP95Ms: sorted.length ? percentile(sorted, 95) : 0,
          latencyP99Ms: sorted.length ? percentile(sorted, 99) : 0,
        },
      });
      emit({ type: "progress", phase: "measured", iteration: i, total: config.iterations });
      for (const l of result.latencies) allLatencies.push(Math.round(l * 1_000) / 1_000);
    }

    emit({
      type: "result",
      opsUnit: "requests",
      inputChecksum: checksum,
      outputChecksum: checksum,
      latenciesMs: allLatencies,
      errorSamples: [...errorSamples],
    });
    return EXIT_CODES.ok;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit({ type: "error", message: message.slice(0, 2_000) });
    console.error(`load client: ${message}`);
    return error instanceof RunnerError ? error.exitCode : EXIT_CODES.workloadError;
  }
}

process.exitCode = await main();
