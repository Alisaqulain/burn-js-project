import type { BenchmarkOutcome } from "@bunbench/benchmark-core/orchestrator";
import {
  type AggregateMetric,
  type BenchmarkConfig,
  benchmarkConfigSchema,
  type BenchmarkType,
  DEFAULT_SETTINGS,
  type ExecutionDetail,
  type ExecutionStatus,
  type LatencyBucket,
  type ListRunsQuery,
  type MeasurementRow,
  type MetricKey,
  type Paginated,
  type RunDetail,
  type RunStatus,
  type RunSummary,
  type RuntimeAggregate,
  type RuntimeName,
  RUNTIMES,
  type RunWarning,
  type Settings,
  settingsSchema,
} from "@bunbench/shared";
import { currentSchemaVersion, type Db } from "./database.ts";

interface RunRow {
  id: string;
  label: string | null;
  benchmark_type: BenchmarkType;
  status: RunStatus;
  config_hash: string;
  execution_order: string | null;
  idempotency_key: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
}

interface ConfigRow {
  run_id: string;
  iterations: number;
  warmups: number;
  rounds: number;
  seed: number;
  max_duration_ms: number;
  params_json: string;
}

interface ExecutionRow {
  id: number;
  run_id: string;
  runtime: RuntimeName;
  round: number;
  order_index: number;
  status: ExecutionStatus;
  exit_code: number | null;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  peak_rss_bytes: number | null;
  input_checksum: string | null;
  output_checksum: string | null;
  runtime_version: string | null;
  platform: string | null;
  os_release: string | null;
  arch: string | null;
  cpu_model: string | null;
  cpu_count: number | null;
  total_memory_bytes: number | null;
  timer: string | null;
  client_runtime: string | null;
  client_version: string | null;
}

interface MeasurementDbRow {
  execution_id: number;
  iteration: number;
  elapsed_ms: number;
  ops: number;
  rss_bytes: number;
  heap_used_bytes: number;
  checksum: string;
  requests_ok: number | null;
  requests_failed: number | null;
  latency_mean_ms: number | null;
  latency_p50_ms: number | null;
  latency_p90_ms: number | null;
  latency_p95_ms: number | null;
  latency_p99_ms: number | null;
}

interface AggregateRow {
  run_id: string;
  runtime: RuntimeName;
  metric: MetricKey;
  value: number;
  unit: string;
  better: AggregateMetric["better"];
  sample_count: number;
}

export type StoredRun = Omit<RunDetail, "live" | "reproducibility">;

export interface CreateRunInput {
  id: string;
  config: BenchmarkConfig;
  configHash: string;
  idempotencyKey: string | null;
  createdAt: string;
}

/** Headline metric used in summaries: throughput for HTTP, median iteration time otherwise. */
export function headlineMetric(type: BenchmarkType): MetricKey {
  return type === "http" ? "http_rps" : "elapsed_median_ms";
}

