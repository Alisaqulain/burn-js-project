import { describe, expect, test } from "bun:test";
import { describeExitCode, EXIT_CODES, LineSplitter, parseRunnerLine, serializeEvent } from "../src/protocol.ts";
import { parseComputeConfig, RunnerError, runComputeBenchmark, type RunnerHost } from "../src/runner-loop.ts";
import type { RunnerEvent } from "@bunbench/shared";

const env = {
  runtime: "bun" as const,
  version: "1.0.0",
  platform: "linux",
  osRelease: "6",
  arch: "x64",
  cpuModel: "test",
  cpuCount: 1,
  totalMemoryBytes: 1,
  pid: 1,
  timer: "test",
};

describe("parseRunnerLine", () => {
  test("parses valid events", () => {
    const line = serializeEvent({ type: "progress", phase: "warmup", iteration: 1, total: 3 });
    const parsed = parseRunnerLine(line);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.event).toEqual({ type: "progress", phase: "warmup", iteration: 1, total: 3 });
  });

  test("rejects non-JSON and schema-invalid lines without throwing", () => {
    expect(parseRunnerLine("hello world").ok).toBe(false);
    expect(parseRunnerLine('{"type":"measurement","iteration":-1}').ok).toBe(false);
    expect(parseRunnerLine('{"type":"unknown"}').ok).toBe(false);
  });

  test("parses a measurement with http fields", () => {
    const parsed = parseRunnerLine(
      JSON.stringify({
        type: "measurement",
        phase: "measured",
        iteration: 2,
        elapsedMs: 10.5,
        ops: 100,
        rssBytes: 1,
        heapUsedBytes: 1,
        checksum: "abc",
        http: { requestsOk: 100, requestsFailed: 0, latencyMeanMs: 1, latencyP50Ms: 1, latencyP90Ms: 2, latencyP95Ms: 2, latencyP99Ms: 3 },
      }),
    );
    expect(parsed.ok).toBe(true);
  });
});

describe("LineSplitter", () => {
  test("handles lines split across chunks and CRLF", () => {
    const s = new LineSplitter();
    expect(s.push("ab")).toEqual([]);
    expect(s.push("c\r\nde")).toEqual(["abc"]);
    expect(s.push(new TextEncoder().encode("f\n\n"))).toEqual(["def"]);
    expect(s.push("tail")).toEqual([]);
    expect(s.flush()).toEqual(["tail"]);
  });
});

describe("exit codes", () => {
  test("are described", () => {
    expect(describeExitCode(EXIT_CODES.deadlineExceeded)).toContain("deadline");
    expect(describeExitCode(null)).toContain("terminated");
    expect(describeExitCode(77)).toContain("77");
  });
});

describe("parseComputeConfig", () => {
  test("rejects invalid JSON and out-of-range values", () => {
    expect(() => parseComputeConfig("{")).toThrow(RunnerError);
    try {
      parseComputeConfig(JSON.stringify({ protocolVersion: 1, type: "cpu", params: { limit: 1 }, iterations: 1, warmups: 0, seed: 1, deadlineMs: 10 }));
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(RunnerError);
      expect((e as RunnerError).exitCode).toBe(EXIT_CODES.invalidConfig);
    }
  });

  test("rejects unknown keys (strict)", () => {
    expect(() =>
      parseComputeConfig(JSON.stringify({ protocolVersion: 1, type: "cpu", params: { limit: 1000, extra: 1 }, iterations: 1, warmups: 0, seed: 1, deadlineMs: 10 })),
    ).toThrow(RunnerError);
  });
});

describe("runComputeBenchmark (shared runner loop)", () => {
  function fakeHost(clockStep = 1) {
    const events: RunnerEvent[] = [];
    let t = 0;
    const host: RunnerHost = {
      now: () => (t += clockStep),
      memory: () => ({ rss: 100, heapUsed: 50 }),
      emit: (e) => events.push(e),
      yieldToEventLoop: async () => {},
      env,
    };
    return { host, events };
  }

  test("emits hello, warm-up progress, one measurement per iteration, then result", async () => {
    const { host, events } = fakeHost();
    await runComputeBenchmark({ protocolVersion: 1, type: "cpu", params: { limit: 1_000 }, iterations: 3, warmups: 2, seed: 1, deadlineMs: 100_000 }, host);
    expect(events[0]?.type).toBe("hello");
    const warm = events.filter((e) => e.type === "progress" && e.phase === "warmup");
    expect(warm).toHaveLength(2);
    const measurements = events.filter((e) => e.type === "measurement");
    expect(measurements).toHaveLength(3);
    expect(measurements.every((m) => m.type === "measurement" && m.elapsedMs === 1 && m.ops === 1_000)).toBe(true);
    const result = events.at(-1);
    expect(result?.type).toBe("result");
  });

  test("throws a deadline error when the deadline passes", async () => {
    const { host } = fakeHost(1_000);
    const promise = runComputeBenchmark({ protocolVersion: 1, type: "cpu", params: { limit: 1_000 }, iterations: 50, warmups: 0, seed: 1, deadlineMs: 5_000 }, host);
    await expect(promise).rejects.toMatchObject({ exitCode: EXIT_CODES.deadlineExceeded });
  });
});
