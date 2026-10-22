import { type DetectedRuntime, detectRuntime, toRuntimeInfo } from "@bunbench/benchmark-core/orchestrator";
import { type RuntimeInfo, type RuntimeName, RUNTIMES } from "@bunbench/shared";

const CACHE_TTL_MS = 30_000;

export interface RuntimeServiceOptions {
  bunPathOverride?: string | undefined;
  nodePathOverride?: string | undefined;
  exposePaths: boolean;
}

export type Detector = typeof detectRuntime;

/** Detects Bun and Node.js, caching results briefly. Never throws: failures become "unavailable". */
export class RuntimeService {
  private cache: { at: number; value: Record<RuntimeName, DetectedRuntime> } | null = null;

  private readonly options: RuntimeServiceOptions;
  private readonly detect: Detector;

  constructor(options: RuntimeServiceOptions, detect: Detector = detectRuntime) {
    this.options = options;
    this.detect = detect;
  }

  async detectAll(force = false): Promise<Record<RuntimeName, DetectedRuntime>> {
    if (!force && this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) return this.cache.value;
    const overrides: Record<RuntimeName, string | undefined> = {
      bun: this.options.bunPathOverride,
      node: this.options.nodePathOverride,
    };
    const results = await Promise.all(
      RUNTIMES.map(async (name): Promise<DetectedRuntime> => {
        try {
          return await this.detect(name, { override: overrides[name] });
        } catch (error) {
          return { name, available: false, version: null, execPath: null, source: "none", reason: `Detection failed: ${(error as Error).message}` };
        }
      }),
    );
    const value = Object.fromEntries(results.map((r) => [r.name, r])) as Record<RuntimeName, DetectedRuntime>;
    this.cache = { at: Date.now(), value };
    return value;
  }

  async info(force = false): Promise<RuntimeInfo[]> {
    const all = await this.detectAll(force);
    return RUNTIMES.map((name) => toRuntimeInfo(all[name], this.options.exposePaths));
  }
}