/** Escapes LIKE wildcards so user search text is matched literally. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

export type RunFilters = Omit<ListRunsQuery, "page" | "pageSize">;

function buildWhere(filters: RunFilters): { sql: string; params: (string | number)[] } {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (filters.q) {
    clauses.push("(r.label LIKE ? ESCAPE '\\' OR r.id LIKE ? ESCAPE '\\')");
    const like = escapeLike(filters.q);
    params.push(`%${like}%`, `${like}%`);
  }
  if (filters.type) {
    clauses.push("r.benchmark_type = ?");
    params.push(filters.type);
  }
  if (filters.status) {
    clauses.push("r.status = ?");
    params.push(filters.status);
  }
  if (filters.runtime) {
    clauses.push("EXISTS (SELECT 1 FROM run_runtimes rr WHERE rr.run_id = r.id AND rr.runtime = ?)");
    params.push(filters.runtime);
  }
  if (filters.from) {
    clauses.push("r.created_at >= ?");
    params.push(addDays(filters.from, 0));
  }
  if (filters.to) {
    clauses.push("r.created_at < ?");
    params.push(addDays(filters.to, 1));
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

function placeholders(n: number): string {
  return Array.from({ length: n }, () => "?").join(",");
}

export class RunRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  schemaVersion(): number {
    return currentSchemaVersion(this.db);
  }

  countRuns(): number {
    return this.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM runs").get()?.n ?? 0;
  }

  createRun(input: CreateRunInput): void {
    const { config } = input;
    this.db.transaction(() => {
      this.db
        .query(
          `INSERT INTO runs (id, label, benchmark_type, status, config_hash, idempotency_key, created_at)
           VALUES (?, ?, ?, 'queued', ?, ?, ?)`,
        )
        .run(input.id, config.label ?? null, config.type, input.configHash, input.idempotencyKey, input.createdAt);
      this.db
        .query(
          `INSERT INTO workload_configs (run_id, iterations, warmups, rounds, seed, max_duration_ms, params_json)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(input.id, config.iterations, config.warmups, config.rounds, config.seed, config.maxDurationMs, JSON.stringify(config.params));
      const insertRuntime = this.db.query("INSERT INTO run_runtimes (run_id, runtime, status) VALUES (?, ?, 'pending')");
      for (const runtime of config.runtimes) insertRuntime.run(input.id, runtime);
    })();
  }

  findIdByIdempotencyKey(key: string): string | null {
    return this.db.query<{ id: string }, [string]>("SELECT id FROM runs WHERE idempotency_key = ?").get(key)?.id ?? null;
  }

  getStatus(id: string): RunStatus | null {
    return this.db.query<{ status: RunStatus }, [string]>("SELECT status FROM runs WHERE id = ?").get(id)?.status ?? null;
  }

  getConfig(id: string): BenchmarkConfig | null {
    const run = this.db.query<RunRow, [string]>("SELECT * FROM runs WHERE id = ?").get(id);
    if (!run) return null;
    return this.loadConfig(run);
  }

  updateStatus(
    id: string,
    status: RunStatus,
    fields: { startedAt?: string; finishedAt?: string; errorMessage?: string | null; durationMs?: number } = {},
  ): void {
    this.db
      .query(
        `UPDATE runs SET status = ?,
           started_at = COALESCE(?, started_at),
           finished_at = COALESCE(?, finished_at),
           error_message = CASE WHEN ? THEN ? ELSE error_message END,
           duration_ms = COALESCE(?, duration_ms)
         WHERE id = ?`,
      )
      .run(
        status,
        fields.startedAt ?? null,
        fields.finishedAt ?? null,
        fields.errorMessage !== undefined ? 1 : 0,
        fields.errorMessage ?? null,
        fields.durationMs ?? null,
        id,
      );
  }

  /** Persists a finished benchmark atomically: executions, metadata, measurements, aggregates. */
  saveOutcome(id: string, outcome: BenchmarkOutcome, finishedAt: string, durationMs: number): void {
    const db = this.db;
    db.transaction(() => {
      db.query("DELETE FROM executions WHERE run_id = ?").run(id);
      db.query("DELETE FROM aggregate_results WHERE run_id = ?").run(id);
      db.query("DELETE FROM latency_buckets WHERE run_id = ?").run(id);
      db.query("DELETE FROM run_warnings WHERE run_id = ?").run(id);

      const insertExecution = db.query<{ id: number }, (string | number | null)[]>(
        `INSERT INTO executions (run_id, runtime, round, order_index, status, exit_code, error_message, started_at,
           finished_at, duration_ms, peak_rss_bytes, input_checksum, output_checksum, ops_unit, error_samples_json,
           server_rss_after_bytes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      );
      const insertMeta = db.query(
        `INSERT INTO runtime_metadata (execution_id, runtime_version, platform, os_release, arch, cpu_model, cpu_count,
           total_memory_bytes, timer, client_runtime, client_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertMeasurement = db.query(
        `INSERT INTO measurements (execution_id, iteration, elapsed_ms, ops, rss_bytes, heap_used_bytes, checksum,
           requests_ok, requests_failed, latency_mean_ms, latency_p50_ms, latency_p90_ms, latency_p95_ms, latency_p99_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );

      for (const e of outcome.executions) {
        const row = insertExecution.get(
          id,
          e.runtime,
          e.round,
          e.orderIndex,
          e.status,
          e.exitCode,
          e.errorMessage?.slice(0, 4_000) ?? null,
          e.startedAt,
          e.finishedAt,
          e.durationMs,
          e.peakRssBytes,
          e.inputChecksum,
          e.outputChecksum,
          e.opsUnit,
          e.errorSamples.length ? JSON.stringify(e.errorSamples) : null,
          e.serverRssAfterBytes,
        );
        const executionId = row!.id;
        if (e.env) {
          insertMeta.run(
            executionId,
            e.env.version,
            e.env.platform,
            e.env.osRelease,
            e.env.arch,
            e.env.cpuModel,
            e.env.cpuCount,
            e.env.totalMemoryBytes,
            e.env.timer,
            e.clientEnv?.runtime ?? null,
            e.clientEnv?.version ?? null,
          );
        }
        for (const m of e.measurements) {
          if (m.phase !== "measured") continue;
          insertMeasurement.run(
            executionId,
            m.iteration,
            m.elapsedMs,
            m.ops,
            m.rssBytes,
            m.heapUsedBytes,
            m.checksum,
            m.http?.requestsOk ?? null,
            m.http?.requestsFailed ?? null,
            m.http?.latencyMeanMs ?? null,
            m.http?.latencyP50Ms ?? null,
            m.http?.latencyP90Ms ?? null,
            m.http?.latencyP95Ms ?? null,
            m.http?.latencyP99Ms ?? null,
          );
        }
      }

      const insertAggregate = db.query(
        `INSERT INTO aggregate_results (run_id, runtime, metric, value, unit, better, sample_count) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      const updateRuntime = db.query("UPDATE run_runtimes SET status = ? WHERE run_id = ? AND runtime = ?");
      for (const agg of outcome.aggregates) {
        updateRuntime.run(agg.status, id, agg.runtime);
        for (const m of Object.values(agg.metrics)) {
          if (m && Number.isFinite(m.value)) insertAggregate.run(id, agg.runtime, m.metric, m.value, m.unit, m.better, m.sampleCount);
        }
      }
      const insertBucket = db.query("INSERT INTO latency_buckets (run_id, runtime, upper_ms, count) VALUES (?, ?, ?, ?)");
      for (const b of outcome.latencyHistogram) insertBucket.run(id, b.runtime, b.upperMs, b.count);
      const insertWarning = db.query("INSERT INTO run_warnings (run_id, code, message) VALUES (?, ?, ?)");
      for (const w of outcome.warnings) insertWarning.run(id, w.code, w.message.slice(0, 1_000));

      db.query(
        `UPDATE runs SET status = ?, error_message = ?, execution_order = ?, finished_at = ?, duration_ms = ? WHERE id = ?`,
      ).run(outcome.status, outcome.errorMessage, JSON.stringify(outcome.executionOrder), finishedAt, durationMs, id);
    })();
  }

  /** Marks runs left in a non-terminal state by a previous process as failed. */
  recoverInterrupted(): number {
    const now = new Date().toISOString();
    const result = this.db
      .query(
        `UPDATE runs SET status = 'failed', finished_at = ?, error_message = 'The server stopped before this run finished. No partial results were saved.'
         WHERE status IN ('queued','preparing','running')`,
      )
      .run(now);
    return result.changes;
  }

  deleteRun(id: string): boolean {
    return this.db.query("DELETE FROM runs WHERE id = ?").run(id).changes > 0;
  }

  listRuns(query: ListRunsQuery): Paginated<RunSummary> {
    const { page, pageSize, ...filters } = query;
    const where = buildWhere(filters);
    const total = this.db.query<{ n: number }, (string | number)[]>(`SELECT COUNT(*) AS n FROM runs r ${where.sql}`).get(...where.params)?.n ?? 0;
    const rows = this.db
      .query<RunRow, (string | number)[]>(`SELECT r.* FROM runs r ${where.sql} ORDER BY r.created_at DESC, r.id LIMIT ? OFFSET ?`)
      .all(...where.params, pageSize, (page - 1) * pageSize);
    return {
      items: this.toSummaries(rows),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  /** All runs matching filters (bounded), with full details, for CSV export. */
  listRunsForExport(filters: RunFilters, limit = 5_000): StoredRun[] {
    const where = buildWhere(filters);
    const ids = this.db
      .query<{ id: string }, (string | number)[]>(`SELECT r.id FROM runs r ${where.sql} ORDER BY r.created_at DESC LIMIT ?`)
      .all(...where.params, limit)
      .map((r) => r.id);
    return ids.map((id) => this.getRun(id)).filter((r): r is StoredRun => r !== null);
  }

  private loadConfig(run: RunRow): BenchmarkConfig {
    const cfg = this.db.query<ConfigRow, [string]>("SELECT * FROM workload_configs WHERE run_id = ?").get(run.id);
    const runtimes = this.db
      .query<{ runtime: RuntimeName }, [string]>("SELECT runtime FROM run_runtimes WHERE run_id = ?")
      .all(run.id)
      .map((r) => r.runtime)
      .sort((a, b) => RUNTIMES.indexOf(a) - RUNTIMES.indexOf(b));
    if (!cfg) throw new Error(`Run ${run.id} has no stored workload configuration`);
    let params: unknown;
    try {
      params = JSON.parse(cfg.params_json);
    } catch {
      throw new Error(`Run ${run.id} has corrupt workload parameters`);
    }
    const parsed = benchmarkConfigSchema.safeParse({
      type: run.benchmark_type,
      params,
      runtimes,
      iterations: cfg.iterations,
      warmups: cfg.warmups,
      rounds: cfg.rounds,
      seed: cfg.seed,
      maxDurationMs: cfg.max_duration_ms,
      ...(run.label ? { label: run.label } : {}),
    });
    if (!parsed.success) throw new Error(`Run ${run.id} has an invalid stored configuration`);
    return parsed.data;
  }

  private aggregatesFor(ids: string[]): Map<string, AggregateRow[]> {
    const map = new Map<string, AggregateRow[]>();
    if (ids.length === 0) return map;
    const rows = this.db
      .query<AggregateRow, string[]>(`SELECT * FROM aggregate_results WHERE run_id IN (${placeholders(ids.length)})`)
      .all(...ids);
    for (const row of rows) {
      const list = map.get(row.run_id) ?? [];
      list.push(row);
      map.set(row.run_id, list);
    }
    return map;
  }

  private runtimesFor(ids: string[]): Map<string, { runtime: RuntimeName; status: ExecutionStatus }[]> {
    const map = new Map<string, { runtime: RuntimeName; status: ExecutionStatus }[]>();
    if (ids.length === 0) return map;
    const rows = this.db
      .query<{ run_id: string; runtime: RuntimeName; status: ExecutionStatus }, string[]>(
        `SELECT run_id, runtime, status FROM run_runtimes WHERE run_id IN (${placeholders(ids.length)})`,
      )
      .all(...ids);
    for (const row of rows) {
      const list = map.get(row.run_id) ?? [];
      list.push({ runtime: row.runtime, status: row.status });
      map.set(row.run_id, list);
    }
    for (const list of map.values()) list.sort((a, b) => RUNTIMES.indexOf(a.runtime) - RUNTIMES.indexOf(b.runtime));
    return map;
  }

  private toSummaries(rows: RunRow[]): RunSummary[] {
    const ids = rows.map((r) => r.id);
    const aggregates = this.aggregatesFor(ids);
    const runtimes = this.runtimesFor(ids);
    return rows.map((row) => {
      const metric = headlineMetric(row.benchmark_type);
      const aggs = aggregates.get(row.id) ?? [];
      const rts = (runtimes.get(row.id) ?? []).map((r) => r.runtime);
      const headline: RunSummary["headline"] = {};
      for (const rt of rts) {
        const found = aggs.find((a) => a.runtime === rt && a.metric === metric);
        headline[rt] = found ? { metric, value: found.value } : null;
      }
      return {
        id: row.id,
        label: row.label,
        type: row.benchmark_type,
        status: row.status,
        runtimes: rts,
        createdAt: row.created_at,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        durationMs: row.duration_ms,
        errorMessage: row.error_message,
        configHash: row.config_hash,
        headline,
      };
    });
  }

  getRun(id: string): StoredRun | null {
    const row = this.db.query<RunRow, [string]>("SELECT * FROM runs WHERE id = ?").get(id);
    if (!row) return null;
    const summary = this.toSummaries([row])[0]!;
    const config = this.loadConfig(row);

    const execRows = this.db
      .query<ExecutionRow, [string]>(
        `SELECT e.*, m.runtime_version, m.platform, m.os_release, m.arch, m.cpu_model, m.cpu_count, m.total_memory_bytes,
                m.timer, m.client_runtime, m.client_version
         FROM executions e LEFT JOIN runtime_metadata m ON m.execution_id = e.id
         WHERE e.run_id = ? ORDER BY e.order_index, e.id`,
      )
      .all(id);
    const measurementRows = execRows.length
      ? this.db
          .query<MeasurementDbRow, number[]>(
            `SELECT * FROM measurements WHERE execution_id IN (${placeholders(execRows.length)}) ORDER BY execution_id, iteration`,
          )
          .all(...execRows.map((e) => e.id))
      : [];

    const executions: ExecutionDetail[] = execRows.map((e) => ({
      id: e.id,
      runtime: e.runtime,
      round: e.round,
      orderIndex: e.order_index,
      status: e.status,
      exitCode: e.exit_code,
      errorMessage: e.error_message,
      startedAt: e.started_at,
      finishedAt: e.finished_at,
      durationMs: e.duration_ms,
      peakRssBytes: e.peak_rss_bytes,
      inputChecksum: e.input_checksum,
      outputChecksum: e.output_checksum,
      metadata: e.runtime_version
        ? {
            runtimeVersion: e.runtime_version,
            platform: e.platform ?? "",
            osRelease: e.os_release ?? "",
            arch: e.arch ?? "",
            cpuModel: e.cpu_model ?? "",
            cpuCount: e.cpu_count ?? 0,
            totalMemoryBytes: e.total_memory_bytes ?? 0,
            timer: e.timer ?? "",
            clientRuntime: e.client_runtime,
            clientVersion: e.client_version,
          }
        : null,
      measurements: measurementRows
        .filter((m) => m.execution_id === e.id)
        .map(
          (m): MeasurementRow => ({
            iteration: m.iteration,
            round: e.round,
            elapsedMs: m.elapsed_ms,
            ops: m.ops,
            opsPerSec: m.elapsed_ms > 0 ? m.ops / (m.elapsed_ms / 1_000) : 0,
            rssBytes: m.rss_bytes,
            heapUsedBytes: m.heap_used_bytes,
            checksum: m.checksum,
            requestsOk: m.requests_ok,
            requestsFailed: m.requests_failed,
            latencyMeanMs: m.latency_mean_ms,
            latencyP50Ms: m.latency_p50_ms,
            latencyP90Ms: m.latency_p90_ms,
            latencyP95Ms: m.latency_p95_ms,
            latencyP99Ms: m.latency_p99_ms,
          }),
        ),
    }));

    const runtimeStatuses = this.runtimesFor([id]).get(id) ?? [];
    const aggRows = this.aggregatesFor([id]).get(id) ?? [];
    const aggregates: RuntimeAggregate[] = runtimeStatuses.map(({ runtime, status }) => {
      const metrics: RuntimeAggregate["metrics"] = {};
      for (const a of aggRows.filter((r) => r.runtime === runtime)) {
        metrics[a.metric] = { metric: a.metric, value: a.value, unit: a.unit, better: a.better, sampleCount: a.sample_count };
      }
      return { runtime, status, metrics };
    });

    const latencyHistogram: LatencyBucket[] = this.db
      .query<{ runtime: RuntimeName; upper_ms: number; count: number }, [string]>(
        "SELECT runtime, upper_ms, count FROM latency_buckets WHERE run_id = ? ORDER BY runtime, CASE WHEN upper_ms < 0 THEN 1 ELSE 0 END, upper_ms",
      )
      .all(id)
      .map((b) => ({ runtime: b.runtime, upperMs: b.upper_ms, count: b.count }));
    const warnings: RunWarning[] = this.db
      .query<RunWarning, [string]>("SELECT code, message FROM run_warnings WHERE run_id = ? ORDER BY id")
      .all(id);

    let executionOrder: RuntimeName[][] = [];
    if (row.execution_order) {
      try {
        executionOrder = JSON.parse(row.execution_order) as RuntimeName[][];
      } catch {
        executionOrder = [];
      }
    }
    return { ...summary, config, executionOrder, executions, aggregates, latencyHistogram, warnings };
  }

  /** Completed runs in chronological order, optionally filtered, for overview statistics. */
  listCompletedRunRows(filters: { type?: BenchmarkType; configHash?: string; limit?: number } = {}): RunSummary[] {
    const clauses = ["r.status = 'completed'"];
    const params: (string | number)[] = [];
    if (filters.type) {
      clauses.push("r.benchmark_type = ?");
      params.push(filters.type);
    }
    if (filters.configHash) {
      clauses.push("r.config_hash = ?");
      params.push(filters.configHash);
    }
    const rows = this.db
      .query<RunRow, (string | number)[]>(
        `SELECT r.* FROM runs r WHERE ${clauses.join(" AND ")} ORDER BY r.created_at DESC LIMIT ?`,
      )
      .all(...params, filters.limit ?? 50);
    return this.toSummaries(rows);
  }

  aggregateValues(runId: string): AggregateRow[] {
    return this.aggregatesFor([runId]).get(runId) ?? [];
  }

  latestRun(): RunSummary | null {
    const row = this.db.query<RunRow, []>("SELECT * FROM runs ORDER BY created_at DESC LIMIT 1").get();
    return row ? this.toSummaries([row])[0]! : null;
  }

  countByStatus(status: RunStatus): number {
    return this.db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM runs WHERE status = ?").get(status)?.n ?? 0;
  }

  getSettings(): Settings {
    const row = this.db.query<{ value_json: string }, [string]>("SELECT value_json FROM settings WHERE key = ?").get("app");
    if (!row) return { ...DEFAULT_SETTINGS };
    try {
      const parsed = settingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...(JSON.parse(row.value_json) as object) });
      return parsed.success ? parsed.data : { ...DEFAULT_SETTINGS };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  saveSettings(settings: Settings): void {
    this.db
      .query(
        `INSERT INTO settings (key, value_json, updated_at) VALUES ('app', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run(JSON.stringify(settings), new Date().toISOString());
  }
}
