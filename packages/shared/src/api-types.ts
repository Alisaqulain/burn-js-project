import type {
  BenchmarkType,
  ExecutionStatus,
  MetricDirection,
  MetricKey,
  RunStatus,
  RuntimeName,
} from "./constants.ts";
import type { BenchmarkConfig, Settings } from "./schemas.ts";

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiErrorBody {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiErrorBody;

export interface RuntimeInfo {
  name: RuntimeName;
  available: boolean;
  version: string | null;
  /** Executable path with the home directory redacted, or null when hidden/unknown. */
  path: string | null;
  source: "env" | "current-process" | "path" | "none";
  /** Why the runtime cannot be used, if unavailable. */
  reason: string | null;
  installHint: string;
  docsUrl: string;
}

export interface AggregateMetric {
  metric: MetricKey;
  value: number;
  unit: string;
  better: MetricDirection;
  sampleCount: number;
}

export interface MeasurementRow {
  iteration: number;
  round: number;
  elapsedMs: number;
  ops: number;
  opsPerSec: number;
  rssBytes: number;
  heapUsedBytes: number;
  checksum: string;
  requestsOk: number | null;
  requestsFailed: number | null;
  latencyMeanMs: number | null;
  latencyP50Ms: number | null;
  latencyP90Ms: number | null;
  latencyP95Ms: number | null;
  latencyP99Ms: number | null;
}

export interface ExecutionMetadata {
  runtimeVersion: string;
  platform: string;
  osRelease: string;
  arch: string;
  cpuModel: string;
  cpuCount: number;
  totalMemoryBytes: number;
  timer: string;
  /** HTTP benchmarks: the runtime/version that generated load. */
  clientRuntime: string | null;
  clientVersion: string | null;
}

export interface ExecutionDetail {
  id: number;
  runtime: RuntimeName;
  round: number;
  orderIndex: number;
  status: ExecutionStatus;
  exitCode: number | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  peakRssBytes: number | null;
  inputChecksum: string | null;
  outputChecksum: string | null;
  metadata: ExecutionMetadata | null;
  measurements: MeasurementRow[];
}

export interface LatencyBucket {
  runtime: RuntimeName;
  upperMs: number;
  count: number;
}

export interface RuntimeAggregate {
  runtime: RuntimeName;
  status: ExecutionStatus;
  metrics: Partial<Record<MetricKey, AggregateMetric>>;
}

export interface RunWarning {
  code: string;
  message: string;
}

export interface RunSummary {
  id: string;
  label: string | null;
  type: BenchmarkType;
  status: RunStatus;
  runtimes: RuntimeName[];
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  errorMessage: string | null;
  configHash: string;
  /** Median iteration time (or HTTP req/s) per runtime for quick display. */
  headline: Partial<Record<RuntimeName, { metric: MetricKey; value: number } | null>>;
}

export interface RunDetail extends RunSummary {
  config: BenchmarkConfig;
  executionOrder: RuntimeName[][];
  executions: ExecutionDetail[];
  aggregates: RuntimeAggregate[];
  latencyHistogram: LatencyBucket[];
  warnings: RunWarning[];
  reproducibility: Reproducibility;
  live: LiveProgress | null;
}

export interface Reproducibility {
  command: string;
  apiRequest: string;
  notes: string[];
}

export interface LiveProgress {
  status: RunStatus;
  runtime: RuntimeName | null;
  round: number | null;
  phase: "preparing" | "warmup" | "measured" | "server-start" | "verifying" | null;
  iteration: number | null;
  total: number | null;
  /** Completed executions / total planned executions. */
  executionsDone: number;
  executionsTotal: number;
  startedAt: string | null;
  message: string | null;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface CompareResult {
  runs: RunDetail[];
  /** Comparable groups: runs that share an identical configuration hash. */
  groups: { configHash: string; runIds: string[]; type: BenchmarkType }[];
  warnings: RunWarning[];
  /** Per-run runtime ratios for the headline metric (Node value / Bun value or vice versa). */
  ratios: {
    runId: string;
    metric: MetricKey;
    better: MetricDirection;
    bun: number | null;
    node: number | null;
    /** How many times better the faster runtime was on this metric; null when not comparable. */
    factor: number | null;
    leader: RuntimeName | null;
  }[];
}

export interface OverviewStats {
  totalRuns: number;
  completedRuns: number;
  latestRun: RunSummary | null;
  latestComparison: {
    runId: string;
    type: BenchmarkType;
    metric: MetricKey;
    leader: RuntimeName | null;
    factor: number | null;
    createdAt: string;
  } | null;
  httpThroughput: {
    configHash: string;
    runCount: number;
    params: string;
    byRuntime: Partial<Record<RuntimeName, number>>;
  } | null;
  httpTrend: {
    runId: string;
    createdAt: string;
    bunRps: number | null;
    nodeRps: number | null;
    bunP95: number | null;
    nodeP95: number | null;
  }[];
  runtimeComparison: {
    type: BenchmarkType;
    runId: string;
    metric: MetricKey;
    bun: number | null;
    node: number | null;
    better: MetricDirection;
  }[];
}

export interface HealthInfo {
  status: "ok";
  version: string;
  uptimeSeconds: number;
  database: { ok: boolean; path: string; schemaVersion: number; runCount: number };
  queue: { running: number; queued: number; maxConcurrent: number };
}

export interface SettingsResponse {
  settings: Settings;
  database: { path: string; schemaVersion: number; sizeBytes: number | null; runCount: number };
  runtimeConfig: { bunPathOverride: boolean; nodePathOverride: boolean; exposePaths: boolean };
  server: { host: string; port: number; corsOrigins: string[]; rateLimitPerMinute: number };
}

/** Server-Sent Event payloads on /api/benchmarks/:id/events. */
export type RunStreamEvent =
  | { type: "snapshot"; live: LiveProgress }
  | { type: "status"; status: RunStatus; message: string | null }
  | { type: "progress"; live: LiveProgress }
  | { type: "execution"; runtime: RuntimeName; round: number; status: ExecutionStatus; message: string | null }
  | { type: "log"; level: "info" | "warn" | "error"; message: string }
  | { type: "done"; status: RunStatus };
