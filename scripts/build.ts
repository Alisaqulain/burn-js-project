/**
 * Production build: type-check, then build the frontend into apps/web/dist.
 * The API and runners execute TypeScript directly (Bun natively, Node via type stripping),
 * so they need no compilation step; `bun run start` serves the built frontend.
 */
import { join } from "node:path";
import { BUN, printSummary, ROOT, type StepResult, step } from "./lib.ts";

const results: StepResult[] = [];
results.push(await step("Type check", [BUN, "scripts/typecheck.ts"]));
if (results.every((r) => r.ok)) {
  results.push(await step("Frontend build (vite)", [BUN, "x", "vite", "build"], { cwd: join(ROOT, "apps", "web") }));
}
process.exit(printSummary(results) ? 0 : 1);
