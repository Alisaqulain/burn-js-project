import { describe, expect, test } from "bun:test";
import type { ApiErrorBody, ApiSuccess, HealthInfo } from "@bunbench/shared";
import { forwardedClient, tokenMatches } from "../src/app.ts";
import { unsafeExposureError } from "../src/config.ts";
import { createTestApp, jsonRequest, validCpuBody } from "./helpers.ts";

const TOKEN = "t".repeat(20) + "0123456789abcdef";

describe("bearer token helpers", () => {
  test("tokenMatches requires the exact token with the Bearer scheme", () => {
    expect(tokenMatches(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(tokenMatches(`bearer   ${TOKEN}  `, TOKEN)).toBe(true);
    expect(tokenMatches(TOKEN, TOKEN)).toBe(false);
    expect(tokenMatches(`Bearer ${TOKEN}x`, TOKEN)).toBe(false);
    expect(tokenMatches(`Basic ${TOKEN}`, TOKEN)).toBe(false);
    expect(tokenMatches(undefined, TOKEN)).toBe(false);
  });

  test("forwardedClient takes the address appended by the trusted proxy", () => {
    expect(forwardedClient("203.0.113.9, 198.51.100.7")).toBe("198.51.100.7");
    expect(forwardedClient(" 203.0.113.9 ")).toBe("203.0.113.9");
    expect(forwardedClient(undefined)).toBeNull();
    expect(forwardedClient("")).toBeNull();
  });
});

describe("startup exposure check", () => {
  test("refuses a public bind without a token unless explicitly allowed", () => {
    expect(unsafeExposureError({ host: "127.0.0.1", apiToken: undefined, allowUnauthenticated: false })).toBeNull();
    expect(unsafeExposureError({ host: "0.0.0.0", apiToken: undefined, allowUnauthenticated: false })).toContain("Refusing");
    expect(unsafeExposureError({ host: "0.0.0.0", apiToken: TOKEN, allowUnauthenticated: false })).toBeNull();
    expect(unsafeExposureError({ host: "0.0.0.0", apiToken: undefined, allowUnauthenticated: true })).toBeNull();
  });
});

describe("API token enforcement", () => {
  test("state-changing requests need the token; reads stay public", async () => {
    const { app, service } = createTestApp({ config: { apiToken: TOKEN } });
    const health = (await (await app.request("/api/health")).json()) as ApiSuccess<HealthInfo>;
    expect(health.data.auth.required).toBe(true);
    expect((await app.request("/api/benchmarks")).status).toBe(200);
    expect((await app.request("/api/runtimes")).status).toBe(200);

    const denied = await app.request("/api/benchmarks", jsonRequest("POST", validCpuBody));
    expect(denied.status).toBe(401);
    expect(denied.headers.get("www-authenticate")).toContain("Bearer");
    expect(((await denied.json()) as ApiErrorBody).error.code).toBe("UNAUTHORIZED");

    const wrong = await app.request("/api/benchmarks", jsonRequest("POST", validCpuBody, { authorization: "Bearer nope" }));
    expect(wrong.status).toBe(401);

    const ok = await app.request("/api/benchmarks", jsonRequest("POST", validCpuBody, { authorization: `Bearer ${TOKEN}` }));
    expect(ok.status).toBe(202);
    await service.waitForIdle();

    expect((await app.request("/api/settings", jsonRequest("PUT", {}))).status).toBe(401);
    expect((await app.request(`/api/benchmarks/${crypto.randomUUID()}`, { method: "DELETE" })).status).toBe(401);
    expect((await app.request(`/api/benchmarks/${crypto.randomUUID()}/cancel`, { method: "POST" })).status).toBe(401);
  });

  test("without a configured token, no authorization is needed", async () => {
    const { app, service } = createTestApp();
    const health = (await (await app.request("/api/health")).json()) as ApiSuccess<HealthInfo>;
    expect(health.data.auth.required).toBe(false);
    expect((await app.request("/api/benchmarks", jsonRequest("POST", validCpuBody))).status).toBe(202);
    await service.waitForIdle();
  });

  test("CORS preflight allows the authorization header for configured origins", async () => {
    const { app } = createTestApp({ config: { apiToken: TOKEN, corsOrigins: ["https://bunbench.example.com"] } });
    const res = await app.request("/api/benchmarks", {
      method: "OPTIONS",
      headers: { origin: "https://bunbench.example.com", "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("https://bunbench.example.com");
    expect(res.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("authorization");
  });

  test("trusted proxy: rate limiting keys on the forwarded client address", async () => {
    const { app, service } = createTestApp({ config: { trustProxy: true, rateLimitPerMinute: 1 } });
    const post = (ip: string) => app.request("/api/benchmarks", jsonRequest("POST", validCpuBody, { "x-forwarded-for": ip }));
    expect((await post("203.0.113.1")).status).toBe(202);
    expect((await post("203.0.113.1")).status).toBe(429);
    expect((await post("203.0.113.2")).status).toBe(202);
    await service.waitForIdle();
  });
});
