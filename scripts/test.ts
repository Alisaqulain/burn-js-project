/**
 * Test orchestrator.
 *   bun scripts/test.ts unit         - unit tests (no real benchmark processes except fast fixtures)
 *   bun scripts/test.ts integration  - real Bun and Node.js runner processes
 *   bun scripts/test.ts all          - both, plus Node's built-in test runner for the Node runner
 * Missing runtimes are reported as SKIPPED, never as passed.
 */
import { join } from "node:path";
import { BUN, findNode, printSummary, ROOT, type StepResult, step } from "./lib.ts";

const mode = process.argv[2] ?? "unit";
if (!["unit", "integration", "all"].includes(mode)) {
  console.error("usage: bun scripts/test.ts <unit|integration|all>");
  process.exit(2);
}

const results: StepResult[] = [];
const node = findNode();

if (mode === "unit" || mode === "all") {
  results.push(await step("Unit tests: shared, benchmark-core, api", [BUN, "test", "packages/shared/test", "packages/benchmark-core/test", "apps/api/test"]));
  results.push(await step("Component tests: web (happy-dom)", [BUN, "test"], { cwd: join(ROOT, "apps", "web") }));
}

if (mode === "integration" || mode === "all") {
  results.push(await step("Integration: real runners (Bun + Node.js)", [BUN, "test", "packages/benchmark-core/integration", "apps/api/integration"]));
  if (node) {
    results.push(await step("Node built-in test runner: Node runner + server", [node, "--test", "--test-reporter=spec", "runners/node/test/node-runner.test.ts"]));
  } else {
    results.push({ name: "Node built-in test runner: Node runner + server", ok: false, skipped: "node not found on PATH", ms: 0 });
    console.warn("\n⚠ Node.js not found: Node runner tests were SKIPPED (not passed). Install Node.js >= 22.18 or set BUNBENCH_NODE_PATH.");
  }
}

process.exit(printSummary(results) ? 0 : 1);
