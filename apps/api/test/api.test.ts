import { describe, expect, test } from "bun:test";
import type { ApiErrorBody, ApiSuccess, CompareResult, OverviewStats, Paginated, RunDetail, RuntimeInfo, RunSummary, SettingsResponse } from "@bunbench/shared";
import { DEFAULT_SETTINGS } from "@bunbench/shared";
import { blockingExecutor, createTestApp, jsonRequest, validCpuBody } from "./helpers.ts";

type Json<T> = ApiSuccess<T>;

async function createRun(app: ReturnType<typeof createTestApp>["app"], body: unknown = validCpuBody, headers: Record<string, string> = {}) {
  const res = await app.request("/api/benchmarks", jsonRequest("POST", body, headers));
  return { res, json: (await res.json()) as { ok: boolean; data: RunDetail; error: ApiErrorBody["error"] } };
}

describe("health and runtimes", () => {
  test("GET /api/health", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Json<{ status: string; database: { ok: boolean; schemaVersion: number } }>;
    expect(body.ok).toBe(true);
    expect(body.data.database).toMatchObject({ ok: true, schemaVersion: 1 });
  });

  test("GET /api/runtimes reports an unavailable runtime without failing", async () => {
    const { app } = createTestApp();
    const body = (await (await app.request("/api/runtimes")).json()) as Json<RuntimeInfo[]>;
    const node = body.data.find((r) => r.name === "node")!;
    expect(node.available).toBe(false);
    expect(node.reason).toContain("not found");
    expect(node.installHint.length).toBeGreaterThan(0);
    expect(body.data.find((r) => r.name === "bun")!.available).toBe(true);
  });

  test("unknown routes return a JSON 404", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/nope");
    expect(res.status).toBe(404);
    expect(((await res.json()) as ApiErrorBody).error.code).toBe("NOT_FOUND");
  });

  test("serves the OpenAPI document", async () => {
    const { app } = createTestApp();
    const doc = (await (await app.request("/api/openapi.json")).json()) as { openapi: string; paths: Record<string, unknown> };
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths)).toContain("/api/benchmarks/{id}/events");
  });
});

