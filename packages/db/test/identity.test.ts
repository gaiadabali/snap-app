import { createHash, randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * THE IDENTITY PLANE — migration 0015.
 *
 * Four operations necessarily happen before any tenant context exists: signing
 * in, reading your own row, creating a workspace, and accepting an invitation.
 * No RLS policy can honestly permit them, so each is a SECURITY DEFINER
 * function owned by a NOLOGIN role, and the function states its own rule.
 *
 * This file exists because of how the original bug was found, which is to say
 * not at all: the server was connecting as `postgres`, a superuser bypasses RLS
 * entirely, and so every test that "proved" isolation proved nothing. Every
 * assertion here therefore runs as `app_rw` and the first two check the
 * negative case — that the raw statements these functions replace are actually
 * refused. If those two ever start passing, the suite has gone blind again.
 */

const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

const TENANT = 'dddddddd-4444-4444-8444-444444444444';
const OUTSIDER = 'eeeeeeee-5555-4555-8555-555555555555';

describeIfDb('identity plane', () => {
  let c: Client;

  async function asAppRw(userId: string | null) {
    await c.query('RESET ROLE');
    await c.query('SET ROLE app_rw');
    await c.query(`SELECT set_config('app.user_id', $1, false)`, [userId ?? '']);
    await c.query(`SELECT set_config('app.tenant_id', '', false)`);
  }

  async function wipe() {
    await c.query('RESET ROLE');
    await c.query(`SELECT set_config('app.user_id','',false)`);
    await c.query(`SELECT set_config('app.tenant_id','',false)`);
    await c.query('DELETE FROM invitations WHERE email LIKE $1', ['%@identity.test']);
    await c.query(`DELETE FROM subscriptions WHERE tenant_id IN (SELECT id FROM tenants WHERE name LIKE 'Identity Test%')`);
    await c.query(
      `DELETE FROM memberships WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@identity.test')`,
    );
    await c.query(`DELETE FROM memberships WHERE tenant_id = $1`, [TENANT]);
    await c.query(`DELETE FROM tenants WHERE id = $1 OR name LIKE 'Identity Test%'`, [TENANT]);
    await c.query('DELETE FROM users WHERE email LIKE $1', ['%@identity.test']);
    await c.query('DELETE FROM users WHERE id = $1', [OUTSIDER]);
  }

  beforeAll(async () => {
    c = new Client({ connectionString: url });
    await c.connect();
    await wipe();
  });

  afterAll(async () => {
    await wipe();
    await c.end();
  });

  /* ── The negative case: the raw statements really are refused ─────────── */

  it('app_rw cannot read the users table directly with no tenant context', async () => {
    await asAppRw(null);
    const r = await c.query<{ n: string }>('SELECT count(*)::text AS n FROM users');
    // Not an error — RLS filters rather than refuses. Zero rows IS the check:
    // if this is ever non-zero the connection is bypassing policy.
    expect(Number(r.rows[0].n)).toBe(0);
  });

  it('app_rw cannot insert a user directly', async () => {
    await asAppRw(null);
    await expect(
      c.query(`INSERT INTO users (id, subject, email) VALUES ($1, 'x', 'raw@identity.test')`, [
        randomUUID(),
      ]),
    ).rejects.toThrow();
  });

  it('app_rw cannot insert a tenant directly', async () => {
    await asAppRw(null);
    await expect(
      c.query(`INSERT INTO tenants (id, name, kind) VALUES ($1, 'Identity Test Raw', 'business')`, [
        randomUUID(),
      ]),
    ).rejects.toThrow();
  });

  /* ── 1. Signing in ────────────────────────────────────────────────────── */

  it('creates an account for a new address, and returns the same one next time', async () => {
    await asAppRw(null);
    const first = await c.query<{ user_id: string; display_name: string }>(
      `SELECT * FROM identity_sign_in('dev|kate', 'kate@identity.test', 'Kate Marsh')`,
    );
    expect(first.rows).toHaveLength(1);
    const id = first.rows[0].user_id;

    // Same inbox, different capitalisation — citext, so it is the same person.
    const second = await c.query<{ user_id: string; display_name: string }>(
      `SELECT * FROM identity_sign_in('dev|kate', 'KATE@identity.test', 'Someone Else')`,
    );
    expect(second.rows[0].user_id).toBe(id);
    // A second sign-in must never rewrite a name the person already has.
    expect(second.rows[0].display_name).toBe('Kate Marsh');
  });

  it('reads your own row by id, and nothing by guessing', async () => {
    await asAppRw(null);
    const made = await c.query<{ user_id: string }>(
      `SELECT * FROM identity_sign_in('dev|jem', 'jem@identity.test', 'Jem Marsh')`,
    );
    const found = await c.query(`SELECT * FROM identity_user($1)`, [made.rows[0].user_id]);
    expect(found.rows).toHaveLength(1);
    const missing = await c.query(`SELECT * FROM identity_user($1)`, [randomUUID()]);
    expect(missing.rows).toHaveLength(0);
  });

  /* ── 2. Creating a workspace ──────────────────────────────────────────── */

  it('refuses to create a workspace for nobody', async () => {
    await asAppRw(null);
    await expect(
      c.query(`SELECT workspace_create('Identity Test Orphan', 'business', NULL)`),
    ).rejects.toThrow(/app\.user_id is not set/);
  });

  it('creates the tenant and its owner membership together', async () => {
    await asAppRw(null);
    const kate = await c.query<{ user_id: string }>(
      `SELECT * FROM identity_sign_in('dev|kate', 'kate@identity.test', 'Kate Marsh')`,
    );
    await asAppRw(kate.rows[0].user_id);
    const made = await c.query<{ workspace_create: string }>(
      `SELECT workspace_create('Identity Test Haulage', 'business', '51824753556')`,
    );
    const tenantId = made.rows[0].workspace_create;

    // Visible through the caller's own membership, with no tenant context —
    // which is exactly what the workspace switcher does.
    const mine = await c.query<{ id: string; role: string }>(
      `SELECT t.id, m.role FROM memberships m JOIN tenants t ON t.id = m.tenant_id
        WHERE m.user_id = current_user_id() AND t.id = $1`,
      [tenantId],
    );
    expect(mine.rows).toHaveLength(1);
    expect(mine.rows[0].role).toBe('owner');
  });

  /* ── 3. Accepting an invitation ───────────────────────────────────────── */

  describe('invitations', () => {
    let tenantId: string;
    let kateId: string;
    let jemId: string;

    /** Issues an invitation as the owner and returns the raw token. */
    async function invite(email: string, role = 'member'): Promise<string> {
      const token = randomUUID();
      const hash = createHash('sha256').update(token).digest();
      await c.query('RESET ROLE');
      // `invitations_one_pending_per_email` permits exactly one live
      // invitation per address per workspace, which is the product rule; these
      // tests issue several in a row, so each clears the last.
      await c.query(
        `DELETE FROM invitations
          WHERE tenant_id = $1 AND email = $2 AND accepted_at IS NULL AND revoked_at IS NULL`,
        [tenantId, email],
      );
      await c.query(
        `INSERT INTO invitations (id, tenant_id, email, role, token_hash, invited_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, now() + interval '7 days')`,
        [randomUUID(), tenantId, email, role, hash, kateId],
      );
      return token;
    }

    const accept = (token: string) =>
      c.query<{ tenant_id: string; role: string }>(`SELECT * FROM invitation_accept($1)`, [
        createHash('sha256').update(token).digest(),
      ]);

    beforeAll(async () => {
      await asAppRw(null);
      kateId = (
        await c.query<{ user_id: string }>(
          `SELECT * FROM identity_sign_in('dev|kate', 'kate@identity.test', 'Kate Marsh')`,
        )
      ).rows[0].user_id;
      jemId = (
        await c.query<{ user_id: string }>(
          `SELECT * FROM identity_sign_in('dev|jem', 'jem@identity.test', 'Jem Marsh')`,
        )
      ).rows[0].user_id;

      await asAppRw(kateId);
      tenantId = (
        await c.query<{ workspace_create: string }>(
          `SELECT workspace_create('Identity Test Household', 'personal', NULL)`,
        )
      ).rows[0].workspace_create;

      // A workspace with no subscription gets the one-seat default, so without
      // this every join below would correctly be refused. The seat limit has
      // its own test further down, on a tenant deliberately left on the default.
      await c.query('RESET ROLE');
      await c.query(
        `INSERT INTO subscriptions (id, tenant_id, plan_id, status, provider,
                                    current_period_start, current_period_end)
         SELECT $1, $2, p.id, 'active', 'manual', now(), now() + interval '30 days'
           FROM plans p ORDER BY p.seat_limit DESC LIMIT 1`,
        [randomUUID(), tenantId],
      );
    });

    it('lets the invited address join', async () => {
      const token = await invite('jem@identity.test', 'admin');
      await asAppRw(jemId);
      const joined = await accept(token);
      expect(joined.rows[0]).toMatchObject({ tenant_id: tenantId, role: 'admin' });
    });

    it('will not admit a different person holding the same link', async () => {
      const token = await invite('someone-else@identity.test');
      await asAppRw(jemId);
      await expect(accept(token)).rejects.toThrow(/sent to a different address/);
    });

    it('refuses a token that has already been used', async () => {
      const token = await invite('jem@identity.test');
      await asAppRw(jemId);
      await accept(token); // already a member; accepted and no-ops
      await expect(accept(token)).rejects.toThrow(/no longer valid/);
    });

    it('does not change the role of someone who is already in', async () => {
      // Jem is an admin from the first test. A fresh 'readonly' invitation must
      // not quietly demote them.
      const token = await invite('jem@identity.test', 'readonly');
      await asAppRw(jemId);
      const again = await accept(token);
      expect(again.rows[0].role).toBe('admin');
    });

    it('refuses an expired invitation', async () => {
      const token = randomUUID();
      await c.query('RESET ROLE');
      await c.query(
        `DELETE FROM invitations WHERE tenant_id = $1 AND email = 'jem@identity.test'
           AND accepted_at IS NULL AND revoked_at IS NULL`,
        [tenantId],
      );
      await c.query(
        `INSERT INTO invitations (id, tenant_id, email, role, token_hash, invited_by, created_at, expires_at)
         VALUES ($1, $2, 'jem@identity.test', 'member', $3, $4, now() - interval '9 days', now() - interval '2 days')`,
        [randomUUID(), tenantId, createHash('sha256').update(token).digest(), kateId],
      );
      await asAppRw(jemId);
      await expect(accept(token)).rejects.toThrow(/no longer valid/);
    });

    it('refuses a revoked invitation', async () => {
      const token = await invite('jem@identity.test');
      await c.query('RESET ROLE');
      await c.query(`UPDATE invitations SET revoked_at = now() WHERE token_hash = $1`, [
        createHash('sha256').update(token).digest(),
      ]);
      await asAppRw(jemId);
      await expect(accept(token)).rejects.toThrow(/no longer valid/);
    });

    it('will not exceed the seat limit', async () => {
      // No subscription on this fixture tenant, so the limit is the default of
      // one seat — and Kate already holds it.
      const outsiderId = (
        await (async () => {
          await asAppRw(null);
          return c.query<{ user_id: string }>(
            `SELECT * FROM identity_sign_in('dev|out', 'outsider@identity.test', 'Outsider')`,
          );
        })()
      ).rows[0].user_id;

      await asAppRw(kateId);
      const solo = (
        await c.query<{ workspace_create: string }>(
          `SELECT workspace_create('Identity Test Solo', 'personal', NULL)`,
        )
      ).rows[0].workspace_create;

      const token = randomUUID();
      await c.query('RESET ROLE');
      await c.query(
        `INSERT INTO invitations (id, tenant_id, email, role, token_hash, invited_by, expires_at)
         VALUES ($1, $2, 'outsider@identity.test', 'member', $3, $4, now() + interval '7 days')`,
        [randomUUID(), solo, createHash('sha256').update(token).digest(), kateId],
      );
      await asAppRw(outsiderId);
      await expect(accept(token)).rejects.toThrow(/no seats left/);
    });

    it('refuses to accept anything for nobody', async () => {
      const token = await invite('jem@identity.test');
      await asAppRw(null);
      await expect(accept(token)).rejects.toThrow(/app\.user_id is not set/);
    });
  });
});
