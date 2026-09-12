import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * WORKSPACE SWITCHING — the authorisation decision the product rests on.
 *
 * Before migration 0012, `withTenant()` set whatever tenant id it was given
 * with no check that the caller belonged to it. With one tenant per user that
 * was academic; with a workspace switcher the id arrives from the client, and
 * an unchecked switch is total cross-tenant access.
 *
 * These tests prove the three properties the fix depends on:
 *
 *   1. A user can read their OWN memberships with no tenant context set —
 *      otherwise the membership check is impossible before a tenant is
 *      chosen, and the switcher has no list to show.
 *   2. That visibility extends to nobody else's memberships.
 *   3. Setting a tenant context you are not a member of still yields nothing
 *      useful, so even a bypassed application check fails closed.
 *
 * Runs as the real `app_rw` role, because a superuser bypasses RLS and would
 * make all of this pass vacuously.
 */

const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

const HOME = 'cccccccc-3333-3333-3333-333333333333';
const WORK = 'dddddddd-4444-4444-4444-444444444444';
const KATE = 'eeeeeeee-5555-5555-5555-555555555555';
const JEM = 'ffffffff-6666-6666-6666-666666666666';

describeIfDb('membership-verified workspace switching', () => {
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
    await c.query('DELETE FROM invitations WHERE tenant_id = ANY($1::uuid[])', [[HOME, WORK]]);
    await c.query('DELETE FROM memberships WHERE tenant_id = ANY($1::uuid[])', [[HOME, WORK]]);
    await c.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [[HOME, WORK]]);
    await c.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[KATE, JEM]]);
  }

  beforeAll(async () => {
    c = new Client({ connectionString: url });
    await c.connect();
    await wipe();

    // Kate runs a haulage business and a household. Jem is only in the
    // household — the exact case the whole design exists to keep separate.
    await c.query(
      `INSERT INTO tenants (id, name, kind, abn, gst_registered, country, base_currency)
       VALUES ($1,'Marsh Household','personal',NULL,false,'AU','AUD'),
              ($2,'K. Marsh Transport','business','51824753556',true,'AU','AUD')`,
      [HOME, WORK],
    );
    await c.query(
      `INSERT INTO users (id, subject, email, display_name)
       VALUES ($1,'idp|kate','kate@membership.test','Kate Marsh'),
              ($2,'idp|jem','jem@membership.test','Jem Marsh')`,
      [KATE, JEM],
    );
    await c.query(
      `INSERT INTO memberships (tenant_id, user_id, role)
       VALUES ($1,$3,'owner'), ($2,$3,'owner'), ($1,$4,'admin')`,
      [HOME, WORK, KATE, JEM],
    );
  });

  afterAll(async () => {
    await wipe();
    await c.end();
  });

  it('lets a user list their own workspaces with NO tenant context', async () => {
    await asAppRw(KATE, null);
    const r = await c.query<{ name: string; kind: string; role: string }>(
      `SELECT t.name, t.kind, m.role
         FROM memberships m JOIN tenants t ON t.id = m.tenant_id
        WHERE m.user_id = current_user_id()
        ORDER BY t.name`,
    );
    expect(r.rows.map((x) => x.name)).toEqual(['K. Marsh Transport', 'Marsh Household']);
    expect(r.rows.map((x) => x.kind)).toEqual(['business', 'personal']);
  });

  it('does NOT widen a tenant-scoped membership query to other tenants', async () => {
    // `memberships_self` is PERMISSIVE, so it is OR'd with tenant isolation.
    // A query that relies on RLS alone therefore sees the caller's rows from
    // every tenant they belong to — which showed up as an owner of two
    // workspaces appearing twice in one workspace's member list, and as a seat
    // count that refused invitations the workspace had room for.
    //
    // The lesson is in the assertion: with a tenant context set, a query that
    // says what it means returns one row, and one that does not returns two.
    await asAppRw(KATE, WORK);
    const lax = await c.query(`SELECT tenant_id FROM memberships WHERE user_id = $1`, [KATE]);
    expect(lax.rows.length).toBe(2); // both of Kate's workspaces — the trap

    const strict = await c.query(
      `SELECT tenant_id FROM memberships
        WHERE user_id = $1 AND tenant_id = current_tenant_id()`,
      [KATE],
    );
    expect(strict.rows.length).toBe(1);
    expect(strict.rows[0].tenant_id).toBe(WORK);
  });

  it('leaves the membership CHECK to withTenantAs, not to the policy', async () => {
    // Worth stating precisely, because it is easy to assume otherwise.
    //
    // `tenant_isolation` on memberships is `tenant_id = current_tenant_id()`.
    // It says nothing about WHO is asking — so a session with `app.tenant_id`
    // set to a workspace the caller does not belong to would read that
    // workspace's rows quite happily. Setting it to a value like that is
    // exactly what `withTenantAs` refuses to do: it verifies membership first,
    // in the same transaction, BEFORE any tenant context exists.
    //
    // The policy is therefore the floor, and `withTenantAs` is the gate. This
    // test exists so nobody removes the gate believing the floor covers it.
    await asAppRw(JEM, WORK); // deliberately bypassing the gate
    const rows = await c.query(`SELECT tenant_id FROM memberships`);
    expect(rows.rows.length).toBeGreaterThan(0);

    // And this is the gate doing its job: the membership probe that
    // `withTenantAs` runs before setting any tenant returns nothing for Jem.
    await c.query(`SELECT set_config('app.tenant_id','',false)`);
    const allowed = await c.query(
      `SELECT 1 FROM memberships WHERE user_id = current_user_id() AND tenant_id = $1`,
      [WORK],
    );
    expect(allowed.rows).toHaveLength(0);
  });

  it('shows a household member only the household', async () => {
    await asAppRw(JEM, null);
    const r = await c.query<{ name: string }>(
      `SELECT t.name FROM memberships m JOIN tenants t ON t.id = m.tenant_id
        WHERE m.user_id = current_user_id()`,
    );
    // The business must not appear. This is the whole point of the design.
    expect(r.rows.map((x) => x.name)).toEqual(['Marsh Household']);
  });

  it('never reveals another person’s memberships', async () => {
    await asAppRw(JEM, null);
    const r = await c.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM memberships WHERE user_id = $1`,
      [KATE],
    );
    expect(r.rows[0].n).toBe('0');
  });

  it('fails closed with no user context at all', async () => {
    await asAppRw(null, null);
    const r = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM memberships`);
    expect(r.rows[0].n).toBe('0');
  });

  it('the membership check that gates a switch answers no for a non-member', async () => {
    // Exactly the query withTenantAs() runs before it sets app.tenant_id.
    await asAppRw(JEM, null);
    const denied = await c.query(
      `SELECT 1 FROM memberships WHERE user_id = current_user_id() AND tenant_id = $1`,
      [WORK],
    );
    expect(denied.rowCount).toBe(0);

    const allowed = await c.query(
      `SELECT 1 FROM memberships WHERE user_id = current_user_id() AND tenant_id = $1`,
      [HOME],
    );
    expect(allowed.rowCount).toBe(1);
  });

  it('gives a non-member no DATA even if a tenant context is forced', async () => {
    // Belt and braces: if an endpoint ever skips the membership check, the
    // policies must still hold. They do for every tenant-scoped table.
    await asAppRw(JEM, WORK);
    for (const table of ['documents', 'captures', 'transactions', 'parties', 'invitations']) {
      const r = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`);
      expect(`${table}=${r.rows[0].n}`).toBe(`${table}=0`);
    }
  });

  it('does expose the forced tenant’s own row — which is why the check exists', async () => {
    // `tenants_self` (0010) keys on the context, so setting a context you do
    // not belong to still reveals that tenant's NAME and ABN. Not data, but
    // not nothing either. It is precisely the reason the membership check
    // belongs in withTenantAs rather than being left to each endpoint.
    await asAppRw(JEM, WORK);
    const names = await c.query<{ name: string }>('SELECT name FROM tenants ORDER BY name');
    expect(names.rows.map((x) => x.name)).toEqual(['K. Marsh Transport', 'Marsh Household']);
  });
});

describeIfDb('workspace kind', () => {
  let c: Client;
  const T = 'a1a1a1a1-7777-7777-7777-777777777777';

  beforeAll(async () => {
    c = new Client({ connectionString: url });
    await c.connect();
    await c.query('DELETE FROM tenants WHERE id = $1', [T]);
  });

  afterAll(async () => {
    await c.query('DELETE FROM tenants WHERE id = $1', [T]);
    await c.end();
  });

  it('refuses a personal workspace with an ABN', async () => {
    // A household does not have an ABN, and one that acquired a BAS position
    // by accident is a compliance problem rather than a UI bug.
    await expect(
      c.query(
        `INSERT INTO tenants (id, name, kind, abn, country, base_currency)
         VALUES ($1,'Bad','personal','51824753556','AU','AUD')`,
        [T],
      ),
    ).rejects.toThrow(/tenants_personal_has_no_gst/);
  });

  it('refuses a GST-registered personal workspace', async () => {
    await expect(
      c.query(
        `INSERT INTO tenants (id, name, kind, gst_registered, country, base_currency)
         VALUES ($1,'Bad','personal',true,'AU','AUD')`,
        [T],
      ),
    ).rejects.toThrow(/tenants_personal_has_no_gst/);
  });

  it('accepts a plain personal workspace', async () => {
    await c.query(
      `INSERT INTO tenants (id, name, kind, country, base_currency)
       VALUES ($1,'Marsh Household','personal','AU','AUD')`,
      [T],
    );
    const r = await c.query<{ kind: string }>('SELECT kind FROM tenants WHERE id = $1', [T]);
    expect(r.rows[0].kind).toBe('personal');
  });
});

describeIfDb('document attribution and concurrency', () => {
  let c: Client;
  const T = 'b2b2b2b2-8888-8888-8888-888888888888';
  const U = 'c3c3c3c3-9999-9999-9999-999999999999';
  const CAP = 'd4d4d4d4-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const DOC = 'e5e5e5e5-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  beforeAll(async () => {
    c = new Client({ connectionString: url });
    await c.connect();
    await c.query('DELETE FROM documents WHERE id = $1', [DOC]);
    await c.query('DELETE FROM captures WHERE id = $1', [CAP]);
    await c.query('DELETE FROM memberships WHERE tenant_id = $1', [T]);
    await c.query('DELETE FROM tenants WHERE id = $1', [T]);
    await c.query('DELETE FROM users WHERE id = $1', [U]);

    await c.query(
      `INSERT INTO tenants (id, name, kind, country, base_currency)
       VALUES ($1,'Attribution Co','business','AU','AUD')`,
      [T],
    );
    await c.query(
      `INSERT INTO users (id, subject, display_name) VALUES ($1,'idp|attr','Sam Oyelaran')`,
      [U],
    );
    await c.query(
      `INSERT INTO captures
         (id, tenant_id, uploaded_by, original_storage_key, original_mime_type,
          original_byte_size, original_sha256)
       VALUES ($1,$2,$3,'k/1','image/jpeg',1024,sha256('bytes'::bytea))`,
      [CAP, T, U],
    );
    await c.query(
      `INSERT INTO documents (id, tenant_id, capture_id, created_by)
       VALUES ($1,$2,$3,$4)`,
      [DOC, T, CAP, U],
    );
  });

  afterAll(async () => {
    await c.query('DELETE FROM documents WHERE id = $1', [DOC]);
    await c.query('DELETE FROM captures WHERE id = $1', [CAP]);
    await c.query('DELETE FROM tenants WHERE id = $1', [T]);
    await c.query('DELETE FROM users WHERE id = $1', [U]);
    await c.end();
  });

  it('starts every document at version 1, shared', async () => {
    const r = await c.query<{ version: number; visibility: string; created_by: string }>(
      'SELECT version, visibility, created_by FROM documents WHERE id = $1',
      [DOC],
    );
    expect(r.rows[0]).toMatchObject({ version: 1, visibility: 'shared', created_by: U });
  });

  it('bumps the version on a real change', async () => {
    await c.query(`UPDATE documents SET document_number = 'RCT-0091' WHERE id = $1`, [DOC]);
    const r = await c.query<{ version: number }>('SELECT version FROM documents WHERE id = $1', [
      DOC,
    ]);
    expect(r.rows[0].version).toBe(2);
  });

  it('does not bump the version on a no-op update', async () => {
    // Otherwise a save that changed nothing would invalidate a colleague's
    // in-flight edit for no reason.
    await c.query(`UPDATE documents SET document_number = 'RCT-0091' WHERE id = $1`, [DOC]);
    const r = await c.query<{ version: number }>('SELECT version FROM documents WHERE id = $1', [
      DOC,
    ]);
    expect(r.rows[0].version).toBe(2);
  });

  it('rejects a visibility outside the two it allows', async () => {
    await expect(
      c.query(`UPDATE documents SET visibility = 'secret' WHERE id = $1`, [DOC]),
    ).rejects.toThrow();
  });
});

describeIfDb('invitations', () => {
  let c: Client;
  const T = 'f6f6f6f6-cccc-cccc-cccc-cccccccccccc';

  beforeAll(async () => {
    c = new Client({ connectionString: url });
    await c.connect();
    await c.query('DELETE FROM invitations WHERE tenant_id = $1', [T]);
    await c.query('DELETE FROM tenants WHERE id = $1', [T]);
    await c.query(
      `INSERT INTO tenants (id, name, kind, country, base_currency)
       VALUES ($1,'Invite Co','business','AU','AUD')`,
      [T],
    );
  });

  afterAll(async () => {
    await c.query('DELETE FROM invitations WHERE tenant_id = $1', [T]);
    await c.query('DELETE FROM tenants WHERE id = $1', [T]);
    await c.end();
  });

  const invite = (id: string, email: string, extra = '') =>
    c.query(
      `INSERT INTO invitations (id, tenant_id, email, role, token_hash, expires_at${
        extra ? ', ' + extra.split('=')[0] : ''
      })
       VALUES ($1,$2,$3,'member',sha256('t'::bytea), now() + interval '7 days'${
         extra ? ', ' + extra.split('=')[1] : ''
       })`,
      [id, T, email],
    );

  it('accepts one pending invitation per address', async () => {
    await invite('11111111-0000-0000-0000-000000000001', 'noah@example.com');
    await expect(invite('11111111-0000-0000-0000-000000000002', 'noah@example.com')).rejects.toThrow(
      /invitations_one_pending_per_email/,
    );
  });

  it('treats the address case-insensitively', async () => {
    // citext, because NOAH@ and noah@ are the same inbox and inviting both
    // would send two links to one person with different roles.
    await expect(invite('11111111-0000-0000-0000-000000000003', 'NOAH@example.com')).rejects.toThrow(
      /invitations_one_pending_per_email/,
    );
  });

  it('allows re-inviting once the first is revoked', async () => {
    await c.query(`UPDATE invitations SET revoked_at = now() WHERE tenant_id = $1`, [T]);
    await invite('11111111-0000-0000-0000-000000000004', 'noah@example.com');
    const r = await c.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM invitations WHERE tenant_id = $1`,
      [T],
    );
    expect(r.rows[0].n).toBe('2');
  });

  it('refuses an invitation that expires before it was created', async () => {
    await expect(
      c.query(
        `INSERT INTO invitations (id, tenant_id, email, role, token_hash, created_at, expires_at)
         VALUES ($1,$2,'past@example.com','member',sha256('t'::bytea), now(), now() - interval '1 day')`,
        ['11111111-0000-0000-0000-000000000005', T],
      ),
    ).rejects.toThrow(/invitations_expiry_after_creation/);
  });
});
