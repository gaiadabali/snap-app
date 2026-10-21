import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';

import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export function createPool(connectionString: string, extra: PoolConfig = {}): Pool {
  return new Pool({ connectionString, ...extra });
}

export function createDb(pool: Pool): Db {
  return drizzle(pool, { schema });
}

/**
 * Marks a job done.
 *
 * Claiming and completing are separate calls because the work between them
 * can fail, and a queue where claiming implies completion loses exactly the
 * jobs that needed attention. Nothing re-runs a completed job: `completed_at`
 * is the only thing `claimJobs` will not look past.
 */
export async function completeJob(db: Db, jobId: string): Promise<void> {
  await db.execute(sql`
    update jobs set completed_at = now(), locked_at = null, last_error = null
     where id = ${jobId}
  `);
}

/**
 * Heartbeat: pushes a claimed job's lock forward so a LIVE worker's slow job
 * is never mistaken for a dead worker's.
 *
 * `claimJobs` treats a lock older than its timeout as abandoned. With a
 * heartbeat the timeout can be short (about a minute, so a job stranded by a
 * killed worker is picked up quickly) without a long statement being claimed a
 * second time. Guarded by `locked_by`: a worker whose lock was already taken
 * over must not extend someone else's claim. Returns false when it no longer
 * holds the job.
 */
export async function renewJobLock(db: Db, jobId: string, workerId: string): Promise<boolean> {
  const res = await db.execute(sql`
    update jobs set locked_at = now()
     where id = ${jobId} and locked_by = ${workerId} and completed_at is null
  `);
  return (res.rowCount ?? 0) > 0;
}

/**
 * Releases a failed job for another attempt, backing off exponentially.
 *
 * The backoff matters: a provider outage otherwise becomes a hot loop that
 * burns the retry budget in seconds and gives up before the provider is back.
 * Once `attempts` reaches `max_attempts` the job stops being claimed at all
 * and stays visible for a person to look at, rather than disappearing.
 */
export async function failJob(db: Db, jobId: string, error: string): Promise<void> {
  await db.execute(sql`
    update jobs
       set locked_at  = null,
           locked_by  = null,
           last_error = ${error.slice(0, 2000)},
           run_after  = now() + make_interval(secs => least(3600, power(4, attempts)::int))
     where id = ${jobId}
  `);
}

/**
 * Run `fn` with the tenant context set, inside one transaction.
 *
 * THIS IS THE ONLY CORRECT WAY TO READ TENANT DATA. Every RLS policy resolves
 * `current_setting('app.tenant_id')`, and a connection without it sees nothing
 * (fail closed). Two things make this helper necessary rather than decorative:
 *
 *  1. POOLING. The setting must be applied to the *same* connection that runs
 *     the query. Setting it outside a transaction hands the next borrower of
 *     that pooled connection someone else's tenant context — a cross-tenant
 *     leak that no test on a single connection will ever reveal. A transaction
 *     pins the connection, and `is_local = true` discards the setting at COMMIT
 *     or ROLLBACK.
 *
 *  2. `SET` TAKES NO BIND PARAMETERS. `SET LOCAL app.tenant_id = $1` is not
 *     valid SQL, so the naive workaround is string interpolation — i.e. SQL
 *     injection on the one value that gates all tenant isolation.
 *     `set_config(name, value, is_local)` is an ordinary function and does
 *     accept a parameter, so the id is bound, never interpolated.
 */
export async function withTenant<T>(
  db: Db,
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) {
    throw new Error(`withTenant: not a uuid: ${JSON.stringify(tenantId)}`);
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}

/** Thrown when a caller asks for a tenant they are not a member of. */
export class NotAMemberError extends Error {
  constructor(
    readonly userId: string,
    readonly tenantId: string,
  ) {
    super(`user ${userId} is not a member of tenant ${tenantId}`);
    this.name = 'NotAMemberError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Run `fn` as a specific USER, in a tenant they are proven to belong to.
 *
 * `withTenant` above trusts its tenant id. That was defensible while a user
 * had exactly one tenant and the id came straight from their session. It stops
 * being defensible the moment the product has a workspace switcher: the tenant
 * id then arrives from the client, and "which workspace am I allowed into" is
 * the single authorisation question the whole product rests on.
 *
 * So the check happens HERE, in the same transaction, before the tenant
 * context exists — not in each endpoint, where the fourteenth one will forget.
 * It works because `memberships_self` (migration 0012) lets a caller read
 * their own memberships with no tenant set: the predicate is their own user
 * id, so it discloses nothing about anyone else.
 *
 * Order matters and is not interchangeable:
 *   1. set app.user_id          — who is asking
 *   2. read own memberships     — may they?
 *   3. set app.tenant_id        — only then does tenant data become visible
 *
 * Prefer this over `withTenant` for anything driven by a request. `withTenant`
 * remains for migrations and a few unscoped reads. The extraction worker does
 * NOT use this: it holds no memberships, and enters a job's tenant through
 * `withWorkerTenant` below, which checks its database role instead.
 */
export async function withTenantAs<T>(
  db: Db,
  userId: string,
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!UUID.test(userId)) throw new Error(`withTenantAs: not a uuid: ${JSON.stringify(userId)}`);
  if (!UUID.test(tenantId)) throw new Error(`withTenantAs: not a uuid: ${JSON.stringify(tenantId)}`);

  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);

