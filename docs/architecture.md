# Architecture

```
 Browser (React)                          Bun process: apps/api
 ┌──────────────┐  REST + SSE   ┌──────────────────────────────────────────┐
 │ apps/web     │──────────────▶│ Hono app ── BenchmarkService (queue)     │
 │ Vite build   │◀──────────────│   │            │                          │
 └──────────────┘               │   │            ▼                          │
                                │   │     orchestrator (benchmark-core)     │
                                │   │      │ Bun.spawn(argv[], no shell)    │
                                │   ▼      ▼                                │
                                │ SQLite  ┌───────────────┬───────────────┐ │
                                └─────────┼───────────────┼───────────────┼─┘
                                          ▼               ▼               ▼
                                 bun runners/bun/*  node runners/node/*  bun runners/loadgen/client.ts
                                 (Bun under test)   (Node under test)    (HTTP load, constant runtime)
```

## Components

### packages/shared
Zod schemas for every input (benchmark config, settings, list queries, compare requests), the runner protocol, hard limits, metric definitions (unit and which direction is better), and response types. The frontend and the API validate with the **same** schemas.

### packages/benchmark-core
- `workloads/` contains deterministic workloads written in *erasable* TypeScript with no runtime dependencies. Inputs come from a seeded Mulberry32 PRNG, and outputs are reduced to an FNV-1a checksum.
- `runner-loop.ts` is the single warm-up/measure loop used by both runners. Each runtime supplies only a `RunnerHost` (timer, memory sampling, output).
- `stats.ts` / `aggregate.ts` provide statistics, aggregation and warning generation.
- `protocol.ts` handles parsing of newline-delimited JSON, line splitting and exit codes.
- `orchestrator/` is Bun-only (`Bun.spawn`). It covers runtime detection, process management (timeouts, abort, SIGKILL escalation, stderr tail, OS peak RSS), execution plans (random first round, then ABBA), and `executeBenchmark`.

### runners
| Script | Runtime | Purpose |
|---|---|---|
| `bun/runner.ts` | Bun only | compute workloads |
| `node/runner.ts` | Node.js only | compute workloads |
| `bun/http-server.ts` | Bun only | `Bun.serve` server for the HTTP benchmark |
| `node/http-server.ts` | Node.js only | `node:http` server for the HTTP benchmark |
| `loadgen/client.ts` | Bun | HTTP load generator, identical for both servers |

Each runner checks that it is executing under its intended runtime (exit code 3 otherwise).

**Runner protocol.** The config arrives on stdin as JSON (validated with Zod, exit code 2 on error). Events are written to stdout as JSON lines: `hello`, `progress`, `measurement`, `result`, `error`, and `ready` for servers. Diagnostics go to stderr.

| Exit code | Meaning |
|---|---|
| 0 | ok |
| 1 | workload error / non-determinism |
| 2 | invalid config |
| 3 | wrong runtime |
| 124 | deadline exceeded |

### apps/api
Hono on `Bun.serve`.
- **Repository:** all SQL lives here and uses parameterized queries only.
- **Migrations:** ordered and transactional.
- **BenchmarkService:** an in-memory FIFO queue that runs at most `maxConcurrentRuns` jobs at once (default 1), with idempotency keys, cancellation and graceful shutdown.
- **RunEventBus:** live progress fan-out for SSE.
- **Insights:** overview statistics and comparisons. Only runs with the same configuration hash are aggregated together.
- In production the same process also serves `apps/web/dist`.

### apps/web
React 19 with React Router 7 (lazy-loaded routes), Tailwind CSS 4 with design tokens and dark/light themes, shadcn-style components built on Radix primitives, Recharts, and sonner toasts. A small `useQuery` hook fetches data without showing skeletons again on refetch.

## Data flow of a run

1. `POST /api/benchmarks` validates the body, enforces settings limits, applies the rate limit and idempotency key, then inserts a `queued` run.
2. The queue starts the job (status `preparing`), detects runtimes fresh, and moves the run to `running`.
3. The orchestrator builds the plan. For each (round, runtime) it spawns the runner and streams `progress` events, which are forwarded to SSE subscribers.
4. For HTTP: start the server on 127.0.0.1 with an OS-assigned port, wait for `ready` and a health check, run the Bun load client, read `/__stats`, then send `POST /__shutdown` (and kill the server if it doesn't exit).
5. Aggregate the results: pool measured iterations per runtime, compute statistics, build warnings, and verify that checksums match.
6. A single transaction stores executions, runtime metadata, measurements, aggregates, latency histogram buckets and warnings.

## Database schema (migration 1)

`runs` 1─1 `workload_configs`, `runs` 1─n `run_runtimes`, `runs` 1─n `executions` 1─1 `runtime_metadata`, `executions` 1─n `measurements`, `runs` 1─n `aggregate_results` / `latency_buckets` / `run_warnings`, plus `settings` and `schema_migrations`. Every foreign key uses `ON DELETE CASCADE`. Indexes cover creation time, status, type, config hash and the idempotency key, plus child lookups.

## Design decisions

- **Same source on both runtimes.** Node's built-in type stripping (Node ≥ 22.18) executes the shared TypeScript as-is, so no build step can drift between runtimes. The code base enforces `erasableSyntaxOnly`.
- **Constant HTTP client runtime.** Using Bun for every load client keeps client overhead identical across servers. The client runtime and version are recorded with every execution.
- **One run at a time by default.** Concurrent benchmarks interfere with each other's measurements.
- **No authentication.** BunBench is a local tool. It binds to loopback by default; see [security.md](security.md).
- **shadcn/ui.** The components follow shadcn's conventions (Radix + cva + Tailwind) but are written into the repo directly instead of being installed with the interactive CLI.
