/**
 * Sliding-window rate limiter keyed by client address. In-memory: suitable for the single-process
 * local deployment BunBench targets.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(limit: number, windowMs: number, now: () => number = Date.now) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
  }

  /** Records a hit and returns whether it is allowed, plus seconds until the next slot frees. */
  check(key: string): { allowed: boolean; retryAfterSeconds: number; remaining: number } {
    const t = this.now();
    const windowStart = t - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((ts) => ts > windowStart);
    if (list.length >= this.limit) {
      this.hits.set(key, list);
      const retryAfterMs = list[0]! + this.windowMs - t;
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1_000)), remaining: 0 };
    }
    list.push(t);
    this.hits.set(key, list);
    if (this.hits.size > 10_000) this.prune(windowStart);
    return { allowed: true, retryAfterSeconds: 0, remaining: this.limit - list.length };
  }

  private prune(windowStart: number) {
    for (const [key, list] of this.hits) {
      if (list.every((ts) => ts <= windowStart)) this.hits.delete(key);
    }
  }
}
