import { compareValues } from "@bunbench/benchmark-core/stats";
import {
  BENCHMARK_TYPES,
  type CompareResult,
  METRIC_DEFINITIONS,
  type OverviewStats,
  type RunSummary,
  type RunWarning,
} from "@bunbench/shared";
import { headlineMetric, type RunRepository, type StoredRun } from "../db/repository.ts";
import { describeParams } from "../lib/config-hash.ts";
import { notFound } from "../lib/errors.ts";

function bothRuntimes(run: RunSummary): boolean {
  return run.headline.bun != null && run.headline.node != null;
}

/** Overview dashboard statistics. Aggregates only ever combine runs with an identical config hash. */
export function computeOverview(repo: RunRepository): OverviewStats {
  const totalRuns = repo.countRuns();
  const completedRuns = repo.countByStatus("completed");
  const latestRun = repo.latestRun();

  const recentCompleted = repo.listCompletedRunRows({ limit: 200 });
  const latestPair = recentCompleted.find(bothRuntimes) ?? null;
  let latestComparison: OverviewStats["latestComparison"] = null;
  if (latestPair) {
    const metric = headlineMetric(latestPair.type);
    const cmp = compareValues(
      { runtime: "bun", value: latestPair.headline.bun?.value ?? null },
      { runtime: "node", value: latestPair.headline.node?.value ?? null },
      METRIC_DEFINITIONS[metric].better,
    );
    latestComparison = { runId: latestPair.id, type: latestPair.type, metric, leader: cmp.leader, factor: cmp.factor, createdAt: latestPair.createdAt };
  }

  let httpThroughput: OverviewStats["httpThroughput"] = null;
  let httpTrend: OverviewStats["httpTrend"] = [];
  const latestHttp = recentCompleted.find((r) => r.type === "http") ?? null;
  if (latestHttp) {
    const sameConfig = repo.listCompletedRunRows({ type: "http", configHash: latestHttp.configHash, limit: 30 });
    const byRuntime: Partial<Record<"bun" | "node", number>> = {};
    for (const rt of ["bun", "node"] as const) {
      const values = sameConfig.map((r) => r.headline[rt]?.value).filter((v): v is number => v != null);
      if (values.length) byRuntime[rt] = values.reduce((a, b) => a + b, 0) / values.length;
    }
    const config = repo.getConfig(latestHttp.id);
    httpThroughput = {
      configHash: latestHttp.configHash,
      runCount: sameConfig.length,
      params: config ? describeParams(config) : "",
      byRuntime,
    };
    httpTrend = sameConfig
      .slice()
      .reverse()
      .map((r) => {
        const aggs = repo.aggregateValues(r.id);
        const get = (rt: string, metric: string) => aggs.find((a) => a.runtime === rt && a.metric === metric)?.value ?? null;
        return {
          runId: r.id,
          createdAt: r.createdAt,
          bunRps: get("bun", "http_rps"),
          nodeRps: get("node", "http_rps"),
          bunP95: get("bun", "http_latency_p95_ms"),
          nodeP95: get("node", "http_latency_p95_ms"),
        };
      });
  }

  const runtimeComparison: OverviewStats["runtimeComparison"] = [];
  for (const type of BENCHMARK_TYPES) {
    const run = recentCompleted.find((r) => r.type === type && bothRuntimes(r));
    if (!run) continue;
    const metric = headlineMetric(type);
    runtimeComparison.push({
      type,
      runId: run.id,
      metric,
      bun: run.headline.bun?.value ?? null,
      node: run.headline.node?.value ?? null,
      better: METRIC_DEFINITIONS[metric].better,
    });
  }

  return { totalRuns, completedRuns, latestRun, latestComparison, httpThroughput, httpTrend, runtimeComparison };
}

/** Compares saved runs. Runs are grouped by config hash; cross-group comparisons are flagged. */
export function compareRuns(repo: RunRepository, ids: readonly string[], decorate: (run: StoredRun) => CompareResult["runs"][number]): CompareResult {
  const stored = ids.map((id) => {
    const run = repo.getRun(id);
    if (!run) throw notFound(`Benchmark run ${id}`);
    return run;
  });
  const groupsMap = new Map<string, { configHash: string; runIds: string[]; type: StoredRun["type"] }>();
  for (const run of stored) {
    const group = groupsMap.get(run.configHash) ?? { configHash: run.configHash, runIds: [], type: run.type };
    group.runIds.push(run.id);
    groupsMap.set(run.configHash, group);
  }
  const groups = [...groupsMap.values()];
  const warnings: RunWarning[] = [];
  if (groups.length > 1) {
    warnings.push({
      code: "mixed_configurations",
      message: `These runs use ${groups.length} different configurations. Values are only directly comparable within the same configuration group.`,
    });
  }
  for (const run of stored) {
    if (run.status !== "completed") {
      warnings.push({ code: "incomplete_run", message: `Run ${run.label ?? run.id.slice(0, 8)} is ${run.status}; its results are incomplete or absent.` });
    }
  }

  const ratios: CompareResult["ratios"] = stored.map((run) => {
    const metric = headlineMetric(run.type);
    const bun = run.aggregates.find((a) => a.runtime === "bun")?.metrics[metric]?.value ?? null;
    const node = run.aggregates.find((a) => a.runtime === "node")?.metrics[metric]?.value ?? null;
    const better = METRIC_DEFINITIONS[metric].better;
    const cmp = compareValues({ runtime: "bun", value: bun }, { runtime: "node", value: node }, better);
    return { runId: run.id, metric, better, bun, node, factor: cmp.factor, leader: cmp.leader };
  });

  return { runs: stored.map(decorate), groups, warnings, ratios };
}
