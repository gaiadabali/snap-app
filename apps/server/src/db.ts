import { createDb, createPool, type Db } from '@snap/db';
import type { Pool } from 'pg';

import { config } from './config.js';

/**
 * One pool for the process.
 *
 * A pool per request exhausts Postgres' connection limit under any real load,
 * and every tenant-scoped read has to run inside a transaction anyway (see
 * `withTenantAs`), which pins a connection for exactly as long as it is
 * needed and no longer.
 */
let pool: Pool | null = null;
let db: Db | null = null;
let asWorker = false;

/**
 * Connect as the worker account rather than the API account.
 *
 * Called by the worker entrypoint before anything touches the database. It is
 * a process-wide switch rather than a second pool because the two never run in
 * the same process: mixing them would mean a request could reach the role that
 * can read every tenant's queue.
 */
export function useWorkerConnection(): void {
  if (pool) throw new Error('useWorkerConnection must be called before the pool is created');
  asWorker = true;
}

export function getPool(): Pool {
  const url = asWorker
    ? (config().WORKER_DATABASE_URL ?? config().DATABASE_URL)
    : config().DATABASE_URL;
  pool ??= createPool(url, {
    // Small on purpose. The API is I/O-bound on the model call, not on
    // Postgres, and a large idle pool is just held file descriptors.
    max: 10,
    idleTimeoutMillis: 30_000,
    // Fail fast rather than queueing behind a database that is down: a
    // request that hangs for a minute is worse than one that errors in two
    // seconds, because the client cannot tell the difference from a hang.
    connectionTimeoutMillis: 2_000,
  });
  return pool;
}

export function getDb(): Db {
  db ??= createDb(getPool());
  return db;
}

/** Closes the pool. Called on shutdown and by tests. */
export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
  }
}