    const check = await tx.execute<{ ok: number }>(sql`
      select 1 as ok
      from memberships
      where user_id = current_user_id()
        and tenant_id = ${tenantId}
      limit 1
    `);
    if (check.rows.length === 0) throw new NotAMemberError(userId, tenantId);

    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}

/**
 * Thrown when `withWorkerTenant` is called on a connection that is not the
 * worker's. Not a "try again" error: it means API code reached for the
 * worker's door, and the database refused it.
 */
export class NotTheWorkerError extends Error {
  constructor(
    readonly userId: string,
    readonly tenantId: string,
    readonly sessionRole: string,
    readonly currentRole: string,
  ) {
    super(
      `withWorkerTenant refused: this connection (session ${sessionRole}, role ${currentRole}) is not ` +
        `the worker's — only a login that is a member of app_worker may enter tenant ${tenantId} ` +
        `without a membership (asked as user ${userId})`,
    );
    this.name = 'NotTheWorkerError';
  }
}

/** Thrown when a tenant does not exist, or has been deleted. */
export class NoSuchTenantError extends Error {
  constructor(readonly tenantId: string) {
    super(`tenant ${tenantId} does not exist or has been deleted`);
    this.name = 'NoSuchTenantError';
  }
}

/**
 * Run `fn` as the EXTRACTION WORKER, inside a tenant it is not a member of.
 *
 * WHY THIS EXISTS. The worker acts as a service user (`WORKER_USER_ID`) so
 * that what it writes is attributed — `extraction_runs`, `documents.created_by`
 * and the rest name the worker, not nobody. It used to enter a tenant through
 * `withTenantAs`, which demands a `memberships` row, and only the seed script
 * ever gave the worker one. Every workspace made by onboarding or by
 * `POST /v1/workspaces` therefore had no worker membership, and every scan in
 * it failed with `NotAMemberError`, forever. Making the worker a member of
 * every workspace is not the fix: a membership is a seat (`seats_used`
 * against `seat_limit`, which is 1 on a personal plan) and a person in the
 * member list, so a fake member would take a real customer's only seat.
 *
 * WHAT IT CHECKS INSTEAD OF MEMBERSHIP, in the same transaction, before any
 * tenant data is visible:
 *
 *   1. THE CONNECTION IS THE WORKER'S. Both the login (`session_user`) and the
 *      role in force (`current_user`) must be members of `app_worker`. That is
 *      a property of the credentials this process connected with — granted by
 *      `db.mjs appuser` to `snap_worker` only — not of anything the
 *      application passes in. The API connects as `snap_app` (`app_rw`, never
 *      `app_worker`), so API code that calls this, with ANY user id including
 *      the worker's own, is refused with `NotTheWorkerError`. Checking
 *      `current_user` as well closes the owner-session case: a privileged
 *      login that has `SET ROLE snap_app` is treated as `snap_app`.
 *   2. THE TENANT EXISTS AND IS NOT DELETED. A job for a deleted workspace is
 *      refused with `NoSuchTenantError` rather than worked on.
 *
 * It then sets `app.user_id` to the worker's id (so audit columns still name
 * the worker) and `app.tenant_id`, exactly as `withTenantAs` does, and every
 * row it touches is still filtered by the ordinary tenant policies. Nothing
 * is bypassed: no BYPASSRLS, no SECURITY DEFINER, no new policy.
 *
 * WHY IT IS SAFE.
 *   - It grants nothing the worker role did not already have. `app_worker`
 *     already reads every tenant's job queue (`jobs_worker_all`, 0010), and
 *     the job row names the tenant this is then called with. Entering that
 *     tenant to do the job is the access the queue already implies; this
 *     replaces a membership row that was standing in for it.
 *   - Entry is bound to the DATABASE ROLE of the connection, which an HTTP
 *     caller cannot influence, not to an app-level claim such as a user id,
 *     which a bug could forge.
 *   - A real member's path is unchanged: every request-driven read still goes
 *     through `withTenantAs` and its membership check. The worker's user id
 *     passed to `withTenantAs` is now refused everywhere, because the worker
 *     no longer holds memberships at all.
 */
