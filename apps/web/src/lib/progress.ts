import type { LiveProgress, RunDetail } from "@bunbench/shared";

/** Overall fraction from measurable quantities only: finished processes + iterations in the current one. */
export function overallProgress(live: LiveProgress, run: RunDetail): number | null {
  if (live.executionsTotal <= 0) return null;
  let current = 0;
  if (live.phase === "warmup" || live.phase === "measured") {
    // The HTTP client reports its warm-up requests as a single step.
    const warmSteps = run.config.type === "http" ? (run.config.params.warmupRequests > 0 ? 1 : 0) : run.config.warmups;
    const steps = warmSteps + run.config.iterations;
    const done = live.phase === "warmup" ? (live.iteration ?? 0) : warmSteps + (live.iteration ?? 0);
    current = steps > 0 ? Math.min(1, done / steps) : 0;
  }
  return Math.min(1, (live.executionsDone + current) / live.executionsTotal);
}
