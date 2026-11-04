import { createHash } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * FTR SENDS — migration 0049 (group 4.8.a, S1). As the real roles on one
 * connection (`SET ROLE`), never the superuser, which bypasses RLS:
 *
 *   - another workspace cannot see, change or insert a send; reporting cannot read the table;
 *   - `bundle` exists only while a send is `started`;
 *   - the worker has no policy on the table: with no workspace it sees and changes nothing, and
 *     ftr_sends_expire_stale() is its only way to expire an open send older than an hour;
 *   - erase_person (0043) takes a person's sends and the sign-in flows that point at them;
 *   - 0043's self-checks (spill guard, pinned-FK list) still pass with the new foreign keys.
 */

const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

const WA = 'f7500000-0000-4000-8000-0000000000a0';
const WB = 'f7500000-0000-4000-8000-0000000000b0';
const UA = 'f7500000-0000-4000-8000-0000000000a1';
const UB = 'f7500000-0000-4000-8000-0000000000b1';
const SUB_A = 'ftr-sends-test-a';
const BUNDLE = '{"a":1}';
// The hash of BUNDLE (a CHECK binds the bytes held to the hash), and a dummy for rows with no bytes.
const HASH = createHash('sha256').update(BUNDLE).digest('hex');
const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

describeIfDb('ftr_sends (migration 0049)', () => {
  let c: Client;

  async function as(role: 'app_rw' | 'app_readonly' | 'app_worker', userId: string | null, tenantId: string | null) {
    await c.query('RESET ROLE');
    await c.query(`SET ROLE ${role}`);
    await c.query(`SELECT set_config('app.user_id', $1, false), set_config('app.tenant_id', $2, false)`, [
      userId ?? '',
      tenantId ?? '',
    ]);
  }
  const owner = async () => {
    await c.query('RESET ROLE');
    await c.query(`SELECT set_config('app.user_id','',false), set_config('app.tenant_id','',false)`);
  };
  const failure = (sqlText: string, params: unknown[] = []) =>
    c.query(sqlText, params as never[]).then(
      () => null,
      (e: Error & { code?: string }) => `${e.code ?? ''} ${e.message}`,
    );
  const send = async (tenant: string, user: string, extra = '', cols = 'bundle') =>
    (
      await c.query(
        `INSERT INTO ftr_sends (tenant_id, user_id, financial_year, line_count, bundle_sha256, ${cols}) VALUES ($1,$2,'2025-26',3,$3,'${BUNDLE}') ${extra} RETURNING id`,
        [tenant, user, HASH],
      )
    ).rows[0].id as string;

  async function wipe() {
    await owner();
    await c.query('DELETE FROM yourtal_sign_in_flows WHERE state LIKE $1', ['ftr-sends-%']);
    await c.query('DELETE FROM ftr_sends WHERE tenant_id = ANY($1::uuid[])', [[WA, WB]]);
    await c.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [[WA, WB]]);
    await c.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[UA, UB]]);
    await c.query('DELETE FROM yourtal_erased_subjects WHERE sub = $1', [SUB_A]);
  }

  beforeAll(async () => {
    c = new Client({ connectionString: url });
    await c.connect();
    await wipe();
    await c.query(
      `INSERT INTO users (id, subject, email, display_name) VALUES
         ($1, $3, 'a@ftr-sends.test', 'A'), ($2, 'idp|ftr-sends-b', 'b@ftr-sends.test', 'B')`,
      [UA, UB, `yourtal|${SUB_A}`],
    );
    await c.query(`INSERT INTO tenants (id, name, kind) VALUES ($1,'A','personal'), ($2,'B','personal')`, [WA, WB]);
    await c.query(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1,$2,'owner'), ($3,$4,'owner')`, [
      WA, UA, WB, UB,
    ]);
  });

  afterAll(async () => {
    await wipe();
    await c.end();
  });

  it('another workspace cannot see, change or write a send; reporting has no access', async () => {
    await as('app_rw', UA, WA);
    const id = await send(WA, UA);
    expect((await c.query('SELECT id FROM ftr_sends')).rows).toEqual([{ id }]);

    await as('app_rw', UB, WB);
    expect((await c.query('SELECT id FROM ftr_sends')).rows).toEqual([]);
    expect((await c.query(`UPDATE ftr_sends SET status = 'cancelled', bundle = NULL, finished_at = now() RETURNING id`)).rows).toEqual([]);
    expect(await failure(`INSERT INTO ftr_sends (tenant_id, user_id, financial_year, line_count, bundle_sha256)
                          VALUES ($1, $2, '2025-26', 1, $3)`, [WA, UB, HASH])).toMatch(/^42501|row-level security/);
    // Nor with no workspace at all.
    await as('app_rw', UB, null);
    expect((await c.query('SELECT id FROM ftr_sends')).rows).toEqual([]);

    await as('app_readonly', UA, WA);
    expect(await failure('SELECT 1 FROM ftr_sends')).toMatch(/^42501/);
    // The API cannot delete either: only the cascades do.
    await as('app_rw', UA, WA);
    expect(await failure('DELETE FROM ftr_sends')).toMatch(/^42501/);
  });

  it('holds a bundle only while started, within 2 MB, and every finish closes the row', async () => {
    await as('app_rw', UA, WA);
    const id = await send(WA, UA);
    // Closing without dropping the bytes, or without a finish time, is refused.
    expect(await failure(`UPDATE ftr_sends SET status = 'sent', finished_at = now() WHERE id = $1`, [id])).toMatch(/ftr_sends_bundle_open_only/);
    expect(await failure(`UPDATE ftr_sends SET status = 'sent', bundle = NULL WHERE id = $1`, [id])).toMatch(/ftr_sends_finished/);
    await c.query(`UPDATE ftr_sends SET status = 'sent', bundle = NULL, ftr_import_id = 'imp-1', finished_at = now() WHERE id = $1`, [id]);
    // Bytes cannot be put back on a closed send.
    expect(await failure(`UPDATE ftr_sends SET bundle = '{}' WHERE id = $1`, [id])).toMatch(/closed send/);
    // An import id only on a sent send; a malformed year or hash is refused.
    const open = await send(WA, UA);
    expect(await failure(`UPDATE ftr_sends SET ftr_import_id = 'x' WHERE id = $1`, [open])).toMatch(/ftr_sends_import_when_sent/);
    expect(await failure(`UPDATE ftr_sends SET financial_year = '2025' WHERE id = $1`, [open])).toMatch(/ftr_sends_year/);
    expect(await failure(`UPDATE ftr_sends SET bundle_sha256 = 'ABC' WHERE id = $1`, [open])).toMatch(/ftr_sends_(bundle_)?hash/);
    // The cap is in BYTES: 2 MiB of ASCII passes, one more byte fails, and 2 MiB of a 3-byte character (6 MiB) fails.
    const big = (n: number, ch = 'x') => ch.repeat(n);
    const setBundle = (id: string, text: string) =>
      failure(`UPDATE ftr_sends SET bundle = $2, bundle_sha256 = $3 WHERE id = $1`, [id, text, sha(text)]);
    expect(await setBundle(open, big(2097152))).toBeNull();
    expect(await setBundle(open, big(2097153))).toMatch(/ftr_sends_bundle_open_only/);
    expect(await setBundle(open, big(2097152, '\u20ac'))).toMatch(/ftr_sends_bundle_open_only/);
  });

  it('binds the bytes held to the hash, and a finish cannot predate the start', async () => {
    await as('app_rw', UA, WA);
    const open = await send(WA, UA);
    expect(await failure(`UPDATE ftr_sends SET bundle = '{"b":2}' WHERE id = $1`, [open])).toMatch(/ftr_sends_bundle_hash/);
    expect(await failure(`INSERT INTO ftr_sends (tenant_id, user_id, financial_year, line_count, bundle_sha256, bundle)
                          VALUES ($1, $2, '2025-26', 1, $3, '{"b":2}')`, [WA, UA, HASH])).toMatch(/ftr_sends_bundle_hash/);
    expect(await failure(`UPDATE ftr_sends SET status = 'failed', bundle = NULL, finished_at = created_at - interval '1 second' WHERE id = $1`, [open])).toMatch(/ftr_sends_finished_after_created/);
    await c.query(`UPDATE ftr_sends SET status = 'failed', bundle = NULL, finished_at = now() WHERE id = $1`, [open]);
  });

  it('a closed send is final: no reopening, no change at all, for the API or the owner', async () => {
    await as('app_rw', UA, WA);
    const id = await send(WA, UA);
    await c.query(`UPDATE ftr_sends SET status = 'sent', bundle = NULL, ftr_import_id = 'imp-2', finished_at = now() WHERE id = $1`, [id]);
    expect(await failure(`UPDATE ftr_sends SET status = 'started', ftr_import_id = NULL, finished_at = NULL, bundle = '${BUNDLE}' WHERE id = $1`, [id])).toMatch(/closed send/);
    expect(await failure(`UPDATE ftr_sends SET error = 'x' WHERE id = $1`, [id])).toMatch(/closed send/);
    await owner();
    expect(await failure(`UPDATE ftr_sends SET line_count = 9 WHERE id = $1`, [id])).toMatch(/closed send/);
  });

  it('the worker has no policy: with no workspace it sees and changes no row, even a stale open send', async () => {
    await owner();
    const stale = await send(WA, UA);
    await c.query(`UPDATE ftr_sends SET created_at = now() - interval '2 hours' WHERE id = $1`, [stale]);
    await as('app_worker', null, null);
    expect((await c.query('SELECT id, bundle FROM ftr_sends')).rows).toEqual([]);
    // The forgery the first draft's policy allowed: expire AND move the row to workspace B.
    const forged = await c.query(
      `UPDATE ftr_sends SET status = 'expired', bundle = NULL, finished_at = now(), tenant_id = $2, user_id = $3, line_count = 999
        WHERE id = $1 RETURNING id`,
      [stale, WB, UB],
    );
    expect(forged.rows).toEqual([]);
    expect((await c.query(`UPDATE ftr_sends SET status = 'expired', bundle = NULL, finished_at = now() WHERE id = $1 RETURNING id`, [stale])).rows).toEqual([]);
    expect(await failure(`INSERT INTO ftr_sends (tenant_id, user_id, financial_year, line_count, bundle_sha256) VALUES ($1, $2, '2025-26', 1, $3)`, [WA, UA, HASH])).toMatch(/row-level security/);
    await owner();
    expect((await c.query(`SELECT tenant_id, user_id, line_count, status, bundle FROM ftr_sends WHERE id = $1`, [stale])).rows).toEqual([
      { tenant_id: WA, user_id: UA, line_count: 3, status: 'started', bundle: BUNDLE },
    ]);
  });

  it('ftr_sends_expire_stale() expires only open sends over an hour old, in every workspace, clears their bytes, and is the worker\'s alone', async () => {
    await owner();
    await c.query(`DELETE FROM ftr_sends WHERE tenant_id = ANY($1::uuid[])`, [[WA, WB]]);
    const ids = {
      oldA: await send(WA, UA),
      oldB: await send(WB, UB),
      fresh: await send(WA, UA),
      doneOld: await send(WA, UA),
    };
    await c.query(`UPDATE ftr_sends SET created_at = now() - interval '61 minutes' WHERE id = ANY($1::uuid[])`, [
      [ids.oldA, ids.oldB, ids.doneOld],
    ]);
    await c.query(`UPDATE ftr_sends SET status = 'cancelled', bundle = NULL, finished_at = now() WHERE id = $1`, [ids.doneOld]);

    // Nobody else may call it.
    for (const role of ['app_rw', 'app_readonly'] as const) {
      await as(role, UA, WA);
      expect(await failure('SELECT ftr_sends_expire_stale()')).toMatch(/^42501/);
    }
    await as('app_worker', null, null);
    expect((await c.query('SELECT ftr_sends_expire_stale() AS n')).rows).toEqual([{ n: 2 }]);
    // Idempotent, and the worker still sees nothing directly.
    expect((await c.query('SELECT ftr_sends_expire_stale() AS n')).rows).toEqual([{ n: 0 }]);
    expect((await c.query('SELECT id FROM ftr_sends')).rows).toEqual([]);
    await owner();
    const rows = (await c.query(`SELECT id, status, bundle, tenant_id FROM ftr_sends WHERE id = ANY($1::uuid[])`, [Object.values(ids)])).rows;
    const by = (id: string) => rows.find((r) => r.id === id);
    expect(by(ids.oldA)).toMatchObject({ status: 'expired', bundle: null, tenant_id: WA });
    expect(by(ids.oldB)).toMatchObject({ status: 'expired', bundle: null, tenant_id: WB });
    expect(by(ids.fresh)).toMatchObject({ status: 'started', bundle: BUNDLE });
    expect(by(ids.doneOld)).toMatchObject({ status: 'cancelled', bundle: null });
  });

  it('erase_person takes the person\'s sends and the sign-in flows that point at them, and no one else\'s', async () => {
    await owner();
    const mine = await send(WA, UA);
    const theirs = await send(WB, UB);
    await c.query(
      `INSERT INTO yourtal_sign_in_flows (client, state, nonce, code_verifier, expires_at, ftr_send_id) VALUES
         ('web', 'ftr-sends-1', 'n', 'v', now() + interval '10 minutes', $1),
         ('web', 'ftr-sends-2', 'n', 'v', now() + interval '10 minutes', $2)`,
      [mine, theirs],
    );
    await as('app_worker', null, null);
    const out = await c.query('SELECT outcome FROM erase_person($1)', [UA]);
    expect(out.rows.length).toBeGreaterThan(0);
    await owner();
    expect((await c.query('SELECT id FROM ftr_sends WHERE id = $1', [mine])).rows).toEqual([]);
    expect((await c.query('SELECT 1 FROM yourtal_sign_in_flows WHERE state = $1', ['ftr-sends-1'])).rows).toEqual([]);
    expect((await c.query('SELECT id FROM ftr_sends WHERE id = $1', [theirs])).rows).toEqual([{ id: theirs }]);
    expect((await c.query('SELECT 1 FROM yourtal_sign_in_flows WHERE state = $1', ['ftr-sends-2'])).rows).toHaveLength(1);
  });

  it('deleting a send takes its flow; a send can be deleted with the workspace around it', async () => {
    await owner();
    const id = await send(WB, UB);
    await c.query(
      `INSERT INTO yourtal_sign_in_flows (client, state, nonce, code_verifier, expires_at, ftr_send_id)
       VALUES ('web', 'ftr-sends-3', 'n', 'v', now() + interval '10 minutes', $1)`,
      [id],
    );
    await c.query('DELETE FROM ftr_sends WHERE id = $1', [id]);
    expect((await c.query('SELECT 1 FROM yourtal_sign_in_flows WHERE state = $1', ['ftr-sends-3'])).rows).toEqual([]);
  });

  it('0043 still refuses to cross workspaces: a send in a workspace erased by erase_workspace is gone, others stay', async () => {
    await owner();
    const id = await send(WB, UB);
    await as('app_worker', null, null);
    // erase_person on B: B owns WB alone, so WB goes whole.
    await c.query('SELECT * FROM erase_person($1)', [UB]);
    await owner();
    expect((await c.query('SELECT 1 FROM ftr_sends WHERE id = $1', [id])).rows).toEqual([]);
    expect((await c.query('SELECT 1 FROM tenants WHERE id = $1', [WB])).rows).toEqual([]);
  });
});