export async function withWorkerTenant<T>(
  db: Db,
  workerUserId: string,
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!UUID.test(workerUserId)) {
    throw new Error(`withWorkerTenant: not a uuid: ${JSON.stringify(workerUserId)}`);
  }
  if (!UUID.test(tenantId)) throw new Error(`withWorkerTenant: not a uuid: ${JSON.stringify(tenantId)}`);

  return db.transaction(async (tx) => {
    // 1. Who is connected — asked of the database, never told to it.
    const role = await tx.execute<{ ok: boolean; session_role: string; current_role: string }>(sql`
      select pg_has_role(session_user, 'app_worker', 'MEMBER')
         and pg_has_role(current_user, 'app_worker', 'MEMBER') as ok,
             session_user::text as session_role,
             current_user::text as current_role
    `);
    const r = role.rows[0];
    if (!r?.ok) {
      throw new NotTheWorkerError(workerUserId, tenantId, r?.session_role ?? '?', r?.current_role ?? '?');
    }

    await tx.execute(sql`select set_config('app.user_id', ${workerUserId}, true)`);
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);

    // 2. The tenant exists and is live. Read under the tenant context just
    //    set (`tenant_self` lets a tenant see its own row), before `fn` runs.
    //    A refusal throws, which rolls the transaction back.
    const tenant = await tx.execute<{ ok: number }>(sql`
      select 1 as ok from tenants
       where id = current_tenant_id() and deleted_at is null
       limit 1
    `);
    if (tenant.rows.length === 0) throw new NoSuchTenantError(tenantId);

    return fn(tx);
  });
}

/**
 * Run `fn` with a user context and NO tenant context.
 *
 * A small, deliberately awkward door. Almost nothing belongs here: with no
 * tenant set, `current_tenant_id()` is NULL and every tenant policy fails
 * closed, so the only statements that work are the ones whose rule is the
 * caller's own identity — reading your own memberships, and the four
 * SECURITY DEFINER functions of migration 0015 (sign-in, your own user row,
 * creating a workspace, accepting an invitation), each of which reads
 * `current_user_id()` itself rather than trusting an argument.
 *
 * If you are reaching for this to make a query work, the query is almost
 * certainly meant to be tenant-scoped and `withTenantAs` is what you want.
 */
export async function asUser<T>(db: Db, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID.test(userId)) throw new Error(`asUser: not a uuid: ${JSON.stringify(userId)}`);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}

/**
 * The workspaces a user may switch into.
 *
 * Runs with a user context but NO tenant context, which is exactly the state
 * the switcher needs and the only query that is legitimately answered in it.
 */
export async function listWorkspacesFor(
  db: Db,
  userId: string,
): Promise<Array<{ id: string; name: string; kind: 'business' | 'personal'; role: string }>> {
  if (!UUID.test(userId)) throw new Error(`listWorkspacesFor: not a uuid: ${JSON.stringify(userId)}`);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    const rows = await tx.execute<{
      id: string;
      name: string;
      kind: 'business' | 'personal';
      role: string;
    }>(sql`
      select t.id, t.name, t.kind, m.role
      from memberships m
      join tenants t on t.id = m.tenant_id
      where m.user_id = current_user_id()
        and t.deleted_at is null
      order by t.kind, t.name
    `);
    return rows.rows;
  });
}

/**
 * Claim up to `limit` jobs for this worker.
 *
 * `FOR UPDATE SKIP LOCKED` is what makes Postgres a usable queue: concurrent
 * workers never block on each other and never claim the same row. Requires the
 * `app_worker` role, whose policy on `jobs` — and only on `jobs` — spans
 * tenants. Having claimed a job the worker must then call `withWorkerTenant`
 * with the job's own tenant to do the actual work, so the elevated read stays
 * confined to the queue table and everything else runs under tenant RLS.
 */
export async function claimJobs(
  db: Db,
  kind: string,
  workerId: string,
  limit = 1,
  lockTimeoutSeconds = 600,
): Promise<Array<{ id: string; tenantId: string | null; payload: unknown; attempts: number; maxAttempts: number }>> {
  const rows = await db.execute<{
    id: string;
    tenant_id: string | null;
    payload: unknown;
    attempts: number;
    max_attempts: number;
  }>(sql`
    with claimed as (
      select id
      from jobs
      where kind = ${kind}
        and completed_at is null
        and run_after <= now()
        and attempts < max_attempts
        -- Unlocked, OR locked long enough ago that the worker holding it is
        -- presumed dead. Without the second clause a worker that crashes —
        -- or is killed mid-deploy — strands its job forever, and the capture
        -- it was extracting is never turned into a document. The visibility
        -- timeout must exceed the slowest model call by a wide margin, or a
        -- slow job gets picked up twice.
        and (locked_at is null or locked_at < now() - make_interval(secs => ${lockTimeoutSeconds}))
      order by run_after
      for update skip locked
      limit ${limit}
    )
    update jobs j
       set locked_at = now(),
           locked_by = ${workerId},
           attempts  = j.attempts + 1
      from claimed c
     where j.id = c.id
    returning j.id, j.tenant_id, j.payload, j.attempts, j.max_attempts
  `);
  // `attempts` counts THIS claim, so `attempts >= maxAttempts` means this is
  // the job's last try: if it fails, `claimJobs` never returns it again.
  return rows.rows.map((r) => ({
    id: r.id,
    tenantId: r.tenant_id,
    payload: r.payload,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
  }));
}
