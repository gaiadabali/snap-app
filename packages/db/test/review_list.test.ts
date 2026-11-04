import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The staff review list and the erase_person notice clean-up — migration 0046
 * (group 3.6.c and 3.7.c(a)).
 *
 * yourtal_sign_in_reviews has forced RLS and no grant for any application
 * role, so the only way to read or close a case is through the two
 * SECURITY DEFINER functions. Every check runs as the real role.
 */

const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

const id = (n: number) => `a36c0000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const STAFF = id(1);
const STAFF_NO_CAP = id(2);
const PLAIN = id(3);
const HOLDER = id(4);
const ERASED = id(5);
const SUB = 'review-list-test-sub';

describeIfDb('review list and erase notices (migration 0046)', () => {
  let c: Client;
  let caseId: string;

  const as = async (role: string, userId: string | null) => {
    await c.query('RESET ROLE');
    await c.query(`SET ROLE ${role}`);
    await c.query(`SELECT set_config('app.user_id', $1, false)`, [userId ?? '']);
    await c.query(`SELECT set_config('app.tenant_id', '', false)`);
  };
  const owner = () => c.query('RESET ROLE');

  async function wipe() {
    await owner();
    await c.query(`DELETE FROM jobs WHERE kind = 'erasure_notice' AND payload ->> 'to' LIKE '%@review-list.test'`);
    await c.query(`DELETE FROM audit_log WHERE actor_id = $1`, [STAFF]);
    await c.query(`DELETE FROM yourtal_sign_in_reviews WHERE yourtal_sub = $1`, [SUB]);
    await c.query(`DELETE FROM platform_staff_capabilities WHERE staff_id IN (SELECT id FROM platform_staff WHERE user_id = ANY($1))`, [[STAFF, STAFF_NO_CAP]]);
    await c.query(`DELETE FROM platform_staff WHERE user_id = ANY($1)`, [[STAFF, STAFF_NO_CAP]]);
    await c.query(`DELETE FROM users WHERE id = ANY($1)`, [[STAFF, STAFF_NO_CAP, PLAIN, HOLDER, ERASED]]);
  }

  beforeAll(async () => {
    c = new Client({ connectionString: url });
    await c.connect();
    await wipe();
    await c.query(
      `INSERT INTO users (id, subject, email, display_name) VALUES
         ($1, 'dev|rl-staff', 'staff@review-list.test', 'Staff'),
         ($2, 'dev|rl-nocap', 'nocap@review-list.test', 'No cap'),
         ($3, 'dev|rl-plain', 'plain@review-list.test', 'Plain'),
         ($4, 'dev|rl-holder', 'holder@review-list.test', 'Holder'),
         ($5, 'dev|rl-erased', 'Erased.Person@review-list.test', 'Erased')`,
      [STAFF, STAFF_NO_CAP, PLAIN, HOLDER, ERASED],
    );
    for (const [u, caps] of [[STAFF, ['manage_operations']], [STAFF_NO_CAP, ['view_analytics']]] as const) {
      const staffId = (
        await c.query<{ id: string }>(`INSERT INTO platform_staff (user_id, role) VALUES ($1, 'support') RETURNING id`, [u])
      ).rows[0]!.id;
      await c.query(
        `INSERT INTO platform_staff_capabilities (staff_id, capability) SELECT $1, x FROM unnest($2::platform_capability[]) x`,
        [staffId, caps],
      );
    }
    caseId = (
      await c.query<{ id: string }>(
        `INSERT INTO yourtal_sign_in_reviews (kind, yourtal_sub, email, user_id)
         VALUES ('second_sub', $1, 'Holder@review-list.test', $2) RETURNING id`,
        [SUB, HOLDER],
      )
    ).rows[0]!.id;
  });

  afterAll(async () => {
    await wipe();
    await c.end();
  });

  describe('the review list', () => {
    it('no application role can read the table itself', async () => {
      for (const role of ['app_rw', 'app_worker', 'app_readonly']) {
        await as(role, STAFF);
        await expect(c.query('SELECT * FROM yourtal_sign_in_reviews')).rejects.toThrow(/permission denied/i);
      }
    });

    it('is executable by app_rw only, not app_readonly', async () => {
      await as('app_readonly', STAFF);
      await expect(c.query('SELECT * FROM admin_yourtal_review_list()')).rejects.toThrow(/permission denied/i);
      await expect(c.query(`SELECT admin_yourtal_review_resolve($1, 'x')`, [caseId])).rejects.toThrow(/permission denied/i);
    });

    it('refuses a non-staff user and a staff member without manage_operations', async () => {
      for (const u of [PLAIN, STAFF_NO_CAP, null]) {
        await as('app_rw', u);
        await expect(c.query('SELECT * FROM admin_yourtal_review_list()')).rejects.toThrow(/missing capability: manage_operations/);
        await expect(c.query(`SELECT admin_yourtal_review_resolve($1, 'x')`, [caseId])).rejects.toThrow(/missing capability/);
      }
      await owner();
      const { rows } = await c.query('SELECT resolved_at FROM yourtal_sign_in_reviews WHERE id = $1', [caseId]);
      expect(rows[0]!.resolved_at).toBeNull();
    });

    it('lists the case with the email masked and without the sub', async () => {
      await as('app_rw', STAFF);
      const { rows } = await c.query('SELECT * FROM admin_yourtal_review_list()');
      const row = rows.find((r) => r.id === caseId)!;
      expect(row.kind).toBe('second_sub');
      expect(row.email_masked).toBe('H••••@review-list.test');
      expect(row.user_id).toBe(HOLDER);
      expect(JSON.stringify(rows)).not.toContain(SUB);
      expect(Object.keys(row)).not.toContain('yourtal_sub');
    });

    it('resolve needs a resolution', async () => {
      await as('app_rw', STAFF);
      await expect(c.query(`SELECT admin_yourtal_review_resolve($1, '   ')`, [caseId])).rejects.toThrow(/resolution/);
    });

    it('resolves an open case once, records who, audits it, and refuses a second time', async () => {
      await as('app_rw', STAFF);
      const r = await c.query(`SELECT admin_yourtal_review_resolve($1, '  Asked the person to sign in with the linked account  ') AS ok`, [caseId]);
      expect(r.rows[0]!.ok).toBe(true);

      await expect(c.query(`SELECT admin_yourtal_review_resolve($1, 'overwrite')`, [caseId])).rejects.toThrow(/no such open review case/);
      await expect(
        c.query(`SELECT admin_yourtal_review_resolve($1, 'x')`, ['00000000-0000-4000-8000-000000000000']),
      ).rejects.toThrow(/no such open review case/);

      await owner();
      const row = (await c.query('SELECT * FROM yourtal_sign_in_reviews WHERE id = $1', [caseId])).rows[0]!;
      expect(row.resolved_by).toBe(STAFF);
      expect(row.resolved_at).not.toBeNull();
      expect(row.resolution).toBe('Asked the person to sign in with the linked account');

      const audit = await c.query(`SELECT * FROM audit_log WHERE actor_id = $1 AND action = 'admin_yourtal_review_resolve'`, [STAFF]);
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0]!.entity_id).toBe(caseId);
      expect(audit.rows[0]!.after.kind).toBe('second_sub');
      expect(audit.rows[0]!.after).toEqual({ kind: 'second_sub', resolution_length: 'Asked the person to sign in with the linked account'.length });
      // The free text stays out of the append-only log.
      expect(JSON.stringify(audit.rows[0]!.after)).not.toContain('Asked');
    });

    it('the open-only list drops it, the full list keeps it', async () => {
      await as('app_rw', STAFF);
      expect((await c.query('SELECT id FROM admin_yourtal_review_list(true)')).rows.map((r) => r.id)).not.toContain(caseId);
      expect((await c.query('SELECT id FROM admin_yourtal_review_list(false)')).rows.map((r) => r.id)).toContain(caseId);
    });
  });

  describe('erase_person and open erasure notices', () => {
    const notice = (to: string, done = false) =>
      c.query(
        `INSERT INTO jobs (id, tenant_id, kind, payload, completed_at)
         VALUES (gen_random_uuid(), NULL, 'erasure_notice', $1::jsonb, ${done ? 'now()' : 'NULL'})`,
        [JSON.stringify({ to, outcome: 'erased' })],
      );

    it('deletes the open notices to the erased address (any case) and nothing else', async () => {
      await owner();
      await notice('erased.person@review-list.test');
      await notice('ERASED.PERSON@review-list.test');
      await notice('holder@review-list.test');
      await notice('erased.person@review-list.test', true);

      await as('app_worker', null);
      await c.query('SELECT * FROM erase_person($1)', [ERASED]);
      await owner();

      const { rows } = await c.query(
        `SELECT lower(payload ->> 'to') AS to, completed_at IS NOT NULL AS done FROM jobs
          WHERE kind = 'erasure_notice' AND payload ->> 'to' LIKE '%@review-list.test' ORDER BY 1, 2`,
      );
      expect(rows).toEqual([
        { to: 'erased.person@review-list.test', done: true },
        { to: 'holder@review-list.test', done: false },
      ]);
    });
  });
});
