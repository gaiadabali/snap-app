import { createDb, createPool, type Db } from '@snap/db';
import type { Pool } from 'pg';

import { workerActor, type WorkerActor } from '../tenant-entry.js';

/**
 * The WORKER's connection (`snap_worker`, a member of `app_worker`), for a
 * suite that drives the worker's repo functions directly while the rest of
 * the file runs as the API (`snap_app`, through `getDb()`).
 *
 * The worker enters a tenant through `withWorkerTenant`, which refuses any
 * connection that is not the worker's — so these suites need the real worker
 * login, exactly as production does, not the API's pool and a fake
 * membership.
 */
export function workerDatabaseUrl(): string {
  return (
    process.env.WORKER_DATABASE_URL ?? (process.env.DATABASE_URL ?? '').replace(/:\/\/[^:]+:/, '://snap_worker:')
  );
}

export interface WorkerDb {
  pool: Pool;
  db: Db;
  /** The worker, on this connection. */
  actor: WorkerActor;
}

export function openWorkerDb(workerUserId: string): WorkerDb {
  const pool = createPool(workerDatabaseUrl());
  const db = createDb(pool);
  return { pool, db, actor: workerActor(workerUserId, db) };
}
