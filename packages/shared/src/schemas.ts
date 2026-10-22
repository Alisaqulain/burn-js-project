import { z } from "zod";
import {
  BENCHMARK_TYPES,
  DEFAULT_SEED,
  EXECUTION_STATUSES,
  HARD_LIMITS,
  RUN_STATUSES,
  RUNTIMES,
  WORKLOAD_LIMITS,
} from "./constants.ts";

const int = (min: number, max: number) => z.number().int().min(min).max(max);

/** Printable label text: no control characters, trimmed, bounded. */
const labelSchema = z
  .string()
  .trim()
  .max(HARD_LIMITS.labelMaxLength)
  .regex(/^[^\p{Cc}]*$/u, "Label must not contain control characters");

export const runtimeNameSchema = z.enum(RUNTIMES);
export const benchmarkTypeSchema = z.enum(BENCHMARK_TYPES);
export const runStatusSchema = z.enum(RUN_STATUSES);
export const executionStatusSchema = z.enum(EXECUTION_STATUSES);

export const runtimesSchema = z
  .array(runtimeNameSchema)
  .min(1)
  .max(RUNTIMES.length)
  .refine((list) => new Set(list).size === list.length, "Runtimes must be unique");

const W = WORKLOAD_LIMITS;

export const cpuParamsSchema = z.strictObject({
  limit: int(W.cpu.limit.min, W.cpu.limit.max),
});
export const jsonParamsSchema = z.strictObject({
  records: int(W.json.records.min, W.json.records.max),
});
export const arrayParamsSchema = z.strictObject({
  size: int(W.array.size.min, W.array.size.max),
});
export const memoryParamsSchema = z.strictObject({
  objects: int(W.memory.objects.min, W.memory.objects.max),
});
export const httpParamsSchema = z.strictObject({
  requests: int(W.http.requests.min, W.http.requests.max),
  concurrency: int(W.http.concurrency.min, W.http.concurrency.max),
  payloadItems: int(W.http.payloadItems.min, W.http.payloadItems.max),
  warmupRequests: int(W.http.warmupRequests.min, W.http.warmupRequests.max),
  requestTimeoutMs: int(W.http.requestTimeoutMs.min, W.http.requestTimeoutMs.max),
});

export type CpuParams = z.infer<typeof cpuParamsSchema>;
export type JsonParams = z.infer<typeof jsonParamsSchema>;
export type ArrayParams = z.infer<typeof arrayParamsSchema>;
export type MemoryParams = z.infer<typeof memoryParamsSchema>;
export type HttpParams = z.infer<typeof httpParamsSchema>;

const commonConfigShape = {
  runtimes: runtimesSchema,
  iterations: int(HARD_LIMITS.iterations.min, HARD_LIMITS.iterations.max),
  warmups: int(HARD_LIMITS.warmups.min, HARD_LIMITS.warmups.max),
  maxDurationMs: int(HARD_LIMITS.maxDurationMs.min, HARD_LIMITS.maxDurationMs.max),
  rounds: int(HARD_LIMITS.rounds.min, HARD_LIMITS.rounds.max).default(1),
  seed: int(HARD_LIMITS.seed.min, HARD_LIMITS.seed.max).default(DEFAULT_SEED),
  label: labelSchema.optional(),
};

export const benchmarkConfigSchema = z
  .discriminatedUnion("type", [
    z.strictObject({ type: z.literal("cpu"), params: cpuParamsSchema, ...commonConfigShape }),
    z.strictObject({ type: z.literal("json"), params: jsonParamsSchema, ...commonConfigShape }),
    z.strictObject({ type: z.literal("array"), params: arrayParamsSchema, ...commonConfigShape }),
    z.strictObject({ type: z.literal("memory"), params: memoryParamsSchema, ...commonConfigShape }),
    z.strictObject({ type: z.literal("http"), params: httpParamsSchema, ...commonConfigShape }),
  ])
  .superRefine((config, ctx) => {
    if (config.type !== "http") return;
    const { requests, concurrency } = config.params;
    if (concurrency > requests) {
      ctx.addIssue({
        code: "custom",
        path: ["params", "concurrency"],
        message: "Concurrency cannot exceed the number of requests per iteration",
      });
    }
    if (requests * config.iterations > HARD_LIMITS.httpTotalMeasuredRequests) {
      ctx.addIssue({
        code: "custom",
        path: ["params", "requests"],
        message: `requests x iterations must not exceed ${HARD_LIMITS.httpTotalMeasuredRequests.toLocaleString("en-US")}`,
      });
    }
  });

export type BenchmarkConfigInput = z.input<typeof benchmarkConfigSchema>;
export type BenchmarkConfig = z.output<typeof benchmarkConfigSchema>;
export type ComputeBenchmarkConfig = Exclude<BenchmarkConfig, { type: "http" }>;
export type HttpBenchmarkConfig = Extract<BenchmarkConfig, { type: "http" }>;

