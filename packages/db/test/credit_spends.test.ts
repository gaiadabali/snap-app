import { randomBytes } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * CREDIT SPENDS — migration 0039 (group plan 7.1.a, 7.1.c, 2.5.f).
 *
 * One row per capture queued for extraction, saying which credit paid for the
 * scan and whether it was a BOUGHT one. Proven here as the real roles on one
 * connection (`SET ROLE`), never as the superuser, which bypasses RLS:
 *
 *   - a workspace sees only its own spends;
 *   - the API (app_rw) may read and insert, never change or delete;
 *   - the insert policy recomputes `paid` and `grant_source` from the grant,
 *     so a free credit cannot be recorded as a bought one;
 *   - the worker (app_worker) may set only `refunded_at` and `refund_reason`;
 *   - one spend per capture;
 *   - the outbox accepts `skipped_free` and nothing else new.
 */

const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

const A = 'c5e60000-0000-4000-8000-00000000000a';
const B = 'c5e60000-0000-4000-8000-00000000000b';
const USER = 'c5e60000-0000-4000-8000-0000000000a1';
const CAPTURE_A1 = 'c5e60000-0000-4000-8000-0000000000c1';
const CAPTURE_A2 = 'c5e60000-0000-4000-8000-0000000000c2';
const CAPTURE_B1 = 'c5e60000-0000-4000-8000-0000000000c3';
const FREE_GRANT = 'c5e60000-0000-4000-8000-0000000000f1';
const BOUGHT_GRANT = 'c5e60000-0000-4000-8000-0000000000f2';

