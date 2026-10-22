import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * YOURTAL VOUCHER REDEMPTIONS — migration 0041 (group plan 2.8, ticket S1;
 * yourtal docs/28 §5 S1 and S4).
 *
 * A voucher redemption grants scan credits exactly once. Proven here as the
 * real roles on one connection (`SET ROLE app_rw` / `app_worker`), and as the
 * owner only where the point is that the TRIGGER holds even for a role the
 * grants and policies do not stop:
 *
 *   - the API inserts only a fresh `authorizing` row, its own, in its
 *     workspace, against its own live link, as owner or admin;
 *   - nobody deletes a redemption; one workspace never sees another's;
 *   - identity columns, keys and the order ref never change; YourTal's answers
 *     are write-once; status moves only along the docs/28 machine (every
 *     (from, to) pair is tried);
 *   - one in-progress or granted row per code hash;
 *   - a `yourtal_voucher` grant commits only with exactly one granted
 *     redemption naming it; any other grant source is unaffected;
 *   - the migration's self-check passes, and fails when a grant is widened;
 *   - the migration applies to a database that already holds data.
 */

const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

const MIGRATION = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
  '0041_yourtal_voucher_redemptions.sql',
);

const A = 'b0c4e000-0000-4000-8000-00000000000a';
const B = 'b0c4e000-0000-4000-8000-00000000000b';
const USER = 'b0c4e000-0000-4000-8000-0000000000a1';
const OTHER = 'b0c4e000-0000-4000-8000-0000000000a2';
const GONE = 'b0c4e000-0000-4000-8000-0000000000a3';
const LINK = 'b0c4e000-0000-4000-8000-0000000000e1';
const LINK_REVOKED = 'b0c4e000-0000-4000-8000-0000000000e2';
const OTHER_LINK = 'b0c4e000-0000-4000-8000-0000000000e3';
const GONE_LINK = 'b0c4e000-0000-4000-8000-0000000000e4';

const FINALS = ['granted', 'voided', 'expired', 'refused', 'abandoned', 'failed'] as const;
const STATES = [
  'authorizing',
  'authorized',
  'capturing',
  'captured',
  'voiding',
  'needs_review',
  ...FINALS,
] as const;
type State = (typeof STATES)[number];

/** docs/28 §5 S1, verbatim. */
const MOVES: Record<State, readonly State[]> = {
  authorizing: ['authorized', 'captured', 'voided', 'expired', 'refused', 'abandoned', 'failed'],
  authorized: ['capturing', 'voiding', 'captured', 'expired'],
  capturing: ['captured', 'voiding', 'voided', 'expired', 'needs_review'],
  captured: ['granted', 'needs_review'],
  voiding: ['voided', 'expired', 'captured'],
  needs_review: ['captured', 'granted', 'voided', 'expired'],
  granted: [],
  voided: [],
  expired: [],
  refused: [],
  abandoned: [],
  failed: [],
};

/** A legal path from `authorizing` to each state. */
const PATH: Record<State, readonly State[]> = {
  authorizing: [],
  authorized: ['authorized'],
  capturing: ['authorized', 'capturing'],
  captured: ['authorized', 'captured'],
  voiding: ['authorized', 'voiding'],
  needs_review: ['authorized', 'capturing', 'needs_review'],
  granted: ['authorized', 'captured', 'granted'],
  voided: ['voided'],
  expired: ['expired'],
  refused: ['refused'],
  abandoned: ['abandoned'],
  failed: ['failed'],
};

const hash = () => randomBytes(32).toString('hex');