// ---------------------------------------------------------------------------
// Runner protocol (orchestrator <-> runner processes, JSON over stdin/stdout)
// ---------------------------------------------------------------------------

export const PROTOCOL_VERSION = 1;

/** Configuration written to a compute runner's stdin. */
export const computeRunnerConfigSchema = z.discriminatedUnion("type", [
  z.strictObject({ protocolVersion: z.literal(PROTOCOL_VERSION), type: z.literal("cpu"), params: cpuParamsSchema, iterations: commonConfigShape.iterations, warmups: commonConfigShape.warmups, seed: int(0, HARD_LIMITS.seed.max), deadlineMs: int(1, HARD_LIMITS.maxDurationMs.max * 2) }),
  z.strictObject({ protocolVersion: z.literal(PROTOCOL_VERSION), type: z.literal("json"), params: jsonParamsSchema, iterations: commonConfigShape.iterations, warmups: commonConfigShape.warmups, seed: int(0, HARD_LIMITS.seed.max), deadlineMs: int(1, HARD_LIMITS.maxDurationMs.max * 2) }),
  z.strictObject({ protocolVersion: z.literal(PROTOCOL_VERSION), type: z.literal("array"), params: arrayParamsSchema, iterations: commonConfigShape.iterations, warmups: commonConfigShape.warmups, seed: int(0, HARD_LIMITS.seed.max), deadlineMs: int(1, HARD_LIMITS.maxDurationMs.max * 2) }),
  z.strictObject({ protocolVersion: z.literal(PROTOCOL_VERSION), type: z.literal("memory"), params: memoryParamsSchema, iterations: commonConfigShape.iterations, warmups: commonConfigShape.warmups, seed: int(0, HARD_LIMITS.seed.max), deadlineMs: int(1, HARD_LIMITS.maxDurationMs.max * 2) }),
]);
export type ComputeRunnerConfig = z.infer<typeof computeRunnerConfigSchema>;

/** Configuration written to an HTTP server runner's stdin. */
export const httpServerConfigSchema = z.strictObject({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  payloadItems: httpParamsSchema.shape.payloadItems,
  seed: int(0, HARD_LIMITS.seed.max),
});
export type HttpServerConfig = z.infer<typeof httpServerConfigSchema>;

/** Configuration written to the HTTP load client's stdin. */
export const httpClientConfigSchema = z.strictObject({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  url: z.url().refine((u) => /^http:\/\/127\.0\.0\.1:\d+\//.test(u), "Load client only targets 127.0.0.1"),
  params: httpParamsSchema,
  iterations: commonConfigShape.iterations,
  seed: int(0, HARD_LIMITS.seed.max),
  deadlineMs: int(1, HARD_LIMITS.maxDurationMs.max * 2),
});
export type HttpClientConfig = z.infer<typeof httpClientConfigSchema>;

export const environmentInfoSchema = z.object({
  runtime: runtimeNameSchema,
  version: z.string().max(64),
  platform: z.string().max(32),
  osRelease: z.string().max(128),
  arch: z.string().max(32),
  cpuModel: z.string().max(256),
  cpuCount: z.number().int().nonnegative(),
  totalMemoryBytes: z.number().nonnegative(),
  pid: z.number().int(),
  timer: z.string().max(128),
});
export type EnvironmentInfo = z.infer<typeof environmentInfoSchema>;

const phaseSchema = z.enum(["warmup", "measured"]);

export const runnerHelloEventSchema = z.object({ type: z.literal("hello"), env: environmentInfoSchema });
export const runnerReadyEventSchema = z.object({ type: z.literal("ready"), env: environmentInfoSchema, port: z.number().int().min(1).max(65_535) });
export const runnerProgressEventSchema = z.object({
  type: z.literal("progress"),
  phase: phaseSchema,
  iteration: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});
export const runnerMeasurementEventSchema = z.object({
  type: z.literal("measurement"),
  phase: phaseSchema,
  iteration: z.number().int().positive(),
  elapsedMs: z.number().nonnegative(),
  ops: z.number().nonnegative(),
  rssBytes: z.number().nonnegative(),
  heapUsedBytes: z.number().nonnegative(),
  checksum: z.string().max(64),
  http: z
    .object({
      requestsOk: z.number().int().nonnegative(),
      requestsFailed: z.number().int().nonnegative(),
      latencyMeanMs: z.number().nonnegative(),
      latencyP50Ms: z.number().nonnegative(),
      latencyP90Ms: z.number().nonnegative(),
      latencyP95Ms: z.number().nonnegative(),
      latencyP99Ms: z.number().nonnegative(),
    })
    .optional(),
});
export const runnerResultEventSchema = z.object({
  type: z.literal("result"),
  opsUnit: z.string().max(32),
  inputChecksum: z.string().max(64),
  outputChecksum: z.string().max(64),
  /** HTTP only: every measured request latency in ms (successful requests only). */
  latenciesMs: z.array(z.number().nonnegative()).max(HARD_LIMITS.httpTotalMeasuredRequests).optional(),
  /** HTTP only: a small sample of distinct failure reasons. */
  errorSamples: z.array(z.string().max(300)).max(10).optional(),
});
export const runnerErrorEventSchema = z.object({ type: z.literal("error"), message: z.string().max(2_000) });

export const runnerEventSchema = z.discriminatedUnion("type", [
  runnerHelloEventSchema,
  runnerReadyEventSchema,
  runnerProgressEventSchema,
  runnerMeasurementEventSchema,
  runnerResultEventSchema,
  runnerErrorEventSchema,
]);
export type RunnerEvent = z.infer<typeof runnerEventSchema>;
export type RunnerMeasurementEvent = z.infer<typeof runnerMeasurementEventSchema>;
export type RunnerResultEvent = z.infer<typeof runnerResultEventSchema>;

// ---------------------------------------------------------------------------
// API input schemas
// ---------------------------------------------------------------------------

export const runIdSchema = z.uuid();

export const listRunsQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(80).optional(),
  runtime: runtimeNameSchema.optional(),
  type: benchmarkTypeSchema.optional(),
  status: runStatusSchema.optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});
