import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * 0050 (group 4.8.a, S2): the sign-in flow of a send to Free Tax Returns. As
 * `app_rw` (the API's role), which cannot read the flow table: every access is
 * a function. The two takes are each other's complement, so neither finish
 * can burn the other's flow.
 */

const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

const W = 'f7600000-0000-4000-8000-0000000000a0';
const U = 'f7600000-0000-4000-8000-0000000000a1';
const HASH = 'a'.repeat(64);

describeIfDb('ftr send flow functions (migration 0050)', () => {
  let c: Client;
  const owner = async () => {
    await c.query('RESET ROLE');
    await c.query(`SELECT set_config('app.user_id','',false), set_config('app.tenant_id','',false)`);
  };
  const asApi = async () => {
    await c.query('RESET ROLE');
    await c.query('SET ROLE app_rw');
  };
  const flow = async (state: string) =>
    (
      await c.query(
        `INSERT INTO yourtal_sign_in_flows (client, state, nonce, code_verifier, expires_at)
         VALUES ('web', $1, 'n', 'v', now() + interval '10 minutes') RETURNING id`,
        [state],
      )
    ).rows[0].id as string;
  const send = async () =>
    (
      await c.query(
        `INSERT INTO ftr_sends (tenant_id, user_id, financial_year, line_count, bundle_sha256) VALUES ($1,$2,'2025-26',1,$3) RETURNING id`,
        [W, U, HASH],
      )
    ).rows[0].id as string;

  async function wipe() {
    await owner();
    await c.query(`DELETE FROM yourtal_sign_in_flows WHERE state LIKE 'ftr-flow-%'`);
    await c.query('DELETE FROM ftr_sends WHERE tenant_id = $1', [W]);
    await c.query('DELETE FROM tenants WHERE id = $1', [W]);
    await c.query('DELETE FROM users WHERE id = $1', [U]);
  }

  beforeAll(async () => {
    c = new Client({ connectionString: url });
    await c.connect();
    await wipe();
    await c.query(`INSERT INTO users (id, subject, email, display_name) VALUES ($1,'idp|ftr-flow','u@ftr-flow.test','U')`, [U]);
    await c.query(`INSERT INTO tenants (id, name, kind) VALUES ($1,'W','personal')`, [W]);
  });
  afterAll(async () => {
    await wipe();
    await c.end();
  });

  it('the API role cannot read or write the flow table, only call the functions', async () => {
    await asApi();
    const err = await c.query('SELECT 1 FROM yourtal_sign_in_flows').then(() => null, (e: { code: string }) => e.code);
    expect(err).toBe('42501');
    await owner();
    expect(
      (await c.query(`SELECT has_function_privilege('app_readonly','identity_yourtal_flow_take_ftr_send(uuid)','EXECUTE') AS r`)).rows[0].r,
    ).toBe(false);
  });

  it('a send flow is taken only by the send take; a sign-in flow only by the sign-in take; neither burns the other', async () => {
    await owner();
    const sendId = await send();
    const withSend = await flow('ftr-flow-1');
    const plain = await flow('ftr-flow-2');
    await asApi();
    expect((await c.query('SELECT identity_yourtal_flow_set_ftr_send($1,$2) AS ok', [withSend, sendId])).rows[0].ok).toBe(true);
    // Linked once: a second link, and a flow already linked, are refused.
    expect((await c.query('SELECT identity_yourtal_flow_set_ftr_send($1,$2) AS ok', [withSend, sendId])).rows[0].ok).toBe(false);

    // The sign-in take refuses the send flow and leaves it usable...
    expect((await c.query('SELECT * FROM identity_yourtal_flow_take($1)', [withSend])).rows).toEqual([]);
    // ...and the send take refuses the plain flow, leaving that usable.
    expect((await c.query('SELECT * FROM identity_yourtal_flow_take_ftr_send($1)', [plain])).rows).toEqual([]);

    const taken = (await c.query('SELECT * FROM identity_yourtal_flow_take_ftr_send($1)', [withSend])).rows;
    expect(taken).toHaveLength(1);
    expect(taken[0]).toMatchObject({ state: 'ftr-flow-1', ftr_send_id: sendId });
    // Once only.
    expect((await c.query('SELECT * FROM identity_yourtal_flow_take_ftr_send($1)', [withSend])).rows).toEqual([]);
    expect((await c.query('SELECT state FROM identity_yourtal_flow_take($1)', [plain])).rows).toEqual([{ state: 'ftr-flow-2' }]);
  });

  it('an expired or used flow cannot be linked', async () => {
    await owner();
    const sendId = await send();
    const expired = (
      await c.query(
        `INSERT INTO yourtal_sign_in_flows (client, state, nonce, code_verifier, created_at, expires_at)
         VALUES ('web', 'ftr-flow-3', 'n', 'v', now() - interval '20 minutes', now() - interval '10 minutes') RETURNING id`,
      )
    ).rows[0].id as string;
    const used = await flow('ftr-flow-4');
    await c.query(`UPDATE yourtal_sign_in_flows SET consumed_at = now() WHERE id = $1`, [used]);
    await asApi();
    for (const id of [expired, used]) {
      expect((await c.query('SELECT identity_yourtal_flow_set_ftr_send($1,$2) AS ok', [id, sendId])).rows[0].ok).toBe(false);
    }
    expect((await c.query('SELECT identity_yourtal_flow_set_ftr_send($1,$2) AS ok', ['f7600000-0000-4000-8000-00000000ffff', sendId])).rows[0].ok).toBe(false);
  });
});
