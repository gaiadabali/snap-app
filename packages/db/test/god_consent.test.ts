import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * GOD GROUP CONSENT — migration 0062.
 *
 * Runs as the real application roles on one connection (`SET ROLE` persists; a
 * superuser would bypass RLS and make every isolation assertion pass
 * vacuously, the reasoning of `rls.test.ts`). Proves:
 *
 *   - the record is append-only and the status mirrors the latest decision;
 *   - the API cannot write the tables, only the functions can;
 *   - an adult accepts at registration or next sign-in, declines only at next
 *     sign-in, and withdraws only from an accepted status;
 *   - a version bump leaves the old status in place (the caller re-asks);
 *   - a teen cannot accept for themselves; only the parent who invited them
 *     can, and a stranger cannot;
 *   - erasing a person removes their rows and leaves a teen's record when the
 *     parent is erased.
 */

const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

describeIfDb('GOD group consent (migration 0062)', () => {
  let c: Client;
  const users: string[] = [];
  const tenants: string[] = [];

  async function user(): Promise<string> {
    // Fixtures are made as the owner: an earlier test may have left an application role set.
    await c.query('RESET ROLE');
    await c.query(`SELECT set_config('app.user_id','',false)`);
    const id = randomUUID();
    users.push(id);
    await c.query(`INSERT INTO users (id, subject, email, display_name) VALUES ($1, $2, $3, 'x')`, [
      id,
      `test|gc-${id}`,
      `${id}@gc.test`,
    ]);
    return id;
  }
  /** A teen space for a new teen, invited by `parent`. */
  async function teenSpace(parent: string): Promise<{ teen: string; tenant: string }> {
    const teen = await user();
    const tenant = randomUUID();
    tenants.push(tenant);
    await c.query(`INSERT INTO tenants (id, name, kind) VALUES ($1, 'gc teen', 'personal')`, [tenant]);
    await c.query(
      `INSERT INTO teen_spaces (tenant_id, teen_user_id, parent_user_id, invite_id) VALUES ($1, $2, $3, gen_random_uuid())`,
      [tenant, teen, parent],
    );
    return { teen, tenant };
  }
  async function as(userId: string | null, role: 'app_rw' | 'app_readonly' = 'app_rw') {
    await c.query('RESET ROLE');
    await c.query(`SET ROLE ${role}`);
    await c.query(`SELECT set_config('app.user_id', $1, false)`, [userId ?? '']);
    await c.query(`SELECT set_config('app.tenant_id', '', false)`);
  }
  const owner = async () => {
    await c.query('RESET ROLE');
    await c.query(`SELECT set_config('app.user_id','',false)`);
  };
  const record = async (v: string, d: string, m: string) =>
    (await c.query<{ r: boolean }>('SELECT god_consent_record($1, $2, $3) AS r', [v, d, m])).rows[0]!.r;
  const forTeen = async (tenant: string, v: string, d: string) =>
    (await c.query<{ r: boolean }>('SELECT god_consent_record_for_teen($1, $2, $3) AS r', [tenant, v, d])).rows[0]!.r;
  const status = async () =>
    (
      await c.query<{ notice_version: string; decision: string; method: string }>(
        'SELECT notice_version, decision, method FROM god_consent_status',
      )
    ).rows;
  const events = async () =>
    (
      await c.query<{ decision: string; notice_version: string; method: string }>(
        'SELECT decision, notice_version, method FROM god_consent_events ORDER BY created_at, id',
      )
    ).rows;

  beforeAll(async () => {
    c = new Client({ connectionString: url });
    await c.connect();
  });

  afterAll(async () => {
    if (!c) return;
    await owner();
    await c.query('DELETE FROM teen_spaces WHERE tenant_id = ANY($1::uuid[])', [tenants]);
    await c.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [tenants]);
    await c.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    await c.end();
  });

  it('accepts at registration, mirrors it in the status, and is idempotent', async () => {
    const u = await user();
    await as(u);
    expect(await status()).toEqual([]);
    expect(await record('1.0', 'accepted', 'registration')).toBe(true);
    expect(await status()).toEqual([{ notice_version: '1.0', decision: 'accepted', method: 'registration' }]);
    // A double tap writes one row.
    expect(await record('1.0', 'accepted', 'registration')).toBe(false);
    expect(await events()).toHaveLength(1);
  });

  it('an existing person declines at next sign-in; the decline is recorded and a new version can be accepted later', async () => {
    const u = await user();
    await as(u);
    expect(await record('1.0', 'declined', 'next_sign_in')).toBe(true);
    expect(await status()).toEqual([{ notice_version: '1.0', decision: 'declined', method: 'next_sign_in' }]);
    // The version bump leaves the 1.0 answer in place; the caller sees 1.0 is not the current version and re-asks.
    expect(await record('1.1', 'accepted', 'next_sign_in')).toBe(true);
    expect(await status()).toEqual([{ notice_version: '1.1', decision: 'accepted', method: 'next_sign_in' }]);
    expect((await events()).map((e) => `${e.decision}@${e.notice_version}`)).toEqual(['declined@1.0', 'accepted@1.1']);
  });

  it('refuses a decline at registration, a guardian method for oneself, and a malformed version', async () => {
    const u = await user();
    await as(u);
    await expect(record('1.0', 'declined', 'registration')).rejects.toThrow(/bad decision, method or version/);
    await expect(record('1.0', 'accepted', 'guardian')).rejects.toThrow(/bad decision, method or version/);
    await expect(record('banana', 'accepted', 'registration')).rejects.toThrow(/bad decision, method or version/);
    expect(await events()).toEqual([]);
  });

  it('withdraws only from accepted, and records it', async () => {
    const u = await user();
    await as(u);
    expect(await record('1.0', 'withdrawn', 'next_sign_in')).toBe(false); // never accepted: nothing to withdraw
    await record('1.0', 'accepted', 'registration');
    expect(await record('1.0', 'withdrawn', 'next_sign_in')).toBe(true);
    expect(await record('1.0', 'withdrawn', 'next_sign_in')).toBe(false);
    expect(await status()).toEqual([{ notice_version: '1.0', decision: 'withdrawn', method: 'next_sign_in' }]);
    expect((await events()).map((e) => e.decision)).toEqual(['accepted', 'withdrawn']);
  });

  it('a person sees only their own rows', async () => {
    const a = await user();
    const b = await user();
    await as(a);
    await record('1.0', 'accepted', 'registration');
    await as(b);
    expect(await status()).toEqual([]);
    expect(await events()).toEqual([]);
  });

  it('the API cannot write the tables or the internal function, and the log cannot be edited', async () => {
    const u = await user();
    await as(u);
    await expect(
      c.query(
        `INSERT INTO god_consent_events (user_id, notice_version, decision, method) VALUES ($1, '1.0', 'accepted', 'registration')`,
        [u],
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      c.query(
        `INSERT INTO god_consent_status (user_id, notice_version, decision, method, decided_at, event_id)
         VALUES ($1, '1.0', 'accepted', 'registration', now(), gen_random_uuid())`,
        [u],
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(c.query(`SELECT god_consent_append($1, '1.0', 'accepted', 'registration', NULL)`, [u])).rejects.toThrow(
      /permission denied/,
    );
    await record('1.0', 'accepted', 'registration');
    await expect(c.query(`UPDATE god_consent_events SET decision = 'declined'`)).rejects.toThrow(/permission denied/);
    await expect(c.query(`DELETE FROM god_consent_events`)).rejects.toThrow(/permission denied/);
    await expect(c.query(`DELETE FROM god_consent_status`)).rejects.toThrow(/permission denied/);
    // Even the owner cannot rewrite history.
    await owner();
    await expect(c.query(`UPDATE god_consent_events SET decision = 'declined' WHERE user_id = $1`, [u])).rejects.toThrow(
      /append-only/,
    );
    // A caller with no session, and the read-only role, cannot record.
    await as(null);
    await expect(record('1.0', 'accepted', 'registration')).rejects.toThrow(/no signed-in user/);
    await as(u, 'app_readonly');
    await expect(record('1.0', 'accepted', 'registration')).rejects.toThrow(/permission denied/);
  });

  describe('teens', () => {
    it('a teen cannot accept for themselves', async () => {
      const parent = await user();
      const { teen } = await teenSpace(parent);
      await as(teen);
      await expect(record('1.0', 'accepted', 'registration')).rejects.toMatchObject({ code: 'GC001' });
      await expect(record('1.0', 'accepted', 'next_sign_in')).rejects.toMatchObject({ code: 'GC001' });
      expect(await events()).toEqual([]);
    });

    it('the parent who invited accepts for the teen, by guardian, and can read the status', async () => {
      const parent = await user();
      const { teen, tenant } = await teenSpace(parent);
      await as(parent);
      expect(await forTeen(tenant, '1.0', 'accepted')).toBe(true);
      const seen = await c.query('SELECT user_id, decision, method, guardian_user_id FROM god_consent_status');
      expect(seen.rows).toEqual([{ user_id: teen, decision: 'accepted', method: 'guardian', guardian_user_id: parent }]);
      // Idempotent, then withdrawn by the parent.
      expect(await forTeen(tenant, '1.0', 'accepted')).toBe(false);
      expect(await forTeen(tenant, '1.0', 'withdrawn')).toBe(true);
      // The teen reads their own row too.
      await as(teen);
      expect((await status())[0]!.decision).toBe('withdrawn');
    });

    it('anyone else is refused (GC003), and a parent has nothing to decline', async () => {
      const parent = await user();
      const stranger = await user();
      const { tenant } = await teenSpace(parent);
      await as(stranger);
      await expect(forTeen(tenant, '1.0', 'accepted')).rejects.toMatchObject({ code: 'GC003' });
      await as(parent);
      await expect(forTeen(tenant, '1.0', 'declined')).rejects.toThrow(/bad decision or version/);
    });

    it("a parent cannot accept once the teen's access has ended, but can still withdraw", async () => {
      const parent = await user();
      const { tenant } = await teenSpace(parent);
      await as(parent);
      await forTeen(tenant, '1.0', 'accepted');
      await owner();
      await c.query(`UPDATE teen_spaces SET access_ended_at = now() WHERE tenant_id = $1`, [tenant]);
      await as(parent);
      await expect(forTeen(tenant, '1.1', 'accepted')).rejects.toMatchObject({ code: 'GC003' });
      expect(await forTeen(tenant, '1.0', 'withdrawn')).toBe(true);
    });
  });

  it("erasing a person removes their rows; erasing the parent leaves the teen's record", async () => {
    const parent = await user();
    const { teen, tenant } = await teenSpace(parent);
    await as(parent);
    await forTeen(tenant, '1.0', 'accepted');
    await record('1.0', 'accepted', 'registration');
    await owner();
    await c.query('DELETE FROM teen_spaces WHERE tenant_id = $1', [tenant]);
    await c.query('DELETE FROM users WHERE id = $1', [parent]);
    const left = await c.query('SELECT user_id FROM god_consent_events WHERE user_id = ANY($1::uuid[])', [[parent, teen]]);
    expect(left.rows.map((r) => r.user_id)).toEqual([teen]);
    await c.query('DELETE FROM users WHERE id = $1', [teen]);
    expect((await c.query('SELECT 1 FROM god_consent_status WHERE user_id = $1', [teen])).rowCount).toBe(0);
  });
});
