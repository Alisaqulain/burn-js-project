# Production deployment

## Architecture: frontend on Vercel, API + runners on a persistent host

BunBench **cannot run entirely on Vercel**. The API and benchmark engine need things Vercel's serverless/static platform does not provide:

| Requirement (from the code) | Where | Vercel Functions |
|---|---|---|
| Spawning child processes for every benchmark (`Bun.spawn`) | `packages/benchmark-core/src/orchestrator/process.ts` | Not suitable: each request is an isolated, short-lived invocation |
| **Two** runtime executables (Bun *and* Node.js ≥ 22.18) on the same machine | runtime detection, runners | Not available together |
| Runs lasting up to 300 s per process, continuing after the HTTP response | `BenchmarkService` queue | Work after the response is not guaranteed; duration is capped |
| Persistent SQLite file | `apps/api/src/db` | Filesystem is ephemeral and per-instance |
| In-memory queue + event bus shared between requests (SSE progress) | `BenchmarkService`, `RunEventBus` | Instances are not shared |
| Stable CPU for fair measurements | everything | Shared, variable serverless CPUs would make results meaningless |

So the supported production setup is:

```
Browser ──HTTPS──▶ Vercel (static React app, apps/web/dist)
   │
   └──HTTPS (CORS)──▶ API host: Caddy ─▶ BunBench API container (Bun + Node.js, SQLite volume)
                                           └─ spawns bun/node runner processes
```

A static frontend cannot reach an API that does not exist. That is the cause of the original
`Unexpected response (HTTP 404) / BAD_RESPONSE` error: without `VITE_API_BASE`, the Vercel site requested
`https://<site>/api/...` and received Vercel's HTML 404 page.

---

## 1. Deploy the API host (VPS or any Docker host with a persistent volume)

