import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb, getDb } from '../db.js';
import { provisionTenant, wipeTenant } from '../test-support/tenant.js';
import {
  CreditPurchaseNotPendingError,
  fulfilCreditPurchase,
  getCreditBalance,
  grantSignupBonusIfFirst,
  listCreditPacks,
  listCreditPurchases,
  startCreditPurchase,
} from './credits.repo.js';

/**
 * `credits.repo.ts` — against a real Postgres, as the real `app_rw`-backed
 * application role (`DATABASE_URL`), with a privileged connection
 * (`ADMIN_DATABASE_URL`, falling back to `DATABASE_URL`) only for fixtures.
 * Same shape as `extraction/reextraction.test.ts` and `repo.test.ts`.
 *
 * `docs/ECOSYSTEM.md` D27 is the design this proves: credits are bought or
 * granted free, never reset, and are strictly separate from both the plan
 * quota and points.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TENANT = 'de000000-0000-4000-8000-000000000001';
const OWNER = 'de000000-0000-4000-8000-0000000000a1';

describeIfDb('credits.repo', () => {
  let admin: Client;

  beforeAll(async () => {
    admin = await provisionTenant({
      tenantId: TENANT,
      name: 'Credits repo test co',
      users: [{ id: OWNER, role: 'owner', subject: 'test|credits-owner', email: 'owner@credits-repo.test' }],
    });
  });

  afterAll(async () => {
    await admin.query('DELETE FROM credit_purchases WHERE tenant_id = $1', [TENANT]);
    await admin.query('DELETE FROM usage_grants WHERE tenant_id = $1', [TENANT]);
    await wipeTenant(admin, TENANT, [OWNER]);
    await admin.end();
    await closeDb();
  });

  it('lists the seeded active packs in display order', async () => {
    const packs = await listCreditPacks(OWNER, TENANT);
    expect(packs.map((p) => p.code)).toEqual([
      'credits_10',
      'credits_50',
      'credits_100',
      'credits_200',
      'credits_500',
      'credits_1000',
    ]);
    // Money crosses as a string, never a parsed number.
    expect(typeof packs[0]!.price_aud).toBe('string');
    expect(packs[0]!.price_aud).toMatch(/^\d+\.\d+$/);
  });

  it('the credits balance starts at zero and rises only with a live grant', async () => {
    expect(await getCreditBalance(OWNER, TENANT)).toBe(0);

    await admin.query(
      `INSERT INTO usage_grants (id, tenant_id, metric, amount, remaining, source)
       VALUES ($1, $2, 'scans', 50, 30, 'topup_pack')`,
      [randomUUID(), TENANT],
    );
    expect(await getCreditBalance(OWNER, TENANT)).toBe(30);

    // An expired grant does not count.
    await admin.query(
      `INSERT INTO usage_grants (id, tenant_id, metric, amount, remaining, source, expires_at)
       VALUES ($1, $2, 'scans', 10, 10, 'topup_pack', now() - interval '1 day')`,
      [randomUUID(), TENANT],
    );
    expect(await getCreditBalance(OWNER, TENANT)).toBe(30);
  });

  it('refuses to start a purchase against an unknown pack code', async () => {
    expect(await startCreditPurchase(OWNER, TENANT, 'not_a_real_pack')).toBeNull();
  });

  it('starts a purchase pending, with no grant — and fulfilling it grants the credits atomically', async () => {
    const started = await startCreditPurchase(OWNER, TENANT, 'credits_100');
    expect(started).toMatchObject({ pack_code: 'credits_100', credits: 100, status: 'pending', paid_at: null });

    /*
     * The purchase captures the CATALOGUE's price, read from the catalogue
     * rather than asserted as a literal.
     *
     * This line used to say `toBe('1.3000')` and broke the moment the packs
     * were repriced (migration 0027, cost x 3). That was the test's fault, not
     * the repricing's: a price is a business decision that will change again,
     * and hardcoding one here asserts the decision instead of the invariant.
     *
     * The invariant worth protecting is the one migration 0024 exists to
     * state — what was paid is recorded on the purchase and never read back
     * from a catalogue that may since have moved. That is what this compares.
     */
    const catalogue = await listCreditPacks(OWNER, TENANT);
    const pack = catalogue.find((row) => row.code === 'credits_100');
    expect(pack, 'credits_100 missing from the catalogue').toBeDefined();
    expect(started!.price_aud).toBe(pack!.price_aud);

    const before = await getCreditBalance(OWNER, TENANT);

    const fulfilled = await fulfilCreditPurchase(OWNER, TENANT, started!.id);
    expect(fulfilled).toMatchObject({ id: started!.id, status: 'paid', credits: 100 });
    expect(fulfilled!.paid_at).not.toBeNull();

    // The grant this purchase created actually moved the balance, by exactly
    // the pack's credit count.
    expect(await getCreditBalance(OWNER, TENANT)).toBe(before + 100);

    const history = await listCreditPurchases(OWNER, TENANT);
    expect(history.find((p) => p.id === started!.id)).toMatchObject({ status: 'paid' });
  });

  it('fulfilling an already-paid purchase is idempotent — it does not grant a second time', async () => {
    const started = await startCreditPurchase(OWNER, TENANT, 'credits_10');
    const first = await fulfilCreditPurchase(OWNER, TENANT, started!.id);
    const before = await getCreditBalance(OWNER, TENANT);

    const second = await fulfilCreditPurchase(OWNER, TENANT, started!.id);
    expect(second).toEqual(first);
    expect(await getCreditBalance(OWNER, TENANT)).toBe(before); // unchanged — no second grant
  });

  it('refuses to fulfil a purchase that is not pending (failed/refunded)', async () => {
    const started = await startCreditPurchase(OWNER, TENANT, 'credits_10');
    await admin.query(`UPDATE credit_purchases SET status = 'failed' WHERE id = $1`, [started!.id]);

    await expect(fulfilCreditPurchase(OWNER, TENANT, started!.id)).rejects.toBeInstanceOf(
      CreditPurchaseNotPendingError,
    );
  });

  it('returns null fulfilling a purchase that does not exist', async () => {
    expect(await fulfilCreditPurchase(OWNER, TENANT, randomUUID())).toBeNull();
  });
});

