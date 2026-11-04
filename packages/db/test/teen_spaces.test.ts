import { createHash, randomBytes } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * TEEN SPACES — migration 0045 (group 3.10). As the real roles on one
 * connection (`SET ROLE`), never as the superuser, which bypasses RLS:
 *
 *   - joining makes a space the teen OWNS, with the parent read-only;
 *   - its membership is locked and the teen is in no other workspace;
 *   - it takes no grant, purchase or invitation of its own;
 *   - a teen's scan spends the parent's credit, once, and a refund gives it back;
 *   - ending access stamps the 30-day hold and ends the teen's sessions;
 *   - erasing the teen (0043) still works.
 */

const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

const FUND = '7ee70000-0000-4000-8000-00000000000f';
const PARENT = '7ee70000-0000-4000-8000-0000000000a1';
const TEEN = '7ee70000-0000-4000-8000-0000000000b1';
const OTHER = '7ee70000-0000-4000-8000-0000000000c1';
const INVITE = '7ee70000-0000-4000-8000-0000000000e1';
const FLOW = '7ee70000-0000-4000-8000-0000000000d1';
const GRANT = '7ee70000-0000-4000-8000-0000000000f1';
const CODE = 'a-join-code-not-a-secret';
const codeHash = createHash('sha256').update(CODE).digest();

