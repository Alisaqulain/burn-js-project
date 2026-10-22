import { type BenchmarkConfig, type Reproducibility, RUNTIME_LABELS } from "@bunbench/shared";
import type { StoredRun } from "../db/repository.ts";

/** Builds the reproducibility section stored with / shown for every result. */
export function buildReproducibility(run: StoredRun, apiBase: string): Reproducibility {
  const body: Partial<BenchmarkConfig> = { ...run.config };
  const json = JSON.stringify(body);
  const notes: string[] = [];
  const seen = new Set<string>();
  for (const e of run.executions) {
    if (!e.metadata || seen.has(e.runtime)) continue;
    seen.add(e.runtime);
    const m = e.metadata;
    notes.push(
      `${RUNTIME_LABELS[e.runtime]} ${m.runtimeVersion} on ${m.platform} ${m.osRelease} (${m.arch}), ${m.cpuCount}x ${m.cpuModel}, timer: ${m.timer}` +
        (m.clientRuntime ? `; load client: ${m.clientRuntime} ${m.clientVersion}` : ""),
    );
  }
  notes.push(`Workload seed ${run.config.seed}; ${run.config.warmups} warm-up and ${run.config.iterations} measured iterations per process; ${run.config.rounds} round(s).`);
  if (run.executionOrder.length) {
    notes.push(`Execution order: ${run.executionOrder.map((round, i) => `round ${i + 1}: ${round.join(" → ")}`).join("; ")}.`);
  }
  notes.push(`Configuration hash ${run.configHash}: only runs with the same hash are directly comparable.`);
  notes.push("Results depend on hardware, OS, background load, power settings and runtime versions. Re-run on the same machine to compare.");
  return {
    command: `curl -X POST ${apiBase}/api/benchmarks -H "content-type: application/json" -d '${json.replace(/'/g, "'\\''")}'`,
    apiRequest: JSON.stringify(body, null, 2),
    notes,
  };
}
