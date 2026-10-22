import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { homedir } from "node:os";
import { buildChildEnv, ChildProcess, runProcess } from "../src/orchestrator/process.ts";
import { detectRuntime, nodeVersionSupported, parseVersion, redactPath, toRuntimeInfo } from "../src/orchestrator/runtime-detect.ts";

const fixtures = join(import.meta.dir, "fixtures");
const bun = process.execPath;

describe("runProcess", () => {
  test("passes stdin, streams stdout lines, captures stderr and exit code", async () => {
    const lines: string[] = [];
    const outcome = await runProcess({ cmd: [bun, join(fixtures, "echo.ts")], cwd: fixtures, stdin: "hi", timeoutMs: 10_000, onLine: (l) => lines.push(l) });
    expect(lines).toEqual(["line1:hi", "line2"]);
    expect(outcome.exitCode).toBe(7);
    expect(outcome.stderr).toContain("diagnostic message");
    expect(outcome.timedOut).toBe(false);
    expect(outcome.cancelled).toBe(false);
  });

  test("kills a process that exceeds its timeout", async () => {
    const started = performance.now();
    const lines: string[] = [];
    const outcome = await runProcess({ cmd: [bun, join(fixtures, "hang.ts")], cwd: fixtures, timeoutMs: 1_000, onLine: (l) => lines.push(l) });
    expect(outcome.timedOut).toBe(true);
    expect(outcome.exitCode).not.toBe(0);
    expect(performance.now() - started).toBeLessThan(8_000);
    expect(lines).toHaveLength(1);
  });

  test("cancels a running process via AbortSignal", async () => {
    const controller = new AbortController();
    const child = new ChildProcess({ cmd: [bun, join(fixtures, "hang.ts")], cwd: fixtures, timeoutMs: 30_000, signal: controller.signal });
    await child.waitForLine((line) => (line.includes("progress") ? true : undefined), 10_000);
    controller.abort();
    const outcome = await child.wait();
    expect(outcome.cancelled).toBe(true);
    expect(outcome.timedOut).toBe(false);
    expect(child.exited).toBe(true);
  });

  test("an already-aborted signal kills immediately", async () => {
    const controller = new AbortController();
    controller.abort();
    const outcome = await runProcess({ cmd: [bun, join(fixtures, "hang.ts")], cwd: fixtures, timeoutMs: 30_000, signal: controller.signal });
    expect(outcome.cancelled).toBe(true);
  });

  test("waitForLine rejects when the process exits first", async () => {
    const child = new ChildProcess({ cmd: [bun, join(fixtures, "echo.ts")], cwd: fixtures, timeoutMs: 10_000 });
    await expect(child.waitForLine(() => undefined, 10_000)).rejects.toThrow(/exited/);
    await child.wait();
  });

  test("child environment drops unrelated variables", () => {
    const env = buildChildEnv({ PATH: "/bin", NODE_OPTIONS: "--max-old-space-size=1", BUN_DEBUG: "1", SECRET_TOKEN: "x" });
    expect(env.PATH).toBe("/bin");
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.SECRET_TOKEN).toBeUndefined();
    expect(env.NO_COLOR).toBe("1");
  });
});

describe("runtime detection", () => {
  test("parses version strings", () => {
    expect(parseVersion("v24.22.1\n")).toBe("24.22.1");
    expect(parseVersion("1.4.4")).toBe("1.4.4");
    expect(parseVersion("garbage")).toBeNull();
  });

  test("enforces the minimum Node.js version for type stripping", () => {
    expect(nodeVersionSupported("20.11.0")).toBe(false);
    expect(nodeVersionSupported("22.17.0")).toBe(false);
    expect(nodeVersionSupported("22.18.0")).toBe(true);
    expect(nodeVersionSupported("23.5.0")).toBe(false);
    expect(nodeVersionSupported("23.6.0")).toBe(true);
    expect(nodeVersionSupported("24.0.0")).toBe(true);
  });

  test("detects the Bun running the tests", async () => {
    const detected = await detectRuntime("bun");
    expect(detected.available).toBe(true);
    expect(detected.version).toBe(Bun.version);
    expect(detected.source).toBe("current-process");
  });

  test("rejects unsafe or invalid overrides without executing them", async () => {
    const relative = await detectRuntime("node", { override: "node" });
    expect(relative.available).toBe(false);
    expect(relative.reason).toContain("absolute");
    const wrongBinary = await detectRuntime("node", { override: process.platform === "win32" ? "C:\\Windows\\System32\\cmd.exe" : "/bin/sh" });
    expect(wrongBinary.available).toBe(false);
    expect(wrongBinary.reason).toContain("node executable");
    const missing = await detectRuntime("node", { override: join(fixtures, "node") });
    expect(missing.available).toBe(false);
    expect(missing.reason).toContain("does not exist");
  });

  test("redacts the home directory and can hide paths entirely", () => {
    expect(redactPath(join(homedir(), ".bun", "bin", "bun"), true)).toBe(`~${join(homedir(), ".bun", "bin", "bun").slice(homedir().length)}`);
    expect(redactPath("/usr/bin/node", false)).toBeNull();
    const info = toRuntimeInfo({ name: "node", available: false, version: null, execPath: null, source: "none", reason: "missing" }, true);
    expect(info.installHint.length).toBeGreaterThan(10);
    expect(info.docsUrl).toContain("nodejs.org");
  });
});
