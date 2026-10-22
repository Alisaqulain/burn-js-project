import { METRIC_DEFINITIONS, type MetricKey } from "@bunbench/shared";
import type { StoredRun } from "../db/repository.ts";
import { describeParams } from "./config-hash.ts";

type Cell = string | number | null | undefined;

/**
 * Escapes one CSV cell (RFC 4180). Cells that a spreadsheet would interpret as a formula are
 * prefixed with an apostrophe to prevent CSV/formula injection from user-provided labels.
 */
export function escapeCsvCell(value: Cell): string {
  if (value === null || value === undefined) return "";
  let text = typeof value === "number" ? (Number.isFinite(value) ? String(value) : "") : value;
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(header: readonly string[], rows: readonly Cell[][]): string {
  const lines = [header.map(escapeCsvCell).join(",")];
  for (const row of rows) lines.push(row.map(escapeCsvCell).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

const METRIC_COLUMNS = Object.keys(METRIC_DEFINITIONS) as MetricKey[];

/** One row per (run, runtime) with configuration, environment and every aggregate metric. */
export function runsToCsv(runs: readonly StoredRun[]): string {
  const header = [
    "run_id",
    "created_at",
    "label",
    "benchmark_type",
    "run_status",
    "config_hash",
    "params",
    "iterations",
    "warmups",
    "rounds",
    "seed",
    "runtime",
    "runtime_status",
    "runtime_version",
    "platform",
    "arch",
    "cpu_model",
    // Metric keys carry their unit as a suffix (e.g. elapsed_median_ms, peak_rss_bytes, http_rps).
    ...METRIC_COLUMNS,
  ];
  const rows: Cell[][] = [];
  for (const run of runs) {
    for (const agg of run.aggregates) {
      const meta = run.executions.find((e) => e.runtime === agg.runtime && e.metadata)?.metadata ?? null;
      rows.push([
        run.id,
        run.createdAt,
        run.label,
        run.type,
        run.status,
        run.configHash,
        describeParams(run.config),
        run.config.iterations,
        run.config.warmups,
        run.config.rounds,
        run.config.seed,
        agg.runtime,
        agg.status,
        meta?.runtimeVersion ?? null,
        meta?.platform ?? null,
        meta?.arch ?? null,
        meta?.cpuModel ?? null,
        ...METRIC_COLUMNS.map((m) => agg.metrics[m]?.value ?? null),
      ]);
    }
  }
  return toCsv(header, rows);
}
