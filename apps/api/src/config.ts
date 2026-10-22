import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import { findRepoRoot } from "@bunbench/benchmark-core/orchestrator";

const envSchema = z.object({
  BUNBENCH_HOST: z.string().trim().min(1).default("127.0.0.1"),
  BUNBENCH_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  BUNBENCH_CORS_ORIGINS: z.string().default("http://localhost:5173,http://127.0.0.1:5173"),
  BUNBENCH_DB_PATH: z.string().trim().min(1).default("data/bunbench.sqlite"),
  BUNBENCH_BUN_PATH: z.string().trim().optional(),
  BUNBENCH_NODE_PATH: z.string().trim().optional(),
  BUNBENCH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(1_000).default(12),
  BUNBENCH_EXPOSE_PATHS: z.enum(["true", "false"]).default("true"),
  /** Bearer token required for state-changing requests. Required when not bound to loopback. */
  BUNBENCH_API_TOKEN: z
    .string()
    .trim()
    .optional()
    .refine((t) => !t || t.length >= 32, "BUNBENCH_API_TOKEN must be at least 32 characters"),
  /** Explicit opt-out of the token requirement on non-loopback hosts (trusted private networks only). */
  BUNBENCH_ALLOW_UNAUTHENTICATED: z.enum(["true", "false"]).default("false"),
  /** Use the last X-Forwarded-For entry as the client address (only behind your own reverse proxy). */
  BUNBENCH_TRUST_PROXY: z.enum(["true", "false"]).default("false"),
});

export interface AppConfig {
  host: string;
  port: number;
  corsOrigins: string[];
  dbPath: string;
  bunPathOverride: string | undefined;
  nodePathOverride: string | undefined;
  rateLimitPerMinute: number;
  exposePaths: boolean;
  apiToken: string | undefined;
  allowUnauthenticated: boolean;
  trustProxy: boolean;
  repoRoot: string;
  webDistDir: string;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Invalid environment configuration: ${issue?.path.join(".")} ${issue?.message}`);
  }
  const e = parsed.data;
  const repoRoot = findRepoRoot();
  return {
    host: e.BUNBENCH_HOST,
    port: e.BUNBENCH_PORT,
    corsOrigins: e.BUNBENCH_CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean),
    dbPath: e.BUNBENCH_DB_PATH === ":memory:" ? ":memory:" : isAbsolute(e.BUNBENCH_DB_PATH) ? e.BUNBENCH_DB_PATH : resolve(repoRoot, e.BUNBENCH_DB_PATH),
    bunPathOverride: e.BUNBENCH_BUN_PATH || undefined,
    nodePathOverride: e.BUNBENCH_NODE_PATH || undefined,
    rateLimitPerMinute: e.BUNBENCH_RATE_LIMIT_PER_MINUTE,
    exposePaths: e.BUNBENCH_EXPOSE_PATHS === "true",
    apiToken: e.BUNBENCH_API_TOKEN || undefined,
    allowUnauthenticated: e.BUNBENCH_ALLOW_UNAUTHENTICATED === "true",
    trustProxy: e.BUNBENCH_TRUST_PROXY === "true",
    repoRoot,
    webDistDir: resolve(repoRoot, "apps", "web", "dist"),
  };
}

export function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

/**
 * Startup safety check. Returns an error message when the configuration would expose
 * process-launching endpoints to a network without authentication.
 */
export function unsafeExposureError(config: Pick<AppConfig, "host" | "apiToken" | "allowUnauthenticated">): string | null {
  if (isLoopback(config.host) || config.apiToken || config.allowUnauthenticated) return null;
  return (
    `Refusing to bind to ${config.host} without authentication: anyone who can reach this port could launch benchmark processes. ` +
    "Set BUNBENCH_API_TOKEN (>= 32 random characters), or set BUNBENCH_ALLOW_UNAUTHENTICATED=true only on a trusted private network."
  );
}
