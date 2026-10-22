# Production deployment notes

BunBench is designed to run on the machine whose performance you want to measure.

## Single-process mode

```bash
bun install --frozen-lockfile
bun run build      # type-checks and builds apps/web/dist
bun run start      # serves the API and the built UI on BUNBENCH_HOST:BUNBENCH_PORT
```

- **The repository is the deployment.** The API and runners run TypeScript directly (Bun natively, Node via type stripping). Deploy the repository, not only `dist/`, because the runner scripts must be present.
- **Database.** The schema is migrated automatically on start, and runs that were interrupted by a previous shutdown are marked failed.
- **Shutdown.** SIGINT/SIGTERM cancels active benchmarks, waits for their child processes, closes the database and exits.

## Benchmark hygiene on a dedicated host

- **Avoid noisy neighbours.** Use bare metal or a dedicated VM. Shared or burstable cloud instances make timings unstable.
- **CPU frequency.** Pin the frequency governor (`performance`) and disable turbo for consistent results if your goal is A/B stability.
- **Background work.** Keep the host idle: no builds, indexing or antivirus scans during runs.
- **Concurrency.** Keep `maxConcurrentRuns = 1`.

## If it must be reachable remotely

BunBench has no authentication. Before binding beyond loopback:

1. **Authenticate at the proxy.** Put a reverse proxy in front (Caddy, nginx, Traefik) that handles TLS and authentication (SSO/OIDC, mTLS, or a VPN such as Tailscale).
   - Keep BunBench on `127.0.0.1` and let the proxy forward to it.
   - SSE needs buffering disabled. BunBench sends `X-Accel-Buffering: no`; also set `proxy_buffering off` in nginx.
2. **Restrict CORS.** Set `BUNBENCH_CORS_ORIGINS` to the proxy's public origin.
3. **Isolate and limit resources.** Run inside a container or VM with CPU and memory limits (cgroups) so a benchmark cannot starve the host.
4. **Rate limit at the proxy as well.**

## Backups

- `bun run db:backup` uses SQLite `VACUUM INTO`, which is safe while the API is running. It writes `backups/bunbench-<timestamp>.sqlite`.
- To restore: stop the API, then copy a backup over `BUNBENCH_DB_PATH` (delete any `-wal`/`-shm` files next to it).
- To reset: `bun run db:reset -- --yes`, with the API stopped.

## Upgrades

Run `bun install` and `bun run db:migrate` (or simply restart). Migrations are append-only and each one runs in a transaction.
