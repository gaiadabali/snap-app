import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * THE TEEN HOLD AND TURNING 18 — migration 0047 (group 3.10.f, 3.10.h). As
 * the real roles on one connection (`SET ROLE`), never as the superuser:
 *
 *   - ending access drops the parent's read access and queues both notices;
 *   - a new invite from the same parent within 30 days restores the space;
 *     another parent's, or one after erase_after, does not;
 *   - the sweep erases a space past erase_after through erase_workspace, and
 *     the spill guard still refuses (that one is left held, the rest go on);
 *   - became-adult lifts the locks and removes the parent, once; during the
 *     hold it changes nothing and the erasure stands.
 */

const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

const id = (n: string) => `7ee80000-0000-4000-8000-${n.padStart(12, '0')}`;
const FUND = id('f1');
const FUND2 = id('f2');
const PARENT = id('a1');
const PARENT2 = id('a2');
const TEEN = id('b1'); // held, restored, held again, erased
const TEEN2 = id('b2'); // turns 18 with a live space
const TEEN3 = id('b3'); // turns 18 during the hold
const USERS = [PARENT, PARENT2, TEEN, TEEN2, TEEN3];

describeIfDb('the teen hold and turning 18 (migration 0047)', () => {
  let c: Client;
  const spaces: Record<string, string> = {};

  async function as(role: 'app_rw' | 'app_worker' | null, userId: string | null = null, tenantId: string | null = null) {
    await c.query('RESET ROLE');
    if (role) await c.query(`SET ROLE ${role}`);
    await c.query(`SELECT set_config('app.user_id', $1, false)`, [userId ?? '']);
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId ?? '']);
  }

  const failure = (sqlText: string, params: unknown[] = []) =>
    c.query(sqlText, params as never[]).then(
      () => null,
      (e: Error & { code?: string }) => `${e.code ?? ''} ${e.message}`,
    );

  /** A parent's invite, carried by a fresh sign-in flow, as the API does it. Returns the flow id. */
  async function invite(parent: string, fund: string): Promise<{ flow: string; inviteId: string }> {
    const code = randomBytes(16).toString('hex');
    const hash = createHash('sha256').update(code).digest();
    const inviteId = randomUUID();
    const flow = randomUUID();
    await as(null);
    await c.query(
      `INSERT INTO yourtal_sign_in_flows (id, client, state, nonce, code_verifier, expires_at)
       VALUES ($1, 'web', 's', 'n', 'v', now() + interval '10 minutes')`,
      [flow],
    );
    await as('app_rw', parent);
    await c.query(`SELECT teen_invite_record($1, $2, $3, now() + interval '7 days')`, [inviteId, fund, hash]);
    await as('app_rw');
    expect((await c.query('SELECT teen_invite_attach_flow($1, $2) AS id', [hash, flow])).rows[0].id).toBe(inviteId);
    return { flow, inviteId };
  }

  async function join(teen: string, flow: string) {
    await as('app_rw', teen);
    return (await c.query(`SELECT * FROM teen_space_join($1, 'A space', 'AU')`, [flow])).rows[0] as {
      tenant_id: string;
      created: boolean;
    };
  }

  const members = async (tenant: string) => {
    await as(null);
    return (await c.query('SELECT user_id, role FROM memberships WHERE tenant_id = $1 ORDER BY role', [tenant])).rows;
  };
  const notices = async () => {
    await as(null);
    return (
      await c.query(
        `SELECT payload FROM jobs WHERE kind = 'erasure_notice' AND tenant_id IS NULL AND completed_at IS NULL
           AND payload->>'to' LIKE '%@hold.test' ORDER BY payload->>'outcome'`,
      )
    ).rows.map((r) => r.payload);
  };
  const clearNotices = async () => {
    await as(null);
    await c.query(`DELETE FROM jobs WHERE kind = 'erasure_notice' AND payload->>'to' LIKE '%@hold.test'`);
  };
  const spaceRow = async (tenant: string) => {
    await as(null);
    return (await c.query('SELECT * FROM teen_spaces WHERE tenant_id = $1', [tenant])).rows[0];
  };

  async function wipe() {
    await as(null);
    const own = (await c.query('SELECT tenant_id FROM teen_spaces WHERE teen_user_id = ANY($1::uuid[])', [USERS])).rows.map(
      (r) => r.tenant_id as string,
    );
    const tenants = [FUND, FUND2, ...own];
    await c.query('DELETE FROM teen_spaces WHERE tenant_id = ANY($1::uuid[])', [tenants]);
    await c.query('DELETE FROM teen_invites WHERE parent_user_id = ANY($1::uuid[])', [USERS]);
    await c.query(`DELETE FROM jobs WHERE kind IN ('erasure_notice', 'teen_invite_end', 'storage_purge')
                     AND (payload->>'to' LIKE '%@hold.test' OR payload->>'parentSub' LIKE 'hold-%'
                          OR payload->>'tenantId' = ANY($1::text[]))`, [tenants]);
    await c.query('DELETE FROM goal_contributions WHERE tenant_id = ANY($1::uuid[])', [tenants]);
    await c.query('DELETE FROM goals WHERE tenant_id = ANY($1::uuid[])', [tenants]);
    await c.query('DELETE FROM credit_spends WHERE tenant_id = ANY($1::uuid[])', [tenants]);
    await c.query('DELETE FROM captures WHERE tenant_id = ANY($1::uuid[])', [tenants]);
    await c.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [tenants]);
    await c.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [USERS]);
  }

  beforeAll(async () => {
    c = new Client({ connectionString: url });
    await c.connect();
    await wipe();
    await c.query(
      `INSERT INTO users (id, subject, email, display_name) VALUES
         ($1,'yourtal|hold-parent','parent@hold.test','Pat'),
         ($2,'yourtal|hold-parent2','parent2@hold.test','Quinn'),
         ($3,'yourtal|hold-teen','teen@hold.test','Tia'),
         ($4,'yourtal|hold-teen2','teen2@hold.test','Uma'),
         ($5,'yourtal|hold-teen3','teen3@hold.test','Vic')`,
      USERS,
    );
    await c.query(`INSERT INTO tenants (id, name, kind) VALUES ($1, 'Pat household', 'personal'), ($2, 'Quinn household', 'personal')`, [
      FUND,
      FUND2,
    ]);
    await c.query(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'owner'), ($3, $4, 'owner')`, [
      FUND,
      PARENT,
      FUND2,
      PARENT2,
    ]);
    await c.query(
      `INSERT INTO usage_grants (id, tenant_id, metric, amount, remaining, source) VALUES (gen_random_uuid(), $1, 'scans', 5, 5, 'signup_bonus')`,
      [FUND],
    );
    for (const [teen, key] of [
      [TEEN, 'teen'],
      [TEEN2, 'teen2'],
      [TEEN3, 'teen3'],
    ] as const) {
      const joined = await join(teen, (await invite(PARENT, FUND)).flow);
      expect(joined.created).toBe(true);
      spaces[key] = joined.tenant_id;
    }
  });

  afterAll(async () => {
    await wipe();
    await c.end();
  });

  it('ending access drops the parent’s read access, ends the teen’s sessions and tells both, naming the day', async () => {
    const space = spaces.teen!;
    await as(null);
    await c.query(
      `INSERT INTO user_sessions (id, user_id, token_hash, expires_at, idle_timeout_seconds)
       VALUES (gen_random_uuid(), $1, $2, now() + interval '1 day', 3600)`,
      [TEEN, randomBytes(32)],
    );
    // While access stands, nobody can remove the parent, not even the guard's own role.
    await as('app_rw', PARENT, space);
    expect(await failure('DELETE FROM memberships WHERE tenant_id = $1 AND user_id = $2', [space, PARENT])).toMatch(/^TS001/);

    await as('app_rw', PARENT);
    expect((await c.query('SELECT teen_space_end($1) AS ended', [space])).rows[0].ended).toBe(true);
    expect(await members(space)).toEqual([{ user_id: TEEN, role: 'owner' }]);
    const row = await spaceRow(space);
    expect(row.erase_after.getTime() - row.access_ended_at.getTime()).toBe(30 * 86_400_000);
    expect((await c.query('SELECT revoked_reason FROM user_sessions WHERE user_id = $1', [TEEN])).rows).toEqual([
      { revoked_reason: 'teen_access_ended' },
    ]);
    const date = row.erase_after.toISOString().slice(0, 10);
    expect(await notices()).toEqual([
      { to: 'parent@hold.test', outcome: 'teen_ended_parent', name: 'Tia', date: expect.stringContaining(date) },
      { to: 'teen@hold.test', outcome: 'teen_ended_teen', name: 'Pat', date: expect.stringContaining(date) },
    ]);

    // A repeat changes nothing and tells nobody again.
    await clearNotices();
    await as('app_rw', PARENT);
    expect((await c.query('SELECT teen_space_end($1) AS ended', [space])).rows[0].ended).toBe(false);
    expect(await notices()).toEqual([]);

    // The parent still sees the row (Family), the teen's name and their own sub, and nothing inside.
    await as('app_rw', PARENT);
    expect((await c.query('SELECT * FROM teen_space_for_parent($1)', [space])).rows).toEqual([
      { teen_name: 'Tia', parent_sub: 'hold-parent' },
    ]);
    await as('app_rw', PARENT2);
    expect((await c.query('SELECT * FROM teen_space_for_parent($1)', [space])).rows).toEqual([]);
    // The teen's owner row stays locked during the hold.
    await as('app_rw', TEEN, space);
    expect(await failure('DELETE FROM memberships WHERE tenant_id = $1 AND user_id = $2', [space, TEEN])).toMatch(/^TS001/);
  });

  it('refuses a restore by another parent’s invite, or after erase_after', async () => {
    const space = spaces.teen!;
    const other = await invite(PARENT2, FUND2);
    await as('app_rw', TEEN);
    expect(await failure(`SELECT * FROM teen_space_join($1, 'x', 'AU')`, [other.flow])).toMatch(/^TS002/);
    // No flow, no restore.
    expect(await failure(`SELECT * FROM teen_space_join(gen_random_uuid(), 'x', 'AU')`)).toMatch(/^TS002/);

    // The clock past erase_after (moved here by moving the hold back): too late.
    const late = await invite(PARENT, FUND);
    await as(null);
    await c.query(`UPDATE teen_spaces SET access_ended_at = access_ended_at - interval '31 days',
                                          erase_after = erase_after - interval '31 days' WHERE tenant_id = $1`, [space]);
    await as('app_rw', TEEN);
    expect(await failure(`SELECT * FROM teen_space_join($1, 'x', 'AU')`, [late.flow])).toMatch(/^TS002/);
    await as(null);
    await c.query(`UPDATE teen_spaces SET access_ended_at = access_ended_at + interval '31 days',
                                          erase_after = erase_after + interval '31 days' WHERE tenant_id = $1`, [space]);
    expect((await spaceRow(space)).access_ended_at).not.toBeNull();
  });

  it('restores the same space by a new invite from the same parent within 30 days', async () => {
    const space = spaces.teen!;
    // Day 29 of the hold: the sweep leaves it.
    await as(null);
    await c.query(`UPDATE teen_spaces SET access_ended_at = access_ended_at - interval '29 days',
                                          erase_after = erase_after - interval '29 days' WHERE tenant_id = $1`, [space]);
    await as('app_worker');
    expect((await c.query('SELECT * FROM teen_space_erase_due() WHERE tenant_id = $1', [space])).rows).toEqual([]);

    const again = await invite(PARENT, FUND);
    const joined = await join(TEEN, again.flow);
    expect(joined).toEqual({ tenant_id: space, created: false });
    const row = await spaceRow(space);
    expect(row).toMatchObject({ access_ended_at: null, erase_after: null, yourtal_ended_at: null, invite_id: again.inviteId, funding_tenant_id: FUND });
    expect(await members(space)).toEqual([
      { user_id: TEEN, role: 'owner' },
      { user_id: PARENT, role: 'readonly' },
    ]);
    expect((await c.query('SELECT count(*)::int AS n FROM teen_invites WHERE id = $1', [again.inviteId])).rows[0].n).toBe(0);
    // Signing in later needs no code again.
    expect((await c.query('SELECT teen_invite_for_sign_in(gen_random_uuid(), $1) AS id', ['yourtal|hold-teen'])).rows[0].id).toBe(
      again.inviteId,
    );
  });

  it('YourTal’s access-ended (erase_data) starts the same hold, once', async () => {
    const space = spaces.teen!;
    await clearNotices();
    await as('app_rw');
    expect(await failure(`SELECT teen_space_end_for_subject('hold-teen')`)).toMatch(/^42501/);
    await as('app_worker');
    expect((await c.query(`SELECT teen_space_end_for_subject('hold-teen') AS ended`)).rows[0].ended).toBe(true);
    expect((await c.query(`SELECT teen_space_end_for_subject('hold-teen') AS ended`)).rows[0].ended).toBe(false);
    expect(await members(space)).toEqual([{ user_id: TEEN, role: 'owner' }]);
    expect((await notices()).map((n) => n.outcome)).toEqual(['teen_ended_parent', 'teen_ended_teen']);
  });

  it('the sweep erases a space past erase_after, but not while the spill guard refuses it', async () => {
    const space = spaces.teen!;
    await as('app_rw');
    expect(await failure('SELECT * FROM teen_space_erase_due()')).toMatch(/^42501/);
    await as('app_worker');
    expect(await failure('SELECT erase_workspace($1)', [space])).toMatch(/^42501/);
    expect((await c.query('SELECT * FROM teen_space_erase_due() WHERE tenant_id = $1', [space])).rows).toEqual([]);

    // Day 31.
    await as(null);
    await c.query(`UPDATE teen_spaces SET access_ended_at = access_ended_at - interval '30 days 1 minute',
                                          erase_after = erase_after - interval '30 days 1 minute' WHERE tenant_id = $1`, [space]);
    // A row in the teen space pointing into the parent's workspace (an FK
    // check ignores RLS, so it can exist): the guard refuses, nothing goes.
    const goal = randomUUID();
    await c.query(`INSERT INTO goals (id, tenant_id, name, target) VALUES ($1, $2, 'Car', 100)`, [goal, FUND]);
    await c.query(
      `INSERT INTO goal_contributions (id, tenant_id, goal_id, amount, occurred_on) VALUES (gen_random_uuid(), $1, $2, 5, '2026-08-20')`,
      [space, goal],
    );
    await as('app_worker');
    const refused = (await c.query('SELECT * FROM teen_space_erase_due() WHERE tenant_id = $1', [space])).rows;
    expect(refused).toEqual([{ tenant_id: space, outcome: expect.stringContaining('goal_contributions_goal_id_fkey') }]);
    await as(null);
    expect((await c.query('SELECT count(*)::int AS n FROM tenants WHERE id = $1', [space])).rows[0].n).toBe(1);
    expect((await c.query('SELECT count(*)::int AS n FROM goal_contributions WHERE tenant_id = $1', [space])).rows[0].n).toBe(1);

    await c.query('DELETE FROM goal_contributions WHERE tenant_id = $1', [space]);
    await as('app_worker');
    expect((await c.query('SELECT * FROM teen_space_erase_due() WHERE tenant_id = $1', [space])).rows).toEqual([
      { tenant_id: space, outcome: 'erased' },
    ]);
    await as(null);
    expect((await c.query('SELECT count(*)::int AS n FROM tenants WHERE id = $1', [space])).rows[0].n).toBe(0);
    expect((await c.query('SELECT count(*)::int AS n FROM teen_spaces WHERE tenant_id = $1', [space])).rows[0].n).toBe(0);
    expect(
      (await c.query(`SELECT count(*)::int AS n FROM jobs WHERE kind = 'storage_purge' AND payload->>'tenantId' = $1`, [space])).rows[0].n,
    ).toBe(1);
    // The teen keeps their account (no workspace), and the parent's workspace is untouched.
    expect((await c.query('SELECT count(*)::int AS n FROM users WHERE id = $1', [TEEN])).rows[0].n).toBe(1);
    expect((await c.query('SELECT count(*)::int AS n FROM goals WHERE id = $1', [goal])).rows[0].n).toBe(1);
  });

  it('became-adult lifts the locks: the parent goes, the space is an ordinary one, the parent’s credits stop, both told', async () => {
    const space = spaces.teen2!;
    await clearNotices();
    await as('app_rw');
    expect(await failure(`SELECT teen_space_became_adult('hold-teen2')`)).toMatch(/^42501/);
    await as('app_worker');
    expect((await c.query(`SELECT teen_space_became_adult('hold-teen2') AS o`)).rows[0].o).toBe('lifted');
    expect((await c.query(`SELECT teen_space_became_adult('hold-teen2') AS o`)).rows[0].o).toBe('none');
    expect((await c.query(`SELECT teen_space_became_adult('nobody') AS o`)).rows[0].o).toBe('none');

    expect(await spaceRow(space)).toBeUndefined();
    expect(await members(space)).toEqual([{ user_id: TEEN2, role: 'owner' }]);
    expect(await notices()).toEqual([
      { to: 'teen2@hold.test', outcome: 'teen_adult_teen', name: 'Pat' },
      { to: 'parent@hold.test', outcome: 'teen_adult_parent', name: 'Uma' },
    ].sort((a, b) => a.outcome.localeCompare(b.outcome)));

    // No longer paid by the parent: take_credit is not a teen space's any more.
    await as(null);
    const capture = randomUUID();
    await c.query(
      `INSERT INTO captures (id, tenant_id, uploaded_by, original_storage_key, original_mime_type, original_byte_size, original_sha256, status)
       VALUES ($1, $2, $3, 'k', 'image/jpeg', 10, $4, 'received')`,
      [capture, space, TEEN2, randomBytes(32)],
    );
    const fund = async () => (await c.query('SELECT sum(remaining)::int AS n FROM usage_grants WHERE tenant_id = $1', [FUND])).rows[0].n;
    const before = await fund();
    await as('app_rw', TEEN2, space);
    expect((await c.query('SELECT * FROM teen_space_take_credit($1)', [capture])).rows[0]).toEqual({ teen_space: false, grant_id: null });
    expect((await c.query('SELECT teen_space_funded() AS f')).rows[0].f).toBeNull();
    await as(null);
    expect(await fund()).toBe(before);

    // The locks are gone: credits of its own, and other workspaces.
    await c.query(
      `INSERT INTO usage_grants (id, tenant_id, metric, amount, remaining, source) VALUES (gen_random_uuid(), $1, 'scans', 1, 1, 'signup_bonus')`,
      [space],
    );
    await c.query(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'member')`, [FUND2, TEEN2]);
    await c.query(`DELETE FROM memberships WHERE tenant_id = $1 AND user_id = $2`, [FUND2, TEEN2]);
  });

  it('became-adult during the hold changes nothing: the parent is already gone and the erasure stands', async () => {
    const space = spaces.teen3!;
    await as('app_rw', PARENT);
    expect((await c.query('SELECT teen_space_end($1) AS ended', [space])).rows[0].ended).toBe(true);
    await clearNotices();
    const before = await spaceRow(space);
    await as('app_worker');
    expect((await c.query(`SELECT teen_space_became_adult('hold-teen3') AS o`)).rows[0].o).toBe('held');
    expect(await spaceRow(space)).toEqual(before);
    expect(await members(space)).toEqual([{ user_id: TEEN3, role: 'owner' }]);
    expect(await notices()).toEqual([]);
    // Still erased on day 31.
    await as(null);
    await c.query(`UPDATE teen_spaces SET erase_after = now() - interval '1 minute' WHERE tenant_id = $1`, [space]);
    await as('app_worker');
    expect((await c.query('SELECT * FROM teen_space_erase_due() WHERE tenant_id = $1', [space])).rows).toEqual([
      { tenant_id: space, outcome: 'erased' },
    ]);
  });
});
