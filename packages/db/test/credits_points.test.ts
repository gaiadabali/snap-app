import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * CREDITS AND POINTS — migration 0024, `docs/ECOSYSTEM.md` D27.
 *
 * Three balances that look alike and are not: plan quota (tenant, resets),
 * credits (tenant, never resets), points (USER, never resets, redeemed in a
 * different app entirely). This file proves the refusals the design depends
 * on — by exercising them against a real Postgres, as the real application
 * role, never by reading the SQL and trusting it.
 *
 * Runs on a single connection so `SET ROLE` persists across statements, and
 * as `app_rw` rather than a superuser, which would bypass RLS entirely and
 * make every isolation assertion pass vacuously — the same reasoning as
 * `rls.test.ts` and `membership.test.ts`, which this file sits beside.
 *
 * Requires DATABASE_URL from `pnpm db:up && pnpm db:migrate`, connected as a
 * role that may CREATE tenants/users/memberships directly (a superuser, or
 * whatever `db:up` prints) — `app_rw` itself cannot insert a tenant row
 * (`tenants_self` requires a tenant context that cannot exist before the row
 * does; that gap is exactly why `workspace_create()` is SECURITY DEFINER).
 * Fixtures are therefore written before any `SET ROLE`, and every assertion
 * about RLS or grants happens after switching to `app_rw`.
 */

const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

const TENANT_A = '0a000000-c9ed-4000-8000-000000000001'; // this user's first workspace
const TENANT_B = '0a000000-c9ed-4000-8000-000000000002'; // a second workspace, same user
const USER = '0a000000-c9ed-4000-8000-000000000003';
const OTHER_USER = '0a000000-c9ed-4000-8000-000000000004';

