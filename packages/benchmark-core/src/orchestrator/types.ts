import type {
  AggregateMetric,
  EnvironmentInfo,
  ExecutionStatus,
  LatencyBucket,
  MetricKey,
  RunnerMeasurementEvent,
  RuntimeAggregate,
  RunWarning,
  RuntimeName,
} from "@bunbench/shared";

export interface ExecutionResult {
  runtime: RuntimeName;
  round: number;
  /** Position in the overall execution sequence (0-based). */
  orderIndex: number;
  status: ExecutionStatus;
  exitCode: number | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  /** OS-reported peak RSS of the process under test (the server for HTTP benchmarks). */
  peakRssBytes: number | null;
  env: EnvironmentInfo | null;
  /** HTTP benchmarks: environment of the load client process. */
  clientEnv: EnvironmentInfo | null;
  measurements: RunnerMeasurementEvent[];
  inputChecksum: string | null;
  outputChecksum: string | null;
  opsUnit: string | null;
  latenciesMs: number[];
  errorSamples: string[];
  serverRssAfterBytes: number | null;
}

export type OrchestratorEvent =
  | { type: "plan"; order: RuntimeName[][]; executionsTotal: number }
  | { type: "execution-start"; runtime: RuntimeName; round: number; index: number }
  | { type: "phase"; runtime: RuntimeName; round: number; phase: "server-start" | "verifying" }
  | { type: "progress"; runtime: RuntimeName; round: number; phase: "warmup" | "measured"; iteration: number; total: number }
  | { type: "execution-end"; result: ExecutionResult }
  | { type: "log"; level: "info" | "warn" | "error"; message: string };

export interface BenchmarkOutcome {
  status: "completed" | "failed" | "cancelled";
  errorMessage: string | null;
  executionOrder: RuntimeName[][];
  executions: ExecutionResult[];
  aggregates: RuntimeAggregate[];
  latencyHistogram: LatencyBucket[];
  warnings: RunWarning[];
}

export type MetricMap = Partial<Record<MetricKey, AggregateMetric>>;
