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
import { apiToken } from "./api-token";

/**
 * Normalizes the API base URL: trims whitespace, trailing slashes and a trailing "/api".
 * Empty means "same origin" (local dev through the Vite proxy, or the API serving the UI).
 */
export function normalizeApiBase(raw: string | undefined): string {
  return (raw ?? "").trim().replace(/\/+$/, "").replace(/\/api$/, "");
}

/** Configured at build time with VITE_API_BASE (e.g. https://api.example.com). */
export const API_BASE = normalizeApiBase(import.meta.env.VITE_API_BASE as string | undefined);

/** Where API requests go, for display in errors and Settings. */
export function apiOrigin(): string {
  return API_BASE || (typeof window === "undefined" ? "" : window.location.origin);
}

const BASE = API_BASE;

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
        return {
          title: "Cannot reach the BunBench API",
          hint: API_BASE
            ? `Could not connect to ${API_BASE}. Check that the API server is running, is served over HTTPS, and lists this site's origin (${typeof window === "undefined" ? "" : window.location.origin}) in BUNBENCH_CORS_ORIGINS.`
            : "Start it with `bun run dev` (or `bun run start`) and check that it listens on 127.0.0.1:3001.",
        };
      case "API_NOT_FOUND":
        return {
          title: "The BunBench API was not found",
          hint: API_BASE
            ? `${API_BASE}/api answered HTTP ${error.status} with a non-API response. Check that VITE_API_BASE points to the BunBench API server (not the website) and that the server is running.`
            : `This site has no API at ${apiOrigin()}/api (HTTP ${error.status}). When the frontend is hosted separately (for example on Vercel), set VITE_API_BASE to the BunBench API server's URL and redeploy.`,
        };
      case "UNAUTHORIZED":
        return { title: "Access token required", hint: "This API requires a token for this action. Enter it under Settings → API access." };
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
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  const token = apiToken.get();
  // Only state-changing requests carry the token (GETs stay simple requests without a CORS preflight).
  if (token && method !== "GET") headers.set("authorization", `Bearer ${token}`);
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, { ...init, headers });
  } catch {
    throw new ApiClientError(0, "NETWORK_ERROR", "Network error");
  }
  let body: ApiResponse<T>;
  try {
    body = (await res.json()) as ApiResponse<T>;
  } catch {
    // Not BunBench JSON: typically a static host's 404 page because no API is deployed at this URL.
    const html = (res.headers.get("content-type") ?? "").includes("text/html");
    if (res.status === 404 || res.status === 405 || html) throw new ApiClientError(res.status, "API_NOT_FOUND", `No BunBench API at ${apiOrigin()}/api`);
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
