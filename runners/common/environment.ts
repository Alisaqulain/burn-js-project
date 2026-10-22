import os from "node:os";
import type { EnvironmentInfo, RuntimeName } from "@bunbench/shared";

/**
 * Environment description reported by every runner. Uses only node:os / process APIs that both
 * Bun and Node.js implement, so values are collected identically on both runtimes.
 */
export function describeEnvironment(runtime: RuntimeName, version: string, timer: string): EnvironmentInfo {
  const cpus = os.cpus();
  return {
    runtime,
    version,
    platform: process.platform,
    osRelease: os.release(),
    arch: process.arch,
    cpuModel: (cpus[0]?.model ?? "unknown").trim(),
    cpuCount: cpus.length,
    totalMemoryBytes: os.totalmem(),
    pid: process.pid,
    timer,
  };
}
