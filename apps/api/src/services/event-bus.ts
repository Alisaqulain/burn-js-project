import { type LiveProgress, type RunStreamEvent, TERMINAL_RUN_STATUSES } from "@bunbench/shared";

type Listener = (event: RunStreamEvent) => void;

/** How long live progress for a finished run stays available to late subscribers / pollers. */
const LIVE_RETENTION_MS = 60_000;

/** In-process pub/sub for run progress, plus the latest live snapshot per run. */
export class RunEventBus {
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly live = new Map<string, LiveProgress>();

  subscribe(runId: string, listener: Listener): () => void {
    const set = this.listeners.get(runId) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(runId, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(runId);
    };
  }

  listenerCount(runId: string): number {
    return this.listeners.get(runId)?.size ?? 0;
  }

  publish(runId: string, event: RunStreamEvent): void {
    for (const listener of this.listeners.get(runId) ?? []) {
      try {
        listener(event);
      } catch {
        // a broken subscriber must not affect the run
      }
    }
  }

  getLive(runId: string): LiveProgress | null {
    return this.live.get(runId) ?? null;
  }

  /** Merges a patch into the live snapshot and broadcasts it as a progress event. */
  updateLive(runId: string, patch: Partial<LiveProgress>): LiveProgress {
    const current: LiveProgress = this.live.get(runId) ?? {
      status: "queued",
      runtime: null,
      round: null,
      phase: null,
      iteration: null,
      total: null,
      executionsDone: 0,
      executionsTotal: 0,
      startedAt: null,
      message: null,
    };
    const next = { ...current, ...patch };
    this.live.set(runId, next);
    this.publish(runId, { type: "progress", live: next });
    if (TERMINAL_RUN_STATUSES.includes(next.status)) {
      setTimeout(() => {
        if (this.live.get(runId) === next) this.live.delete(runId);
      }, LIVE_RETENTION_MS).unref?.();
    }
    return next;
  }
}
