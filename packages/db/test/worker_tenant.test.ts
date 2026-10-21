import { sql } from 'drizzle-orm';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDb,
  NoSuchTenantError,
  NotAMemberError,
  NotTheWorkerError,
  withTenantAs,
  withWorkerTenant,
  type Db,
} from '../src/client';

/**
 * THE WORKER'S WAY INTO A TENANT — `withWorkerTenant`.
 *
 * The extraction worker holds no memberships (a membership is a seat), so it
 * cannot use `withTenantAs`. Before this helper existed it did, and every
 * workspace created by a real sign-up — which never gets a worker membership —
 * had its scans fail with NotAMemberError on every attempt.
 *
 * What these tests pin, as the REAL login roles (never the superuser, which
 * would pass everything vacuously):
 *
 *   1. On the worker's connection (`snap_worker`, a member of app_worker) it
 *      enters a tenant where the worker has NO membership, sets both settings,
 *      and tenant RLS then scopes what it reads.
 *   2. On the API's connection (`snap_app`, app_rw only) it throws
 *      NotTheWorkerError — even when handed the worker's own user id. Also
 *      when a privileged session has `SET ROLE snap_app`.
 *   3. A missing or soft-deleted tenant is refused with NoSuchTenantError.
 *   4. `withTenantAs` is unchanged: a non-member — the worker included — is
 *      still refused, and a member still gets in.
 *
 * Needs the login roles `db.mjs appuser` creates, as CI's database job does
 * before this suite runs.
 */

const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

const PASSWORD = process.env.APP_DB_PASSWORD || 'app-dev-password';
function loginUrl(role: 'snap_app' | 'snap_worker'): string {
  const explicit =
    role === 'snap_app' ? process.env.SNAP_TEST_APP_DATABASE_URL : process.env.SNAP_TEST_WORKER_DATABASE_URL;
  if (explicit) return explicit;
  const u = new URL(url!);
  u.username = role;
  u.password = PASSWORD;
  return u.toString();
}

const TENANT = 'c0ffee00-0000-4000-8000-000000000001';
const OTHER = 'c0ffee00-0000-4000-8000-000000000002';
const DELETED = 'c0ffee00-0000-4000-8000-000000000003';
const MISSING = 'c0ffee00-0000-4000-8000-0000000000ff';
const OWNER = 'c0ffee00-0000-4000-8000-0000000000a1';
const WORKER = 'c0ffee00-0000-4000-8000-0000000000a2';

