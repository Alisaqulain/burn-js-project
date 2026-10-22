import {
  type BenchmarkConfigInput,
  benchmarkConfigSchema,
  type BenchmarkType,
  checkConfigAgainstSettings,
  DEFAULT_SEED,
  type RuntimeInfo,
  type RuntimeName,
  type Settings,
  WORKLOAD_LIMITS,
} from "@bunbench/shared";

/** Form state, payload building and validation for the New benchmark page (mirrors the API). */
type ParamField = { key: string; label: string; min: number; max: number; default: number; hint: string };

export const PARAM_FIELDS: Record<BenchmarkType, ParamField[]> = {
  cpu: [{ key: "limit", label: "Sieve upper limit", ...WORKLOAD_LIMITS.cpu.limit, hint: "Primes are computed up to this number each iteration." }],
  json: [{ key: "records", label: "Records", ...WORKLOAD_LIMITS.json.records, hint: "Nested records serialized and parsed each iteration." }],
  array: [{ key: "size", label: "Array length", ...WORKLOAD_LIMITS.array.size, hint: "Integers mapped, filtered, reduced and sorted each iteration." }],
  memory: [{ key: "objects", label: "Objects", ...WORKLOAD_LIMITS.memory.objects, hint: "Small object graphs allocated and released each iteration." }],
  http: [
    { key: "requests", label: "Requests per iteration", ...WORKLOAD_LIMITS.http.requests, hint: "Measured requests per iteration." },
    { key: "concurrency", label: "Concurrency", ...WORKLOAD_LIMITS.http.concurrency, hint: "Simultaneous in-flight requests from the load client." },
    { key: "payloadItems", label: "Payload items", ...WORKLOAD_LIMITS.http.payloadItems, hint: "Items in the JSON response (size of each response)." },
    { key: "warmupRequests", label: "Warm-up requests", ...WORKLOAD_LIMITS.http.warmupRequests, hint: "Unmeasured requests before measuring." },
    { key: "requestTimeoutMs", label: "Request timeout (ms)", ...WORKLOAD_LIMITS.http.requestTimeoutMs, hint: "Requests slower than this count as failed." },
  ],
};

export type FormState = {
  type: BenchmarkType;
  runtimes: RuntimeName[];
  iterations: string;
  warmups: string;
  rounds: string;
  maxDurationSec: string;
  seed: string;
  label: string;
  params: Record<string, string>;
};

export function defaultParams(type: BenchmarkType): Record<string, string> {
  return Object.fromEntries(PARAM_FIELDS[type].map((f) => [f.key, String(f.default)]));
}

function toNumber(v: string): number {
  return v.trim() === "" ? Number.NaN : Number(v);
}

/** Builds the API payload from form strings. Invalid numbers become NaN and fail validation. */
export function buildConfig(form: FormState): BenchmarkConfigInput {
  const params = Object.fromEntries(Object.entries(form.params).map(([k, v]) => [k, toNumber(v)]));
  return {
    type: form.type,
    params,
    runtimes: form.runtimes,
    iterations: toNumber(form.iterations),
    // HTTP warm-up is configured as a request count (params.warmupRequests), not iterations.
    warmups: form.type === "http" ? 0 : toNumber(form.warmups),
    rounds: toNumber(form.rounds),
    maxDurationMs: Math.round(toNumber(form.maxDurationSec) * 1_000),
    seed: toNumber(form.seed),
    ...(form.label.trim() ? { label: form.label.trim() } : {}),
  } as BenchmarkConfigInput;
}

/** Same validation as the API: Zod schema plus user-configured limits. Keys are form field names. */
export function validateForm(form: FormState, settings: Settings | undefined): Record<string, string> {
  const errors: Record<string, string> = {};
  const parsed = benchmarkConfigSchema.safeParse(buildConfig(form));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.join(".");
      const key = path === "maxDurationMs" ? "maxDurationSec" : path.startsWith("params.") ? path : path.split(".")[0]!;
      const message = issue.code === "invalid_type" ? "Enter a whole number" : issue.message;
      errors[key] ??= key === "maxDurationSec" ? message.replace(/(\d+)/g, (n) => String(Number(n) / 1_000)) : message;
    }
  } else if (settings) {
    for (const issue of checkConfigAgainstSettings(parsed.data, settings)) errors.limits = issue;
  }
  if (form.runtimes.length === 0) errors.runtimes = "Select at least one runtime";
  return errors;
}

export function initialForm(type: BenchmarkType, settings: Settings, runtimes: RuntimeInfo[]): FormState {
  const available = runtimes.filter((r) => r.available).map((r) => r.name);
  return {
    type,
    runtimes: available.length ? available : [],
    iterations: String(settings.defaultIterations),
    warmups: String(settings.defaultWarmups),
    rounds: String(settings.defaultRounds),
    maxDurationSec: String(settings.defaultMaxDurationMs / 1_000),
    seed: String(DEFAULT_SEED),
    label: "",
    params: defaultParams(type),
  };
}
