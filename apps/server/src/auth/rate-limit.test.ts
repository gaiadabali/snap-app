import { createDb, type Db } from '@snap/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

import { RateLimiter } from './rate-limit.js';

/**
 * The limiter's counters now live in Postgres (migration 0035), so these are
 * real-database tests: the thing under test is precisely the behaviour the
 * in-memory Map could not have — a limit that survives a second process.
 */

const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

describeIfDb('RateLimiter (Postgres-backed)', () => {
  let pool: Pool;
  let db: Db;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = createDb(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('allows requests up to the limit within the window', async () => {
    const limiter = new RateLimiter(3, 60_000, () => db);
    const key = `test:allow:${Date.now()}`;
    expect(await limiter.consume(key)).toBe(true);
    expect(await limiter.consume(key)).toBe(true);
    expect(await limiter.consume(key)).toBe(true);
  });

  it('refuses the request that exceeds the limit — the negative case', async () => {
    const limiter = new RateLimiter(3, 60_000, () => db);
    const key = `test:refuse:${Date.now()}`;
    await limiter.consume(key);
    await limiter.consume(key);
    await limiter.consume(key);
    expect(await limiter.consume(key)).toBe(false);
    // Still refused, not just the one request over — a caller retrying in a
    // loop must not slip through on attempt five just because four failed.
    expect(await limiter.consume(key)).toBe(false);
  });

  it('tracks separate keys independently', async () => {
    const limiter = new RateLimiter(1, 60_000, () => db);
    const a = `test:email:a:${Date.now()}`;
    const b = `test:email:b:${Date.now()}`;
    expect(await limiter.consume(a)).toBe(true);
    expect(await limiter.consume(b)).toBe(true);
    expect(await limiter.consume(a)).toBe(false);
  });

  // THE test this file exists for. Two limiter instances built on two
  // SEPARATE connection pools — separate connections are what separate
  // processes actually get; sharing one pool would understate the bug by
  // letting the two "processes" share a client cache neither has. No
  // in-process state is shared: the only thing the instances have in common
  // is the database, exactly as two API replicas would.
  it('keeps counting across two instances sharing the same database', async () => {
    const other = new Pool({ connectionString: url });
    try {
      const secondDb = createDb(other);
      const first = new RateLimiter(3, 60_000, () => db);
      const second = new RateLimiter(3, 60_000, () => secondDb);
      const key = `test:two-processes:${Date.now()}`;

      // Three requests through the FIRST instance exhaust the window...
      expect(await first.consume(key)).toBe(true);
      expect(await first.consume(key)).toBe(true);
      expect(await first.consume(key)).toBe(true);

      // ...and the SECOND instance must see them. Before the shared store,
      // this instance held its own empty Map and admitted the request.
      expect(await second.consume(key)).toBe(false);
    } finally {
      await other.end();
    }
  });

  it('resets once the window has elapsed', async () => {
    const limiter = new RateLimiter(1, 60_000, () => db);
    const key = `test:reset:${Date.now()}`;
    expect(await limiter.consume(key)).toBe(true);
    expect(await limiter.consume(key)).toBe(false);

    // Simulate the window rolling over by backdating the stored window, the
    // same outcome the floor(now / windowMs) arithmetic produces at the
    // boundary, without a suite that sleeps for a minute.
    await db.execute(sql`
      UPDATE rate_limits SET window_start = window_start - interval '2 minutes'
      WHERE bucket_key = ${key}
    `);
    expect(await limiter.consume(key)).toBe(true);
  });

  it('sweep deletes only rows from elapsed windows', async () => {
    const limiter = new RateLimiter(5, 60_000, () => db);
    const stale = `test:stale:${Date.now()}`;
    const fresh = `test:fresh:${Date.now()}`;
    await limiter.consume(stale);
    await limiter.consume(fresh);
    await db.execute(sql`
      UPDATE rate_limits SET window_start = window_start - interval '2 minutes'
      WHERE bucket_key = ${stale}
    `);
    await limiter.sweep('test:');
    const { rows } = await db.execute<{ bucket_key: string }>(sql`
      SELECT bucket_key FROM rate_limits WHERE bucket_key IN (${stale}, ${fresh})
    `);
    expect(rows.map((r) => r.bucket_key)).toEqual([fresh]);
  });

  // The regression this pins (task 1.2): the global limiter (1-minute window)
  // swept the whole table at ITS window, deleting the 15-minute auth counters
  // about a minute into their window — so "5 per address per 15 minutes" was
  // in practice about 5 per minute. A sweep now touches only its own keys.
  it("a short-window limiter's sweep leaves a longer-window limiter's live counter alone", async () => {
    const global = new RateLimiter(300, 60_000, () => db);
    const auth = new RateLimiter(3, 15 * 60_000, () => db);
    const authKey = `reset:email:sweep-${Date.now()}@example.test`;
    const globalKey = `global:sweep-${Date.now()}`;

    await auth.consume(authKey);
    await auth.consume(authKey);
    await auth.consume(authKey);
    await global.consume(globalKey);
    // Both windows started five minutes ago: stale for the 1-minute limiter,
    // very much live for the 15-minute one.
    await db.execute(sql`
      UPDATE rate_limits SET window_start = window_start - interval '5 minutes'
      WHERE bucket_key IN (${authKey}, ${globalKey})
    `);

    await global.sweep('global:');

    const { rows } = await db.execute<{ bucket_key: string }>(sql`
      SELECT bucket_key FROM rate_limits WHERE bucket_key IN (${authKey}, ${globalKey})
    `);
    expect(rows.map((r) => r.bucket_key)).toEqual([authKey]);

    // And the counter still holds: the fourth attempt in the (backdated, but
    // still current) window is refused. Undo the backdating first, or the
    // consumer would see a different window_start and restart the count.
    await db.execute(sql`
      UPDATE rate_limits SET window_start = window_start + interval '5 minutes' WHERE bucket_key = ${authKey}
    `);
    expect(await auth.consume(authKey)).toBe(false);
  });

  it('sweepStale reclaims abandoned keys of every limiter past the longest window', async () => {
    const auth = new RateLimiter(3, 15 * 60_000, () => db);
    const abandoned = `pwd:abandoned-${Date.now()}@example.test`;
    const live = `pwd:live-${Date.now()}@example.test`;
    await auth.consume(abandoned);
    await auth.consume(live);
    await db.execute(sql`
      UPDATE rate_limits SET window_start = window_start - interval '2 hours' WHERE bucket_key = ${abandoned}
    `);
    await RateLimiter.sweepStale(60 * 60 * 1000, () => db);
    const { rows } = await db.execute<{ bucket_key: string }>(sql`
      SELECT bucket_key FROM rate_limits WHERE bucket_key IN (${abandoned}, ${live})
    `);
    expect(rows.map((r) => r.bucket_key)).toEqual([live]);
  });
});