describeIfDb('teen spaces (migration 0045)', () => {
  let c: Client;
  let space: string;

  async function as(role: 'app_rw' | 'app_worker', userId: string | null, tenantId: string | null) {
    await c.query('RESET ROLE');
    await c.query(`SET ROLE ${role}`);
    await c.query(`SELECT set_config('app.user_id', $1, false)`, [userId ?? '']);
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId ?? '']);
  }

  const failure = (sqlText: string, params: unknown[] = []) =>
    c.query(sqlText, params as never[]).then(
      () => null,
      (e: Error & { code?: string }) => `${e.code ?? ''} ${e.message}`,
    );

  async function wipe() {
    await c.query('RESET ROLE');
    await c.query(`SELECT set_config('app.tenant_id','',false), set_config('app.user_id','',false)`);
    const spaces = (await c.query('SELECT tenant_id FROM teen_spaces WHERE teen_user_id = $1', [TEEN])).rows.map(
      (r) => r.tenant_id as string,
    );
    const tenants = [FUND, ...spaces];
    await c.query('DELETE FROM teen_spaces WHERE tenant_id = ANY($1::uuid[])', [tenants]);
    await c.query('DELETE FROM teen_invites WHERE parent_user_id = $1', [PARENT]);
    await c.query('DELETE FROM credit_spends WHERE tenant_id = ANY($1::uuid[])', [tenants]);
    await c.query('DELETE FROM captures WHERE tenant_id = ANY($1::uuid[])', [tenants]);
    await c.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [tenants]);
    await c.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[PARENT, TEEN, OTHER]]);
  }

  beforeAll(async () => {
    c = new Client({ connectionString: url });
    await c.connect();
    await wipe();
    await c.query(
      `INSERT INTO users (id, subject, email, display_name) VALUES
         ($1,'yourtal|teen-parent','parent@teen.test','Pat'),
         ($2,'yourtal|teen-teen','teen@teen.test','Tia'),
         ($3,'idp|teen-other','other@teen.test','Oli')`,
      [PARENT, TEEN, OTHER],
    );
    await c.query(`INSERT INTO tenants (id, name, kind) VALUES ($1, 'Pat household', 'personal')`, [FUND]);
    await c.query(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'owner')`, [FUND, PARENT]);
    await c.query(
      `INSERT INTO usage_grants (id, tenant_id, metric, amount, remaining, source) VALUES ($1, $2, 'scans', 2, 2, 'signup_bonus')`,
      [GRANT, FUND],
    );
  });

  afterAll(async () => {
    await wipe();
    await c.end();
  });

  it('records an invite only for the owner of the funding workspace', async () => {
    await as('app_rw', OTHER, null);
    expect(
      await failure('SELECT teen_invite_record($1, $2, $3, now() + interval \'7 days\')', [INVITE, FUND, codeHash]),
    ).toMatch(/^42501/);
    await as('app_rw', PARENT, null);
    await c.query(`SELECT teen_invite_record($1, $2, $3, now() + interval '7 days')`, [INVITE, FUND, codeHash]);
    expect((await c.query('SELECT id FROM teen_invites')).rows).toEqual([{ id: INVITE }]);
    // Nobody else can read it.
    await as('app_rw', OTHER, null);
    expect((await c.query('SELECT id FROM teen_invites')).rows).toEqual([]);
  });

  it('finds the invite by code at start, and by flow at finish', async () => {
    await as('app_rw', null, null);
    const wrong = createHash('sha256').update('nope').digest();
    expect((await c.query('SELECT teen_invite_attach_flow($1, $2) AS id', [wrong, FLOW])).rows[0].id).toBeNull();
    expect((await c.query('SELECT teen_invite_attach_flow($1, $2) AS id', [codeHash, FLOW])).rows[0].id).toBe(INVITE);
    expect((await c.query('SELECT teen_invite_for_sign_in($1, $2) AS id', [FLOW, 'yourtal|teen-teen'])).rows[0].id).toBe(
      INVITE,
    );
    expect(
      (await c.query('SELECT teen_invite_for_sign_in(gen_random_uuid(), $1) AS id', ['yourtal|teen-teen'])).rows[0].id,
    ).toBeNull();
  });

  it('makes a space the teen owns, with the parent read-only, once', async () => {
    await as('app_rw', TEEN, null);
    space = (await c.query(`SELECT teen_space_join($1, 'Tia''s space', 'AU') AS id`, [INVITE])).rows[0].id;
    expect(space).toMatch(/^[0-9a-f-]{36}$/);
    expect((await c.query(`SELECT teen_space_join($1, 'x', 'AU') AS id`, [INVITE])).rows[0].id).toBe(space);

    await c.query('RESET ROLE');
    const members = await c.query('SELECT user_id, role FROM memberships WHERE tenant_id = $1 ORDER BY role', [space]);
    expect(members.rows).toEqual([
      { user_id: TEEN, role: 'owner' },
      { user_id: PARENT, role: 'readonly' },
    ]);
    expect((await c.query('SELECT count(*)::int AS n FROM teen_invites')).rows[0].n).toBe(0);
    // Later sign-ins find the standing space's invite with no flow.
    expect(
      (await c.query('SELECT teen_invite_for_sign_in(gen_random_uuid(), $1) AS id', ['yourtal|teen-teen'])).rows[0].id,
    ).toBe(INVITE);
  });

  it('locks the membership: nobody joins, leaves or changes role, and the teen joins nothing else', async () => {
    await as('app_rw', TEEN, space);
    expect(await failure(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'member')`, [space, OTHER])).toMatch(
      /^TS001/,
    );
    expect(await failure(`DELETE FROM memberships WHERE tenant_id = $1 AND user_id = $2`, [space, PARENT])).toMatch(/^TS001/);
    expect(await failure(`UPDATE memberships SET role = 'admin' WHERE tenant_id = $1 AND user_id = $2`, [space, PARENT])).toMatch(
      /^TS001/,
    );
    expect(await failure(`SELECT workspace_create('Mine', 'personal', null)`)).toMatch(/^TS001/);
  });

  it('takes no grant, purchase or invitation of its own', async () => {
    await c.query('RESET ROLE');
    expect(
      await failure(
        `INSERT INTO usage_grants (id, tenant_id, metric, amount, remaining, source) VALUES (gen_random_uuid(), $1, 'scans', 10, 10, 'signup_bonus')`,
        [space],
      ),
    ).toMatch(/^TS001/);
    expect(
      await failure(
        `INSERT INTO credit_purchases (id, tenant_id, purchased_by, pack_code, credits, price_aud, status, provider)
         VALUES (gen_random_uuid(), $1, $2, 'credits_50', 50, 0.7, 'pending', 'manual')`,
        [space, TEEN],
      ),
    ).toMatch(/^TS001/);
    expect(
      await failure(
        `INSERT INTO invitations (id, tenant_id, email, role, token_hash, invited_by, expires_at)
         VALUES (gen_random_uuid(), $1, 'x@teen.test', 'member', $2, $3, now() + interval '1 day')`,
        [space, randomBytes(32), TEEN],
      ),
    ).toMatch(/^TS001/);
  });

  it("spends the parent's credit for a teen's scan, once, and gives it back on a refund", async () => {
    await c.query('RESET ROLE');
    const capture = (
      await c.query(
        `INSERT INTO captures (id, tenant_id, uploaded_by, original_storage_key, original_mime_type, original_byte_size, original_sha256)
         VALUES (gen_random_uuid(), $1, $2, 'k', 'image/jpeg', 10, $3) RETURNING id`,
        [space, TEEN, randomBytes(32)],
      )
    ).rows[0].id as string;
    // Read as the owner over its own connection: this one is mid-role.
    const owner = new Client({ connectionString: url });
    await owner.connect();
    const remaining = async () =>
      (await owner.query('SELECT remaining FROM usage_grants WHERE id = $1', [GRANT])).rows[0].remaining as number;

    await as('app_rw', TEEN, space);
    expect((await c.query('SELECT teen_space_credits() AS n')).rows[0].n).toBe(2);
    const took = (await c.query('SELECT * FROM teen_space_take_credit($1)', [capture])).rows[0];
    expect(took).toEqual({ teen_space: true, grant_id: GRANT });
    await c.query('SELECT * FROM teen_space_take_credit($1)', [capture]);
    expect(await remaining()).toBe(1);

    // Not a teen space: nothing taken.
    await as('app_rw', PARENT, FUND);
    expect((await c.query('SELECT * FROM teen_space_take_credit(gen_random_uuid())')).rows[0].teen_space).toBe(false);
    expect((await c.query('SELECT teen_space_credits() AS n')).rows[0].n).toBeNull();

    // Only the worker refunds; twice gives one credit back.
    expect(await failure('SELECT teen_space_refund_credit($1)', [capture])).toMatch(/^42501/);
    await as('app_worker', null, space);
    expect((await c.query('SELECT teen_space_refund_credit($1) AS ok', [capture])).rows[0].ok).toBe(true);
    expect((await c.query('SELECT teen_space_refund_credit($1) AS ok', [capture])).rows[0].ok).toBe(false);
    expect(await remaining()).toBe(2);
    await owner.end();
  });

  it('lets only the parent end access, which stamps the hold and ends the teen sessions', async () => {
    await c.query('RESET ROLE');
    await c.query(
      `INSERT INTO user_sessions (id, user_id, token_hash, expires_at, idle_timeout_seconds)
       VALUES (gen_random_uuid(), $1, $2, now() + interval '1 day', 3600)`,
      [TEEN, randomBytes(32)],
    );
    await as('app_rw', TEEN, null);
    expect(await failure('SELECT teen_space_end($1)', [space])).toMatch(/^42501/);
    await as('app_rw', PARENT, null);
    expect((await c.query('SELECT teen_space_end($1) AS ended', [space])).rows[0].ended).toBe(true);
    expect((await c.query('SELECT teen_space_end($1) AS ended', [space])).rows[0].ended).toBe(false);

    await c.query('RESET ROLE');
    const row = (
      await c.query(`SELECT erase_after - access_ended_at = interval '30 days' AS hold FROM teen_spaces WHERE tenant_id = $1`, [space])
    ).rows[0];
    expect(row.hold).toBe(true);
    const live = await c.query('SELECT revoked_reason FROM user_sessions WHERE user_id = $1', [TEEN]);
    expect(live.rows).toEqual([{ revoked_reason: 'teen_access_ended' }]);
    // No standing invite any more, and joining again is refused (3.10.f restores).
    expect(
      (await c.query('SELECT teen_invite_for_sign_in(gen_random_uuid(), $1) AS id', ['yourtal|teen-teen'])).rows[0].id,
    ).toBeNull();
    await as('app_rw', TEEN, null);
    expect(await failure(`SELECT teen_space_join($1, 'x', 'AU')`, [INVITE])).toMatch(/^TS002/);
  });

  it('still lets erasure delete the teen and their space', async () => {
    await c.query('RESET ROLE');
    await c.query('SET ROLE app_worker');
    const rows = (await c.query('SELECT workspace_id, outcome FROM erase_person($1)', [TEEN])).rows;
    expect(rows).toEqual([{ workspace_id: space, outcome: 'erased' }]);
    await c.query('RESET ROLE');
    expect((await c.query('SELECT count(*)::int AS n FROM teen_spaces WHERE tenant_id = $1', [space])).rows[0].n).toBe(0);
    expect((await c.query('SELECT count(*)::int AS n FROM memberships WHERE tenant_id = $1', [space])).rows[0].n).toBe(0);
  });
});
