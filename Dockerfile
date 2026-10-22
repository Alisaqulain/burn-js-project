# BunBench API + benchmark runners.
# Both runtimes under test are installed: Node.js (base image) and Bun (copied binary).
# The API launches runner processes, keeps an in-memory queue and writes SQLite to /data,
# so run exactly ONE container per database volume (no horizontal scaling).

FROM oven/bun:1.4.4 AS bun

FROM node:24.22.1-bookworm-slim

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app

# Install workspace dependencies first (cached layer). Manifests of every workspace are needed
# for the lockfile to resolve; only production dependencies are installed.
COPY package.json bun.lock bunfig.toml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/benchmark-core/package.json packages/benchmark-core/
COPY runners/package.json runners/
RUN bun install --frozen-lockfile --production

COPY packages/shared/src packages/shared/src
COPY packages/benchmark-core/src packages/benchmark-core/src
COPY runners/bun runners/bun
COPY runners/node runners/node
COPY runners/loadgen runners/loadgen
COPY runners/common runners/common
COPY apps/api/src apps/api/src

RUN mkdir -p /data && chown node:node /data

ENV NODE_ENV=production \
    BUNBENCH_HOST=0.0.0.0 \
    BUNBENCH_PORT=3001 \
    BUNBENCH_DB_PATH=/data/bunbench.sqlite \
    BUNBENCH_EXPOSE_PATHS=false

USER node
VOLUME ["/data"]
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# BUNBENCH_API_TOKEN must be provided at runtime; the API refuses to start on 0.0.0.0 without it.
CMD ["bun", "apps/api/src/index.ts"]
