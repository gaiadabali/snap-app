import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * ERASING A PERSON — migration 0043 (group 3.7, ticket S1; yourtal docs/29 §6).
 *
 * erase_person destroys data, so this proves both halves: what must go is
 * gone, and nothing else changed. Every workspace is filled with a row in
 * nearly every tenant table (erase_person.seed.sql).
 *
 * Every scenario goes through `compare`: the WHOLE database (every row of
 * every table, as to_jsonb) after the erasure must equal the database before
 * it, with only the expected changes applied: rows of erased workspaces and
 * the person's own rows gone, the person's ids NULL where a row survives, one
 * storage_purge job per erased workspace, and the rows the scenario names
 * itself (a promoted owner). Anything else that moved fails.
 *
 * Scenarios: A alone in a personal and a business workspace and a member of
 * B's; a second call; D, only owner, with two admins (handover); F, only
 * owner, with only a bookkeeper (erased); S, staff, who revoked another staff
 * member and an AI key; C2, a co-owner; J, a sole admin with no owner; and a
 * workspace another workspace points into (refused). Plus the grants and the
 * sign-in refusal.
 */

const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

const SEED = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'erase_person.seed.sql'), 'utf8');

const id = (n: number) => `e7a5e000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const USERS = {
  A: id(1), B: id(2), U: id(3), D: id(4), E: id(5), E2: id(6), H: id(7), F: id(8), G: id(9),
  S: id(10), R: id(11), C1: id(12), C2: id(13), J: id(14), K: id(15), P: id(16), Q: id(17),
};
const WS = {
  PA: id(0xa1), WA: id(0xa2), WB: id(0xb1), WU: id(0xc1), WD: id(0xd1), WF: id(0xf1),
  WCO: id(0xe1), WAD: id(0xe2), WX: id(0xe3), WY: id(0xe4),
};
const email = (who: string) => `erase-${who.toLowerCase()}@example.com`;
const SUB_A = 'erase-test-sub-a';

type Snapshot = Map<string, string[]>;
type Row = Record<string, unknown>;
type Result = { workspace_id: string; outcome: string; notify_emails: string[] };

describeIfDb('erase_person (migration 0043)', () => {
  let c: Client;
  let tables: string[];
  /** Per table, the columns whose FK to users is ON DELETE CASCADE. */
  const cascade = new Map<string, string[]>();

  async function owner() {
    await c.query('RESET ROLE');
  }

  /** Every row of every table, as jsonb text, sorted. */
  async function snapshot(): Promise<Snapshot> {
    const out: Snapshot = new Map();
    for (const t of tables) {
      const { rows } = await c.query<{ r: string }>(`SELECT to_jsonb(x)::text AS r FROM ${t} x`);
      out.set(t, rows.map((row) => row.r).sort());
    }
    return out;
  }

  const mentions = (rows: string[] | undefined, ids: string[]) =>
    (rows ?? []).filter((r) => ids.some((i) => r.includes(i)));

  async function erase(userId: string, role = 'app_worker'): Promise<Result[]> {
    await c.query(`SET ROLE ${role}`);
    try {
      const { rows } = await c.query<Result>(
        'SELECT workspace_id, outcome, notify_emails FROM erase_person($1) ORDER BY workspace_id',
        [userId],
      );
      return rows;
    } finally {
      await owner();
    }
  }

  const ids = async (sql: string, params: unknown[]) =>
    (await c.query<{ id: string }>(sql, params)).rows.map((r) => r.id);

  /**
   * Erases `who` between two snapshots and returns a check that the whole
   * database changed only as expected. `erased`: the workspaces that must be
   * gone. `changed`: rows the caller checks itself (left out on both sides).
   */
  async function eraseAndCompare(
    who: string,
    o: { erased?: string[]; changed?: (table: string, row: Row) => boolean } = {},
  ) {
    const erased = o.erased ?? [];
    const changed = o.changed ?? (() => false);
    // Rows mentioning these go: the erased workspaces, their webhook
    // endpoints (deliveries carry only the endpoint), the person's staff row
    // (capabilities carry only the staff id).
    const deleted = [
      ...erased,
      ...(await ids('SELECT id::text AS id FROM webhook_endpoints WHERE tenant_id = ANY($1)', [erased])),
      ...(await ids('SELECT id::text AS id FROM platform_staff WHERE user_id = $1', [who])),
    ];
    // Ids that become NULL where a row survives: the person, and their
    // YourTal links (a voucher redemption keeps its row, link_row_id NULL).
    const gone = [who, ...(await ids('SELECT id::text AS id FROM yourtal_links WHERE user_id = $1', [who]))];
    const mail = (await c.query<{ e: string }>('SELECT lower(email::text) AS e FROM users WHERE id = $1', [who]))
      .rows[0]?.e;

    const isDeleted = (t: string, r: Row, text: string) =>
      deleted.some((i) => text.includes(i)) ||
      (t === 'users' && r.id === who) ||
      (cascade.get(t) ?? []).some((col) => r[col] === who) ||
      (t === 'mail_deliveries' && String(r.recipient).toLowerCase() === mail) ||
      (t === 'invitations' && r.accepted_by === who);

    const before = await snapshot();
    const result = await erase(who);
    const after = await snapshot();

    function check() {
      const purges: Row[] = [];
      for (const t of tables) {
        const expected = (before.get(t) ?? [])
          .map((text) => ({ text, r: JSON.parse(text) as Row }))
          .filter(({ text, r }) => !isDeleted(t, r, text) && !changed(t, r))
          .map(({ r }) => normalise(t, r, gone))
          .sort();
        const actual = (after.get(t) ?? [])
          .map((text) => JSON.parse(text) as Row)
          .filter((r) => {
            const payload = r.payload as { tenantId?: string } | undefined;
            const purge = t === 'jobs' && r.kind === 'storage_purge' && erased.includes(payload?.tenantId ?? '');
            if (purge) purges.push(r);
            return !purge && !changed(t, r);
          })
          .map((r) => normalise(t, r))
          .sort();
        expect(actual, `table ${t}`).toEqual(expected);
      }
      // One purge job per erased workspace, with no tenant (it would cascade).
      expect(purges.map((j) => (j.payload as { tenantId: string }).tenantId).sort()).toEqual([...erased].sort());
      for (const j of purges) expect(j.tenant_id).toBeNull();
    }
    return { result, before, after, check };
  }

  async function user(who: keyof typeof USERS, subject = `test|erase-${who}`) {
    await c.query(`INSERT INTO users (id, subject, email, display_name) VALUES ($1, $2, $3, $4)`, [
      USERS[who],
      subject,
      email(who),
      who,
    ]);
  }

  async function member(ws: keyof typeof WS, who: keyof typeof USERS, role: string, at: string) {
    await c.query(`INSERT INTO memberships (tenant_id, user_id, role, created_at) VALUES ($1, $2, $3, $4)`, [
      WS[ws],
      USERS[who],
      role,
      at,
    ]);
  }

  async function workspace(ws: keyof typeof WS, kind: 'personal' | 'business' = 'business') {
    await c.query(`INSERT INTO tenants (id, name, kind) VALUES ($1, $2, $3)`, [WS[ws], `Erase ${ws}`, kind]);
  }

  async function seed(ws: keyof typeof WS, who: keyof typeof USERS) {
    await c.query('BEGIN');
    await c.query('SELECT pg_temp.seed_workspace($1, $2, $3)', [WS[ws], USERS[who], `${ws}-${who}`]);
    await c.query('COMMIT');
  }

  async function cleanup() {
    await owner();
    // The cross-workspace payment the refusal test plants.
    await c.query(
      `DELETE FROM payments p USING invoices i
        WHERE p.invoice_id = i.id AND p.tenant_id <> i.tenant_id AND p.tenant_id = ANY($1)`,
      [Object.values(WS)],
    );
    await c.query(
      `DELETE FROM goal_contributions x USING goals g
        WHERE x.goal_id = g.id AND x.tenant_id <> g.tenant_id AND x.tenant_id = ANY($1)`,
      [Object.values(WS)],
    );
    for (const u of Object.values(USERS)) await c.query('SELECT erase_person($1)', [u]);
    for (const w of Object.values(WS)) await c.query('SELECT erase_workspace($1)', [w]);
    await c.query(`DELETE FROM jobs WHERE kind = 'storage_purge' AND payload->>'tenantId' = ANY($1)`, [
      Object.values(WS),
    ]);
    await c.query(`DELETE FROM ai_provider_configs WHERE label LIKE 'erase-test-%'`);
    await c.query(`DELETE FROM users WHERE subject LIKE 'yourtal|erase-test-%'`);
    await c.query(`DELETE FROM yourtal_erased_subjects WHERE sub LIKE 'erase-test-%'`);
  }

  beforeAll(async () => {
    c = new Client({ connectionString: url });
    await c.connect();
    await c.query(SEED);
    const { rows } = await c.query<{ t: string }>(
      `SELECT quote_ident(table_name) AS t FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_migrations'
        ORDER BY 1`,
    );
    tables = rows.map((r) => r.t);
    const fks = await c.query<{ t: string; col: string }>(
      `SELECT quote_ident(f.conrelid::regclass::text) AS t, a.attname AS col
         FROM pg_constraint f JOIN pg_attribute a ON a.attrelid = f.conrelid AND a.attnum = f.conkey[1]
        WHERE f.contype = 'f' AND f.confrelid = 'public.users'::regclass AND f.confdeltype = 'c'`,
    );
    for (const { t, col } of fks.rows) cascade.set(t, [...(cascade.get(t) ?? []), col]);
    await cleanup();

    await user('A', `yourtal|${SUB_A}`);
    for (const who of Object.keys(USERS).filter((k) => k !== 'A') as (keyof typeof USERS)[]) await user(who);

    await workspace('PA', 'personal');
    await member('PA', 'A', 'owner', '2026-01-01');
    await workspace('WA');
    await member('WA', 'A', 'owner', '2026-01-01');
    await workspace('WB');
    await member('WB', 'B', 'owner', '2026-01-01');
    await member('WB', 'A', 'member', '2026-02-01');
    await workspace('WU');
    await member('WU', 'U', 'owner', '2026-01-01');
    await workspace('WD');
    await member('WD', 'D', 'owner', '2026-01-01');
    await member('WD', 'E2', 'admin', '2026-03-01');
    await member('WD', 'E', 'admin', '2026-02-01');
    await member('WD', 'H', 'bookkeeper', '2026-01-15');
    await workspace('WF');
    await member('WF', 'F', 'owner', '2026-01-01');
    await member('WF', 'G', 'bookkeeper', '2026-02-01');
    await workspace('WCO');
    await member('WCO', 'C1', 'owner', '2026-01-01');
    await member('WCO', 'C2', 'owner', '2026-02-01');
    await workspace('WAD');
    await member('WAD', 'J', 'admin', '2026-01-01');
    await member('WAD', 'K', 'member', '2026-02-01');
    await workspace('WX');
    await member('WX', 'P', 'owner', '2026-01-01');
    await workspace('WY');
    await member('WY', 'Q', 'owner', '2026-01-01');

    // Seeded after the memberships: the voucher fixture needs the person's link.
    for (const [ws, who] of [
      ['PA', 'A'], ['WA', 'A'], ['WB', 'B'], ['WB', 'A'], ['WU', 'U'], ['WD', 'D'], ['WD', 'E'], ['WF', 'F'],
      ['WCO', 'C1'], ['WCO', 'C2'], ['WAD', 'J'], ['WX', 'P'], ['WY', 'Q'],
    ] as const) {
      await seed(ws, who);
    }
    for (const who of ['A', 'B', 'U', 'D', 'F', 'S', 'C2', 'J'] as const) {
      await c.query('SELECT pg_temp.seed_person($1, $2)', [USERS[who], who]);
    }
    // A has accepted an invitation to B's workspace.
    await c.query(
      `INSERT INTO invitations (id, tenant_id, email, role, token_hash, expires_at, invited_by, accepted_by, accepted_at)
       VALUES (gen_random_uuid(), $1, $2, 'member', digest('erase-inv-a', 'sha256'), now() + interval '1 day', $3, $4, now())`,
      [WS.WB, email('A'), USERS.B, USERS.A],
    );

    // S is staff, revoked R's staff access and an AI key, and set a setting.
    await c.query(`INSERT INTO platform_staff (id, user_id, role) VALUES (gen_random_uuid(), $1, 'super_admin')`, [USERS.S]);
    await c.query(
      `INSERT INTO platform_staff_capabilities (staff_id, capability, granted_by)
       SELECT id, 'manage_staff', $1 FROM platform_staff WHERE user_id = $1`,
      [USERS.S],
    );
    await c.query(
      `INSERT INTO platform_staff (id, user_id, role, created_by, revoked_at, revoked_by)
       VALUES (gen_random_uuid(), $1, 'support', $2, now(), $2)`,
      [USERS.R, USERS.S],
    );
    await c.query(
      `WITH cfg AS (
         INSERT INTO ai_provider_configs (provider, label, created_by) VALUES ('openrouter', 'erase-test-cfg', $1) RETURNING id)
       INSERT INTO ai_provider_keys (provider_config_id, key_prefix, key_last4, ciphertext, wrapped_dek, kms_key_id,
                                     created_by, revoked_at, revoked_by)
       SELECT id, 'sk', 'abcd', '\\x01', '\\x02', 'kms', $1, now(), $1 FROM cfg`,
      [USERS.S],
    );
  });

  afterAll(async () => {
    if (!c) return;
    await c.query('ROLLBACK').catch(() => undefined);
    await cleanup();
    await c.end();
  });

  it('the spill guard sees every foreign key into workspace data, bar two pinned exceptions', async () => {
    // erase_workspace checks single-column FKs between two tables that both
    // have tenant_id. Any other FK that lands on workspace data is a shape it
    // would skip: a composite FK, a second FK to tenants, a table without
    // tenant_id pointing at workspace rows. Each must be reviewed and added here.
    const { rows } = await c.query<{ fk: string }>(
      `SELECT c.conrelid::regclass || '.' || a.attname || ' -> ' || c.confrelid::regclass
              || CASE WHEN cardinality(c.conkey) > 1 THEN ' (composite)' ELSE '' END AS fk
         FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
          AND (cardinality(c.conkey) > 1
               OR c.confrelid = 'public.tenants'::regclass
               OR EXISTS (SELECT 1 FROM pg_attribute x WHERE x.attrelid = c.confrelid AND x.attname = 'tenant_id' AND NOT x.attisdropped))
          AND NOT (cardinality(c.conkey) = 1 AND c.confrelid <> 'public.tenants'::regclass
                   AND EXISTS (SELECT 1 FROM pg_attribute x WHERE x.attrelid = c.conrelid AND x.attname = 'tenant_id' AND NOT x.attisdropped))
          AND NOT (cardinality(c.conkey) = 1 AND c.confrelid = 'public.tenants'::regclass AND a.attname = 'tenant_id')
        ORDER BY 1`,
    );
    expect(rows.map((r) => r.fk)).toEqual([
      // Staff rows; the evidence of each impersonation is in audit_log.
      'impersonation_sessions.subject_tenant_id -> tenants',
      // Teen spaces (0045): an invite and a teen's spends reach the parent's
      // workspace on purpose. Each cascades or is nulled when either
      // workspace is erased, and none makes the guard refuse (0045's header).
      'teen_invites.funding_tenant_id -> tenants',
      'teen_space_spends.capture_id -> captures',
      'teen_space_spends.funding_tenant_id -> tenants',
      'teen_space_spends.grant_id -> usage_grants',
      'teen_spaces.funding_tenant_id -> tenants',
      // No tenant_id: a delivery belongs to its endpoint's workspace.
      'webhook_deliveries.endpoint_id -> webhook_endpoints',
    ]);
  });

  it('the seed reaches nearly every table, so the comparisons below mean something', async () => {
    const snap = await snapshot();
    const touched = tables.filter((t) => mentions(snap.get(t), [...Object.values(WS), ...Object.values(USERS)]).length > 0);
    // Not reached: firms, global catalogues (plans, credit packs), sign-in
    // internals, rate limits, audit_log (kept by design) and webhook
    // deliveries (keyed by endpoint; compare() follows the endpoint ids).
    expect(touched.length).toBeGreaterThanOrEqual(55);
  });

  it('only the worker may erase or record an erased sub; nobody may call erase_workspace directly', async () => {
    for (const role of ['app_rw', 'app_readonly']) {
      await c.query(`SET ROLE ${role}`);
      await expect(c.query('SELECT * FROM erase_person($1)', [USERS.A])).rejects.toMatchObject({ code: '42501' });
      await expect(c.query('SELECT identity_yourtal_subject_erase($1)', [SUB_A])).rejects.toMatchObject({
        code: '42501',
      });
      await owner();
    }
    await c.query('SET ROLE app_worker');
    await expect(c.query('SELECT erase_workspace($1)', [WS.PA])).rejects.toMatchObject({ code: '42501' });
    await owner();
    const { rows } = await c.query('SELECT 1 FROM users WHERE id = $1', [USERS.A]);
    expect(rows).toHaveLength(1);
  });

  it('YourTal events: the API revokes only sessions opened before the cut-off; the worker records the sub', async () => {
    await c.query(
      `INSERT INTO user_sessions (user_id, token_hash, created_at, expires_at, idle_timeout_seconds) VALUES
         ($1, digest('erase-old', 'sha256'), now() - interval '1 hour', now() + interval '1 day', 3600),
         ($1, digest('erase-new', 'sha256'), now() + interval '1 minute', now() + interval '1 day', 3600)`,
      [USERS.A],
    );
    await c.query(
      `INSERT INTO yourtal_sign_in_reviews (kind, yourtal_sub, email, user_id) VALUES ('second_sub', $1, $2, $3)`,
      [SUB_A, email('A'), USERS.B],
    );
    await c.query('SET ROLE app_rw');
    const revoked = await c.query<{ n: number }>(`SELECT identity_yourtal_sessions_revoke($1, now()) AS n`, [SUB_A]);
    await c.query('SET ROLE app_worker');
    const erasedUser = await c.query<{ u: string | null }>(`SELECT identity_yourtal_subject_erase($1) AS u`, [SUB_A]);
    const again = await c.query<{ u: string | null }>(`SELECT identity_yourtal_subject_erase($1) AS u`, [SUB_A]);
    await owner();

    // seed_person's session and the hour-old one; not the newer one.
    expect(revoked.rows[0]!.n).toBe(2);
    const { rows } = await c.query<{ reason: string | null }>(
      `SELECT revoked_reason AS reason FROM user_sessions WHERE user_id = $1 ORDER BY created_at`,
      [USERS.A],
    );
    expect(rows.map((r) => r.reason)).toEqual(['yourtal_event', 'yourtal_event', null]);
    expect(erasedUser.rows[0]!.u).toBe(USERS.A);
    expect(again.rows[0]!.u).toBe(USERS.A);
    // The review case the erased sub raised (it holds their email) is gone.
    const reviews = await c.query('SELECT 1 FROM yourtal_sign_in_reviews WHERE yourtal_sub = $1', [SUB_A]);
    expect(reviews.rows).toHaveLength(0);
  });

  it('an erased sub cannot sign in, not even to its own account', async () => {
    await c.query('SET ROLE app_rw');
    const { rows } = await c.query(`SELECT * FROM identity_yourtal_sign_in($1, $2, true, 'A', false, true)`, [
      SUB_A,
      email('A'),
    ]);
    await owner();
    expect(rows).toEqual([{ outcome: 'erased', user_id: null, email_flagged: false }]);
  });

  describe('A: alone in two workspaces, a member of B’s', () => {
    let run: Awaited<ReturnType<typeof eraseAndCompare>>;

    beforeAll(async () => {
      run = await eraseAndCompare(USERS.A, { erased: [WS.PA, WS.WA] });
    });

    it('erases both workspaces A runs alone and says so', () => {
      expect(run.result).toEqual([
        { workspace_id: WS.PA, outcome: 'erased', notify_emails: [] },
        { workspace_id: WS.WA, outcome: 'erased', notify_emails: [] },
      ]);
    });

    it('changes nothing else anywhere: B’s workspace keeps every row with A’s attribution NULL, U is untouched', () => {
      run.check();
    });

    it('the comparison had something to compare: A’s data in both workspaces and in B’s, A’s mail and invitation', () => {
      for (const t of ['captures', 'documents', 'transactions', 'statements', 'yourtal_voucher_redemptions']) {
        for (const ws of [WS.PA, WS.WA]) expect(mentions(run.before.get(t), [ws]).length, t).toBeGreaterThan(0);
      }
      for (const t of ['captures', 'documents', 'transactions', 'review_tasks', 'document_field_corrections',
        'accounting_connections', 'invitations']) {
        expect(mentions(mentions(run.before.get(t), [WS.WB]), [USERS.A]).length, t).toBeGreaterThan(0);
      }
      expect((run.before.get('mail_deliveries') ?? []).filter((r) => r.toLowerCase().includes(email('A')))).toHaveLength(1);
      expect(tables.flatMap((t) => mentions(run.after.get(t), [USERS.A]))).toEqual([]);
    });

    it('a second call is a no-op', async () => {
      const again = await erase(USERS.A);
      expect(again).toEqual([]);
      expect(await snapshot()).toEqual(run.after);
    });

    it('the same person registering again gets a new, empty account', async () => {
      await c.query('SET ROLE app_rw');
      const { rows } = await c.query(`SELECT * FROM identity_yourtal_sign_in($1, $2, true, 'A', false, true)`, [
        'erase-test-sub-a2',
        email('A'),
      ]);
      await owner();
      expect(rows[0]).toMatchObject({ outcome: 'created' });
      const m = await c.query('SELECT 1 FROM memberships WHERE user_id = $1', [rows[0].user_id]);
      expect(m.rows).toHaveLength(0);
    });
  });

  it('D, only owner with two admins: the earlier admin becomes owner; nothing else changes', async () => {
    const promoted = (t: string, r: Row) => t === 'memberships' && r.tenant_id === WS.WD && r.user_id === USERS.E;
    const run = await eraseAndCompare(USERS.D, { changed: promoted });
    expect(run.result).toEqual([{ workspace_id: WS.WD, outcome: 'handed_over', notify_emails: [email('E')] }]);
    run.check();
    const { rows } = await c.query<{ user_id: string; role: string }>(
      'SELECT user_id, role FROM memberships WHERE tenant_id = $1 ORDER BY role, user_id',
      [WS.WD],
    );
    expect(rows).toEqual([
      { user_id: USERS.E2, role: 'admin' },
      { user_id: USERS.H, role: 'bookkeeper' },
      { user_id: USERS.E, role: 'owner' },
    ]);
  });

  it('F, only owner with only a bookkeeper: the workspace is erased and the bookkeeper named; nothing else changes', async () => {
    const run = await eraseAndCompare(USERS.F, { erased: [WS.WF] });
    expect(run.result).toEqual([{ workspace_id: WS.WF, outcome: 'erased', notify_emails: [email('G')] }]);
    run.check();
    const g = await c.query('SELECT 1 FROM users WHERE id = $1', [USERS.G]);
    expect(g.rows).toHaveLength(1);
  });

  it('S, staff who revoked another staff member and an AI key, can be erased; the revocations keep their time', async () => {
    const run = await eraseAndCompare(USERS.S);
    expect(run.result).toEqual([]);
    run.check();
    const staff = await c.query('SELECT revoked_at, revoked_by FROM platform_staff WHERE user_id = $1', [USERS.R]);
    expect(staff.rows[0].revoked_at).not.toBeNull();
    expect(staff.rows[0].revoked_by).toBeNull();
    const key = await c.query(
      `SELECT k.revoked_at, k.revoked_by FROM ai_provider_keys k
         JOIN ai_provider_configs g ON g.id = k.provider_config_id WHERE g.label = 'erase-test-cfg'`,
    );
    expect(key.rows[0].revoked_at).not.toBeNull();
    expect(key.rows[0].revoked_by).toBeNull();
  });

  it('C2, a co-owner: the workspace stays with C1, and only C2’s membership and attribution go', async () => {
    const run = await eraseAndCompare(USERS.C2);
    expect(run.result).toEqual([]);
    run.check();
    const m = await c.query('SELECT user_id, role FROM memberships WHERE tenant_id = $1', [WS.WCO]);
    expect(m.rows).toEqual([{ user_id: USERS.C1, role: 'owner' }]);
  });

  it('J, a sole admin with no owner: the workspace is erased and the member named', async () => {
    const run = await eraseAndCompare(USERS.J, { erased: [WS.WAD] });
    expect(run.result).toEqual([{ workspace_id: WS.WAD, outcome: 'erased', notify_emails: [email('K')] }]);
    run.check();
  });

  it('refuses to erase a workspace that points into another (out), and changes nothing', async () => {
    // X's goal contribution naming Y's goal: deleting it would make 0030's
    // trigger rewrite Y's goal.saved.
    await c.query(
      `INSERT INTO goal_contributions (id, tenant_id, goal_id, amount, occurred_on)
       SELECT gen_random_uuid(), $1, g.id, 5, '2026-08-20' FROM goals g WHERE g.tenant_id = $2 LIMIT 1`,
      [WS.WX, WS.WY],
    );
    const before = await snapshot();
    await expect(erase(USERS.P)).rejects.toMatchObject({
      code: '23000',
      message: expect.stringContaining('goal_contributions_goal_id_fkey'),
    });
    expect(await snapshot()).toEqual(before);
    await c.query(
      `DELETE FROM goal_contributions x USING goals g WHERE x.goal_id = g.id AND x.tenant_id = $1 AND g.tenant_id = $2`,
      [WS.WX, WS.WY],
    );
  });

  it('refuses to erase a workspace another workspace points into (in), and changes nothing', async () => {
    // Y's payment against X's invoice: a foreign key check ignores RLS, so
    // this row can exist. Erasing X would cascade into Y.
    await c.query(
      `INSERT INTO payments (id, tenant_id, invoice_id, paid_on, amount)
       SELECT gen_random_uuid(), $2, i.id, '2026-08-10', 1 FROM invoices i WHERE i.tenant_id = $1 LIMIT 1`,
      [WS.WX, WS.WY],
    );
    const before = await snapshot();
    await expect(erase(USERS.P)).rejects.toMatchObject({
      code: '23000',
      message: expect.stringContaining('payments_invoice_id_fkey'),
    });
    expect(await snapshot()).toEqual(before);

    // Once the stray row is gone, the erasure goes through, global tax codes
    // and all (the seed's categories and splits name one).
    await c.query(
      `DELETE FROM payments p USING invoices i WHERE p.invoice_id = i.id AND i.tenant_id = $1 AND p.tenant_id = $2`,
      [WS.WX, WS.WY],
    );
    const run = await eraseAndCompare(USERS.P, { erased: [WS.WX] });
    expect(run.result).toEqual([{ workspace_id: WS.WX, outcome: 'erased', notify_emails: [] }]);
    run.check();
  });
});

/**
 * A row as it should compare: `gone` (the erased person's ids) replaced by
 * null wherever one appears as a whole value. Left out: documents.version and
 * goals.updated_at, which their triggers bump when an attribution is nulled
 * (goals.saved and every other column are still compared).
 */
function normalise(table: string, row: Row, gone: string[] = []): string {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (table === 'documents' && k === 'version') continue;
    if (table === 'goals' && k === 'updated_at') continue;
    out[k] = typeof v === 'string' && gone.includes(v) ? null : v;
  }
  return JSON.stringify(out);
}
