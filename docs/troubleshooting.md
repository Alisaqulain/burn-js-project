# Troubleshooting

### `bun` is not recognized
Bun is installed in `~/.bun/bin` (Windows: `%USERPROFILE%\.bun\bin`). Open a new terminal or add that directory to `PATH`.

### Node.js shows as unavailable
- **"not found on PATH":** install Node.js (see [installation.md](installation.md)) or set `BUNBENCH_NODE_PATH`.
- **"too old":** Node < 22.18 cannot run the TypeScript runner. Upgrade.
- **After installing Node:** click **Re-detect** on the Runtimes page (detection is cached for 30 s).

### "Cannot reach the BunBench API" in the browser
The API isn't running, or it is on a different port. Start everything with `bun run dev`.
- In dev mode, Vite proxies `/api` to `http://127.0.0.1:3001`. Set `BUNBENCH_API_URL` when starting Vite if the API runs elsewhere.

### `403 ORIGIN_NOT_ALLOWED`
Add the page's origin (scheme://host:port) to `BUNBENCH_CORS_ORIGINS` in `.env` and restart the API.

### Port already in use
Change `BUNBENCH_PORT`. The Vite port 5173 is fixed (`strictPort`), so stop whatever else is using it.

### A run is marked `timeout`
The process exceeded **Max duration per process**. Reduce the workload size or the iteration count, or raise the limit. The limit may be capped by Settings → Maximum duration.

### High coefficient of variation warnings
- **Short iterations.** Iterations under ~1 ms are dominated by timer and scheduling noise. Increase the workload size.
- **Background load.** Close browsers, IDE indexers and builds, and plug laptops in (battery saver throttles the CPU).
- **Not enough samples.** Use more iterations and 2 rounds.

### HTTP runs report failed requests
- **Timeouts at high concurrency.** Lower `concurrency` or raise `requestTimeoutMs`.
- **"All warm-up requests failed".** The server could not be reached. Check that local firewalls allow loopback connections.

### Integration tests are skipped
The Node.js parts of the integration suites are skipped when `node` is unavailable. The test output says so explicitly.

### Database errors after an interrupted upgrade
Run `bun run db:migrate`. If the file is corrupt, restore it from `backups/` or run `bun run db:reset -- --yes`.

### Windows: process kills
BunBench uses `TerminateProcess` (via `subprocess.kill()`) on Windows. Runner processes never install signal handlers, so cancellation and timeouts are immediate.
