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
 * remains for the worker and for migrations, where the tenant comes from a
 * job row rather than from a person.
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
 * tenants. Having claimed a job the worker must then call `withTenant` with the
 * job's own tenant to do the actual work, so the elevated read stays confined
 * to the queue table.
 */
export async function claimJobs(
  db: Db,
  kind: string,
  workerId: string,
  limit = 1,
  lockTimeoutSeconds = 600,
): Promise<Array<{ id: string; tenantId: string | null; payload: unknown }>> {
  const rows = await db.execute<{ id: string; tenant_id: string | null; payload: unknown }>(sql`
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
    returning j.id, j.tenant_id, j.payload
  `);
  return rows.rows.map((r) => ({ id: r.id, tenantId: r.tenant_id, payload: r.payload }));
}
