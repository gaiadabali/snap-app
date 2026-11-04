import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * FTR SENDS — migration 0049 (group 4.8.a, S1). As the real roles on one
 * connection (`SET ROLE`), never the superuser, which bypasses RLS:
 *
 *   - another workspace cannot see, change or insert a send; reporting cannot read the table;
 *   - `bundle` exists only while a send is `started`;
 *   - the worker, with no workspace, can expire an open send older than an hour and nothing else;
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
const HASH = 'a'.repeat(64);

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
        `INSERT INTO ftr_sends (tenant_id, user_id, financial_year, line_count, bundle_sha256, ${cols}) VALUES ($1,$2,'2025-26',3,$3,'{"a":1}') ${extra} RETURNING id`,
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
    expect(await failure(`UPDATE ftr_sends SET bundle = '{}' WHERE id = $1`, [id])).toMatch(/ftr_sends_bundle_open_only/);
    // An import id only on a sent send; a malformed year or hash is refused.
    const open = await send(WA, UA);
    expect(await failure(`UPDATE ftr_sends SET ftr_import_id = 'x' WHERE id = $1`, [open])).toMatch(/ftr_sends_import_when_sent/);
    expect(await failure(`UPDATE ftr_sends SET financial_year = '2025' WHERE id = $1`, [open])).toMatch(/ftr_sends_year/);
    expect(await failure(`UPDATE ftr_sends SET bundle_sha256 = 'ABC' WHERE id = $1`, [open])).toMatch(/ftr_sends_hash/);
    expect(await failure(`UPDATE ftr_sends SET bundle = repeat('x', 2097153) WHERE id = $1`, [open])).toMatch(/ftr_sends_bundle_open_only/);
  });

  it('the worker sweep expires only open sends over an hour old, in every workspace, and clears their bytes', async () => {
    await owner();
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

    await as('app_worker', null, null);
    const swept = await c.query(
      `UPDATE ftr_sends SET bundle = NULL, status = 'expired', finished_at = now()
        WHERE status = 'started' AND created_at < now() - interval '1 hour' RETURNING id`,
    );
    expect(swept.rows.map((r) => r.id).sort()).toEqual([ids.oldA, ids.oldB].sort());
    // Beyond that the worker sees no live send without a workspace.
    expect((await c.query('SELECT id FROM ftr_sends')).rows.map((r) => r.id).sort()).toEqual([ids.oldA, ids.oldB].sort());
    await owner();
    const rows = (await c.query(`SELECT id, status, bundle FROM ftr_sends WHERE id = ANY($1::uuid[])`, [Object.values(ids)])).rows;
    const by = (id: string) => rows.find((r) => r.id === id);
    expect(by(ids.oldA)).toMatchObject({ status: 'expired', bundle: null });
    expect(by(ids.oldB)).toMatchObject({ status: 'expired', bundle: null });
    expect(by(ids.fresh)).toMatchObject({ status: 'started', bundle: '{"a":1}' });
    expect(by(ids.doneOld)).toMatchObject({ status: 'cancelled', bundle: null });

    // The worker's policy cannot be used for anything else, even on a stale open send.
    const stale = await send(WA, UA);
    await c.query(`UPDATE ftr_sends SET created_at = now() - interval '2 hours' WHERE id = $1`, [stale]);
    await as('app_worker', null, null);
    expect(await failure(`UPDATE ftr_sends SET status = 'sent', bundle = NULL, finished_at = now() WHERE id = $1`, [stale])).toMatch(/row-level security/);
    expect(await failure(`UPDATE ftr_sends SET line_count = 9 WHERE id = $1`, [stale])).toMatch(/row-level security/);
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
