import { existsSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getConnInfo } from "hono/bun";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { timeout } from "hono/timeout";
import { z } from "zod";
import {
  benchmarkConfigSchema,
  compareRequestSchema,
  type HealthInfo,
  listRunsQuerySchema,
  type LiveProgress,
  runIdSchema,
  type RunDetail,
  type SettingsResponse,
  settingsSchema,
  TERMINAL_RUN_STATUSES,
} from "@bunbench/shared";
import type { AppConfig } from "./config.ts";
import type { RunRepository, StoredRun } from "./db/repository.ts";
import { runsToCsv } from "./lib/csv.ts";
import { ApiError, notFound } from "./lib/errors.ts";
import { RateLimiter } from "./lib/rate-limit.ts";
import { buildReproducibility } from "./lib/reproducibility.ts";
import { formatSseComment, formatSseEvent } from "./lib/sse.ts";
import { openApiDocument } from "./openapi.ts";
import type { BenchmarkService } from "./services/benchmark-service.ts";
import type { RunEventBus } from "./services/event-bus.ts";
import { compareRuns, computeOverview } from "./services/insights.ts";
import type { RuntimeService } from "./services/runtime-service.ts";

export const APP_VERSION = "0.1.0";
const MAX_BODY_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;
const SSE_HEARTBEAT_MS = 15_000;

export interface AppDeps {
  config: AppConfig;
  repo: RunRepository;
  bus: RunEventBus;
  runtimes: RuntimeService;
  service: BenchmarkService;
  startedAt?: number;
  /** Overrides how the rate-limit key (client address) is derived; used by tests. */
  clientKey?: (c: Context) => string;
}

function ok<T>(c: Context, data: T, status: 200 | 201 | 202 = 200) {
  return c.json({ ok: true as const, data }, status);
}

function validationError(error: z.ZodError, what: string): ApiError {
  return new ApiError(
    400,
    "VALIDATION_ERROR",
    `Invalid ${what}: ${error.issues.map((i) => `${i.path.join(".") || "(root)"} ${i.message}`).join("; ")}`,
    error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  );
}

function parse<T extends z.ZodType>(schema: T, input: unknown, what: string): z.output<T> {
  const result = schema.safeParse(input);
  if (!result.success) throw validationError(result.error, what);
  return result.data;
}

/** Reads a JSON body, requiring an application/json content type (blocks simple cross-site posts). */
async function readJson(c: Context): Promise<unknown> {
  const type = c.req.header("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Request body must be application/json");
  }
  try {
    return await c.req.json();
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Request body is not valid JSON");
  }
}

function nonEmptyQuery(c: Context): Record<string, string> {
  return Object.fromEntries(Object.entries(c.req.query()).filter(([, v]) => v !== ""));
}

const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, "Idempotency-Key must be 8-64 characters of [A-Za-z0-9_-]");