describe("creating benchmarks", () => {
  test("queues a valid benchmark (202) and completes it", async () => {
    const { app, service } = createTestApp();
    const { res, json } = await createRun(app);
    expect(res.status).toBe(202);
    expect(res.headers.get("location")).toBe(`/api/benchmarks/${json.data.id}`);
    expect(json.data.config.seed).toBe(1337);
    await service.waitForIdle();
    const detail = (await (await app.request(`/api/benchmarks/${json.data.id}`)).json()) as Json<RunDetail>;
    expect(detail.data.status).toBe("completed");
    expect(detail.data.aggregates).toHaveLength(2);
    expect(detail.data.reproducibility.command).toContain("curl -X POST");
    expect(detail.data.reproducibility.notes.some((n) => n.includes("seed 1337"))).toBe(true);
  });

  test("rejects invalid configurations with field-level details", async () => {
    const { app } = createTestApp();
    const { res, json } = await createRun(app, { ...validCpuBody, iterations: 0, runtimes: ["deno"], extra: true });
    expect(res.status).toBe(400);
    expect(json.error.code).toBe("VALIDATION_ERROR");
    const paths = (json.error.details as { path: string }[]).map((d) => d.path);
    expect(paths).toContain("iterations");
    expect(paths).toContain("runtimes.0");
  });

  test("rejects HTTP configs whose concurrency exceeds requests", async () => {
    const { app } = createTestApp();
    const { res } = await createRun(app, {
      type: "http",
      params: { requests: 10, concurrency: 50, payloadItems: 5, warmupRequests: 0, requestTimeoutMs: 1_000 },
      runtimes: ["bun"],
      iterations: 1,
      warmups: 0,
      maxDurationMs: 5_000,
    });
    expect(res.status).toBe(400);
  });

  test("enforces settings limits on top of hard limits", async () => {
    const { app, repo } = createTestApp();
    repo.saveSettings({ ...DEFAULT_SETTINGS, maxIterations: 4, defaultIterations: 4 });
    const { res, json } = await createRun(app);
    expect(res.status).toBe(400);
    expect(json.error.code).toBe("LIMIT_EXCEEDED");
  });

  test("requires a JSON content type and valid JSON", async () => {
    const { app } = createTestApp();
    const plain = await app.request("/api/benchmarks", { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" });
    expect(plain.status).toBe(415);
    const broken = await app.request("/api/benchmarks", { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
    expect(broken.status).toBe(400);
    expect(((await broken.json()) as ApiErrorBody).error.code).toBe("INVALID_JSON");
  });

  test("rejects oversized bodies (413)", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/benchmarks", jsonRequest("POST", { ...validCpuBody, label: "x".repeat(70_000) }));
    expect(res.status).toBe(413);
  });

  test("Idempotency-Key returns the original run instead of duplicating", async () => {
    const { app, repo, service } = createTestApp();
    const first = await createRun(app, validCpuBody, { "idempotency-key": "abcdef123456" });
    const second = await createRun(app, validCpuBody, { "idempotency-key": "abcdef123456" });
    expect(first.res.status).toBe(202);
    expect(second.res.status).toBe(200);
    expect(second.json.data.id).toBe(first.json.data.id);
    expect(repo.countRuns()).toBe(1);
    const bad = await createRun(app, validCpuBody, { "idempotency-key": "bad key!" });
    expect(bad.res.status).toBe(400);
    await service.waitForIdle();
  });

  test("rate limits benchmark creation (429 + Retry-After)", async () => {
    const { app, service } = createTestApp({ config: { rateLimitPerMinute: 2 } });
    expect((await createRun(app)).res.status).toBe(202);
    expect((await createRun(app)).res.status).toBe(202);
    const limited = await createRun(app);
    expect(limited.res.status).toBe(429);
    expect(Number(limited.res.headers.get("retry-after"))).toBeGreaterThan(0);
    await service.waitForIdle();
  });

  test("rejects submissions when the queue is full (503)", async () => {
    const { app, repo, service } = createTestApp({ executor: blockingExecutor });
    repo.saveSettings({ ...DEFAULT_SETTINGS, queueLimit: 1 });
    const first = await createRun(app);
    expect(first.res.status).toBe(202);
    const second = await createRun(app);
    expect(second.res.status).toBe(503);
    expect(second.json.error.code).toBe("QUEUE_FULL");
    service.cancel(first.json.data.id);
    await service.waitForIdle();
  });
});

describe("reading, cancelling and deleting", () => {
  test("validates identifiers and returns 404 for unknown runs", async () => {
    const { app } = createTestApp();
    expect((await app.request("/api/benchmarks/not-a-uuid")).status).toBe(400);
    expect((await app.request(`/api/benchmarks/${crypto.randomUUID()}`)).status).toBe(404);
    expect((await app.request(`/api/benchmarks/${crypto.randomUUID()}`, { method: "DELETE" })).status).toBe(404);
  });

  test("cancels a running benchmark and stops its executor", async () => {
    const { app, service } = createTestApp({ executor: blockingExecutor });
    const { json } = await createRun(app);
    await Bun.sleep(20);
    const res = await app.request(`/api/benchmarks/${json.data.id}/cancel`, { method: "POST" });
    expect(res.status).toBe(202);
    await service.waitForIdle();
    const detail = (await (await app.request(`/api/benchmarks/${json.data.id}`)).json()) as Json<RunDetail>;
    expect(detail.data.status).toBe("cancelled");
    const again = await app.request(`/api/benchmarks/${json.data.id}/cancel`, { method: "POST" });
    expect(again.status).toBe(409);
  });

  test("cancels a queued benchmark before it starts", async () => {
    const { app, service } = createTestApp({ executor: blockingExecutor });
    const running = await createRun(app);
    const queued = await createRun(app);
    const res = await app.request(`/api/benchmarks/${queued.json.data.id}/cancel`, { method: "POST" });
    expect(((await res.json()) as Json<{ status: string }>).data.status).toBe("cancelled");
    service.cancel(running.json.data.id);
    await service.waitForIdle();
  });

  test("refuses to delete an active run, deletes a finished one", async () => {
    const { app, service } = createTestApp({ executor: blockingExecutor });
    const { json } = await createRun(app);
    expect((await app.request(`/api/benchmarks/${json.data.id}`, { method: "DELETE" })).status).toBe(409);
    service.cancel(json.data.id);
    await service.waitForIdle();
    const del = await app.request(`/api/benchmarks/${json.data.id}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    expect((await app.request(`/api/benchmarks/${json.data.id}`)).status).toBe(404);
  });
});

describe("listing, export, comparison and overview", () => {
  async function seed() {
    const ctx = createTestApp();
    const a = await createRun(ctx.app, { ...validCpuBody, label: "=cmd()" });
    const b = await createRun(ctx.app, { ...validCpuBody, params: { limit: 20_000 }, label: "second" });
    const h = await createRun(ctx.app, {
      type: "http",
      params: { requests: 100, concurrency: 4, payloadItems: 5, warmupRequests: 10, requestTimeoutMs: 1_000 },
      runtimes: ["bun", "node"],
      iterations: 3,
      warmups: 0,
      maxDurationMs: 5_000,
    });
    await ctx.service.waitForIdle();
    return { ...ctx, ids: [a.json.data.id, b.json.data.id, h.json.data.id] };
  }

  test("lists with pagination and filters; rejects bad query values", async () => {
    const { app } = await seed();
    const page = (await (await app.request("/api/benchmarks?pageSize=2")).json()) as Json<Paginated<RunSummary>>;
    expect(page.data.total).toBe(3);
    expect(page.data.items).toHaveLength(2);
    const http = (await (await app.request("/api/benchmarks?type=http")).json()) as Json<Paginated<RunSummary>>;
    expect(http.data.items).toHaveLength(1);
    expect(http.data.items[0]!.headline.bun?.metric).toBe("http_rps");
    expect((await app.request("/api/benchmarks?pageSize=1000")).status).toBe(400);
    expect((await app.request("/api/benchmarks?type=rust")).status).toBe(400);
    expect((await app.request("/api/benchmarks?from=yesterday")).status).toBe(400);
  });

  test("exports filtered CSV with one row per runtime and injection protection", async () => {
    const { app } = await seed();
    const res = await app.request("/api/benchmarks/export.csv?type=cpu");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    const lines = (await res.text()).trim().split("\r\n");
    expect(lines[0]).toStartWith("run_id,created_at,label");
    expect(lines).toHaveLength(1 + 4);
    expect(lines.some((l) => l.includes("'=cmd()"))).toBe(true);
  });

  test("compares runs and flags mixed configurations", async () => {
    const { app, ids } = await seed();
    const res = await app.request("/api/benchmarks/compare", jsonRequest("POST", { ids: [ids[0], ids[1]] }));
    const body = (await res.json()) as Json<CompareResult>;
    expect(res.status).toBe(200);
    expect(body.data.runs).toHaveLength(2);
    expect(body.data.groups).toHaveLength(2);
    expect(body.data.warnings.map((w) => w.code)).toContain("mixed_configurations");
    const ratio = body.data.ratios[0]!;
    expect(ratio.leader).toBe("bun");
    expect(ratio.factor).toBeGreaterThan(1);
    const missing = await app.request("/api/benchmarks/compare", jsonRequest("POST", { ids: [crypto.randomUUID()] }));
    expect(missing.status).toBe(404);
    const dupes = await app.request("/api/benchmarks/compare", jsonRequest("POST", { ids: [ids[0], ids[0]] }));
    expect(dupes.status).toBe(400);
  });

  test("overview aggregates only same-config HTTP runs", async () => {
    const { app } = await seed();
    const body = (await (await app.request("/api/stats/overview")).json()) as Json<OverviewStats>;
    expect(body.data.totalRuns).toBe(3);
    expect(body.data.completedRuns).toBe(3);
    expect(body.data.httpThroughput?.runCount).toBe(1);
    expect(body.data.httpThroughput?.byRuntime.bun).toBeGreaterThan(0);
    expect(body.data.httpTrend).toHaveLength(1);
    expect(body.data.runtimeComparison.map((r) => r.type).sort()).toEqual(["cpu", "http"]);
    expect(body.data.latestComparison).not.toBeNull();
  });

  test("overview is empty but valid with no data", async () => {
    const { app } = createTestApp();
    const body = (await (await app.request("/api/stats/overview")).json()) as Json<OverviewStats>;
    expect(body.data).toMatchObject({ totalRuns: 0, latestRun: null, httpThroughput: null, httpTrend: [], runtimeComparison: [] });
  });
});

describe("server-sent events", () => {
  test("streams snapshot, progress and done for a run, then closes", async () => {
    const { app, service } = createTestApp({ executor: blockingExecutor });
    const { json } = await createRun(app);
    const res = await app.request(`/api/benchmarks/${json.data.id}/events`);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const readUntil = async (needle: string) => {
      while (!text.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }
    };
    await readUntil("event: snapshot");
    service.cancel(json.data.id);
    await readUntil("event: done");
    expect(text).toContain("retry: 3000");
    expect(text).toMatch(/event: done\ndata: \{"type":"done","status":"cancelled"\}/);
    const { done } = await reader.read();
    expect(done).toBe(true);
    await service.waitForIdle();
  });

  test("a finished run streams snapshot + done immediately", async () => {
    const { app, service } = createTestApp();
    const { json } = await createRun(app);
    await service.waitForIdle();
    const text = await (await app.request(`/api/benchmarks/${json.data.id}/events`)).text();
    expect(text).toContain("event: snapshot");
    expect(text).toContain('"status":"completed"');
    expect(text).toContain("event: done");
  });

  test("unknown run returns 404 instead of a stream", async () => {
    const { app } = createTestApp();
    expect((await app.request(`/api/benchmarks/${crypto.randomUUID()}/events`)).status).toBe(404);
  });
});

describe("settings", () => {
  test("GET returns settings and environment info without secrets", async () => {
    const { app } = createTestApp();
    const body = (await (await app.request("/api/settings")).json()) as Json<SettingsResponse>;
    expect(body.data.settings).toEqual(DEFAULT_SETTINGS);
    expect(body.data.database.schemaVersion).toBe(1);
    expect(body.data.runtimeConfig).toEqual({ bunPathOverride: false, nodePathOverride: false, exposePaths: true });
  });

  test("PUT validates and persists", async () => {
    const { app } = createTestApp();
    const good = await app.request("/api/settings", jsonRequest("PUT", { ...DEFAULT_SETTINGS, defaultIterations: 15 }));
    expect(good.status).toBe(200);
    expect(((await good.json()) as Json<SettingsResponse>).data.settings.defaultIterations).toBe(15);
    const bad = await app.request("/api/settings", jsonRequest("PUT", { ...DEFAULT_SETTINGS, defaultIterations: 500 }));
    expect(bad.status).toBe(400);
    const inconsistent = await app.request("/api/settings", jsonRequest("PUT", { ...DEFAULT_SETTINGS, defaultIterations: 50, maxIterations: 10 }));
    expect(inconsistent.status).toBe(400);
  });
});

describe("CORS and origin protection", () => {
  test("allows configured origins and blocks unknown origins on mutations", async () => {
    const { app } = createTestApp();
    const preflight = await app.request("/api/benchmarks", {
      method: "OPTIONS",
      headers: { origin: "http://localhost:5173", "access-control-request-method": "POST" },
    });
    expect(preflight.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    const evilGet = await app.request("/api/health", { headers: { origin: "http://evil.example" } });
    expect(evilGet.headers.get("access-control-allow-origin")).toBeNull();
    const evilPost = await app.request("/api/benchmarks", jsonRequest("POST", validCpuBody, { origin: "http://evil.example" }));
    expect(evilPost.status).toBe(403);
  });
});
