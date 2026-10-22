/** Shared helpers for repository scripts. Cross-platform: no shell strings, argv arrays only. */
import { resolve } from "node:path";

export const ROOT = resolve(import.meta.dir, "..");

export interface StepResult {
  name: string;
  ok: boolean;
  skipped?: string;
  ms: number;
}

/** Runs a command inheriting stdio; resolves with its exit code. */
export async function run(cmd: string[], options: { cwd?: string; env?: Record<string, string | undefined> } = {}): Promise<number> {
  const proc = Bun.spawn({
    cmd,
    cwd: options.cwd ?? ROOT,
    env: { ...process.env, ...options.env },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return proc.exited;
}

export async function step(name: string, cmd: string[], options: { cwd?: string } = {}): Promise<StepResult> {
  console.log(`\n\x1b[1m▶ ${name}\x1b[0m  (${cmd.join(" ")})`);
  const t0 = performance.now();
  const code = await run(cmd, options);
  return { name, ok: code === 0, ms: performance.now() - t0 };
}

export function printSummary(results: StepResult[]): boolean {
  console.log("\n\x1b[1mSummary\x1b[0m");
  for (const r of results) {
    const mark = r.skipped ? "SKIPPED" : r.ok ? "PASS   " : "FAIL   ";
    console.log(`  ${mark} ${r.name}${r.skipped ? ` (${r.skipped})` : ""}  ${(r.ms / 1000).toFixed(1)}s`);
  }
  return results.every((r) => r.ok || r.skipped);
}

/** The bun executable running this script (works even when bun is not on PATH). */
export const BUN = process.execPath;

export function findNode(): string | null {
  return process.env.BUNBENCH_NODE_PATH || Bun.which("node");
}
