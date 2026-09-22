import type { Db } from '@snap/db';
import { sql } from 'drizzle-orm';

import { getDb } from '../db.js';

/**
 * Fixed-window rate limiting, counted in Postgres.
 *
 * This used to be a `Map` in process memory, which read honestly enough and
 * lied in every deployment that mattered: two API replicas (or one container
 * restart) each counted separately, so the real limit was N x instances, and
 * a restart handed whoever was being limited a fresh allowance. The counter
 * now lives in the `rate_limits` table (migration 0035) — the store every
 * replica already shares, rather than a new dependency for one integer.
 *
 * The database is the source of truth and there is no in-memory shadow
 * counter to drift from it: every `consume` is one atomic upsert against the
 * row for the key. Atomicity is the point, not an implementation detail —
 * the failure this replaces was two processes both reading "3 of 5" and both
 * admitting themselves.
 */
export class RateLimiter {
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    /** Injectable so tests can stand up several independent connections — two "processes" — against one database. */
    private readonly db: () => Db = getDb,
  ) {}

  /**
   * True if the caller may proceed; false if this key has used up its window.
   *
   * Counts ATTEMPTS, not admitted requests: a refused caller increments the
   * counter too. For a fixed window that is the difference between a flood
   * ending the allowance early and the allowance ending on schedule — both
   * are the limit working, and the second is what an attacker would prefer.
   */
  async consume(key: string): Promise<boolean> {
    const now = Date.now();
    const windowStart = new Date(Math.floor(now / this.windowMs) * this.windowMs);
    const { rows } = await this.db().execute<{ count: number }>(sql`
      INSERT INTO rate_limits (bucket_key, window_start, count)
      VALUES (${key}, ${windowStart.toISOString()}, 1)
      ON CONFLICT (bucket_key) DO UPDATE SET
        /* Same window: increment. Window has rolled over: restart at 1. */
        count = CASE WHEN rate_limits.window_start = ${windowStart.toISOString()}::timestamptz
                     THEN rate_limits.count + 1
                     ELSE 1 END,
        window_start = ${windowStart.toISOString()}::timestamptz
      RETURNING count
    `);
    return (rows[0]?.count ?? 0) <= this.limit;
  }

  /**
   * Deletes rows whose window has elapsed.
   *
   * One row per key means the table cannot grow with history, only with the
   * number of distinct keys ever seen — which a scrape across many addresses
   * can still inflate. Call this periodically (the global limiter in main.ts
   * does, roughly once per window) so abandoned keys are reclaimed.
   */
  async sweep(): Promise<void> {
    await this.db().execute(sql`
      DELETE FROM rate_limits WHERE window_start < now() - ${`'${this.windowMs} milliseconds'`}::interval
    `);
  }
}
