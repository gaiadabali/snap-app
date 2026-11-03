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
 * nearly every tenant table (erase_person.seed.sql). The comparisons are of
 * whole rows (to_jsonb) across EVERY table in the schema, not row counts:
 *
 *   - A alone runs a personal and a business workspace: both erased, nothing
 *     anywhere mentions them or A, and one storage_purge job each;
 *   - A is a member of B's workspace: it keeps every row, and the only change
 *     is A's attribution becoming NULL (plus documents.version, bumped by its
 *     trigger);
 *   - U, unrelated: every row mentioning U or U's workspace is byte-identical;
 *   - a second call returns nothing and changes nothing anywhere;
 *   - D, only owner, with two admins: the earlier admin becomes owner;
 *   - F, only owner, with only a bookkeeper: the workspace is erased and the
 *     bookkeeper is named for the email;
 *   - an erased `sub` cannot sign in, and a new `sub` with the same email
 *     gets a new, empty account;
 *   - only the worker may call erase_person; nobody may call erase_workspace.
 */

const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

const SEED = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'erase_person.seed.sql'), 'utf8');

const id = (n: number) => `e7a5e000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const USERS = { A: id(1), B: id(2), U: id(3), D: id(4), E: id(5), E2: id(6), H: id(7), F: id(8), G: id(9) };
const WS = { PA: id(0xa1), WA: id(0xa2), WB: id(0xb1), WU: id(0xc1), WD: id(0xd1), WF: id(0xf1) };
const email = (who: string) => `erase-${who.toLowerCase()}@example.com`;
const SUB_A = 'erase-test-sub-a';

type Snapshot = Map<string, string[]>;

describeIfDb('erase_person (migration 0043)', () => {
  let c: Client;
  let tables: string[];

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

  async function erase(userId: string, role = 'app_worker') {
    await c.query(`SET ROLE ${role}`);
    try {
      const { rows } = await c.query<{ workspace_id: string; outcome: string; notify_emails: string[] }>(
        'SELECT workspace_id, outcome, notify_emails FROM erase_person($1) ORDER BY workspace_id',
        [userId],
      );
      return rows;
    } finally {
      await owner();
    }
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

  async function workspace(ws: keyof typeof WS, kind: 'personal' | 'business') {
    await c.query(`INSERT INTO tenants (id, name, kind) VALUES ($1, $2, $3)`, [WS[ws], `Erase ${ws}`, kind]);
  }

  async function cleanup() {
    await owner();
    for (const u of Object.values(USERS)) await c.query('SELECT erase_person($1)', [u]);
    for (const w of Object.values(WS)) await c.query('SELECT erase_workspace($1)', [w]);
    await c.query(`DELETE FROM jobs WHERE kind = 'storage_purge' AND payload->>'tenantId' = ANY($1)`, [
      Object.values(WS),
    ]);
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
    await cleanup();

    await user('A', `yourtal|${SUB_A}`);
    for (const who of ['B', 'U', 'D', 'E', 'E2', 'H', 'F', 'G'] as const) await user(who);

    await workspace('PA', 'personal');
    await member('PA', 'A', 'owner', '2026-01-01');
    await workspace('WA', 'business');
    await member('WA', 'A', 'owner', '2026-01-01');
    await workspace('WB', 'business');
    await member('WB', 'B', 'owner', '2026-01-01');
    await member('WB', 'A', 'member', '2026-02-01');
    await workspace('WU', 'business');
    await member('WU', 'U', 'owner', '2026-01-01');
    await workspace('WD', 'business');
    await member('WD', 'D', 'owner', '2026-01-01');
    await member('WD', 'E2', 'admin', '2026-03-01');
    await member('WD', 'E', 'admin', '2026-02-01');
    await member('WD', 'H', 'bookkeeper', '2026-01-15');
    await workspace('WF', 'business');
    await member('WF', 'F', 'owner', '2026-01-01');
    await member('WF', 'G', 'bookkeeper', '2026-02-01');

    // Seeded after the memberships: the voucher fixture needs the person's link.
    for (const [ws, who] of [
      ['PA', 'A'], ['WA', 'A'], ['WB', 'B'], ['WB', 'A'], ['WU', 'U'], ['WD', 'D'], ['WD', 'E'], ['WF', 'F'],
    ] as const) {
      await c.query('BEGIN');
      await c.query('SELECT pg_temp.seed_workspace($1, $2, $3)', [WS[ws], USERS[who], `${ws}-${who}`]);
      await c.query('COMMIT');
    }
    for (const who of ['A', 'B', 'U', 'D', 'F'] as const) {
      await c.query('SELECT pg_temp.seed_person($1, $2)', [USERS[who], who]);
    }
  });

  afterAll(async () => {
    if (!c) return;
    await c.query('ROLLBACK').catch(() => undefined);
    await cleanup();
    await c.end();
  });

  it('the seed reaches nearly every table, so the comparisons below mean something', async () => {
    const snap = await snapshot();
    const touched = tables.filter((t) => mentions(snap.get(t), [...Object.values(WS), USERS.A]).length > 0);
    // Not reached: the admin plane, firms, global catalogues (plans, credit
    // packs), sign-in internals, rate limits, audit_log (kept by design) and
    // webhook_deliveries (keyed by endpoint; checked by endpoint id below).
    expect(touched.length).toBeGreaterThanOrEqual(51);
  });

  it('only the worker may erase; nobody may call erase_workspace directly', async () => {
    for (const role of ['app_rw', 'app_readonly']) {
      await c.query(`SET ROLE ${role}`);
      await expect(c.query('SELECT * FROM erase_person($1)', [USERS.A])).rejects.toMatchObject({ code: '42501' });
      await owner();
    }
    await c.query('SET ROLE app_worker');
    await expect(c.query('SELECT erase_workspace($1)', [WS.PA])).rejects.toMatchObject({ code: '42501' });
    await owner();
    const { rows } = await c.query('SELECT 1 FROM users WHERE id = $1', [USERS.A]);
    expect(rows).toHaveLength(1);
  });

  it('YourTal events: revokes only sessions opened before the cut-off, then records the sub as erased', async () => {
    await c.query(
      `INSERT INTO user_sessions (user_id, token_hash, created_at, expires_at, idle_timeout_seconds) VALUES
         ($1, digest('erase-old', 'sha256'), now() - interval '1 hour', now() + interval '1 day', 3600),
         ($1, digest('erase-new', 'sha256'), now() + interval '1 minute', now() + interval '1 day', 3600)`,
      [USERS.A],
    );
    await c.query('SET ROLE app_rw');
    const revoked = await c.query<{ n: number }>(
      `SELECT identity_yourtal_sessions_revoke($1, now()) AS n`,
      [SUB_A],
    );
    const erasedUser = await c.query<{ u: string | null }>(`SELECT identity_yourtal_subject_erase($1) AS u`, [SUB_A]);
    const again = await c.query<{ u: string | null }>(`SELECT identity_yourtal_subject_erase($1) AS u`, [SUB_A]);
    await owner();

    // seed_person's session and the hour-old one; not the newer one.
    expect(revoked.rows[0]!.n).toBe(2);
    const { rows } = await c.query<{ hash: string; reason: string | null }>(
      `SELECT encode(token_hash, 'hex') AS hash, revoked_reason AS reason FROM user_sessions WHERE user_id = $1
        ORDER BY created_at`,
      [USERS.A],
    );
    expect(rows.map((r) => r.reason)).toEqual(['yourtal_event', 'yourtal_event', null]);
    expect(erasedUser.rows[0]!.u).toBe(USERS.A);
    expect(again.rows[0]!.u).toBe(USERS.A);
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
    let before: Snapshot;
    let after: Snapshot;
    let result: Awaited<ReturnType<typeof erase>>;
    let gone: string[];
    let erasedIds: string[];

    beforeAll(async () => {
      const hooks = await c.query<{ id: string }>('SELECT id::text FROM webhook_endpoints WHERE tenant_id = ANY($1)', [
        [WS.PA, WS.WA],
      ]);
      erasedIds = [USERS.A, WS.PA, WS.WA, ...hooks.rows.map((r) => r.id)];
      // A's own ids: the user, and the YourTal links that cascade with it
      // (a voucher redemption keeps its row with link_row_id NULL).
      const links = await c.query<{ id: string }>('SELECT id::text FROM yourtal_links WHERE user_id = $1', [USERS.A]);
      gone = [USERS.A, ...links.rows.map((r) => r.id)];
      before = await snapshot();
      result = await erase(USERS.A);
      after = await snapshot();
    });

    it('erases both workspaces A runs alone and says so', () => {
      expect(result).toEqual(
        [
          { workspace_id: WS.PA, outcome: 'erased', notify_emails: [] },
          { workspace_id: WS.WA, outcome: 'erased', notify_emails: [] },
        ].sort((x, y) => x.workspace_id.localeCompare(y.workspace_id)),
      );
    });

    it('leaves nothing anywhere that mentions A or A’s workspaces, except one storage_purge job each', () => {
      const left = tables.flatMap((t) => mentions(after.get(t), erasedIds).map((r) => `${t} ${r}`));
      expect(mentions(before.get('webhook_deliveries'), erasedIds)).toHaveLength(2);
      expect(left).toHaveLength(2);
      for (const ws of [WS.PA, WS.WA]) {
        const job = left.find((r) => r.includes(ws))!;
        expect(job.startsWith('jobs ')).toBe(true);
        const row = JSON.parse(job.slice('jobs '.length));
        expect(row).toMatchObject({ kind: 'storage_purge', tenant_id: null, payload: { tenantId: ws } });
      }
      // The seed really had them: receipts, documents, transactions,
      // statements and a voucher redemption in each.
      for (const t of ['captures', 'documents', 'transactions', 'statements', 'yourtal_voucher_redemptions']) {
        expect(mentions(before.get(t), [WS.PA]).length, t).toBeGreaterThan(0);
        expect(mentions(before.get(t), [WS.WA]).length, t).toBeGreaterThan(0);
      }
    });

    it('deletes the mail sent to A, and only that', () => {
      const mail = (s: Snapshot, who: string) =>
        (s.get('mail_deliveries') ?? []).filter((r) => r.toLowerCase().includes(email(who)));
      expect(mail(before, 'A')).toHaveLength(1);
      expect(mail(after, 'A')).toHaveLength(0);
      expect(mail(after, 'B')).toEqual(mail(before, 'B'));
    });

    it('keeps every row of B’s workspace; only A’s attribution becomes NULL', () => {
      const changed: string[] = [];
      for (const t of tables) {
        const b = mentions(before.get(t), [WS.WB]);
        const a = mentions(after.get(t), [WS.WB]);
        // What each before-row should look like now: A's id gone to null.
        const expected = b
          .filter((r) => !(t === 'memberships' && r.includes(USERS.A)))
          .map((r) => normalise(t, JSON.parse(r), gone))
          .sort();
        const actual = a.map((r) => normalise(t, JSON.parse(r))).sort();
        expect(actual, t).toEqual(expected);
        if (b.some((r) => r.includes(USERS.A))) changed.push(t);
      }
      // A's receipt, review and posting in B's workspace were really there.
      expect(changed).toEqual(
        expect.arrayContaining([
          'captures',
          'documents',
          'transactions',
          'review_tasks',
          'document_field_corrections',
          'accounting_connections',
        ]),
      );
    });

    it('does not touch an unrelated person or their workspace', async () => {
      const { rows } = await c.query<{ id: string }>('SELECT id::text FROM webhook_endpoints WHERE tenant_id = $1', [WS.WU]);
      const ids = [USERS.U, WS.WU, ...rows.map((r) => r.id)];
      for (const t of tables) expect(mentions(after.get(t), ids), t).toEqual(mentions(before.get(t), ids));
    });

    it('a second call is a no-op', async () => {
      const again = await erase(USERS.A);
      expect(again).toEqual([]);
      expect(await snapshot()).toEqual(after);
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

  it('D, only owner with two admins: the earlier admin becomes owner and the workspace stays', async () => {
    const before = await snapshot();
    const result = await erase(USERS.D);
    expect(result).toEqual([{ workspace_id: WS.WD, outcome: 'handed_over', notify_emails: [email('E')] }]);

    const { rows } = await c.query<{ user_id: string; role: string }>(
      'SELECT user_id, role FROM memberships WHERE tenant_id = $1 ORDER BY role, user_id',
      [WS.WD],
    );
    expect(rows).toEqual([
      { user_id: USERS.E2, role: 'admin' },
      { user_id: USERS.H, role: 'bookkeeper' },
      { user_id: USERS.E, role: 'owner' },
    ]);
    // Every other row of the workspace is still there.
    const after = await snapshot();
    for (const t of tables.filter((x) => x !== 'memberships')) {
      expect(mentions(after.get(t), [WS.WD]).length, t).toBe(mentions(before.get(t), [WS.WD]).length);
    }
    expect(tables.flatMap((t) => mentions(after.get(t), [USERS.D]))).toEqual([]);
  });

  it('F, only owner with only a bookkeeper: the workspace is erased and the bookkeeper is named', async () => {
    const result = await erase(USERS.F);
    expect(result).toEqual([{ workspace_id: WS.WF, outcome: 'erased', notify_emails: [email('G')] }]);
    const after = await snapshot();
    const left = tables.flatMap((t) => mentions(after.get(t), [WS.WF]).map((r) => `${t} ${r}`));
    expect(left).toHaveLength(1);
    expect(left[0]).toMatch(/^jobs .*"storage_purge"/);
    const g = await c.query('SELECT 1 FROM users WHERE id = $1', [USERS.G]);
    expect(g.rows).toHaveLength(1);
  });
});

/**
 * A row as it should compare: `gone` (the erased person's ids) replaced by
 * null wherever one appears as a whole value. Left out: documents.version and
 * goals.updated_at, which their triggers bump when an attribution is nulled
 * (goals.saved is still compared).
 */
function normalise(table: string, row: Record<string, unknown>, gone: string[] = []): string {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (table === 'documents' && k === 'version') continue;
    if (table === 'goals' && k === 'updated_at') continue;
    out[k] = typeof v === 'string' && gone.includes(v) ? null : v;
  }
  return JSON.stringify(out);
}
