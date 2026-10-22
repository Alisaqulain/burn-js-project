import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute } from "node:path";
import type { RuntimeInfo, RuntimeName } from "@bunbench/shared";
import { buildChildEnv, runProcess } from "./process.ts";

export interface DetectedRuntime {
  name: RuntimeName;
  available: boolean;
  version: string | null;
  /** Full executable path. Internal: never sent to clients unredacted. */
  execPath: string | null;
  source: RuntimeInfo["source"];
  reason: string | null;
}

export interface DetectOptions {
  /** Operator-provided absolute executable path (from environment variables only). */
  override?: string | undefined;
  timeoutMs?: number;
}

/** Node.js runs the TypeScript runners via built-in type stripping (unflagged in 22.18 / 23.6+). */
export const MIN_NODE_VERSION = { major: 22, minor: 18 } as const;

export function parseVersion(output: string): string | null {
  const match = /v?(\d+\.\d+\.\d+(?:[-+][\w.]+)?)/.exec(output.trim());
  return match?.[1] ?? null;
}

export function nodeVersionSupported(version: string): boolean {
  const [major = 0, minor = 0] = version.split(".").map((p) => Number.parseInt(p, 10));
  if (major > 23) return true;
  if (major === 23) return minor >= 6;
  if (major === 22) return minor >= MIN_NODE_VERSION.minor;
  return false;
}

const EXECUTABLE_NAME: Record<RuntimeName, RegExp> = {
  bun: /^bun(\.exe)?$/i,
  node: /^node(\.exe)?$/i,
};

function validateOverride(name: RuntimeName, path: string): string | null {
  if (!isAbsolute(path)) return `BUNBENCH_${name.toUpperCase()}_PATH must be an absolute path`;
  if (!EXECUTABLE_NAME[name].test(basename(path))) return `BUNBENCH_${name.toUpperCase()}_PATH must point to a ${name} executable`;
  if (!existsSync(path)) return `BUNBENCH_${name.toUpperCase()}_PATH does not exist`;
  return null;
}

function locate(name: RuntimeName, override?: string): { path: string | null; source: RuntimeInfo["source"]; error: string | null } {
  if (override) {
    const error = validateOverride(name, override);
    return { path: error ? null : override, source: "env", error };
  }
  if (name === "bun" && process.versions.bun) return { path: process.execPath, source: "current-process", error: null };
  const found = Bun.which(name);
  return found ? { path: found, source: "path", error: null } : { path: null, source: "none", error: null };
}

export async function detectRuntime(name: RuntimeName, options: DetectOptions = {}): Promise<DetectedRuntime> {
  const { path, source, error } = locate(name, options.override);
  if (!path) {
    return {
      name,
      available: false,
      version: null,
      execPath: null,
      source,
      reason: error ?? `${name === "bun" ? "Bun" : "Node.js"} was not found on PATH`,
    };
  }
  const lines: string[] = [];
  const outcome = await runProcess({
    cmd: [path, "--version"],
    cwd: process.cwd(),
    env: buildChildEnv(),
    timeoutMs: options.timeoutMs ?? 5_000,
    onLine: (line) => lines.push(line),
  }).catch((e: unknown) => ({ exitCode: null, stderr: String(e), timedOut: false }) as const);
  const version = outcome.exitCode === 0 ? parseVersion(lines.join("\n")) : null;
  if (!version) {
    return {
      name,
      available: false,
      version: null,
      execPath: path,
      source,
      reason: outcome.timedOut ? `\`${name} --version\` timed out` : `\`${name} --version\` failed${outcome.stderr ? `: ${outcome.stderr.slice(0, 200)}` : ""}`,
    };
  }
  if (name === "node" && !nodeVersionSupported(version)) {
    return {
      name,
      available: false,
      version,
      execPath: path,
      source,
      reason: `Node.js ${version} is too old: BunBench requires >= ${MIN_NODE_VERSION.major}.${MIN_NODE_VERSION.minor} (built-in TypeScript type stripping)`,
    };
  }
  return { name, available: true, version, execPath: path, source, reason: null };
}

export const RUNTIME_DOCS: Record<RuntimeName, { installHint: string; docsUrl: string }> = {
  bun: {
    installHint:
      'Windows (PowerShell): powershell -c "irm bun.sh/install.ps1 | iex"  ·  macOS/Linux: curl -fsSL https://bun.sh/install | bash. Restart the terminal so bun is on PATH.',
    docsUrl: "https://bun.sh/docs",
  },
  node: {
    installHint:
      "Install Node.js 22.18+ (LTS 24 recommended) from https://nodejs.org or with a version manager (fnm, nvm, nvm-windows, volta). Ensure `node --version` works in the shell that starts BunBench, or set BUNBENCH_NODE_PATH.",
    docsUrl: "https://nodejs.org/docs/latest/api/",
  },
};

/** Replaces the home directory with ~ so usernames are not exposed. */
export function redactPath(path: string | null, expose: boolean): string | null {
  if (!path || !expose) return null;
  const home = homedir();
  if (home && path.toLowerCase().startsWith(home.toLowerCase())) return `~${path.slice(home.length)}`;
  return path;
}

export function toRuntimeInfo(detected: DetectedRuntime, exposePaths: boolean): RuntimeInfo {
  return {
    name: detected.name,
    available: detected.available,
    version: detected.version,
    path: redactPath(detected.execPath, exposePaths),
    source: detected.source,
    reason: detected.reason,
    ...RUNTIME_DOCS[detected.name],
  };
}
