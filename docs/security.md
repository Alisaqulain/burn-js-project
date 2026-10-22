# Security considerations

BunBench launches operating-system processes on request. Treat it as a **local development tool**.

## Authentication

- **Token for state-changing requests.** When `BUNBENCH_API_TOKEN` is set (at least 32 characters), every POST, PUT and DELETE under `/api` needs `Authorization: Bearer <token>`. Without it the API answers 401. The token is compared in constant time.
- **Public reads.** GET endpoints (results, history, SSE progress) need no token, so the dashboard works for viewers.
- **Startup refusal.** The API **refuses to start** on a non-loopback address without a token. `BUNBENCH_ALLOW_UNAUTHENTICATED=true` overrides this; use it only on trusted private networks.
- **Where the token lives in the browser.** Operators enter it under Settings → API access, and it stays in that browser's `localStorage`. It is never part of the build: `VITE_*` variables are public.

## Assumptions

- **Loopback only.** The API binds to `127.0.0.1` by default and logs a warning if `BUNBENCH_HOST` is anything else.
- **Local default.** For local use no token is configured. Anyone who can reach the port can queue benchmarks, which consumes CPU, and can delete history, so keep the default loopback bind.
- **Single user.** The only intended user is the person at the machine.

**Do not expose BunBench to an untrusted network.** For remote access, set `BUNBENCH_API_TOKEN`, serve the API over HTTPS (the included Caddy setup), and run it in a resource-limited container (see [deployment.md](deployment.md)).

## Process execution safeguards

- **Fixed scripts.** Only five fixed scripts can ever be executed (`runners/{bun,node}/runner.ts`, `runners/{bun,node}/http-server.ts` and `runners/loadgen/client.ts`). Their paths are resolved from the repository root and never come from input.
- **Fixed executables.** The executables are the Bun process that runs the API and the first `node` on `PATH`. The overrides `BUNBENCH_BUN_PATH` and `BUNBENCH_NODE_PATH` are operator-only environment variables. They must be absolute, must exist, and must be named `bun[.exe]` or `node[.exe]`. The API and UI cannot change them.
- **No shell.** Processes are spawned with argument arrays (`Bun.spawn({ cmd: [...] })`), never through a shell or string interpolation. Configuration is passed as JSON on stdin.
- **Minimal environment.** Children receive only an allow-list of environment variables (PATH, temp directories, home directories, locale). `NODE_OPTIONS`, `BUN_*` and secrets from the parent are not inherited.
- **Validated input.** Every input passes a strict Zod schema (unknown keys are rejected), and every numeric parameter has hard bounds.
- **Bounded execution.**
  - Each process has a wall-clock limit and is killed (with SIGKILL escalation after 2 s).
  - At most 2 runs execute concurrently (default 1), and the queue is limited.
  - Benchmark creation is rate-limited per client address.
- **Contained HTTP benchmarks.** Servers bind to 127.0.0.1 on an OS-assigned port. The load client refuses any target other than `http://127.0.0.1:<port>/`.

## Web/API hardening

- **CORS** is restricted to `BUNBENCH_CORS_ORIGINS` (plus the server's own origin).
- **CSRF.** State-changing requests with a disallowed `Origin` header are rejected (403). JSON bodies must use `application/json`, so cross-site "simple" form posts are rejected (415).
- **Limits.** Request bodies are capped at 64 KiB, and non-streaming requests have a 20 s timeout.
- **SQL injection.** Every query is parameterized, and `LIKE` wildcards in search are escaped.
- **CSV injection.** Exports neutralize spreadsheet formulas (`=`, `+`, `-`, `@` prefixes).
- **Security headers.** `hono/secure-headers` applies a strict CSP (`script-src 'self'`; no inline scripts), `frame-ancestors 'none'` and `nosniff`.
- **Static files.** Requests are confined to `apps/web/dist` (path traversal is rejected).

## Data stored

- **Stored:** runtime versions, OS name and release, CPU architecture, model and core count, total memory, benchmark configuration and measurements.
- **Not stored:** hostnames, usernames, environment variables or executable paths.
- **In the UI:** paths are shown with the home directory replaced by `~`, or hidden entirely with `BUNBENCH_EXPOSE_PATHS=false`.
- **Not committed:** the database (`data/`), backups and `.env` are ignored by git.

## Reporting

This is a local tool without a hosted service. Fix issues directly in the repository.
