import { afterEach, describe, expect, test } from "bun:test";
import { api, ApiClientError, describeError, normalizeApiBase } from "../src/lib/api";
import { apiToken } from "../src/lib/api-token";

afterEach(() => apiToken.clear());

describe("API base URL", () => {
  test("normalizes trailing slashes and a trailing /api", () => {
    expect(normalizeApiBase(undefined)).toBe("");
    expect(normalizeApiBase("  ")).toBe("");
    expect(normalizeApiBase("https://api.example.com/")).toBe("https://api.example.com");
    expect(normalizeApiBase("https://api.example.com/api/")).toBe("https://api.example.com");
    expect(normalizeApiBase("https://example.com/bench")).toBe("https://example.com/bench");
  });
});

describe("non-API responses (static host without a backend)", () => {
  test("an HTML 404 becomes API_NOT_FOUND with deployment guidance", async () => {
    globalThis.fetch = (async () => new Response("<!doctype html><h1>404: NOT_FOUND</h1>", { status: 404, headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
    const error = await api.settings().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).code).toBe("API_NOT_FOUND");
    const { title, hint } = describeError(error);
    expect(title).toBe("The BunBench API was not found");
    expect(hint).toContain("VITE_API_BASE");
  });

  test("an HTML 200 (SPA fallback swallowing /api) is also diagnosed", async () => {
    globalThis.fetch = (async () => new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } })) as unknown as typeof fetch;
    const error = (await api.runtimes().catch((e: unknown) => e)) as ApiClientError;
    expect(error.code).toBe("API_NOT_FOUND");
  });

  test("BunBench JSON errors keep their own codes", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: false, error: { code: "UNAUTHORIZED", message: "token" } }), { status: 401, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    const error = (await api.cancelRun("x").catch((e: unknown) => e)) as ApiClientError;
    expect(error.code).toBe("UNAUTHORIZED");
    expect(describeError(error).hint).toContain("Settings");
  });
});

describe("access token", () => {
  test("is sent only on state-changing requests", async () => {
    const seen: { method: string; auth: string | null }[] = [];
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      seen.push({ method: init?.method ?? "GET", auth: new Headers(init?.headers).get("authorization") });
      return new Response(JSON.stringify({ ok: true, data: {} }), { headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    apiToken.set("x".repeat(40));
    await api.health();
    await api.cancelRun("abc");
    expect(seen[0]).toEqual({ method: "GET", auth: null });
    expect(seen[1]).toEqual({ method: "POST", auth: `Bearer ${"x".repeat(40)}` });
  });
});
