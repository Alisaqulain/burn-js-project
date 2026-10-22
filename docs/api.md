# API reference

- **Base URL:** `http://127.0.0.1:3001`. The machine-readable OpenAPI 3.1 document is served at `GET /api/openapi.json`.
- **Response shape.** Every JSON response is either:
  - `{ "ok": true, "data": … }`, or
  - `{ "ok": false, "error": { "code": "…", "message": "…", "details"?: … } }`
- **Request bodies** must be `application/json` (otherwise 415) and at most 64 KiB (otherwise 413).
- **Timeout.** Non-streaming requests time out after 20 s (504).
- **Identifiers** are UUIDs and are validated before any database access (400 if malformed).
- **Authentication.** When the server sets `BUNBENCH_API_TOKEN`, POST, PUT and DELETE requests need `Authorization: Bearer <token>`. GET requests are public. `GET /api/health` reports `auth.required`.

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Status, version, uptime, DB status (schema version, run count), queue |
| GET | `/api/runtimes[?refresh=1]` | Bun/Node.js detection (cached for 30 s; `refresh` bypasses the cache) |
| GET | `/api/benchmarks` | Paginated list. Query: `page`, `pageSize` (≤ 100), `q`, `runtime`, `type`, `status`, `from`, `to` (YYYY-MM-DD, UTC, inclusive) |
| POST | `/api/benchmarks` | Queue a run (202). An optional `Idempotency-Key` header returns the existing run (200) on repeat |
| GET | `/api/benchmarks/export.csv` | CSV of the filtered runs (same filters as the list), one row per run × runtime |
| POST | `/api/benchmarks/compare` | Body `{ "ids": [uuid, …] }` (1–6, unique) |
| GET | `/api/benchmarks/:id` | Full run: config, executions, measurements, aggregates, histogram, warnings, reproducibility, live progress |
| POST | `/api/benchmarks/:id/cancel` | 202 `{status: "cancelled" \| "cancelling"}`. 409 if already finished |
| DELETE | `/api/benchmarks/:id` | 200. 409 if the run is still queued or running |
| GET | `/api/benchmarks/:id/events` | SSE stream (see below) |
| GET | `/api/stats/overview` | Dashboard statistics |
| GET | `/api/settings` | Settings, database info, runtime config flags, server info |
| PUT | `/api/settings` | Replace settings (validated, including cross-field checks) |

## Benchmark configuration

```json
{
  "type": "http",
  "params": { "requests": 2000, "concurrency": 16, "payloadItems": 50, "warmupRequests": 200, "requestTimeoutMs": 5000 },
  "runtimes": ["bun", "node"],
  "iterations": 10,
  "warmups": 0,
  "rounds": 2,
  "seed": 1337,
  "maxDurationMs": 60000,
  "label": "laptop, plugged in"
}
```

`params` by type:

| Type | Params |
|---|---|
| `cpu` | `limit` 1,000–5,000,000 |
| `json` | `records` 10–50,000 |
| `array` | `size` 100–2,000,000 |
| `memory` | `objects` 1,000–500,000 |
| `http` | `requests` 10–50,000, `concurrency` 1–128 (≤ `requests`), `payloadItems` 1–1,000, `warmupRequests` 0–5,000, `requestTimeoutMs` 100–30,000 |

For HTTP, `requests × iterations` must be ≤ 400,000. Unknown keys are rejected. The settings limits (`maxIterations`, `maxWarmups`, `maxDurationLimitMs`, `httpMaxConcurrency`) are applied on top of these and violations return `400 LIMIT_EXCEEDED`.

## Error codes

| Status | Code |
|---|---|
| 400 | `VALIDATION_ERROR` (with `details: [{path, message}]`), `LIMIT_EXCEEDED`, `INVALID_JSON` |
| 401 | `UNAUTHORIZED`: a state-changing request without a valid `Authorization: Bearer` token, when `BUNBENCH_API_TOKEN` is set |
| 403 | `ORIGIN_NOT_ALLOWED` (state-changing request from an origin not in `BUNBENCH_CORS_ORIGINS`) |
| 404 | `NOT_FOUND` |
| 409 | `CONFLICT`, `RUN_ACTIVE` |
| 413 | `PAYLOAD_TOO_LARGE` |
| 415 | `UNSUPPORTED_MEDIA_TYPE` |
| 429 | `RATE_LIMITED` (with a `Retry-After` header) |
| 500 | `INTERNAL_ERROR` |
| 503 | `QUEUE_FULL`, `SHUTTING_DOWN` |
| 504 | `TIMEOUT` |

## Server-Sent Events

`GET /api/benchmarks/:id/events` returns `text/event-stream`. The first frame sets `retry: 3000`, and heartbeat comments are sent every 15 s. Each frame has an `event:` name and JSON `data:`:

| event | data |
|---|---|
| `snapshot` | `{type, live: LiveProgress}`. Always sent first |
| `status` | `{type, status, message}` |
| `progress` | `{type, live: LiveProgress}`: runtime, round, phase (`preparing`, `server-start`, `warmup`, `measured`, `verifying`), iteration/total, executionsDone/Total, startedAt, message |
| `execution` | `{type, runtime, round, status, message}` |
| `log` | `{type, level, message}` |
| `done` | `{type, status}`. The server closes the stream after this |

For a run that has already finished, the stream sends `snapshot` and `done` immediately. Clients without SSE can poll `GET /api/benchmarks/:id`: its `live` field holds the same progress snapshot.

## Examples

```bash
curl -s http://127.0.0.1:3001/api/runtimes
curl -s -X POST http://127.0.0.1:3001/api/benchmarks \
  -H "content-type: application/json" -H "idempotency-key: my-run-0001" \
  -d '{"type":"cpu","params":{"limit":500000},"runtimes":["bun","node"],"iterations":10,"warmups":3,"maxDurationMs":60000}'
curl -N http://127.0.0.1:3001/api/benchmarks/<id>/events
curl -o runs.csv "http://127.0.0.1:3001/api/benchmarks/export.csv?type=cpu"
```

In PowerShell, use `curl.exe` (not the `curl` alias), or use `Invoke-RestMethod` with `-ContentType application/json`.
