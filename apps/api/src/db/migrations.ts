/**
 * Ordered, append-only schema migrations. Never edit a migration that has shipped; add a new one.
 * Each migration runs inside a transaction and is recorded in schema_migrations.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial_schema",
    sql: `
CREATE TABLE runs (
  id                TEXT PRIMARY KEY,
  label             TEXT,
  benchmark_type    TEXT NOT NULL CHECK (benchmark_type IN ('cpu','json','array','http','memory')),
  status            TEXT NOT NULL CHECK (status IN ('queued','preparing','running','completed','failed','cancelled')),
  config_hash       TEXT NOT NULL,
  execution_order   TEXT,
  idempotency_key   TEXT,
  error_message     TEXT,
  created_at        TEXT NOT NULL,
  started_at        TEXT,
  finished_at       TEXT,
  duration_ms       REAL
);
CREATE INDEX idx_runs_created_at ON runs(created_at DESC);
CREATE INDEX idx_runs_status ON runs(status);
CREATE INDEX idx_runs_type_created ON runs(benchmark_type, created_at DESC);
CREATE INDEX idx_runs_config_hash ON runs(config_hash, created_at DESC);
CREATE UNIQUE INDEX idx_runs_idempotency ON runs(idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE workload_configs (
  run_id           TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  iterations       INTEGER NOT NULL CHECK (iterations > 0),
  warmups          INTEGER NOT NULL CHECK (warmups >= 0),
  rounds           INTEGER NOT NULL CHECK (rounds > 0),
  seed             INTEGER NOT NULL,
  max_duration_ms  INTEGER NOT NULL CHECK (max_duration_ms > 0),
  params_json      TEXT NOT NULL
);

CREATE TABLE run_runtimes (
  run_id   TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  runtime  TEXT NOT NULL CHECK (runtime IN ('bun','node')),
  status   TEXT NOT NULL CHECK (status IN ('pending','running','completed','failed','timeout','cancelled','unavailable')),
  PRIMARY KEY (run_id, runtime)
);
CREATE INDEX idx_run_runtimes_runtime ON run_runtimes(runtime, status);

CREATE TABLE executions (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id                  TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  runtime                 TEXT NOT NULL CHECK (runtime IN ('bun','node')),
  round                   INTEGER NOT NULL,
  order_index             INTEGER NOT NULL,
  status                  TEXT NOT NULL CHECK (status IN ('pending','running','completed','failed','timeout','cancelled','unavailable')),
  exit_code               INTEGER,
  error_message           TEXT,
  started_at              TEXT,
  finished_at             TEXT,
  duration_ms             REAL,
  peak_rss_bytes          INTEGER,
  input_checksum          TEXT,
  output_checksum         TEXT,
  ops_unit                TEXT,
  error_samples_json      TEXT,
  server_rss_after_bytes  INTEGER
);
CREATE INDEX idx_executions_run ON executions(run_id, order_index);

CREATE TABLE runtime_metadata (
  execution_id        INTEGER PRIMARY KEY REFERENCES executions(id) ON DELETE CASCADE,
  runtime_version     TEXT NOT NULL,
  platform            TEXT NOT NULL,
  os_release          TEXT NOT NULL,
  arch                TEXT NOT NULL,
  cpu_model           TEXT NOT NULL,
  cpu_count           INTEGER NOT NULL,
  total_memory_bytes  INTEGER NOT NULL,
  timer               TEXT NOT NULL,
  client_runtime      TEXT,
  client_version      TEXT
);

CREATE TABLE measurements (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  execution_id     INTEGER NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  iteration        INTEGER NOT NULL,
  elapsed_ms       REAL NOT NULL CHECK (elapsed_ms >= 0),
  ops              REAL NOT NULL,
  rss_bytes        INTEGER NOT NULL,
  heap_used_bytes  INTEGER NOT NULL,
  checksum         TEXT NOT NULL,
  requests_ok      INTEGER,
  requests_failed  INTEGER,
  latency_mean_ms  REAL,
  latency_p50_ms   REAL,
  latency_p90_ms   REAL,
  latency_p95_ms   REAL,
  latency_p99_ms   REAL,
  UNIQUE (execution_id, iteration)
);

CREATE TABLE aggregate_results (
  run_id        TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  runtime       TEXT NOT NULL CHECK (runtime IN ('bun','node')),
  metric        TEXT NOT NULL,
  value         REAL NOT NULL,
  unit          TEXT NOT NULL,
  better        TEXT NOT NULL CHECK (better IN ('lower','higher','neutral')),
  sample_count  INTEGER NOT NULL,
  PRIMARY KEY (run_id, runtime, metric)
);
CREATE INDEX idx_aggregates_metric ON aggregate_results(metric, runtime);

CREATE TABLE latency_buckets (
  run_id    TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  runtime   TEXT NOT NULL CHECK (runtime IN ('bun','node')),
  upper_ms  REAL NOT NULL,
  count     INTEGER NOT NULL,
  PRIMARY KEY (run_id, runtime, upper_ms)
);

CREATE TABLE run_warnings (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id   TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  code     TEXT NOT NULL,
  message  TEXT NOT NULL
);
CREATE INDEX idx_run_warnings_run ON run_warnings(run_id);

CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value_json  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
`,
  },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;
