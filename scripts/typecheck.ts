/** Type-checks every project with its own tsconfig (strict mode everywhere). */
import { BUN, printSummary, type StepResult, step } from "./lib.ts";

const projects = ["tsconfig.json", "packages/shared", "packages/benchmark-core", "runners", "apps/api", "apps/web"];
const results: StepResult[] = [];
for (const p of projects) {
  results.push(await step(`tsc ${p}`, [BUN, "x", "tsc", "-p", p, "--noEmit"]));
}
process.exit(printSummary(results) ? 0 : 1);
