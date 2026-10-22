/**
 * Node.js-native tests for the Node runner and Node HTTP server, executed with `node --test`
 * (Node's built-in test runner) so they exercise exactly the runtime the runner targets.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { expectedHttpBody } from "@bunbench/benchmark-core/workloads";

const here = dirname(fileURLToPath(import.meta.url));
const runner = join(here, "..", "runner.ts");
const server = join(here, "..", "http-server.ts");

function runNode(script: string, stdin: string): Promise<{ code: number | null; lines: string[]; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, lines: stdout.split("\n").filter(Boolean), stderr }));
    child.stdin.end(stdin);
  });
}

test("node runner executes a CPU workload and emits the protocol", async () => {
  const config = { protocolVersion: 1, type: "cpu", params: { limit: 10_000 }, iterations: 2, warmups: 1, seed: 1, deadlineMs: 30_000 };
  const { code, lines } = await runNode(runner, JSON.stringify(config));
  assert.equal(code, 0);
  const events = lines.map((l) => JSON.parse(l) as { type: string; env?: { runtime: string; version: string }; outputChecksum?: string });
  assert.equal(events[0]!.type, "hello");
  assert.equal(events[0]!.env!.runtime, "node");
  assert.equal(events[0]!.env!.version, process.versions.node);
  assert.equal(events.filter((e) => e.type === "measurement").length, 2);
  const result = events.at(-1)!;
  assert.equal(result.type, "result");
  assert.match(result.outputChecksum!, /^1229-[0-9a-f]{8}$/);
});

test("node runner rejects invalid configuration with exit code 2", async () => {
  const { code, stderr } = await runNode(runner, JSON.stringify({ type: "cpu" }));
  assert.equal(code, 2);
  assert.match(stderr, /Invalid configuration/);
});

test("node HTTP server serves the exact shared payload and shuts down", async () => {
  const child = spawn(process.execPath, [server], { stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.end(JSON.stringify({ protocolVersion: 1, payloadItems: 5, seed: 9 }));
  const rl = createInterface({ input: child.stdout });
  const ready = await new Promise<{ port: number; env: { runtime: string } }>((resolve, reject) => {
    rl.once("line", (line) => resolve(JSON.parse(line)));
    child.once("exit", () => reject(new Error("server exited early")));
  });
  assert.equal(ready.env.runtime, "node");
  const res = await fetch(`http://127.0.0.1:${ready.port}/payload`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), expectedHttpBody(5, 9));
  const exited = new Promise((resolve) => child.once("exit", resolve));
  await fetch(`http://127.0.0.1:${ready.port}/__shutdown`, { method: "POST" });
  assert.equal(await exited, 0);
});
