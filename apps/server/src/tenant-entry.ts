import { withTenantAs, withWorkerTenant, type Db, type Tx } from '@snap/db';

import { getDb } from './db.js';

/**
 * WHO IS ENTERING A TENANT, and therefore which door they use.
 *
 * Two kinds of caller run tenant-scoped code in this server:
 *
 *  - A REAL USER, named by their user id (a plain string, as it always was).
 *    They enter through `withTenantAs`, which refuses anyone without a
 *    `memberships` row in the tenant. Every request-driven path is this.
 *
 *  - THE EXTRACTION WORKER, named by a `WorkerActor`. It holds no
 *    memberships — a membership is a seat and a person in the member list, and
 *    the worker is neither — so it enters through `withWorkerTenant`, which
 *    checks instead that the CONNECTION is the worker's (`app_worker`). On the
 *    API's connection (`snap_app`) that check fails and the call throws
 *    `NotTheWorkerError`, so a `WorkerActor` that ever leaked into request
 *    code would be refused by the database, not trusted.
 *
 * The distinction is carried in the TYPE, not in the id: the worker's user id
 * passed as a plain string is just a user with no memberships, and
 * `withTenantAs` refuses it like any other non-member. Only `worker.ts` builds
 * a `WorkerActor` (pinned by `worker-tenant-entry.test.ts`).
 *
 * Repo functions only the worker calls take a `WorkerActor`. Functions the
 * API and the worker both call take a `TenantActor`, and a plain string still
 * goes through `withTenantAs` exactly as before.
 */
export interface WorkerActor {
  readonly kind: 'worker';
  /** The worker's service user (`WORKER_USER_ID`); audit columns name it. */
  readonly userId: string;
  /**
   * The connection to enter through. Omitted in the worker process, where
   * `getDb()` is the worker's own pool (`useWorkerConnection`); passed by
   * tests that hold a worker pool beside the API's. Resolved per call, never
   * at construction, so building the actor cannot open a pool early.
   */
  readonly db?: Db;
}

/** A real user's id, or the worker. */
export type TenantActor = string | WorkerActor;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function workerActor(userId: string, db?: Db): WorkerActor {
  if (!UUID.test(userId)) throw new Error(`workerActor: not a uuid: ${JSON.stringify(userId)}`);
  return Object.freeze({ kind: 'worker' as const, userId, db });
}

export function isWorkerActor(actor: TenantActor): actor is WorkerActor {
  return typeof actor !== 'string' && actor.kind === 'worker';
}

/** The user id to write into audit columns (`created_by`, `extracted_by`, ...). */
export function actorUserId(actor: TenantActor): string {
  return typeof actor === 'string' ? actor : actor.userId;
}

/** The worker's door. For repo functions only the worker ever calls. */
export function enterTenantAsWorker<T>(
  worker: WorkerActor,
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return withWorkerTenant(worker.db ?? getDb(), worker.userId, tenantId, fn);
}

/**
 * The right door for whoever is asking: `withTenantAs` for a user,
 * `withWorkerTenant` for the worker. A user's path is byte-for-byte what it
 * was before this module existed.
 */
export function enterTenant<T>(actor: TenantActor, tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (typeof actor === 'string') return withTenantAs(getDb(), actor, tenantId, fn);
  return enterTenantAsWorker(actor, tenantId, fn);
}
