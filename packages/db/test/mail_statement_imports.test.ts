import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * STATEMENTS MAILED TO SPAMBANK — migration 0062 (spambank/BUILD.md §4.8, §6).
 *
 * `mail_statement_imports` is USER-scoped. This proves what the header of 0062
 * promises, as the real application roles on one connection (`SET ROLE`
 * persists across statements; a superuser would bypass RLS and make every
 * isolation assertion pass vacuously — the reasoning of `rls.test.ts`):
 *
 *   - the API (app_rw) reads its own rows and cannot write any;
 *   - the worker (app_worker) writes only rows of the person it acts as;
 *   - (person, message, file) is imported once;
 *   - erasing the workspace or the capture leaves the person's row, pointing
 *     at nothing; erasing the person removes it.
 *
 * Requires DATABASE_URL as the schema owner (`pnpm db:up && pnpm db:migrate`).
 */

const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

const TENANT = '0b0a1200-5b00-4000-8000-000000000001';
const USER = '0b0a1200-5b00-4000-8000-000000000002';
const OTHER = '0b0a1200-5b00-4000-8000-000000000003';
const CAPTURE = '0b0a1200-5b00-4000-8000-000000000004';

describeIfDb('mail statement imports (migration 0062)', () => {
  let c: Client;

  async function as(role: 'app_rw' | 'app_worker', userId: string | null) {
    await c.query('RESET ROLE');
    await c.query(`SET ROLE ${role}`);
    await c.query(`SELECT set_config('app.user_id', $1, false)`, [userId ?? '']);
    await c.query(`SELECT set_config('app.tenant_id', '', false)`);
  }

  async function owner() {
    await c.query('RESET ROLE');
    await c.query(`SELECT set_config('app.user_id','',false)`);
    await c.query(`SELECT set_config('app.tenant_id','',false)`);
  }

  async function wipe() {
    await owner();
    await c.query('DELETE FROM mail_statement_imports WHERE user_id = ANY($1::uuid[])', [[USER, OTHER]]);
    await c.query('DELETE FROM captures WHERE tenant_id = $1', [TENANT]);
    await c.query('DELETE FROM memberships WHERE tenant_id = $1', [TENANT]);
    await c.query('DELETE FROM tenants WHERE id = $1', [TENANT]);
    await c.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[USER, OTHER]]);
  }

  const insert = (userId: string, emailId: string, blobId = 'B1') =>
    c.query(
      `INSERT INTO mail_statement_imports (user_id, email_id, blob_id, tenant_id, file_name) VALUES ($1, $2, $3, $4, 'nov.pdf')`,
      [userId, emailId, blobId, TENANT],
    );
  const visible = async () =>
    (await c.query<{ email_id: string }>('SELECT email_id FROM mail_statement_imports ORDER BY email_id')).rows.map((r) => r.email_id);

  beforeAll(async () => {
    c = new Client({ connectionString: url });
    await c.connect();
    await wipe();
    await c.query(
      `INSERT INTO users (id, subject, email, display_name)
       VALUES ($1, 'yourtal|stmt-imports-0062', 'stmt-imports@stmt-imports.test', 'Statement Importer'),
              ($2, 'idp|stmt-imports-other', 'stmt-other@stmt-imports.test', 'Other')`,
      [USER, OTHER],
    );
    await c.query(`INSERT INTO tenants (id, name, kind, country, base_currency) VALUES ($1, 'Imports co', 'personal', 'AU', 'AUD')`, [
      TENANT,
    ]);
    await c.query(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'owner')`, [TENANT, USER]);
  });

  afterAll(async () => {
    await wipe();
    await c.end();
  });

  it('the worker writes a row only for the person it acts as', async () => {
    await as('app_worker', USER);
    await insert(USER, 'M1');
    await expect(insert(OTHER, 'M2')).rejects.toThrow(/row-level security/);
    await as('app_worker', null);
    await expect(insert(USER, 'M3')).rejects.toThrow(/row-level security|invalid input/);
  });

  it('the worker updates only its person’s rows', async () => {
    await as('app_worker', USER);
    const mine = await c.query(`UPDATE mail_statement_imports SET status = 'imported', detail = 'queued' WHERE email_id = 'M1' RETURNING 1`);
    expect(mine.rowCount).toBe(1);
    await as('app_worker', OTHER);
    const theirs = await c.query(`UPDATE mail_statement_imports SET status = 'failed' WHERE email_id = 'M1' RETURNING 1`);
    expect(theirs.rowCount).toBe(0);
    await expect(c.query(`UPDATE mail_statement_imports SET user_id = $1`, [OTHER])).resolves.toMatchObject({ rowCount: 0 });
  });

  it('the API reads its own rows and nobody else’s, and cannot write', async () => {
    await as('app_rw', USER);
    expect(await visible()).toEqual(['M1']);
    await expect(insert(USER, 'M4')).rejects.toThrow(/permission denied/);
    await expect(c.query(`UPDATE mail_statement_imports SET status = 'failed'`)).rejects.toThrow(/permission denied/);
    await expect(c.query(`DELETE FROM mail_statement_imports`)).rejects.toThrow(/permission denied/);

    await as('app_rw', OTHER);
    expect(await visible()).toEqual([]);
  });

  it('nobody else holds anything on the table', async () => {
    await c.query('RESET ROLE');
    await c.query('SET ROLE app_readonly');
    await expect(c.query('SELECT 1 FROM mail_statement_imports')).rejects.toThrow(/permission denied/);
  });

  it('imports each (person, message, file) once, and refuses a bad status or id', async () => {
    await as('app_worker', USER);
    await expect(insert(USER, 'M1')).rejects.toThrow(/mail_statement_imports_once/);
    await insert(USER, 'M1', 'B2');
    await expect(
      c.query(`INSERT INTO mail_statement_imports (user_id, email_id, blob_id, status) VALUES ($1, 'M5', 'B1', 'done')`, [USER]),
    ).rejects.toThrow(/mail_statement_imports_status/);
    await expect(insert(USER, '../M6')).rejects.toThrow(/mail_statement_imports_ids/);
  });

  it('erasing the capture or the workspace keeps the row, pointing at nothing; erasing the person removes it', async () => {
    await owner();
    await c.query(
      `INSERT INTO captures (id, tenant_id, uploaded_by, original_storage_key, original_mime_type, original_byte_size, original_sha256)
       VALUES ($1, $2, $3, 'k', 'application/pdf', 10, decode(repeat('ab', 32), 'hex'))`,
      [CAPTURE, TENANT, USER],
    );
    await c.query(`UPDATE mail_statement_imports SET capture_id = $1 WHERE user_id = $2 AND email_id = 'M1' AND blob_id = 'B1'`, [CAPTURE, USER]);

    await c.query('DELETE FROM captures WHERE id = $1', [CAPTURE]);
    let row = (await c.query(`SELECT tenant_id, capture_id FROM mail_statement_imports WHERE user_id = $1 AND email_id = 'M1' AND blob_id = 'B1'`, [USER])).rows[0];
    expect(row).toEqual({ tenant_id: TENANT, capture_id: null });

    await c.query('DELETE FROM memberships WHERE tenant_id = $1', [TENANT]);
    await c.query('DELETE FROM tenants WHERE id = $1', [TENANT]);
    row = (await c.query(`SELECT tenant_id FROM mail_statement_imports WHERE user_id = $1 AND email_id = 'M1' AND blob_id = 'B1'`, [USER])).rows[0];
    expect(row).toEqual({ tenant_id: null });

    await c.query('DELETE FROM users WHERE id = $1', [USER]);
    expect((await c.query('SELECT 1 FROM mail_statement_imports WHERE user_id = $1', [USER])).rowCount).toBe(0);
  });
});