describeIfDb('withWorkerTenant — the worker enters by database role, not by membership', () => {
  let owner: Client;
  const pools: Pool[] = [];
  let workerDb: Db;
  let appDb: Db;

  function dbFor(connectionString: string, max = 2): { pool: Pool; db: Db } {
    const pool = new Pool({ connectionString, max });
    pools.push(pool);
    return { pool, db: createDb(pool) };
  }

  async function wipe() {
    await owner.query('DELETE FROM captures WHERE tenant_id = ANY($1::uuid[])', [[TENANT, OTHER, DELETED]]);
    await owner.query('DELETE FROM memberships WHERE tenant_id = ANY($1::uuid[])', [[TENANT, OTHER, DELETED]]);
    await owner.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [[TENANT, OTHER, DELETED]]);
    await owner.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[OWNER, WORKER]]);
  }

  beforeAll(async () => {
    owner = new Client({ connectionString: url });
    await owner.connect();
    await wipe();

    await owner.query(
      `INSERT INTO tenants (id, name, kind, abn, gst_registered, country, base_currency)
       VALUES ($1, 'A real sign-up', 'personal', NULL, false, 'AU', 'AUD'),
              ($2, 'Someone else',  'personal', NULL, false, 'AU', 'AUD'),
              ($3, 'Closed down',   'personal', NULL, false, 'AU', 'AUD')`,
      [TENANT, OTHER, DELETED],
    );
    await owner.query(`UPDATE tenants SET deleted_at = now() WHERE id = $1`, [DELETED]);
    await owner.query(
      `INSERT INTO users (id, subject, email, display_name)
       VALUES ($1, 'idp|wt-owner', 'owner@worker-tenant.test', 'Owner'),
              ($2, 'svc|wt-worker', 'worker@worker-tenant.test', 'Extraction worker')`,
      [OWNER, WORKER],
    );
    // The owner is the ONLY member, exactly as `workspace_create` leaves a new
    // workspace. The worker has a users row and nothing else.
    await owner.query(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'owner')`, [TENANT, OWNER]);
    await owner.query(
      `INSERT INTO captures (id, tenant_id, uploaded_by, original_storage_key, original_mime_type,
                             original_byte_size, original_sha256, status)
       VALUES (gen_random_uuid(), $1, $2, 'k/1', 'image/jpeg', 1, decode(repeat('ab', 32), 'hex'), 'received'),
              (gen_random_uuid(), $3, NULL, 'k/2', 'image/jpeg', 1, decode(repeat('cd', 32), 'hex'), 'received')`,
      [TENANT, OWNER, OTHER],
    );

    workerDb = dbFor(loginUrl('snap_worker')).db;
    appDb = dbFor(loginUrl('snap_app')).db;
  });

  afterAll(async () => {
    await wipe();
    await owner.end();
    await Promise.all(pools.map((p) => p.end()));
  });

  it('enters a tenant the worker is NOT a member of, on the worker connection', async () => {
    const seen = await withWorkerTenant(workerDb, WORKER, TENANT, async (tx) => {
      const settings = await tx.execute<{ u: string; t: string; members: number }>(sql`
        select current_setting('app.user_id') as u, current_setting('app.tenant_id') as t,
               (select count(*)::int from memberships where tenant_id = current_tenant_id()) as members
      `);
      const captures = await tx.execute<{ tenant_id: string }>(sql`select tenant_id from captures`);
      return { ...settings.rows[0]!, captureTenants: captures.rows.map((r) => r.tenant_id) };
    });
    // Audit columns will name the worker; the tenant is the job's.
    expect(seen.u).toBe(WORKER);
    expect(seen.t).toBe(TENANT);
    // Still one seat: entering did not need, or make, a membership.
    expect(seen.members).toBe(1);
    // Ordinary tenant RLS still applies: only this tenant's capture, not OTHER's.
    expect(seen.captureTenants).toEqual([TENANT]);
  });

  it('confirms the worker really has no membership — withTenantAs refuses it, on either connection', async () => {
    await expect(withTenantAs(workerDb, WORKER, TENANT, async () => 'in')).rejects.toBeInstanceOf(NotAMemberError);
    await expect(withTenantAs(appDb, WORKER, TENANT, async () => 'in')).rejects.toBeInstanceOf(NotAMemberError);
  });

  it("refuses the API's connection (snap_app), even with the worker's own user id", async () => {
    let ran = false;
    const attempt = withWorkerTenant(appDb, WORKER, TENANT, async () => {
      ran = true;
    });
    await expect(attempt).rejects.toBeInstanceOf(NotTheWorkerError);
    await expect(withWorkerTenant(appDb, OWNER, TENANT, async () => 'in')).rejects.toBeInstanceOf(NotTheWorkerError);
    expect(ran).toBe(false);
  });

  it('refuses a privileged session that has SET ROLE to the API role', async () => {
    // `session_user` alone would pass here (the owner login is a superuser,
    // a member of every role); `current_user` is what says snap_app.
    const { pool, db } = dbFor(url!, 1);
    await pool.query('SET ROLE snap_app');
    await expect(withWorkerTenant(db, WORKER, TENANT, async () => 'in')).rejects.toBeInstanceOf(NotTheWorkerError);
    // And the same session as the worker role is let in — the check is the
    // role in force, not the login's name.
    await pool.query('SET ROLE snap_worker');
    await expect(withWorkerTenant(db, WORKER, TENANT, async () => 'in')).resolves.toBe('in');
  });

  it('refuses a deleted tenant and a tenant that does not exist', async () => {
    let ran = false;
    const mark = async () => {
      ran = true;
    };
    await expect(withWorkerTenant(workerDb, WORKER, DELETED, mark)).rejects.toBeInstanceOf(NoSuchTenantError);
    await expect(withWorkerTenant(workerDb, WORKER, MISSING, mark)).rejects.toBeInstanceOf(NoSuchTenantError);
    expect(ran).toBe(false);
  });

  it('refuses a non-uuid tenant or user before touching the database', async () => {
    await expect(withWorkerTenant(workerDb, WORKER, 'not-a-uuid', async () => 'in')).rejects.toThrow(/not a uuid/);
    await expect(withWorkerTenant(workerDb, '', TENANT, async () => 'in')).rejects.toThrow(/not a uuid/);
  });

  it('leaves a real member on withTenantAs exactly as before', async () => {
    const tenant = await withTenantAs(appDb, OWNER, TENANT, async (tx) => {
      const r = await tx.execute<{ t: string }>(sql`select current_setting('app.tenant_id') as t`);
      return r.rows[0]!.t;
    });
    expect(tenant).toBe(TENANT);
    // ...and a member of one workspace is still refused another.
    await expect(withTenantAs(appDb, OWNER, OTHER, async () => 'in')).rejects.toBeInstanceOf(NotAMemberError);
  });

  it('does not leak the settings past the transaction on a pooled connection', async () => {
    const { pool, db } = dbFor(loginUrl('snap_worker'), 1);
    await withWorkerTenant(db, WORKER, TENANT, async () => undefined);
    const after = await pool.query(
      `select coalesce(current_setting('app.tenant_id', true), '') as t, coalesce(current_setting('app.user_id', true), '') as u`,
    );
    expect(after.rows[0]).toEqual({ t: '', u: '' });
  });
});