Requirements:
- A Linux server (VPS / bare metal) with Docker and Docker Compose, **dedicated to benchmarking** (≥ 2 vCPU, 2 GB RAM recommended). Shared or burstable CPUs make results noisy.
- A DNS name (e.g. `api.your-domain.example`) with an A/AAAA record pointing at the server.
- Ports 80 and 443 open (Caddy obtains a Let's Encrypt certificate automatically).
- Exactly **one** API instance per database volume. Do not autoscale; the queue and live progress are in-memory.

Steps (on the server):

```bash
git clone https://github.com/Alisaqulain/burn-js-project.git bunbench
cd bunbench/deploy
cp api.env.example api.env
# Edit api.env:
#   BUNBENCH_API_TOKEN     = output of: openssl rand -hex 32
#   BUNBENCH_CORS_ORIGINS  = https://<your-vercel-project>.vercel.app  (plus any custom domain)
API_DOMAIN=api.your-domain.example docker compose up -d --build
docker compose logs -f api      # expect: "bun: v1.4.4" and "node: v24.22.1"
curl https://api.your-domain.example/api/health
```

What the image contains (see `Dockerfile`): Node.js 24.22.1 (base image) + the Bun 1.4.4 binary, production
dependencies, the API and runner sources. The SQLite database lives in the `bunbench-data` volume at `/data`.
The container runs as the unprivileged `node` user.

Other hosts (Fly.io, Railway, Render, a plain VM without Docker) work too if they provide: a long-running
process (no scale-to-zero during runs), a persistent disk mounted for `BUNBENCH_DB_PATH`, HTTPS, a single
instance, and `bun` + `node` ≥ 22.18 on `PATH`. Run `bun install --frozen-lockfile --production` then
`bun apps/api/src/index.ts` with the environment variables below.

### API environment variables

| Variable | Required | Value |
|---|---|---|
| `BUNBENCH_API_TOKEN` | **Yes** (when not bound to loopback) | ≥ 32 random characters. Required for starting/cancelling/deleting runs and changing settings. The API refuses to start on `0.0.0.0` without it. |
| `BUNBENCH_CORS_ORIGINS` | **Yes** | Comma-separated exact origins of the frontend, e.g. `https://bunbench.vercel.app,https://bench.your-domain.example` |
| `BUNBENCH_HOST` | set by the image | `0.0.0.0` inside the container (only Caddy is published) |
| `BUNBENCH_TRUST_PROXY` | set by compose | `true` behind Caddy so rate limiting uses the real client IP. Leave `false` without a proxy. |
| `BUNBENCH_DB_PATH` | set by the image | `/data/bunbench.sqlite` |
| `BUNBENCH_RATE_LIMIT_PER_MINUTE` | No | default 12 submissions per client per minute |
| `BUNBENCH_EXPOSE_PATHS` | No | image default `false` (executable paths hidden) |
| `BUNBENCH_ALLOW_UNAUTHENTICATED` | No | Only for trusted private networks. Never on a public server. |

---

## 2. Deploy the frontend to Vercel

Import the GitHub repository in Vercel and use these **Project Settings**:

| Setting | Value |
|---|---|
| Root Directory | *(leave empty: repository root)* |
| Framework Preset | Other (`vercel.json` sets `"framework": null`) |
| Install Command | from `vercel.json`: `bun install --frozen-lockfile` |
| Build Command | from `vercel.json`: `bun run build:web` |
| Output Directory | from `vercel.json`: `apps/web/dist` |
| Node.js Version | 22.x or 24.x (Vite 8 needs ≥ 22.12) |

If your existing Vercel project has **Root Directory = `apps/web`** (a common first attempt), change it to the
repository root: the frontend imports the `@bunbench/shared` workspace package, and `vercel.json` lives at the root.
Overrides in the dashboard take precedence over `vercel.json`, so clear any custom Build/Output/Install values.

### Vercel environment variables

| Name | Environments | Value |
|---|---|---|
| `VITE_API_BASE` | Production (and Preview if previews should work) | The API's public HTTPS URL **without** `/api` and without a trailing slash, e.g. `https://api.your-domain.example` |

`VITE_*` variables are embedded into the JavaScript bundle at **build time** and are public. Changing it requires a
**redeploy**. Never put the API token in a Vercel variable; operators enter it in the app (Settings → API access),
where it is kept only in that browser's local storage.

Routing (`vercel.json`): static files are served first; every other path except `/api/*` and `/assets/*`
is rewritten to `index.html`, so deep links such as `/history` or `/runs/<id>` survive a refresh. `/api/*`
deliberately stays a 404 on Vercel: the app then reports "The BunBench API was not found" with a hint
instead of silently loading HTML.

Preview deployments get their own `*.vercel.app` origins. Add each origin you want to use to
`BUNBENCH_CORS_ORIGINS`, or test previews against a separate API instance.

---

## 3. Verify the live deployment

1. `curl https://api.your-domain.example/api/health` returns `{"ok":true,...,"auth":{"required":true}}`.
2. `curl https://api.your-domain.example/api/runtimes` shows `bun` and `node` with `"available":true`.
3. CORS: `curl -sI -H "Origin: https://<your-site>.vercel.app" https://api.your-domain.example/api/health`
   includes `access-control-allow-origin: https://<your-site>.vercel.app`.
4. Open `https://<your-site>.vercel.app/new` directly (tests the SPA rewrite). The Runtimes card must list Bun and Node.js with versions.
5. Settings → API access: the endpoint shows your API URL; paste the token and click **Save token**.
6. New benchmark → keep both runtimes → **Start benchmark**. The live page should show "Live (server-sent events)",
   progress per iteration, then results with both runtimes' versions under Environment.
7. Refresh `/history` and `/runs/<id>` in the browser: both load.

## Backups and upgrades

- Backup (online, safe while running): `docker compose exec api bun scripts/db-backup.ts` is not in the image; instead copy the
  volume while the API is idle: `docker compose stop api && docker run --rm -v deploy_bunbench-data:/data -v "$PWD":/backup busybox cp /data/bunbench.sqlite /backup/ && docker compose start api`.
  Outside Docker, `bun run db:backup` uses `VACUUM INTO`.
- Upgrade: `git pull && docker compose up -d --build`. Migrations run automatically at start-up, each in a transaction.
  Runs interrupted by the restart are marked failed (no partial results are saved).

## Local single-process mode (unchanged)

`bun run build && bun run start` serves the API and the built UI from one Bun process on `127.0.0.1:3001`
(`VITE_API_BASE` empty, same origin).
