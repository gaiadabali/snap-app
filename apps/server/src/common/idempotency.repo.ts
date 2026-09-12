import { withTenantAs } from '@snap/db';
import { sql } from 'drizzle-orm';

import { getDb } from '../db.js';

/**
 * The idempotency store.
 *
 * A phone at a truck stop retries. It retries because the signal dropped
 * halfway through a request, which means the server may well have *completed*
 * the write and only the response was lost — so "did it happen?" is
 * unanswerable from the client's side. Without a key, the honest options are
 * both bad: retry and risk a duplicate bill payment, or don't and risk losing
 * the capture.
 *
 * A key makes it answerable. The first request claims the key and stores its
 * outcome; every repeat of that key gets the stored outcome back rather than
 * executing again.
 */

export type ClaimResult =
  | { state: 'claimed' }
  | { state: 'replay'; code: number; body: unknown }
  | { state: 'in_flight' }
  | { state: 'mismatch' };

/**
 * Claims a key for this request, or reports what already happened under it.
 *
 * The claim is an INSERT with `response_code` still null, which is what makes
 * two simultaneous retries safe: exactly one wins the primary key, and the
 * loser can tell the difference between "already finished" (a row with a
 * response) and "still running" (a row without one). Deciding this by reading
 * first and inserting second would let both requests read nothing and both
 * proceed — the exact duplicate the key exists to prevent.
 *
 * `request_hash` is checked because a key is only a promise about ONE request.
 * Reusing a key for different content is a client bug, and silently returning
 * the first request's response to the second would hide it — the caller would
 * believe a payment of $50 succeeded when what it actually sent was $500.
 */
export async function claimKey(
  userId: string,
  tenantId: string,
  key: string,
  requestHash: Buffer,
): Promise<ClaimResult> {
  return withTenantAs(getDb(), userId, tenantId, async (tx) => {
    const inserted = await tx.execute<{ key: string }>(sql`
      insert into idempotency_keys (tenant_id, key, request_hash)
      values (${tenantId}, ${key}, ${requestHash})
      on conflict (tenant_id, key) do nothing
      returning key
    `);
    if (inserted.rows.length > 0) return { state: 'claimed' as const };

    const existing = await tx.execute<{
      matches: boolean;
      response_code: number | null;
      response_body: unknown;
    }>(sql`
      select request_hash = ${requestHash} as matches, response_code, response_body
        from idempotency_keys
       where tenant_id = ${tenantId} and key = ${key}
       limit 1
    `);
    const row = existing.rows[0];
    if (!row) {
      // Deleted between our insert and our select — a retention sweep. Treat
      // it as ours rather than failing a request for a bookkeeping reason.
      return { state: 'claimed' as const };
    }
    if (!row.matches) return { state: 'mismatch' as const };
    if (row.response_code === null) return { state: 'in_flight' as const };
    return { state: 'replay' as const, code: row.response_code, body: row.response_body };
  });
}

/** Records the outcome, so the next repeat of this key replays it. */
export async function recordOutcome(
  userId: string,
  tenantId: string,
  key: string,
  code: number,
  body: unknown,
): Promise<void> {
  await withTenantAs(getDb(), userId, tenantId, async (tx) => {
    await tx.execute(sql`
      update idempotency_keys
         set response_code = ${code}, response_body = ${JSON.stringify(body ?? null)}::jsonb
       where tenant_id = ${tenantId} and key = ${key}
    `);
  });
}

/**
 * Releases a claim whose request failed.
 *
 * A 500 is not an outcome worth replaying: the client should be able to retry
 * the same key and have it actually run. Leaving the claim in place would
 * answer every retry with "in progress" forever, turning a transient failure
 * into a permanently stuck operation.
 */
export async function releaseKey(
  userId: string,
  tenantId: string,
  key: string,
): Promise<void> {
  await withTenantAs(getDb(), userId, tenantId, async (tx) => {
    await tx.execute(sql`
      delete from idempotency_keys
       where tenant_id = ${tenantId} and key = ${key} and response_code is null
    `);
  });
}
