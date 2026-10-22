import type {
  ApiResponse,
  BenchmarkConfigInput,
  CompareResult,
  HealthInfo,
  ListRunsQuery,
  OverviewStats,
  Paginated,
  RunDetail,
  RunSummary,
  RuntimeInfo,
  Settings,
  SettingsResponse,
} from "@bunbench/shared";

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Human-oriented explanation for an error, with a hint about what to do next. */
export function describeError(error: unknown): { title: string; hint: string } {
  if (error instanceof ApiClientError) {
    switch (error.code) {
      case "NETWORK_ERROR":
        return { title: "Cannot reach the BunBench API", hint: "Start it with `bun run dev` (or `bun run start`) and check that it listens on 127.0.0.1:3001." };
      case "VALIDATION_ERROR":
      case "LIMIT_EXCEEDED":
        return { title: "The configuration was rejected", hint: error.message };
      case "RATE_LIMITED":
        return { title: "Too many submissions", hint: error.message };
      case "QUEUE_FULL":
        return { title: "The queue is full", hint: "Wait for running benchmarks to finish or cancel one, then retry." };
      case "NOT_FOUND":
        return { title: "Not found", hint: "The run may have been deleted." };
      case "ORIGIN_NOT_ALLOWED":
        return { title: "Origin not allowed", hint: "Add this page's origin to BUNBENCH_CORS_ORIGINS and restart the API." };
      default:
        return { title: error.message, hint: `Error code ${error.code} (HTTP ${error.status}).` };
    }
  }
  return { title: error instanceof Error ? error.message : "Unexpected error", hint: "Check the API server log for details." };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, init);
  } catch {
    throw new ApiClientError(0, "NETWORK_ERROR", "Network error");
  }
  let body: ApiResponse<T>;
  try {
    body = (await res.json()) as ApiResponse<T>;
  } catch {
    throw new ApiClientError(res.status, "BAD_RESPONSE", `Unexpected response (HTTP ${res.status})`);
  }
  if (!body.ok) throw new ApiClientError(res.status, body.error.code, body.error.message, body.error.details);
  return body.data;
}

const json = (method: string, data: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method,
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(data),
});

export function toQueryString(query: Partial<Record<string, string | number | undefined>>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") params.set(k, String(v));
  const s = params.toString();
  return s ? `?${s}` : "";
}

export const api = {
  health: () => request<HealthInfo>("/health"),
  runtimes: (refresh = false) => request<RuntimeInfo[]>(`/runtimes${refresh ? "?refresh=1" : ""}`),
  listRuns: (query: Partial<ListRunsQuery>) => request<Paginated<RunSummary>>(`/benchmarks${toQueryString(query)}`),
  getRun: (id: string) => request<RunDetail>(`/benchmarks/${encodeURIComponent(id)}`),
  createRun: (config: BenchmarkConfigInput, idempotencyKey: string) =>
    request<RunDetail>("/benchmarks", json("POST", config, { "idempotency-key": idempotencyKey })),
  cancelRun: (id: string) => request<{ id: string; status: string }>(`/benchmarks/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
  deleteRun: (id: string) => request<{ id: string; deleted: boolean }>(`/benchmarks/${encodeURIComponent(id)}`, { method: "DELETE" }),
  compare: (ids: string[]) => request<CompareResult>("/benchmarks/compare", json("POST", { ids })),
  overview: () => request<OverviewStats>("/stats/overview"),
  settings: () => request<SettingsResponse>("/settings"),
  updateSettings: (settings: Settings) => request<SettingsResponse>("/settings", json("PUT", settings)),
  exportUrl: (query: Partial<ListRunsQuery>) => `${BASE}/api/benchmarks/export.csv${toQueryString({ ...query, page: undefined, pageSize: undefined })}`,
  eventsUrl: (id: string) => `${BASE}/api/benchmarks/${encodeURIComponent(id)}/events`,
};