describeIfDb('credit_spends (migration 0039)', () => {
  let c: Client;

  async function as(role: 'app_rw' | 'app_worker', tenantId: string | null) {
    await c.query('RESET ROLE');
    await c.query(`SET ROLE ${role}`);
    await c.query(`SELECT set_config('app.user_id', $1, false)`, [USER]);
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId ?? '']);
  }

  const failure = (sqlText: string, params: unknown[] = []) =>
    c.query(sqlText, params as never[]).then(
      () => null,
      (e: Error & { code?: string }) => `${e.code ?? ''} ${e.message}`,
    );

  async function wipe() {
    await c.query('RESET ROLE');
    await c.query(`SELECT set_config('app.tenant_id','',false)`);
    await c.query(`SELECT set_config('app.user_id','',false)`);
    await c.query('DELETE FROM credit_spends WHERE tenant_id = ANY($1::uuid[])', [[A, B]]);
    await c.query('DELETE FROM credit_purchases WHERE tenant_id = ANY($1::uuid[])', [[A, B]]);
    await c.query('DELETE FROM usage_grants WHERE tenant_id = ANY($1::uuid[])', [[A, B]]);
    await c.query('DELETE FROM captures WHERE tenant_id = ANY($1::uuid[])', [[A, B]]);
    await c.query('DELETE FROM memberships WHERE tenant_id = ANY($1::uuid[])', [[A, B]]);
    await c.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [[A, B]]);
    await c.query('DELETE FROM users WHERE id = $1', [USER]);
  }

  beforeAll(async () => {
    c = new Client({ connectionString: url });
    await c.connect();
    await wipe();
    await c.query(
      `INSERT INTO tenants (id, name, kind, country, base_currency)
       VALUES ($1,'Spends A','business','AU','AUD'), ($2,'Spends B','business','AU','AUD')`,
      [A, B],
    );
    await c.query(`INSERT INTO users (id, subject, email, display_name) VALUES ($1,'idp|spends','spends@spends.test','Spends')`, [USER]);
    await c.query(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1,$3,'owner'), ($2,$3,'owner')`, [A, B, USER]);
    for (const [id, tenant] of [
      [CAPTURE_A1, A],
      [CAPTURE_A2, A],
      [CAPTURE_B1, B],
    ]) {
      await c.query(
        `INSERT INTO captures (id, tenant_id, uploaded_by, original_storage_key, original_mime_type, original_byte_size, original_sha256)
         VALUES ($1, $2, $3, 'k', 'image/jpeg', 10, $4)`,
        [id, tenant, USER, randomBytes(32)],
      );
    }
    await c.query(
      `INSERT INTO usage_grants (id, tenant_id, metric, amount, remaining, source)
       VALUES ($1, $3, 'scans', 10, 10, 'signup_bonus'), ($2, $3, 'scans', 50, 50, 'topup_pack')`,
      [FREE_GRANT, BOUGHT_GRANT, A],
    );
    await c.query(
      `INSERT INTO credit_purchases (id, tenant_id, purchased_by, pack_code, credits, price_aud, status, grant_id, paid_at)
       VALUES (gen_random_uuid(), $1, $2, 'credits_50', 50, 0.7, 'paid', $3, now())`,
      [A, USER, BOUGHT_GRANT],
    );
  });

  afterAll(async () => {
    await wipe();
    await c.end();
  });

  it('lets the API record a spend exactly as the grant says, and nothing else', async () => {
    await as('app_rw', A);
    // A free credit claimed as bought: refused.
    expect(
      await failure(
        `INSERT INTO credit_spends (tenant_id, capture_id, user_id, grant_id, grant_source, paid)
         VALUES (current_tenant_id(), $1, $2, $3, 'signup_bonus', true)`,
        [CAPTURE_A1, USER, FREE_GRANT],
      ),
    ).toMatch(/row-level security/);
    // A source that is not the grant's: refused.
    expect(
      await failure(
        `INSERT INTO credit_spends (tenant_id, capture_id, user_id, grant_id, grant_source, paid)
         VALUES (current_tenant_id(), $1, $2, $3, 'topup_pack', false)`,
        [CAPTURE_A1, USER, FREE_GRANT],
      ),
    ).toMatch(/row-level security/);
    // A bought credit recorded as free: refused too (the record must be true).
    expect(
      await failure(
        `INSERT INTO credit_spends (tenant_id, capture_id, user_id, grant_id, grant_source, paid)
         VALUES (current_tenant_id(), $1, $2, $3, 'topup_pack', false)`,
        [CAPTURE_A1, USER, BOUGHT_GRANT],
      ),
    ).toMatch(/row-level security/);
    // Already refunded at insert: refused.
    expect(
      await failure(
        `INSERT INTO credit_spends (tenant_id, capture_id, user_id, grant_id, grant_source, paid, refunded_at, refund_reason)
         VALUES (current_tenant_id(), $1, $2, NULL, NULL, false, now(), 'unreadable')`,
        [CAPTURE_A1, USER],
      ),
    ).toMatch(/row-level security/);

    await c.query(
      `INSERT INTO credit_spends (tenant_id, capture_id, user_id, grant_id, grant_source, paid)
       VALUES (current_tenant_id(), $1, $2, $3, 'topup_pack', true)`,
      [CAPTURE_A1, USER, BOUGHT_GRANT],
    );
    await c.query(
      `INSERT INTO credit_spends (tenant_id, capture_id, user_id, grant_id, grant_source, paid)
       VALUES (current_tenant_id(), $1, $2, NULL, NULL, false)`,
      [CAPTURE_A2, USER],
    );
    const rows = await c.query(`SELECT capture_id, paid FROM credit_spends ORDER BY paid DESC`);
    expect(rows.rows).toEqual([
      { capture_id: CAPTURE_A1, paid: true },
      { capture_id: CAPTURE_A2, paid: false },
    ]);
  });

  it('keeps one spend per capture', async () => {
    await as('app_rw', A);
    expect(
      await failure(
        `INSERT INTO credit_spends (tenant_id, capture_id, user_id, grant_id, grant_source, paid)
         VALUES (current_tenant_id(), $1, $2, NULL, NULL, false)`,
        [CAPTURE_A1, USER],
      ),
    ).toMatch(/^23505 .*credit_spends_one_per_capture/);
  });

  it("hides one workspace's spends from another, even by id", async () => {
    await as('app_rw', B);
    expect((await c.query(`SELECT count(*)::int AS n FROM credit_spends`)).rows[0].n).toBe(0);
    expect((await c.query(`SELECT id FROM credit_spends WHERE capture_id = $1`, [CAPTURE_A1])).rows).toEqual([]);
    // Nor can B record a spend in A's name.
    expect(
      await failure(
        `INSERT INTO credit_spends (tenant_id, capture_id, user_id, paid) VALUES ($1, $2, $3, false)`,
        [A, CAPTURE_B1, USER],
      ),
    ).toMatch(/row-level security/);

    await as('app_rw', null);
    expect((await c.query(`SELECT count(*)::int AS n FROM credit_spends`)).rows[0].n).toBe(0);
  });

  it('never lets the API change or remove a spend', async () => {
    await as('app_rw', A);
    expect(await failure(`UPDATE credit_spends SET paid = true WHERE capture_id = $1`, [CAPTURE_A2])).toMatch(
      /permission denied/,
    );
    expect(await failure(`UPDATE credit_spends SET refunded_at = now(), refund_reason = 'unreadable'`)).toMatch(
      /permission denied/,
    );
    expect(await failure(`DELETE FROM credit_spends`)).toMatch(/permission denied/);
  });

  it('lets the worker mark a refund in its own tenant, and change nothing else', async () => {
    await as('app_worker', A);
    expect(await failure(`UPDATE credit_spends SET paid = true WHERE capture_id = $1`, [CAPTURE_A2])).toMatch(
      /permission denied/,
    );
    expect(await failure(`UPDATE credit_spends SET refunded_at = now() WHERE capture_id = $1`, [CAPTURE_A2])).toMatch(
      /credit_spends_refund_has_reason/,
    );
    const done = await c.query(
      `UPDATE credit_spends SET refunded_at = now(), refund_reason = 'unreadable' WHERE capture_id = $1 RETURNING id`,
      [CAPTURE_A2],
    );
    expect(done.rows).toHaveLength(1);
    expect(await failure(`DELETE FROM credit_spends`)).toMatch(/permission denied/);

    // From another tenant's context the worker reaches nothing of A's.
    await as('app_worker', B);
    const none = await c.query(
      `UPDATE credit_spends SET refunded_at = now(), refund_reason = 'unreadable' WHERE capture_id = $1 RETURNING id`,
      [CAPTURE_A1],
    );
    expect(none.rows).toHaveLength(0);
  });

  it('keeps the spend when its capture is deleted', async () => {
    await c.query('RESET ROLE');
    await c.query(`DELETE FROM captures WHERE id = $1`, [CAPTURE_A1]);
    const rows = await c.query(`SELECT capture_id, paid FROM credit_spends WHERE tenant_id = $1 AND grant_id = $2`, [
      A,
      BOUGHT_GRANT,
    ]);
    expect(rows.rows).toEqual([{ capture_id: null, paid: true }]);
  });

  it('lets the outbox hold skipped_free, and still refuses an unknown status', async () => {
    await c.query('RESET ROLE');
    const def = await c.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'yourtal_outbox_status'`,
    );
    expect(def.rows[0]!.def).toContain('skipped_free');
    expect(def.rows[0]!.def).toContain('skipped_duplicate');
    const policy = await c.query<{ with_check: string }>(
      `SELECT with_check FROM pg_policies WHERE tablename = 'yourtal_outbox' AND policyname = 'yourtal_outbox_self_insert'`,
    );
    expect(policy.rows[0]!.with_check).toMatch(/'pending'.*'skipped_duplicate'.*'skipped_free'/s);
    expect(policy.rows[0]!.with_check).not.toMatch(/'sent'/);
  });
});
