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

### "The BunBench API was not found" / `Unexpected response (HTTP 404)` / `BAD_RESPONSE` on Vercel
The frontend is calling an API that is not there. On Vercel, the site only serves static files, so `https://<site>/api/...` returns Vercel's HTML 404.
1. Deploy the API host (see [deployment.md](deployment.md)).
2. Set `VITE_API_BASE=https://<your-api-host>` in Vercel (Production) and **redeploy**. The value is baked in at build time.
3. Check Settings → API access: "API endpoint" must show your API host, not the Vercel domain.

### "Access token required" (`401 UNAUTHORIZED`)
The API has `BUNBENCH_API_TOKEN` set. Paste the token under Settings → API access (it is stored in this browser only).

### Network error from the Vercel site (CORS or mixed content)
- **Origin not allowed.** The API must list the site's exact origin (for example `https://bunbench.vercel.app`) in `BUNBENCH_CORS_ORIGINS`. Restart the API after changing it.
- **Mixed content.** The API must use HTTPS: browsers block `http://` requests from an `https://` page.

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
