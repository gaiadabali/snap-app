/**
 * In-memory, fixed-window rate limiting.
 *
 * Good enough for a single process, which is the deployment this repo targets
 * for now (docs/PLAN.md O3 defaults to a single Fly.io region). A
 * multi-instance deployment needs a shared store (Redis, most likely) instead
 * — that is a data/infra decision for the architect and devops seats, not
 * something to improvise inside an auth endpoint, so it is a follow-up rather
 * than solved here. Documented so nobody mistakes this for durable.
 */
type Bucket = { count: number; windowStart: number };

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** True if the caller may proceed; false if this key has used up its window. */
  consume(key: string): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || now - bucket.windowStart >= this.windowMs) {
      this.buckets.set(key, { count: 1, windowStart: now });
      return true;
    }
    if (bucket.count >= this.limit) return false;
    bucket.count += 1;
    return true;
  }

  /** Drops windows that have already elapsed, so the map does not grow forever. */
  sweep(): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.windowStart >= this.windowMs) this.buckets.delete(key);
    }
  }

  /** Test-only. */
  size(): number {
    return this.buckets.size;
  }
}
