# Benchmark methodology

## Principles

1. **Real executions only.** Every value comes from a runner process. If a runtime is unavailable or fails, it is recorded as `unavailable`, `failed` or `timeout`, and no value is shown for it.
2. **Same code, same inputs.** Both runtimes execute the identical workload source with the same seed. Input checksums and output checksums are recorded. If outputs differ between runtimes, the run fails verification.
3. **No cold vs warm mixing.** Each process generates its inputs (untimed), runs `warmups` iterations that are never recorded, then `iterations` measured iterations. Only the workload call itself is inside the timed region.
4. **Order bias control.** Round 1 uses a random runtime order. Later rounds alternate it (A B, B A, …) in fresh processes. The order is stored with every result.
5. **Labelled aggregation.** A configuration hash (type, params, iterations, warm-ups, rounds, seed) identifies comparable runs. Trends, averages and comparison charts never mix configurations.

## Workloads

| Type | Work per iteration | Ops unit |
|---|---|---|
| `cpu` | Sieve of Eratosthenes to `limit`, with FNV hashing of every prime | numbers sieved |
| `json` | `JSON.stringify` + `JSON.parse` of `records` nested records (strings with escapes and Unicode, numbers, booleans, nulls), then a field checksum | records |
| `array` | `slice` → `map` → `filter` → `reduce` → numeric `sort` of `size` seeded integers, a sortedness check, then a strided hash | elements |
| `memory` | Allocate `objects` small object graphs, walk them, then release them | objects |
| `http` | `requests` requests at `concurrency` against a server that `JSON.stringify`s a `payloadItems` payload per request | requests |

## Timing

- **Bun:** `Bun.nanoseconds()`.
- **Node.js:** `process.hrtime.bigint()`.
- **HTTP client:** `performance.now()`.

All of these are monotonic. Each runner yields to the event loop between iterations, outside the timed region, so its output can flush.

## Statistics

| Statistic | How it is computed |
|---|---|
| Mean, median, min, max | Over all measured iterations, pooled across rounds |
| Standard deviation | Sample standard deviation (n−1) |
| CV | stddev / mean. A warning is shown above 10% |
| 95% CI half-width | Student t × sd / √n |
| P90 / P95 of iteration time | Type-7 linear interpolation. P90 is reported only with ≥ 10 samples and P95 with ≥ 20 |
| Ops/s | Mean of the per-iteration rates (ops ÷ seconds) |
| HTTP req/s | Mean over iterations of successful responses ÷ iteration seconds. Failed requests are never counted |
| HTTP latency | Percentiles over every successful measured request |

A **few samples** warning is shown with fewer than 5 samples per runtime. The run summary says whether the two runtimes' 95% confidence intervals overlap. If they do, the difference may be noise.

## HTTP benchmarks

- **Server.** The server runs on the runtime under test (`Bun.serve` or `node:http`). It binds to 127.0.0.1 on an OS-assigned port and announces readiness on stdout. The orchestrator then checks `/health` before any load is sent.
- **Warm-up.** `warmupRequests` unmeasured requests are sent first. If every warm-up request fails, the execution fails.
- **Validation.** A response counts as successful only if it has status 200 **and** a body byte-identical to the expected payload. Errors, timeouts (`requestTimeoutMs`) and wrong bodies count as failures, and up to 10 distinct failure reasons are kept.
- **Client.** The load client always runs on Bun, so client overhead is the same for both servers but is not zero. Client and server share the CPU. Results therefore show what this machine achieves with this client, not the server's theoretical maximum.
- **Shutdown.** After the load, the orchestrator reads the server's RSS from `/__stats`, sends `POST /__shutdown`, and kills the server if it hasn't exited within 3 s.

## Memory

| Measure | Source | Comparable across runtimes? |
|---|---|---|
| **Peak RSS (OS)** | `resourceUsage().maxRSS` of the runner or server process after it exits | Yes. Includes each runtime's baseline footprint |
| **Max RSS (in-process)** | `process.memoryUsage().rss` after each measured iteration | Roughly. The sampling points differ from the OS peak |
| **Max heap used** | `process.memoryUsage().heapUsed` | **No.** V8 and JavaScriptCore account heap differently |
| **Server RSS after load** (HTTP) | Server's `process.memoryUsage().rss` right after the measured load | Yes, at the same point for both |

## Resource limits

- **Hard caps:** iterations ≤ 200, warm-ups ≤ 50, rounds ≤ 6, `maxDurationMs` ≤ 300 s per process. Workload sizes are bounded (for example sieve ≤ 5,000,000, memory objects ≤ 500,000) and HTTP is limited to 400,000 measured requests per process.
- **Settings:** can lower these caps further.
- **Timeouts:** each process is killed at `maxDurationMs` plus 5 s of start-up grace. Runners also stop themselves between iterations when their deadline passes (exit code 124).
- **Memory:** there is no OS-level memory cap (it can't be done portably on Windows). Memory use is bounded by the workload limits instead. Node is **not** given `--max-old-space-size`, because changing its GC configuration would distort the comparison.

## Limitations

- Results vary with hardware, OS, power plan, thermal state, background load and runtime versions.
- No CPU pinning or process isolation is applied.
- Micro-benchmarks do not predict the performance of a full application.
- Neither runtime is universally faster.