export type ListRunsQuery = z.infer<typeof listRunsQuerySchema>;

export const compareRequestSchema = z.strictObject({
  ids: z
    .array(runIdSchema)
    .min(1)
    .max(6)
    .refine((ids) => new Set(ids).size === ids.length, "Run ids must be unique"),
});

export const settingsSchema = z
  .strictObject({
    defaultIterations: int(HARD_LIMITS.iterations.min, HARD_LIMITS.iterations.max),
    defaultWarmups: int(HARD_LIMITS.warmups.min, HARD_LIMITS.warmups.max),
    defaultMaxDurationMs: int(HARD_LIMITS.maxDurationMs.min, HARD_LIMITS.maxDurationMs.max),
    defaultRounds: int(HARD_LIMITS.rounds.min, HARD_LIMITS.rounds.max),
    maxIterations: int(HARD_LIMITS.iterations.min, HARD_LIMITS.iterations.max),
    maxWarmups: int(HARD_LIMITS.warmups.min, HARD_LIMITS.warmups.max),
    maxDurationLimitMs: int(HARD_LIMITS.maxDurationMs.min, HARD_LIMITS.maxDurationMs.max),
    maxConcurrentRuns: int(HARD_LIMITS.maxConcurrentRuns.min, HARD_LIMITS.maxConcurrentRuns.max),
    queueLimit: int(HARD_LIMITS.queueLimit.min, HARD_LIMITS.queueLimit.max),
    httpMaxConcurrency: int(1, WORKLOAD_LIMITS.http.concurrency.max),
  })
  .superRefine((s, ctx) => {
    if (s.defaultIterations > s.maxIterations)
      ctx.addIssue({ code: "custom", path: ["defaultIterations"], message: "Default iterations exceed the maximum" });
    if (s.defaultWarmups > s.maxWarmups)
      ctx.addIssue({ code: "custom", path: ["defaultWarmups"], message: "Default warm-ups exceed the maximum" });
    if (s.defaultMaxDurationMs > s.maxDurationLimitMs)
      ctx.addIssue({ code: "custom", path: ["defaultMaxDurationMs"], message: "Default duration exceeds the limit" });
  });
export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  defaultIterations: 10,
  defaultWarmups: 3,
  defaultMaxDurationMs: 60_000,
  defaultRounds: 1,
  maxIterations: 100,
  maxWarmups: 20,
  maxDurationLimitMs: 120_000,
  maxConcurrentRuns: 1,
  queueLimit: 10,
  httpMaxConcurrency: 64,
};

/** Checks a validated config against the user-adjustable limits in settings. Returns issues. */
export function checkConfigAgainstSettings(config: BenchmarkConfig, settings: Settings): string[] {
  const issues: string[] = [];
  if (config.iterations > settings.maxIterations)
    issues.push(`iterations (${config.iterations}) exceeds the configured maximum of ${settings.maxIterations}`);
  if (config.warmups > settings.maxWarmups)
    issues.push(`warmups (${config.warmups}) exceeds the configured maximum of ${settings.maxWarmups}`);
  if (config.maxDurationMs > settings.maxDurationLimitMs)
    issues.push(`maxDurationMs (${config.maxDurationMs}) exceeds the configured limit of ${settings.maxDurationLimitMs}`);
  if (config.type === "http" && config.params.concurrency > settings.httpMaxConcurrency)
    issues.push(`HTTP concurrency (${config.params.concurrency}) exceeds the configured maximum of ${settings.httpMaxConcurrency}`);
  return issues;
}
