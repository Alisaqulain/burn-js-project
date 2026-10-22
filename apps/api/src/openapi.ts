/**
 * OpenAPI 3.1 description of the BunBench REST API. Served at GET /api/openapi.json.
 * Schemas are summarized; the authoritative validation lives in packages/shared/src/schemas.ts.
 */
const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
});

const success = (description: string, dataRef?: string) => ({
  description,
  content: {
    "application/json": {
      schema: {
        type: "object",
        required: ["ok", "data"],
        properties: { ok: { const: true }, data: dataRef ? { $ref: dataRef } : { type: "object" } },
      },
    },
  },
});

const idParam = { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } };
const listParams = [
  { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
  { name: "pageSize", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
  { name: "q", in: "query", description: "Search label or run id prefix", schema: { type: "string", maxLength: 80 } },
  { name: "runtime", in: "query", schema: { enum: ["bun", "node"] } },
  { name: "type", in: "query", schema: { enum: ["cpu", "json", "array", "http", "memory"] } },
  { name: "status", in: "query", schema: { enum: ["queued", "preparing", "running", "completed", "failed", "cancelled"] } },
  { name: "from", in: "query", description: "Inclusive start date (YYYY-MM-DD, UTC)", schema: { type: "string", format: "date" } },
  { name: "to", in: "query", description: "Inclusive end date (YYYY-MM-DD, UTC)", schema: { type: "string", format: "date" } },
];

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "BunBench API",
    version: "0.1.0",
    description:
      "Local-only API that runs Bun and Node.js benchmarks as separate processes. No authentication: bind to localhost only. See docs/security.md.",
  },
  servers: [{ url: "http://127.0.0.1:3001" }],
  paths: {
    "/api/health": { get: { summary: "Service health, database and queue status", responses: { 200: success("Health") } } },
    "/api/runtimes": {
      get: {
        summary: "Detect Bun and Node.js",
        parameters: [{ name: "refresh", in: "query", schema: { enum: ["1", "true"] }, description: "Bypass the 30 s detection cache" }],
        responses: { 200: success("Runtime list") },
      },
    },
    "/api/benchmarks": {
      get: { summary: "List benchmark runs (paginated, filterable)", parameters: listParams, responses: { 200: success("Page of runs"), 400: errorResponse("Invalid query") } },
      post: {
        summary: "Queue a benchmark run",
        parameters: [
          {
            name: "Idempotency-Key",
            in: "header",
            schema: { type: "string", pattern: "^[A-Za-z0-9_-]{8,64}$" },
            description: "Repeated submissions with the same key return the original run (200) instead of creating a new one.",
          },
        ],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/BenchmarkConfig" } } } },
        responses: {
          202: success("Run created and queued", "#/components/schemas/RunDetail"),
          200: success("Existing run returned for a repeated Idempotency-Key", "#/components/schemas/RunDetail"),
          400: errorResponse("Validation error or limit exceeded"),
          415: errorResponse("Body is not application/json"),
          429: errorResponse("Rate limited (see Retry-After)"),
          503: errorResponse("Queue full"),
        },
      },
    },
    "/api/benchmarks/export.csv": {
      get: { summary: "Export filtered runs as CSV (one row per run x runtime)", parameters: listParams.slice(2), responses: { 200: { description: "text/csv" } } },
    },
    "/api/benchmarks/compare": {
      post: {
        summary: "Compare saved runs",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", required: ["ids"], properties: { ids: { type: "array", items: { type: "string", format: "uuid" }, minItems: 1, maxItems: 6 } } } } },
        },
        responses: { 200: success("Comparison"), 404: errorResponse("A run was not found") },
      },
    },
    "/api/benchmarks/{id}": {
      get: { summary: "Run details, measurements and aggregates", parameters: [idParam], responses: { 200: success("Run", "#/components/schemas/RunDetail"), 404: errorResponse("Not found") } },
      delete: { summary: "Delete a finished run", parameters: [idParam], responses: { 200: success("Deleted"), 404: errorResponse("Not found"), 409: errorResponse("Run is still active") } },
    },
    "/api/benchmarks/{id}/cancel": {
      post: { summary: "Cancel a queued or running run", parameters: [idParam], responses: { 202: success("Cancellation accepted"), 404: errorResponse("Not found"), 409: errorResponse("Already finished") } },
    },
    "/api/benchmarks/{id}/events": {
      get: {
        summary: "Server-Sent Events stream of live progress",
        description: "Events: snapshot, status, progress, execution, log, done. Heartbeat comments every 15 s. The stream closes after `done`.",
        parameters: [idParam],
        responses: { 200: { description: "text/event-stream" }, 404: errorResponse("Not found") },
      },
    },
    "/api/stats/overview": { get: { summary: "Dashboard statistics", responses: { 200: success("Overview") } } },
    "/api/settings": {
      get: { summary: "Settings, database and server configuration", responses: { 200: success("Settings") } },
      put: { summary: "Replace settings", responses: { 200: success("Updated settings"), 400: errorResponse("Validation error") } },
    },
    "/api/openapi.json": { get: { summary: "This document", responses: { 200: { description: "OpenAPI document" } } } },
  },
  components: {
    schemas: {
      Error: {
        type: "object",
        required: ["ok", "error"],
        properties: {
          ok: { const: false },
          error: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" }, details: {} } },
        },
      },
      BenchmarkConfig: {
        type: "object",
        required: ["type", "params", "runtimes", "iterations", "warmups", "maxDurationMs"],
        properties: {
          type: { enum: ["cpu", "json", "array", "http", "memory"] },
          params: {
            description:
              "cpu: {limit 1000-5000000}; json: {records 10-50000}; array: {size 100-2000000}; memory: {objects 1000-500000}; http: {requests 10-50000, concurrency 1-128, payloadItems 1-1000, warmupRequests 0-5000, requestTimeoutMs 100-30000}",
            type: "object",
          },
          runtimes: { type: "array", items: { enum: ["bun", "node"] }, minItems: 1, maxItems: 2, uniqueItems: true },
          iterations: { type: "integer", minimum: 1, maximum: 200 },
          warmups: { type: "integer", minimum: 0, maximum: 50 },
          maxDurationMs: { type: "integer", minimum: 1000, maximum: 300000, description: "Hard limit per runtime process" },
          rounds: { type: "integer", minimum: 1, maximum: 6, default: 1 },
          seed: { type: "integer", minimum: 0, default: 1337 },
          label: { type: "string", maxLength: 80 },
        },
      },
      RunDetail: { type: "object", description: "See RunDetail in packages/shared/src/api-types.ts" },
    },
  },
} as const;