describeIfDb('credits and points (migration 0024)', () => {
  let c: Client;

  async function asAppRw(userId: string | null, tenantId: string | null) {
    await c.query('RESET ROLE');
    await c.query('SET ROLE app_rw');
    await c.query(`SELECT set_config('app.user_id', $1, false)`, [userId ?? '']);
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId ?? '']);
  }

  async function wipe() {
    await c.query('RESET ROLE');
    await c.query(`SELECT set_config('app.tenant_id','',false)`);
    await c.query(`SELECT set_config('app.user_id','',false)`);
    await c.query('DELETE FROM point_ledger WHERE user_id = ANY($1::uuid[])', [[USER, OTHER_USER]]);
    await c.query('DELETE FROM credit_purchases WHERE tenant_id = ANY($1::uuid[])', [[TENANT_A, TENANT_B]]);
    await c.query('DELETE FROM usage_grants WHERE tenant_id = ANY($1::uuid[])', [[TENANT_A, TENANT_B]]);
    await c.query('DELETE FROM memberships WHERE tenant_id = ANY($1::uuid[])', [[TENANT_A, TENANT_B]]);
    await c.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [[TENANT_A, TENANT_B]]);
    await c.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[USER, OTHER_USER]]);
  }

  beforeAll(async () => {
    c = new Client({ connectionString: url });
    await c.connect();
    await wipe();

    await c.query(
      `INSERT INTO tenants (id, name, kind, country, base_currency)
       VALUES ($1,'First Workspace','business','AU','AUD'),
              ($2,'Second Workspace','business','AU','AUD')`,
      [TENANT_A, TENANT_B],
    );
    await c.query(
      `INSERT INTO users (id, subject, email, display_name)
       VALUES ($1,'idp|credits-user','credits-user@credits.test','Credits User'),
              ($2,'idp|credits-other','credits-other@credits.test','Other User')`,
      [USER, OTHER_USER],
    );
    // USER owns both tenants — the "second workspace" case the signup-bonus
    // idempotency test depends on. OTHER_USER belongs to neither: the
    // isolation tests depend on that too.
    await c.query(
      `INSERT INTO memberships (tenant_id, user_id, role)
       VALUES ($1,$3,'owner'), ($2,$3,'owner')`,
      [TENANT_A, TENANT_B, USER],
    );
  });

  afterAll(async () => {
    await wipe();
    await c.end();
  });

  describe('credit_packs — the catalogue', () => {
    it('is readable with no session context at all (USING (true))', async () => {
      await asAppRw(null, null);
      const r = await c.query<{ code: string }>(
        `SELECT code FROM credit_packs WHERE active ORDER BY sort_order`,
      );
      expect(r.rows.map((x) => x.code)).toEqual([
        'credits_10',
        'credits_50',
        'credits_100',
        'credits_200',
        'credits_500',
        'credits_1000',
      ]);
    });

    it('refuses a write — the catalogue is migration-owned', async () => {
      await asAppRw(USER, TENANT_A);
      await expect(
        c.query(`UPDATE credit_packs SET price_aud = 999 WHERE code = 'credits_10'`),
      ).rejects.toThrow(/permission denied/);
    });
  });

  describe('the free signup bonus is granted once per account, not once per workspace', () => {
    // Reproduces exactly the check `grantSignupBonusIfFirst`
    // (`apps/server/src/credits/credits.repo.ts`) runs before it ever writes:
    // walk every tenant this user belongs to, in that tenant's own RLS
    // context (usage_grants has no user column and fails closed with no
    // tenant set — there is no cross-tenant shortcut), and look for an
    // existing `source = 'signup_bonus'` row. This is the primitive the
    // idempotency guarantee rests on, so it is what gets exercised — not a
    // literal call into server code, which this package cannot import.
    async function hasSignupBonusAnywhere(userId: string, tenantIds: string[]): Promise<boolean> {
      for (const tenantId of tenantIds) {
        await asAppRw(userId, tenantId);
        const r = await c.query<{ found: boolean }>(
          `SELECT exists(
             SELECT 1 FROM usage_grants
              WHERE tenant_id = current_tenant_id() AND source = 'signup_bonus'
           ) AS found`,
        );
        if (r.rows[0]?.found) return true;
      }
      return false;
    }

    it('grants the bonus to the first tenant when none exists yet', async () => {
      expect(await hasSignupBonusAnywhere(USER, [TENANT_A, TENANT_B])).toBe(false);

      await asAppRw(USER, TENANT_A);
      await c.query(
        `INSERT INTO usage_grants (id, tenant_id, metric, amount, remaining, source)
         VALUES (gen_random_uuid(), current_tenant_id(), 'scans', 10, 10, 'signup_bonus')`,
      );

      const r = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM usage_grants
          WHERE tenant_id = current_tenant_id() AND source = 'signup_bonus'`,
      );
      expect(r.rows[0]!.n).toBe('1');
    });

    it('a second workspace for the SAME user does not get a second bonus', async () => {
      // TENANT_A already has one, from the previous test. The check must see
      // it from TENANT_B's own context by walking the user's memberships —
      // this is the exact race a retried onboarding request, or a second
      // workspace, would hit if the check only ever looked at the tenant
      // being created.
      expect(await hasSignupBonusAnywhere(USER, [TENANT_B, TENANT_A])).toBe(true);

      // So the application never even attempts the INSERT for TENANT_B. The
      // database's own state proves it stayed that way:
      await asAppRw(USER, TENANT_B);
      const r = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM usage_grants
          WHERE tenant_id = current_tenant_id() AND source = 'signup_bonus'`,
      );
      expect(r.rows[0]!.n).toBe('0');

      // And the account's total across every workspace it owns is still
      // exactly one — never zero (missed entirely) and never two (granted
      // twice).
      let total = 0;
      for (const t of [TENANT_A, TENANT_B]) {
        await asAppRw(USER, t);
        const n = await c.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM usage_grants
            WHERE tenant_id = current_tenant_id() AND source = 'signup_bonus'`,
        );
        total += Number(n.rows[0]!.n);
      }
      expect(total).toBe(1);
    });

    it('the RLS floor alone does not check membership — withTenantAs is the gate', async () => {
      // `usage_grants`' policy is `tenant_isolation`: `tenant_id =
      // current_tenant_id()`, the same predicate every tenant-scoped table
      // gets (migration 0010). It says nothing about WHO is asking, so
      // forcing a tenant context this user does not belong to still returns
      // that tenant's grants — the exact lesson `membership.test.ts` proves
      // for `memberships` itself. The real boundary is `withTenantAs`'s
      // membership check, which runs BEFORE any tenant context is set and
      // which application code can never route around.
      await asAppRw(OTHER_USER, TENANT_A);
      const floor = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM usage_grants`);
      expect(Number(floor.rows[0]!.n)).toBeGreaterThan(0); // the floor alone does not stop this

      // The gate: exactly the query `withTenantAs` runs before it ever calls
      // `set_config('app.tenant_id', …)`. For OTHER_USER and TENANT_A it
      // finds nothing, which is what makes `withTenantAs` refuse before
      // `usage_grants` is ever queried in the real application path.
      await c.query(`SELECT set_config('app.tenant_id','',false)`);
      const gate = await c.query(
        `SELECT 1 FROM memberships WHERE user_id = current_user_id() AND tenant_id = $1`,
        [TENANT_A],
      );
      expect(gate.rowCount).toBe(0);
    });
  });

  describe('point_ledger — one point per scan, enforced by the index', () => {
    const CAPTURE_REF = 'cap-0001';

    it('accepts the first point for a scan', async () => {
      await asAppRw(USER, null); // points are USER-scoped; no tenant needed
      await c.query(
        `INSERT INTO point_ledger (id, user_id, delta, reason, ref)
         VALUES (gen_random_uuid(), current_user_id(), 1, 'scan', $1)`,
        [CAPTURE_REF],
      );
      const r = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM point_ledger
          WHERE user_id = current_user_id() AND ref = $1`,
        [CAPTURE_REF],
      );
      expect(r.rows[0]!.n).toBe('1');
    });

    it('rejects a duplicate point for the SAME scan — a retried or re-run capture cannot pay twice', async () => {
      await asAppRw(USER, null);
      await expect(
        c.query(
          `INSERT INTO point_ledger (id, user_id, delta, reason, ref)
           VALUES (gen_random_uuid(), current_user_id(), 1, 'scan', $1)`,
          [CAPTURE_REF],
        ),
      ).rejects.toThrow(/point_ledger_scan_once_idx/);
    });

    it('allows a DIFFERENT ref for the same user — a second, distinct scan is not blocked', async () => {
      await asAppRw(USER, null);
      await c.query(
        `INSERT INTO point_ledger (id, user_id, delta, reason, ref)
         VALUES (gen_random_uuid(), current_user_id(), 1, 'scan', 'cap-0002')`,
      );
      const r = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM point_ledger WHERE user_id = current_user_id()`,
      );
      expect(r.rows[0]!.n).toBe('2');
    });

    it('allows a non-scan reason to reuse the same ref — the partial index only guards reason = scan', async () => {
      await asAppRw(USER, null);
      await c.query(
        `INSERT INTO point_ledger (id, user_id, delta, reason, ref)
         VALUES (gen_random_uuid(), current_user_id(), -1, 'adjustment', $1)`,
        [CAPTURE_REF],
      );
      const r = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM point_ledger WHERE user_id = current_user_id() AND ref = $1`,
        [CAPTURE_REF],
      );
      expect(r.rows[0]!.n).toBe('2'); // the original scan row, plus this one
    });
  });

  describe('point_ledger — append-only, by grant rather than by convention', () => {
    it('app_rw cannot UPDATE a row it can insert', async () => {
      await asAppRw(USER, null);
      await expect(
        c.query(`UPDATE point_ledger SET delta = 99 WHERE user_id = current_user_id()`),
      ).rejects.toThrow(/permission denied/);
    });

    it('app_rw cannot DELETE a row it can insert', async () => {
      await asAppRw(USER, null);
      await expect(
        c.query(`DELETE FROM point_ledger WHERE user_id = current_user_id()`),
      ).rejects.toThrow(/permission denied/);
    });
  });

  describe('point_ledger — RLS is USER-scoped, not tenant-scoped', () => {
    it('one user cannot read another user’s points, even with a tenant set', async () => {
      await asAppRw(OTHER_USER, TENANT_A);
      const r = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM point_ledger WHERE user_id = $1`,
        [USER],
      );
      expect(r.rows[0]!.n).toBe('0');
    });

    it('a user reads their own points with NO tenant context at all', async () => {
      await asAppRw(USER, null);
      const r = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM point_ledger WHERE user_id = current_user_id()`,
      );
      expect(Number(r.rows[0]!.n)).toBeGreaterThan(0);
    });

    it('fails closed with no user context at all', async () => {
      await asAppRw(null, null);
      const r = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM point_ledger`);
      expect(r.rows[0]!.n).toBe('0');
    });
  });

  describe('credit_purchases — a purchase cannot reach paid without a grant', () => {
    const PURCHASE = '0a000000-c9ed-4000-8000-0000000000a1';

    it('starts pending, no grant', async () => {
      await asAppRw(USER, TENANT_A);
      await c.query(
        `INSERT INTO credit_purchases (id, tenant_id, purchased_by, pack_code, credits, price_aud, status, provider)
         VALUES ($1, current_tenant_id(), current_user_id(), 'credits_10', 10, 0.15, 'pending', 'manual')`,
        [PURCHASE],
      );
      const r = await c.query<{ status: string; grant_id: string | null }>(
        `SELECT status, grant_id FROM credit_purchases WHERE id = $1`,
        [PURCHASE],
      );
      expect(r.rows[0]).toMatchObject({ status: 'pending', grant_id: null });
    });

    it('refuses paid with no grant_id and no paid_at', async () => {
      await asAppRw(USER, TENANT_A);
      await expect(
        c.query(`UPDATE credit_purchases SET status = 'paid' WHERE id = $1`, [PURCHASE]),
      ).rejects.toThrow(/purchase_paid_has_time|purchase_paid_has_grant/);
    });

    it('refuses paid with paid_at set but still no grant', async () => {
      await asAppRw(USER, TENANT_A);
      await expect(
        c.query(
          `UPDATE credit_purchases SET status = 'paid', paid_at = now() WHERE id = $1`,
          [PURCHASE],
        ),
      ).rejects.toThrow(/purchase_paid_has_grant/);
    });

    it('accepts paid once a grant exists and is linked — the fulfilment shape', async () => {
      await asAppRw(USER, TENANT_A);
      const grant = await c.query<{ id: string }>(
        `INSERT INTO usage_grants (id, tenant_id, metric, amount, remaining, source)
         VALUES (gen_random_uuid(), current_tenant_id(), 'scans', 10, 10, 'topup_pack')
         RETURNING id`,
      );
      const grantId = grant.rows[0]!.id;
      await c.query(
        `UPDATE credit_purchases SET status = 'paid', paid_at = now(), grant_id = $2 WHERE id = $1`,
        [PURCHASE, grantId],
      );
      const r = await c.query<{ status: string; grant_id: string }>(
        `SELECT status, grant_id FROM credit_purchases WHERE id = $1`,
        [PURCHASE],
      );
      expect(r.rows[0]).toMatchObject({ status: 'paid', grant_id: grantId });
    });
  });
});