describeIfDb('grantSignupBonusIfFirst', () => {
  // A user with TWO tenants, provisioned by hand rather than through
  // `provisionTenant` twice — that helper wipes users by id at the start of
  // each call, which would delete the first tenant's membership out from
  // under it the moment the second tenant's fixture ran.
  let admin: Client;
  const TENANT_A = 'de000000-0000-4000-8000-000000000002';
  const TENANT_B = 'de000000-0000-4000-8000-000000000003';
  const USER = 'de000000-0000-4000-8000-0000000000b1';

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL });
    await admin.connect();
    await admin.query('DELETE FROM usage_grants WHERE tenant_id = ANY($1::uuid[])', [[TENANT_A, TENANT_B]]);
    await admin.query('DELETE FROM memberships WHERE tenant_id = ANY($1::uuid[])', [[TENANT_A, TENANT_B]]);
    await admin.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [[TENANT_A, TENANT_B]]);
    await admin.query('DELETE FROM users WHERE id = $1', [USER]);

    await admin.query(
      `INSERT INTO tenants (id, name, kind, country, base_currency)
       VALUES ($1,'Bonus Test A','business','AU','AUD'), ($2,'Bonus Test B','business','AU','AUD')`,
      [TENANT_A, TENANT_B],
    );
    await admin.query(
      `INSERT INTO users (id, subject, email, display_name) VALUES ($1,'test|signup-bonus','bonus@credits-repo.test','Bonus User')`,
      [USER],
    );
    await admin.query(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1,$2,'owner')`, [
      TENANT_A,
      USER,
    ]);
    // TENANT_B's membership is inserted per-test, right where `create()`
    // would have just inserted it via `workspace_create()` — before this
    // function is ever called for that tenant.
  });

  afterAll(async () => {
    await admin.query('DELETE FROM usage_grants WHERE tenant_id = ANY($1::uuid[])', [[TENANT_A, TENANT_B]]);
    await admin.query('DELETE FROM memberships WHERE tenant_id = ANY($1::uuid[])', [[TENANT_A, TENANT_B]]);
    await admin.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [[TENANT_A, TENANT_B]]);
    await admin.query('DELETE FROM users WHERE id = $1', [USER]);
    await admin.end();
    await closeDb();
  });

  it('grants ten scans to the first tenant a user creates', async () => {
    const result = await grantSignupBonusIfFirst(USER, TENANT_A);
    expect(result).toEqual({ granted: true });

    const grant = await admin.query<{ amount: number; remaining: number; source: string }>(
      `SELECT amount, remaining, source FROM usage_grants WHERE tenant_id = $1 AND source = 'signup_bonus'`,
      [TENANT_A],
    );
    expect(grant.rows).toEqual([{ amount: 10, remaining: 10, source: 'signup_bonus' }]);
  });

  it('does not grant a second bonus for a second workspace the same user creates', async () => {
    // Mirrors `workspace_create()` having just run for TENANT_B.
    await admin.query(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1,$2,'owner')`, [
      TENANT_B,
      USER,
    ]);

    const result = await grantSignupBonusIfFirst(USER, TENANT_B);
    expect(result).toEqual({ granted: false });

    const bonusesAcrossBothTenants = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM usage_grants
        WHERE tenant_id = ANY($1::uuid[]) AND source = 'signup_bonus'`,
      [[TENANT_A, TENANT_B]],
    );
    expect(bonusesAcrossBothTenants.rows[0]!.n).toBe('1'); // still just the one, from TENANT_A
  });

  it('is a no-op for a retried call against the SAME tenant', async () => {
    // The literal "retried request" case: the same call, run again.
    const result = await grantSignupBonusIfFirst(USER, TENANT_A);
    expect(result).toEqual({ granted: false });

    const n = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM usage_grants WHERE tenant_id = $1 AND source = 'signup_bonus'`,
      [TENANT_A],
    );
    expect(n.rows[0]!.n).toBe('1');
  });

  it('serialises two concurrent calls for the same user so exactly one grants', async () => {
    // A fresh user/tenant pair for this test alone, so it is not entangled
    // with the sequential assertions above.
    const raceUser = 'de000000-0000-4000-8000-0000000000c1';
    const raceTenant = 'de000000-0000-4000-8000-000000000004';
    await admin.query('DELETE FROM usage_grants WHERE tenant_id = $1', [raceTenant]);
    await admin.query('DELETE FROM memberships WHERE tenant_id = $1', [raceTenant]);
    await admin.query('DELETE FROM tenants WHERE id = $1', [raceTenant]);
    await admin.query('DELETE FROM users WHERE id = $1', [raceUser]);
    await admin.query(
      `INSERT INTO tenants (id, name, kind, country, base_currency) VALUES ($1,'Race Test','business','AU','AUD')`,
      [raceTenant],
    );
    await admin.query(
      `INSERT INTO users (id, subject, email) VALUES ($1,'test|race-user','race@credits-repo.test')`,
      [raceUser],
    );
    await admin.query(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1,$2,'owner')`, [
      raceTenant,
      raceUser,
    ]);

    // Two calls for the SAME user and tenant, fired together. Without the
    // advisory lock, both could see "no bonus yet" before either writes one.
    const [a, b] = await Promise.all([
      grantSignupBonusIfFirst(raceUser, raceTenant),
      grantSignupBonusIfFirst(raceUser, raceTenant),
    ]);
    expect([a.granted, b.granted].sort()).toEqual([false, true]);

    const n = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM usage_grants WHERE tenant_id = $1 AND source = 'signup_bonus'`,
      [raceTenant],
    );
    expect(n.rows[0]!.n).toBe('1');

    await admin.query('DELETE FROM usage_grants WHERE tenant_id = $1', [raceTenant]);
    await admin.query('DELETE FROM memberships WHERE tenant_id = $1', [raceTenant]);
    await admin.query('DELETE FROM tenants WHERE id = $1', [raceTenant]);
    await admin.query('DELETE FROM users WHERE id = $1', [raceUser]);
  });
});