describeIfDb('yourtal_voucher_redemptions (migration 0041)', () => {
  let c: Client;

  async function owner() {
    await c.query('RESET ROLE');
    await c.query(`SELECT set_config('app.user_id', '', false)`);
    await c.query(`SELECT set_config('app.tenant_id', '', false)`);
  }

  async function as(role: 'app_rw' | 'app_worker', tenantId: string | null, userId: string = USER) {
    await c.query('RESET ROLE');
    await c.query(`SET ROLE ${role}`);
    await c.query(`SELECT set_config('app.user_id', $1, false)`, [userId]);
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId ?? '']);
  }

  const failure = (sqlText: string, params: unknown[] = []) =>
    c.query(sqlText, params as never[]).then(
      () => null,
      (e: Error & { code?: string }) => `${e.code ?? ''} ${e.message}`,
    );

  /** The insert step 5 of the flow makes, with overrides. Returns the error or the id. */
  async function insert(over: Record<string, unknown> = {}): Promise<{ id?: string; error?: string }> {
    const row: Record<string, unknown> = {
      tenant_id: A,
      user_id: USER,
      link_row_id: LINK,
      code_sha256: hash(),
      face_minor: 500,
      currency: 'AUD',
      credits: 50,
      merchant_order_ref: `snap-${randomUUID()}`,
      ...over,
    };
    const cols = Object.keys(row);
    try {
      const r = await c.query<{ id: string }>(
        `INSERT INTO yourtal_voucher_redemptions (${cols.join(', ')})
         VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
        Object.values(row) as never[],
      );
      return { id: r.rows[0]!.id };
    } catch (e) {
      const err = e as Error & { code?: string };
      return { error: `${err.code ?? ''} ${err.message}` };
    }
  }

  /** As the owner: a voucher grant for `tenant`, uncommitted (caller's transaction). */
  async function voucherGrant(tenant: string, amount = 50): Promise<string> {
    const id = randomUUID();
    await c.query(
      `INSERT INTO usage_grants (id, tenant_id, metric, amount, remaining, source)
       VALUES ($1, $2, 'scans', $3, $3, 'yourtal_voucher')`,
      [id, tenant, amount],
    );
    return id;
  }

  /** As the owner: move row `id` one step to `to`, filling what the target needs. */
  async function step(id: string, to: State) {
    if (to === 'granted') {
      await c.query('BEGIN');
      try {
        const g = await voucherGrant(A);
        await c.query(
          `UPDATE yourtal_voucher_redemptions SET status = 'granted', grant_id = $2 WHERE id = $1`,
          [id, g],
        );
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
      return;
    }
    await c.query(
      `UPDATE yourtal_voucher_redemptions
          SET status = $2,
              authorization_id = CASE WHEN $2 = 'authorized' THEN 'auth-' || id ELSE authorization_id END,
              receipt_id = CASE WHEN $2 = 'captured' THEN 'rcpt-' || id ELSE receipt_id END
        WHERE id = $1`,
      [id, to],
    );
  }

  /** As the owner: a fresh row walked to `state` along a legal path. */
  async function rowIn(state: State, over: Record<string, unknown> = {}): Promise<string> {
    await owner();
    const r = await insert(over);
    if (!r.id) throw new Error(`fixture insert failed: ${r.error}`);
    for (const s of PATH[state]) await step(r.id, s);
    return r.id;
  }

  async function wipe() {
    await owner();
    await c.query('DELETE FROM yourtal_voucher_redemptions WHERE tenant_id = ANY($1::uuid[])', [[A, B]]);
    await c.query('DELETE FROM credit_purchases WHERE tenant_id = ANY($1::uuid[])', [[A, B]]);
    await c.query('DELETE FROM usage_grants WHERE tenant_id = ANY($1::uuid[])', [[A, B]]);
    await c.query('DELETE FROM yourtal_links WHERE user_id = ANY($1::uuid[])', [[USER, OTHER, GONE]]);
    await c.query('DELETE FROM memberships WHERE tenant_id = ANY($1::uuid[])', [[A, B]]);
    await c.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [[A, B]]);
    await c.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[USER, OTHER, GONE]]);
  }

  beforeAll(async () => {
    c = new Client({ connectionString: url });
    await c.connect();
    await wipe();
    await c.query(
      `INSERT INTO tenants (id, name, kind, country, base_currency)
       VALUES ($1,'Voucher A','business','AU','AUD'), ($2,'Voucher B','business','AU','AUD')`,
      [A, B],
    );
    await c.query(
      `INSERT INTO users (id, subject, email, display_name) VALUES
         ($1,'idp|vr-user','vr-user@vr.test','VR User'),
         ($2,'idp|vr-other','vr-other@vr.test','VR Other'),
         ($3,'idp|vr-gone','vr-gone@vr.test','VR Gone')`,
      [USER, OTHER, GONE],
    );
    // USER owns A and is a plain member of B; OTHER and GONE are admins of A.
    await c.query(
      `INSERT INTO memberships (tenant_id, user_id, role) VALUES
         ($1,$3,'owner'), ($2,$3,'member'), ($1,$4,'admin'), ($1,$5,'admin')`,
      [A, B, USER, OTHER, GONE],
    );
    await c.query(
      `INSERT INTO yourtal_links (id, user_id, link_id, region, revoked_at) VALUES
         ($1, $2, gen_random_uuid(), 'AU', NULL),
         ($3, $2, gen_random_uuid(), 'AU', now()),
         ($4, $5, gen_random_uuid(), 'AU', NULL),
         ($6, $7, gen_random_uuid(), 'AU', NULL)`,
      [LINK, USER, LINK_REVOKED, OTHER_LINK, OTHER, GONE_LINK, GONE],
    );
  });

  afterAll(async () => {
    await wipe();
    await c.end();
  });

  // ── The API's insert ───────────────────────────────────────────────────────

  it('lets the API insert a fresh authorizing row of its own, in its workspace', async () => {
    await as('app_rw', A);
    const r = await insert();
    expect(r.error).toBeUndefined();
    const row = await c.query(
      `SELECT status, attempts, authorization_id, receipt_id, grant_id,
              authorize_key IS NOT NULL AND capture_key IS NOT NULL AND void_key IS NOT NULL AS keys
         FROM yourtal_voucher_redemptions WHERE id = $1`,
      [r.id],
    );
    expect(row.rows).toEqual([
      { status: 'authorizing', attempts: 0, authorization_id: null, receipt_id: null, grant_id: null, keys: true },
    ]);
  });

  it('refuses an API insert in another workspace, in another status, or with an answer already set', async () => {
    await as('app_rw', A);
    const rls = /^42501 .*row-level security/;
    expect((await insert({ tenant_id: B })).error).toMatch(rls);
    for (const status of STATES.filter((s) => s !== 'authorizing')) {
      // granted / captured would also trip a CHECK; the point is that none gets in.
      expect((await insert({ status })).error, status).toMatch(/^(42501|23514) /);
    }
    expect((await insert({ status: 'authorized' })).error).toMatch(rls);
    expect((await insert({ authorization_id: 'auth-preset' })).error).toMatch(rls);
    expect((await insert({ receipt_id: 'rcpt-preset' })).error).toMatch(rls);
    expect((await insert({ hold_expires_at: new Date() })).error).toMatch(rls);
    expect((await insert({ capture_sent_at: new Date() })).error).toMatch(rls);
    expect((await insert({ attempts: 1 })).error).toMatch(rls);
    expect((await insert({ last_http_status: 200 })).error).toMatch(rls);
    expect((await insert({ finished_at: new Date() })).error).toMatch(rls);
    // A grant named at insert: refused (by the policy, or by the guard first).
    await owner();
    await c.query('BEGIN');
    const g = await voucherGrant(A);
    await c.query('SAVEPOINT s');
    await as('app_rw', A);
    expect((await insert({ grant_id: g })).error).toMatch(/^(42501|23514) /);
    await c.query('ROLLBACK TO SAVEPOINT s');
    await c.query('ROLLBACK');
  });

  it("refuses an API insert for someone else, on someone else's or a dead link, or as a plain member", async () => {
    await as('app_rw', A);
    const rls = /^42501 .*row-level security/;
    expect((await insert({ user_id: OTHER })).error).toMatch(rls);
    expect((await insert({ link_row_id: OTHER_LINK })).error).toMatch(rls);
    expect((await insert({ link_row_id: LINK_REVOKED })).error).toMatch(rls);
    expect((await insert({ link_row_id: null })).error).toMatch(rls);
    // USER is only a member of B: credits go to a workspace its owner or admin chose (D4).
    await as('app_rw', B);
    expect((await insert({ tenant_id: B })).error).toMatch(rls);
    // No workspace at all: nothing.
    await as('app_rw', null);
    expect((await insert()).error).toMatch(rls);
  });

  it('checks the row itself: hash shape, face, currency, credits, distinct keys', async () => {
    await as('app_rw', A);
    expect((await insert({ code_sha256: 'A'.repeat(64) })).error).toMatch(/yourtal_voucher_redemptions_hash/);
    expect((await insert({ face_minor: 0 })).error).toMatch(/yourtal_voucher_redemptions_face/);
    expect((await insert({ currency: 'IDR' })).error).toMatch(/yourtal_voucher_redemptions_currency/);
    expect((await insert({ credits: 0 })).error).toMatch(/yourtal_voucher_redemptions_credits/);
    const k = randomUUID();
    expect((await insert({ authorize_key: k, capture_key: k })).error).toMatch(
      /yourtal_voucher_redemptions_keys_distinct/,
    );
  });

  // ── Delete, read, update boundaries ───────────────────────────────────────

  it('never lets the API or the worker delete a redemption', async () => {
    const id = await rowIn('voided');
    await as('app_rw', A);
    expect(await failure(`DELETE FROM yourtal_voucher_redemptions WHERE id = $1`, [id])).toMatch(
      /^42501 permission denied/,
    );
    await as('app_worker', A);
    expect(await failure(`DELETE FROM yourtal_voucher_redemptions WHERE id = $1`, [id])).toMatch(
      /^42501 permission denied/,
    );
  });

  it("hides one workspace's redemptions from another, and lets the worker drain across them", async () => {
    const id = await rowIn('authorizing');
    await as('app_rw', B);
    expect((await c.query(`SELECT id FROM yourtal_voucher_redemptions WHERE id = $1`, [id])).rows).toEqual([]);
    const upd = await c.query(
      `UPDATE yourtal_voucher_redemptions SET attempts = attempts + 1 WHERE id = $1 RETURNING id`,
      [id],
    );
    expect(upd.rows).toEqual([]);

    // The worker sees and moves it with no workspace context: it is a queue.
    await as('app_worker', null);
    const due = await c.query(
      `SELECT id FROM yourtal_voucher_redemptions
        WHERE id = $1 AND status NOT IN ('granted','voided','expired','refused','abandoned','failed')`,
      [id],
    );
    expect(due.rows).toHaveLength(1);
    const moved = await c.query(
      `UPDATE yourtal_voucher_redemptions
          SET status = 'authorized', authorization_id = 'auth-w-' || id, attempts = attempts + 1
        WHERE id = $1 RETURNING status`,
      [id],
    );
    expect(moved.rows).toEqual([{ status: 'authorized' }]);
  });

  it('lets the API update only the progress columns: identity cannot be named', async () => {
    const id = await rowIn('authorizing');
    await as('app_rw', A);
    for (const [col, val] of [
      ['tenant_id', B],
      ['user_id', OTHER],
      ['link_row_id', OTHER_LINK],
      ['code_sha256', hash()],
      ['face_minor', 1000],
      ['currency', 'AUD'],
      ['credits', 100],
      ['merchant_order_ref', 'snap-other'],
      ['authorize_key', randomUUID()],
      ['capture_key', randomUUID()],
      ['void_key', randomUUID()],
      ['created_at', new Date()],
    ] as const) {
      expect(
        await failure(`UPDATE yourtal_voucher_redemptions SET ${col} = $2 WHERE id = $1`, [id, val]),
        col,
      ).toMatch(/^42501 permission denied/);
    }
    // The request path's own moves are fine.
    const ok = await c.query(
      `UPDATE yourtal_voucher_redemptions
          SET status = 'authorized', authorization_id = 'auth-api-' || id, hold_expires_at = now() + interval '15 minutes'
        WHERE id = $1 RETURNING status`,
      [id],
    );
    expect(ok.rows).toEqual([{ status: 'authorized' }]);
  });

  // ── The guard trigger (as the owner: it holds even where grants do not) ───

  it('refuses any change to identity columns, keys and the order ref', async () => {
    const id = await rowIn('authorized');
    await owner();
    for (const [col, val] of [
      ['tenant_id', B],
      ['code_sha256', hash()],
      ['face_minor', 1000],
      ['currency', 'XXX'], // the guard runs before the CHECK
      ['credits', 100],
      ['merchant_order_ref', 'snap-rewritten'],
      ['authorize_key', randomUUID()],
      ['capture_key', randomUUID()],
      ['void_key', randomUUID()],
      ['created_at', new Date(0)],
      ['user_id', OTHER],
      ['link_row_id', OTHER_LINK],
    ] as const) {
      expect(
        await failure(`UPDATE yourtal_voucher_redemptions SET ${col} = $2 WHERE id = $1`, [id, val]),
        col,
      ).toMatch(/^23514 .*never change/);
    }
  });

  it('keeps authorization_id, receipt_id and grant_id write-once', async () => {
    const id = await rowIn('granted');
    await owner();
    for (const col of ['authorization_id', 'receipt_id']) {
      expect(await failure(`UPDATE yourtal_voucher_redemptions SET ${col} = 'rewritten' WHERE id = $1`, [id]), col).toMatch(
        new RegExp(`^23514 .*${col} is write-once`),
      );
      expect(await failure(`UPDATE yourtal_voucher_redemptions SET ${col} = NULL WHERE id = $1`, [id]), col).toMatch(
        new RegExp(`^23514 .*${col} is write-once`),
      );
    }
    await c.query('BEGIN');
    const g2 = await voucherGrant(A);
    expect(await failure(`UPDATE yourtal_voucher_redemptions SET grant_id = $2 WHERE id = $1`, [id, g2])).toMatch(
      /^23514 .*grant_id is write-once/,
    );
    await c.query('ROLLBACK');
    // Writing the same value again is not a change.
    await c.query(
      `UPDATE yourtal_voucher_redemptions SET authorization_id = authorization_id, receipt_id = receipt_id,
              grant_id = grant_id, last_error = 'noted' WHERE id = $1`,
      [id],
    );
  });

  it('allows exactly the docs/28 status moves, from every state to every other', { timeout: 180_000 }, async () => {
    // 12 x 11 attempts. Each is ONE round trip (a multi-statement simple
    // query: every value is a uuid or a state name generated here), then a
    // ROLLBACK, so the matrix stays fast on a slow Docker host.
    const wrong: string[] = [];
    let tried = 0;
    for (const from of STATES) {
      const id = await rowIn(from);
      await owner();
      for (const to of STATES) {
        if (to === from) continue;
        const g = randomUUID();
        const grant =
          to === 'granted'
            ? `INSERT INTO usage_grants (id, tenant_id, metric, amount, remaining, source)
               VALUES ('${g}', '${A}', 'scans', 50, 50, 'yourtal_voucher');`
            : '';
        let err: string | null = null;
        let updated = -1;
        try {
          const res = (await c.query(
            `BEGIN; ${grant}
             UPDATE yourtal_voucher_redemptions
                SET status = '${to}',
                    receipt_id = CASE WHEN '${to}' IN ('captured','granted') THEN COALESCE(receipt_id, 'rcpt-m-' || id) ELSE receipt_id END,
                    grant_id = CASE WHEN '${to}' = 'granted' THEN COALESCE(grant_id, '${g}'::uuid) ELSE grant_id END
              WHERE id = '${id}';
             SET CONSTRAINTS ALL IMMEDIATE;`, // runs the deferred grant check now
          )) as unknown as { command: string; rowCount: number | null }[];
          updated = res.find((r) => r.command === 'UPDATE')?.rowCount ?? -1;
        } catch (e) {
          const x = e as Error & { code?: string };
          err = `${x.code ?? ''} ${x.message}`;
        } finally {
          await c.query('ROLLBACK');
        }
        tried += 1;
        const allowed = MOVES[from].includes(to);
        if (allowed && err) wrong.push(`${from} -> ${to} refused: ${err}`);
        if (allowed && !err && updated !== 1) wrong.push(`${from} -> ${to} updated ${updated} rows`);
        if (!allowed && !err) wrong.push(`${from} -> ${to} allowed`);
        if (!allowed && err && !/^23514 .*status may not move/.test(err)) {
          wrong.push(`${from} -> ${to} refused for the wrong reason: ${err}`);
        }
      }
    }
    expect(tried).toBe(STATES.length * (STATES.length - 1));
    expect(wrong, wrong.join('\n')).toEqual([]);
  });

  it('keeps operational updates on a final row (same status) but never moves it', async () => {
    const id = await rowIn('refused');
    await as('app_rw', A);
    await c.query(
      `UPDATE yourtal_voucher_redemptions SET last_code = 'authorization_refused', last_http_status = 402, finished_at = now() WHERE id = $1`,
      [id],
    );
    expect(await failure(`UPDATE yourtal_voucher_redemptions SET status = 'authorizing' WHERE id = $1`, [id])).toMatch(
      /^23514 .*status may not move from refused to authorizing/,
    );
  });

  it('requires a receipt for captured and granted, and a grant exactly when granted', async () => {
    const id = await rowIn('authorized');
    await owner();
    expect(await failure(`UPDATE yourtal_voucher_redemptions SET status = 'captured' WHERE id = $1`, [id])).toMatch(
      /^23514 .*yourtal_voucher_redemptions_captured_has_receipt/,
    );
    await step(id, 'captured');
    expect(await failure(`UPDATE yourtal_voucher_redemptions SET status = 'granted' WHERE id = $1`, [id])).toMatch(
      /^23514 .*yourtal_voucher_redemptions_granted_has_grant/,
    );
  });

  // ── One live row per code ─────────────────────────────────────────────────

  it('allows one in-progress or granted row per code hash, and frees it after a final that took nothing', async () => {
    const h = hash();
    await as('app_rw', A);
    const first = await insert({ code_sha256: h });
    expect(first.error).toBeUndefined();
    expect((await insert({ code_sha256: h })).error).toMatch(
      /^23505 .*yourtal_voucher_redemptions_one_live_per_code/,
    );
    // Voided: the code is free again, with a new order ref.
    await c.query(`UPDATE yourtal_voucher_redemptions SET status = 'voided' WHERE id = $1`, [first.id]);
    const second = await insert({ code_sha256: h });
    expect(second.error).toBeUndefined();
    // Granted: never again.
    await owner();
    for (const s of PATH.granted) await step(second.id!, s);
    await as('app_rw', A);
    expect((await insert({ code_sha256: h })).error).toMatch(
      /^23505 .*yourtal_voucher_redemptions_one_live_per_code/,
    );
    // Every in-progress state holds the hash too.
    for (const s of ['authorized', 'capturing', 'captured', 'voiding', 'needs_review'] as const) {
      const h2 = hash();
      await rowIn(s, { code_sha256: h2 });
      await as('app_rw', A);
      expect((await insert({ code_sha256: h2 })).error, s).toMatch(/^23505 /);
    }
  });

  it('keeps the order ref, the keys, the authorization and the receipt unique', async () => {
    const id = await rowIn('captured');
    const row = (
      await c.query(`SELECT * FROM yourtal_voucher_redemptions WHERE id = $1`, [id])
    ).rows[0] as Record<string, string>;
    await as('app_rw', A);
    expect((await insert({ merchant_order_ref: row.merchant_order_ref })).error).toMatch(/^23505 /);
    expect((await insert({ authorize_key: row.authorize_key })).error).toMatch(/^23505 /);
    expect((await insert({ capture_key: row.capture_key })).error).toMatch(/^23505 /);
    expect((await insert({ void_key: row.void_key })).error).toMatch(/^23505 /);
    const other = await rowIn('authorizing');
    await owner();
    expect(
      await failure(
        `UPDATE yourtal_voucher_redemptions SET status = 'authorized', authorization_id = $2 WHERE id = $1`,
        [other, row.authorization_id],
      ),
    ).toMatch(/^23505 /);
    expect(
      await failure(
        `UPDATE yourtal_voucher_redemptions SET status = 'captured', receipt_id = $2 WHERE id = $1`,
        [other, row.receipt_id],
      ),
    ).toMatch(/^23505 /);
  });

  // ── The grant ─────────────────────────────────────────────────────────────

  it('refuses at COMMIT a yourtal_voucher grant with no granted redemption', async () => {
    await as('app_rw', A);
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO usage_grants (id, tenant_id, metric, amount, remaining, source)
       VALUES (gen_random_uuid(), current_tenant_id(), 'scans', 50, 50, 'yourtal_voucher')`,
    );
    const err = await failure('COMMIT');
    expect(err).toMatch(/^23514 .*needs exactly one granted redemption/);
    await owner();
    expect(
      (await c.query(`SELECT count(*)::int AS n FROM usage_grants WHERE tenant_id = $1 AND source = 'yourtal_voucher'
                       AND id NOT IN (SELECT grant_id FROM yourtal_voucher_redemptions WHERE grant_id IS NOT NULL)`, [A]))
        .rows[0].n,
    ).toBe(0);
  });

  it('commits the grant and the redemption together, as the API in the request path', async () => {
    const id = await rowIn('captured');
    await as('app_rw', A);
    await c.query('BEGIN');
    const g = randomUUID();
    await c.query(
      `INSERT INTO usage_grants (id, tenant_id, metric, amount, remaining, source)
       VALUES ($1, current_tenant_id(), 'scans', 50, 50, 'yourtal_voucher')`,
      [g],
    );
    // The grant locks the row and requires captured with grant_id NULL (S4).
    const locked = await c.query(
      `SELECT id FROM yourtal_voucher_redemptions WHERE id = $1 AND status = 'captured' AND grant_id IS NULL FOR UPDATE`,
      [id],
    );
    expect(locked.rows).toHaveLength(1);
    await c.query(
      `UPDATE yourtal_voucher_redemptions SET status = 'granted', grant_id = $2, finished_at = now() WHERE id = $1`,
      [id, g],
    );
    await c.query('COMMIT');
    const credits = await c.query(
      `SELECT g.amount, g.remaining, r.status FROM usage_grants g JOIN yourtal_voucher_redemptions r ON r.grant_id = g.id WHERE g.id = $1`,
      [g],
    );
    expect(credits.rows).toEqual([{ amount: 50, remaining: 50, status: 'granted' }]);

    // Spending a voucher credit is an ordinary decrement: nothing fires.
    await c.query(`UPDATE usage_grants SET remaining = remaining - 1 WHERE id = $1`, [g]);

    // The voucher grant cannot be resized, re-sourced or deleted afterwards.
    expect(await failure(`UPDATE usage_grants SET amount = 60, remaining = 60 WHERE id = $1`, [g])).toMatch(
      /^23514 .*needs exactly one granted redemption/,
    );
    expect(await failure(`UPDATE usage_grants SET source = 'topup_pack' WHERE id = $1`, [g])).toMatch(
      /^23514 .*keeps its source/,
    );
    expect(await failure(`DELETE FROM usage_grants WHERE id = $1`, [g])).toMatch(/^23503 /);
  });

  it('refuses a redemption naming a grant that is not its own voucher grant', async () => {
    const id = await rowIn('captured');
    await as('app_rw', A);
    for (const [source, amount] of [
      ['topup_pack', 50],
      ['yourtal_voucher', 40],
    ] as const) {
      await c.query('BEGIN');
      const g = randomUUID();
      await c.query(
        `INSERT INTO usage_grants (id, tenant_id, metric, amount, remaining, source)
         VALUES ($1, current_tenant_id(), 'scans', $2, $2, $3)`,
        [g, amount, source],
      );
      expect(
        await failure(`UPDATE yourtal_voucher_redemptions SET status = 'granted', grant_id = $2 WHERE id = $1`, [id, g]),
        `${source} ${amount}`,
      ).toMatch(/^23514 .*is not a yourtal_voucher grant of 50 credits in this workspace/);
      await c.query('ROLLBACK');
    }
    // A voucher grant in ANOTHER workspace (made by the owner) is not visible, nor accepted.
    await owner();
    await c.query('BEGIN');
    const gb = await voucherGrant(B);
    await as('app_rw', A);
    expect(
      await failure(`UPDATE yourtal_voucher_redemptions SET status = 'granted', grant_id = $2 WHERE id = $1`, [id, gb]),
    ).toMatch(/^23514 .*is not a yourtal_voucher grant/);
    await c.query('ROLLBACK');
  });

  it('refuses the worker a grant outside the workspace context (fail closed)', async () => {
    const id = await rowIn('captured');
    await owner();
    await c.query('BEGIN');
    const g = await voucherGrant(A);
    await as('app_worker', null);
    expect(
      await failure(`UPDATE yourtal_voucher_redemptions SET status = 'granted', grant_id = $2 WHERE id = $1`, [id, g]),
    ).toMatch(/^23514 .*is not a yourtal_voucher grant/);
    await c.query('ROLLBACK');
  });

  it('leaves topup_pack and signup_bonus grants exactly as they were', async () => {
    await as('app_rw', A);
    await c.query('BEGIN');
    const ids = [randomUUID(), randomUUID()];
    await c.query(
      `INSERT INTO usage_grants (id, tenant_id, metric, amount, remaining, source) VALUES
         ($1, current_tenant_id(), 'scans', 50, 50, 'topup_pack'),
         ($2, current_tenant_id(), 'scans', 10, 10, 'signup_bonus')`,
      ids,
    );
    await c.query(`UPDATE usage_grants SET remaining = remaining - 1 WHERE id = ANY($1::uuid[])`, [ids]);
    await c.query(`UPDATE usage_grants SET amount = amount + 5, remaining = remaining + 5 WHERE id = $1`, [ids[0]]);
    await c.query('COMMIT');
    const rows = await c.query(
      `SELECT source, amount, remaining FROM usage_grants WHERE id = ANY($1::uuid[]) ORDER BY source`,
      [ids],
    );
    expect(rows.rows).toEqual([
      { source: 'signup_bonus', amount: 10, remaining: 9 },
      { source: 'topup_pack', amount: 55, remaining: 54 },
    ]);
    // The constraint triggers carry a WHEN clause, so ordinary grants never reach the function.
    await owner();
    const whens = await c.query<{ tgname: string; def: string }>(
      `SELECT tgname, pg_get_triggerdef(oid) AS def FROM pg_trigger
        WHERE tgrelid = 'usage_grants'::regclass AND tgname LIKE 'usage_grants_yourtal_voucher_backed_%' ORDER BY tgname`,
    );
    expect(whens.rows).toHaveLength(2);
    for (const r of whens.rows) {
      expect(r.def).toMatch(/DEFERRABLE INITIALLY DEFERRED/);
      expect(r.def).toMatch(/WHEN .*'yourtal_voucher'/);
    }
  });

  // ── Deletes elsewhere ─────────────────────────────────────────────────────

  it("keeps the redemption when its user or link is deleted (SET NULL passes the guard)", async () => {
    // GONE (admin of A) redeems, then the account goes.
    await as('app_rw', A, GONE);
    const r = await insert({ user_id: GONE, link_row_id: GONE_LINK });
    expect(r.error).toBeUndefined();
    await owner();
    await c.query(`DELETE FROM users WHERE id = $1`, [GONE]);
    const row = await c.query(`SELECT user_id, link_row_id, status FROM yourtal_voucher_redemptions WHERE id = $1`, [r.id]);
    expect(row.rows).toEqual([{ user_id: null, link_row_id: null, status: 'authorizing' }]);
    // Once NULL, it stays NULL.
    expect(await failure(`UPDATE yourtal_voucher_redemptions SET user_id = $2 WHERE id = $1`, [r.id, USER])).toMatch(
      /^23514 .*user_id never changes/,
    );
  });

  // ── The migration itself ──────────────────────────────────────────────────

  it("passes its own self-check, and the check fails when a grant is widened", async () => {
    const body = readFileSync(MIGRATION, 'utf8');
    const selfCheck = body.slice(body.indexOf('-- ── Self-check'));
    expect(selfCheck).toMatch(/^-- ── Self-check[\s\S]*DO \$\$[\s\S]*END \$\$;\s*$/);
    await owner();
    await c.query(selfCheck);

    for (const widen of [
      'GRANT DELETE ON yourtal_voucher_redemptions TO app_rw',
      'GRANT UPDATE ON yourtal_voucher_redemptions TO app_rw',
      'GRANT UPDATE (credits) ON yourtal_voucher_redemptions TO app_rw',
      'GRANT SELECT ON yourtal_voucher_redemptions TO app_readonly',
      'GRANT DELETE ON yourtal_voucher_redemptions TO app_worker',
      'ALTER TABLE yourtal_voucher_redemptions NO FORCE ROW LEVEL SECURITY',
      'ALTER TABLE usage_grants DISABLE TRIGGER usage_grants_yourtal_voucher_backed_insert',
      'ALTER TABLE yourtal_voucher_redemptions DISABLE TRIGGER yourtal_voucher_redemptions_guard',
    ]) {
      await c.query('BEGIN');
      await c.query(widen);
      const err = await failure(selfCheck);
      await c.query('ROLLBACK');
      expect(err, widen).toMatch(/^P0001 /);
    }
  });

  it('applies to a database that already holds data, leaving existing rows alone', async () => {
    await owner();
    const before = await c.query(
      `SELECT (SELECT count(*) FROM usage_grants)::int AS grants,
              (SELECT coalesce(sum(remaining), 0) FROM usage_grants)::int AS remaining,
              (SELECT count(*) FROM yourtal_links)::int AS links,
              (SELECT count(*) FROM tenants)::int AS tenants`,
    );
    expect(before.rows[0].grants).toBeGreaterThan(0);

    // Re-create the migration's objects from scratch inside a transaction, over
    // every row this database already holds, then roll the experiment back.
    await c.query('BEGIN');
    try {
      await c.query('DROP TABLE yourtal_voucher_redemptions CASCADE');
      await c.query('DROP FUNCTION usage_grants_yourtal_voucher_backed() CASCADE');
      await c.query('DROP FUNCTION yourtal_voucher_redemptions_guard() CASCADE');
      await c.query(readFileSync(MIGRATION, 'utf8'));
      const after = await c.query(
        `SELECT (SELECT count(*) FROM usage_grants)::int AS grants,
                (SELECT coalesce(sum(remaining), 0) FROM usage_grants)::int AS remaining,
                (SELECT count(*) FROM yourtal_links)::int AS links,
                (SELECT count(*) FROM tenants)::int AS tenants,
                (SELECT count(*) FROM yourtal_voucher_redemptions)::int AS redemptions`,
      );
      expect(after.rows[0]).toEqual({ ...before.rows[0], redemptions: 0 });
      // Ordinary grants still commit under the re-created triggers.
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [A]);
      await c.query(
        `INSERT INTO usage_grants (id, tenant_id, metric, amount, remaining, source)
         VALUES (gen_random_uuid(), $1, 'scans', 10, 10, 'topup_pack')`,
        [A],
      );
      await c.query('SET CONSTRAINTS ALL IMMEDIATE');
    } finally {
      await c.query('ROLLBACK');
    }
  });

  it('goes with its workspace: deleting a tenant removes its redemptions and voucher grants together', async () => {
    const id = await rowIn('granted');
    await owner();
    const g = (await c.query(`SELECT grant_id FROM yourtal_voucher_redemptions WHERE id = $1`, [id])).rows[0].grant_id;
    expect(g).toBeTruthy();
    await c.query('BEGIN');
    await c.query(`DELETE FROM tenants WHERE id = $1`, [A]);
    await c.query('SET CONSTRAINTS ALL IMMEDIATE');
    const left = await c.query(
      `SELECT (SELECT count(*) FROM yourtal_voucher_redemptions WHERE tenant_id = $1)::int AS r,
              (SELECT count(*) FROM usage_grants WHERE tenant_id = $1)::int AS g`,
      [A],
    );
    expect(left.rows[0]).toEqual({ r: 0, g: 0 });
    await c.query('ROLLBACK');
  });
});
