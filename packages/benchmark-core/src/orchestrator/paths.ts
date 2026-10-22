import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { RuntimeName } from "@bunbench/shared";

/** Walks up from `start` to the monorepo root (the directory containing runners/package.json). */
export function findRepoRoot(start: string = import.meta.dirname): string {
  if (process.env.BUNBENCH_ROOT) return resolve(process.env.BUNBENCH_ROOT);
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, "runners", "package.json")) && existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`Could not locate the BunBench repository root from ${start}`);
    dir = parent;
  }
}

export interface RunnerPaths {
  /** Working directory for child processes (contains no bunfig.toml or .env). */
  cwd: string;
  compute: Record<RuntimeName, string>;
  server: Record<RuntimeName, string>;
  loadClient: string;
}

/** The only scripts BunBench ever executes. Paths are fixed; nothing comes from user input. */
export function getRunnerPaths(root: string = findRepoRoot()): RunnerPaths {
  const runners = join(root, "runners");
  return {
    cwd: runners,
    compute: { bun: join(runners, "bun", "runner.ts"), node: join(runners, "node", "runner.ts") },
    server: { bun: join(runners, "bun", "http-server.ts"), node: join(runners, "node", "http-server.ts") },
    loadClient: join(runners, "loadgen", "client.ts"),
  };
}