export function createApp(deps: AppDeps): Hono {
  const { config, repo, bus, runtimes, service } = deps;
  const startedAt = deps.startedAt ?? Date.now();
  const apiBase = `http://${config.host.includes(":") ? `[${config.host}]` : config.host}:${config.port}`;
  const selfOrigins = [`http://127.0.0.1:${config.port}`, `http://localhost:${config.port}`, apiBase];
  const allowedOrigins = new Set([...config.corsOrigins, ...selfOrigins]);
  const createLimiter = new RateLimiter(config.rateLimitPerMinute, 60_000);
  const clientKey =
    deps.clientKey ??
    ((c: Context) => {
      try {
        return getConnInfo(c).remote.address ?? "unknown";
      } catch {
        return "local";
      }
    });

  const toDetail = (run: StoredRun): RunDetail => {
    const active = service.isActive(run.id) || !TERMINAL_RUN_STATUSES.includes(run.status);
    return { ...run, reproducibility: buildReproducibility(run, apiBase), live: active ? bus.getLive(run.id) : null };
  };
  const requireRun = (id: string): StoredRun => {
    const run = repo.getRun(id);
    if (!run) throw notFound("Benchmark run");
    return run;
  };

  const app = new Hono();

  app.onError((error, c) => {
    if (error instanceof ApiError) {
      if (error.code === "RATE_LIMITED" && error.details && typeof error.details === "object" && "retryAfterSeconds" in error.details) {
        c.header("Retry-After", String((error.details as { retryAfterSeconds: number }).retryAfterSeconds));
      }
      return c.json({ ok: false as const, error: { code: error.code, message: error.message, details: error.details } }, error.status);
    }
    if (error instanceof z.ZodError) {
      const e = validationError(error, "input");
      return c.json({ ok: false as const, error: { code: e.code, message: e.message, details: e.details } }, 400);
    }
    if (error.name === "HTTPException" && "status" in error) {
      const status = (error as { status: number }).status;
      const code = status === 413 ? "PAYLOAD_TOO_LARGE" : status === 504 ? "TIMEOUT" : "HTTP_ERROR";
      return c.json({ ok: false as const, error: { code, message: error.message || code } }, status as 413);
    }
    console.error("[bunbench] unhandled error:", error);
    return c.json({ ok: false as const, error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } }, 500);
  });

  app.notFound((c) => c.json({ ok: false as const, error: { code: "NOT_FOUND", message: `No route for ${c.req.method} ${c.req.path}` } }, 404));

  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
      crossOriginResourcePolicy: "same-origin",
    }),
  );

  app.use(
    "/api/*",
    cors({
      origin: (origin) => (allowedOrigins.has(origin) ? origin : null),
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["content-type", "idempotency-key"],
      exposeHeaders: ["content-disposition", "retry-after"],
      maxAge: 600,
    }),
  );

  // Reject state-changing requests from origins that are not explicitly allowed (CSRF defence).
  app.use("/api/*", async (c, next) => {
    const origin = c.req.header("origin");
    if (origin && c.req.method !== "GET" && c.req.method !== "OPTIONS" && !allowedOrigins.has(origin)) {
      throw new ApiError(403, "ORIGIN_NOT_ALLOWED", `Origin ${origin} is not allowed. Add it to BUNBENCH_CORS_ORIGINS.`);
    }
    await next();
  });

  app.use(
    "/api/*",
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) =>
        c.json({ ok: false as const, error: { code: "PAYLOAD_TOO_LARGE", message: `Request body exceeds ${MAX_BODY_BYTES} bytes` } }, 413),
    }),
  );

  // Hono throws an HTTPException(504) on timeout; onError converts it to the standard error shape.
  const timed = timeout(REQUEST_TIMEOUT_MS);
  app.use("/api/*", async (c, next) => (c.req.path.endsWith("/events") ? next() : timed(c, next)));

  // --- Health & runtimes -------------------------------------------------------------------------
  app.get("/api/health", (c) => {
    let dbOk = true;
    let runCount = 0;
    let schemaVersion = 0;
    try {
      runCount = repo.countRuns();
      schemaVersion = repo.schemaVersion();
    } catch {
      dbOk = false;
    }
    const health: HealthInfo = {
      status: "ok",
      version: APP_VERSION,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1_000),
      database: { ok: dbOk, path: config.dbPath === ":memory:" ? ":memory:" : "configured", schemaVersion, runCount },
      queue: service.queueInfo(),
    };
    return ok(c, health);
  });

  app.get("/api/runtimes", async (c) => {
    const refresh = c.req.query("refresh") === "1" || c.req.query("refresh") === "true";
    return ok(c, await runtimes.info(refresh));
  });

  app.get("/api/openapi.json", (c) => c.json(openApiDocument));

  // --- Benchmarks ---------------------------------------------------------------------------------
  app.get("/api/benchmarks", (c) => {
    const query = parse(listRunsQuerySchema, nonEmptyQuery(c), "query parameters");
    return ok(c, repo.listRuns(query));
  });

  app.get("/api/benchmarks/export.csv", (c) => {
    const { page: _page, pageSize: _size, ...filters } = parse(listRunsQuerySchema, nonEmptyQuery(c), "query parameters");
    const csv = runsToCsv(repo.listRunsForExport(filters));
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    return c.body(csv, 200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="bunbench-export-${stamp}.csv"`,
    });
  });

  app.post("/api/benchmarks", async (c) => {
    const limit = createLimiter.check(clientKey(c));
    if (!limit.allowed) {
      throw new ApiError(429, "RATE_LIMITED", `Too many benchmark submissions. Try again in ${limit.retryAfterSeconds}s.`, {
        retryAfterSeconds: limit.retryAfterSeconds,
      });
    }
    const rawKey = c.req.header("idempotency-key");
    const key = rawKey ? parse(idempotencyKeySchema, rawKey, "Idempotency-Key header") : null;
    const configInput = parse(benchmarkConfigSchema, await readJson(c), "benchmark configuration");
    const { id, created } = service.submit(configInput, key);
    const detail = toDetail(requireRun(id));
    c.header("Location", `/api/benchmarks/${id}`);
    return ok(c, detail, created ? 202 : 200);
  });

  app.post("/api/benchmarks/compare", async (c) => {
    const { ids } = parse(compareRequestSchema, await readJson(c), "comparison request");
    return ok(c, compareRuns(repo, ids, toDetail));
  });

  app.get("/api/benchmarks/:id", (c) => {
    const id = parse(runIdSchema, c.req.param("id"), "run id");
    return ok(c, toDetail(requireRun(id)));
  });

  app.post("/api/benchmarks/:id/cancel", (c) => {
    const id = parse(runIdSchema, c.req.param("id"), "run id");
    const result = service.cancel(id);
    return ok(c, { id, status: result }, 202);
  });

  app.delete("/api/benchmarks/:id", (c) => {
    const id = parse(runIdSchema, c.req.param("id"), "run id");
    const status = repo.getStatus(id);
    if (!status) throw notFound("Benchmark run");
    if (service.isActive(id) || !TERMINAL_RUN_STATUSES.includes(status)) {
      throw new ApiError(409, "RUN_ACTIVE", "Cancel the run before deleting it");
    }
    repo.deleteRun(id);
    return ok(c, { id, deleted: true });
  });

  app.get("/api/benchmarks/:id/events", (c) => {
    const id = parse(runIdSchema, c.req.param("id"), "run id");
    const status = repo.getStatus(id);
    if (!status) throw notFound("Benchmark run");

    const encoder = new TextEncoder();
    let cleanup = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        let seq = 0;
        let unsubscribe: (() => void) | null = null;
        let heartbeat: ReturnType<typeof setInterval> | null = null;
        const send = (chunk: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            cleanup();
          }
        };
        cleanup = () => {
          if (closed) return;
          closed = true;
          unsubscribe?.();
          if (heartbeat) clearInterval(heartbeat);
          try {
            controller.close();
          } catch {
            // already closed
          }
        };

        const fallback: LiveProgress = {
          status,
          runtime: null,
          round: null,
          phase: null,
          iteration: null,
          total: null,
          executionsDone: 0,
          executionsTotal: 0,
          startedAt: null,
          message: null,
        };
        const live = bus.getLive(id) ?? fallback;
        send(formatSseEvent({ event: "snapshot", id: ++seq, retry: 3_000, data: { type: "snapshot", live } }));
        const terminal = TERMINAL_RUN_STATUSES.includes(live.status) || (TERMINAL_RUN_STATUSES.includes(status) && !service.isActive(id));
        if (terminal) {
          send(formatSseEvent({ event: "done", id: ++seq, data: { type: "done", status: TERMINAL_RUN_STATUSES.includes(live.status) ? live.status : status } }));
          cleanup();
          return;
        }
        unsubscribe = bus.subscribe(id, (event) => {
          send(formatSseEvent({ event: event.type, id: ++seq, data: event }));
          if (event.type === "done") cleanup();
        });
        heartbeat = setInterval(() => send(formatSseComment("heartbeat")), SSE_HEARTBEAT_MS);
        c.req.raw.signal.addEventListener("abort", () => cleanup(), { once: true });
      },
      cancel() {
        cleanup();
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  });

  // --- Overview & settings ------------------------------------------------------------------------
  app.get("/api/stats/overview", (c) => ok(c, computeOverview(repo)));

  const settingsResponse = (): SettingsResponse => {
    let sizeBytes: number | null = null;
    if (config.dbPath !== ":memory:" && existsSync(config.dbPath)) sizeBytes = statSync(config.dbPath).size;
    return {
      settings: repo.getSettings(),
      database: {
        path: config.dbPath === ":memory:" ? ":memory:" : config.dbPath.startsWith(config.repoRoot) ? config.dbPath.slice(config.repoRoot.length + 1) : "(custom path)",
        schemaVersion: repo.schemaVersion(),
        sizeBytes,
        runCount: repo.countRuns(),
      },
      runtimeConfig: {
        bunPathOverride: Boolean(config.bunPathOverride),
        nodePathOverride: Boolean(config.nodePathOverride),
        exposePaths: config.exposePaths,
      },
      server: { host: config.host, port: config.port, corsOrigins: config.corsOrigins, rateLimitPerMinute: config.rateLimitPerMinute },
    };
  };

  app.get("/api/settings", (c) => ok(c, settingsResponse()));

  app.put("/api/settings", async (c) => {
    const settings = parse(settingsSchema, await readJson(c), "settings");
    repo.saveSettings(settings);
    return ok(c, settingsResponse());
  });

  // --- Static frontend (production) ---------------------------------------------------------------
  const webRoot = resolve(config.webDistDir);
  const indexHtml = join(webRoot, "index.html");
  app.get("*", async (c, next) => {
    if (c.req.path.startsWith("/api/") || !existsSync(indexHtml)) return next();
    let rel: string;
    try {
      rel = decodeURIComponent(c.req.path).replace(/^\/+/, "");
    } catch {
      return next();
    }
    const full = resolve(webRoot, rel);
    if (rel && (full === webRoot || full.startsWith(webRoot + sep)) && existsSync(full) && statSync(full).isFile()) {
      const immutable = rel.startsWith("assets/");
      return new Response(Bun.file(full), {
        headers: { "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache" },
      });
    }
    return new Response(Bun.file(indexHtml), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
  });

  return app;
}
