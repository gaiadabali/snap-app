import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDb, createPool, type Db } from '@snap/db';
import type { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { provisionTenant, wipeTenant } from '../test-support/tenant.js';
import { workerDatabaseUrl } from '../test-support/worker-db.js';

/**
 * The erasure sweeps (group 3.7.c(b), (c)), on the worker's own connection:
 * finished yourtal_event and teen_invite_end payloads go after 30 days, and
 * {tenantId}/ directories of workspaces that no longer exist are removed.
 */
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;
const quiet = { log: () => undefined, warn: () => undefined, error: () => undefined };

const LIVE = 'e5c00000-0000-4000-8000-000000000001';
const USER = 'e5c00000-0000-4000-8000-0000000000a1';

describeIfDb('erasure sweeps', () => {
  let admin: Client;
  let pool: Pool;
  let db: Db;
  let storage: string;
  let outside: string;
  let sweep: (db: Db, log?: typeof quiet) => Promise<{ blanked: number; orphans: number }>;
  const jobIds: string[] = [];

  const addJob = async (kind: string, completedDaysAgo: number | null, payload: object) => {
    const id = randomUUID();
    jobIds.push(id);
    await admin.query(
      `insert into jobs (id, tenant_id, kind, payload, completed_at)
       values ($1, null, $2, $3::jsonb, ${completedDaysAgo === null ? 'null' : `now() - interval '${completedDaysAgo} days'`})`,
      [id, kind, JSON.stringify(payload)],
    );
    return id;
  };
  const payload = async (id: string) => (await admin.query('select payload from jobs where id = $1', [id])).rows[0].payload;
  const dir = (name: string) => {
    mkdirSync(join(storage, name, 'originals'), { recursive: true });
    writeFileSync(join(storage, name, 'originals', 'f'), 'x');
    return join(storage, name);
  };

  beforeAll(async () => {
    storage = mkdtempSync(join(tmpdir(), 'erasure-sweeps-'));
    outside = mkdtempSync(join(tmpdir(), 'erasure-sweeps-outside-'));
    process.env.STORAGE_DIR = storage;
    admin = await provisionTenant({ tenantId: LIVE, name: 'Sweeps live', users: [{ id: USER, role: 'owner' }] });
    pool = createPool(workerDatabaseUrl());
    db = createDb(pool);
    ({ runErasureSweepsOnce: sweep } = await import('./events-job.js'));
  });

  afterAll(async () => {
    await admin.query('delete from jobs where id = any($1)', [jobIds]);
    await wipeTenant(admin, LIVE, [USER]);
    await admin.end();
    await pool.end();
    rmSync(storage, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it('empties the payload of a finished yourtal_event and teen_invite_end older than 30 days, and nothing else', async () => {
    const old = await addJob('yourtal_event', 31, { set: 'secret.jwt.token' });
    const oldTeen = await addJob('teen_invite_end', 45, { inviteId: randomUUID(), parentSub: 'parent-sub' });
    const recent = await addJob('yourtal_event', 29, { set: 'recent' });
    const open = await addJob('yourtal_event', null, { set: 'still open' });
    const otherKind = await addJob('erasure_notice', 90, { to: 'x@y.test' });

    const result = await sweep(db, quiet);

    expect(result.blanked).toBeGreaterThanOrEqual(2);
    expect(await payload(old)).toEqual({});
    expect(await payload(oldTeen)).toEqual({});
    expect(await payload(recent)).toEqual({ set: 'recent' });
    expect(await payload(open)).toEqual({ set: 'still open' });
    expect(await payload(otherKind)).toEqual({ to: 'x@y.test' });
    // The row itself stays: it is what refuses a replayed jti.
    expect((await admin.query('select 1 from jobs where id = $1', [old])).rowCount).toBe(1);
    // Idempotent: a second pass touches none of these.
    expect((await sweep(db, quiet)).blanked).toBe(0);
  });

  it('removes only the lower-case uuid directories of workspaces that are gone', async () => {
    const orphan = dir(randomUUID());
    const live = dir(LIVE);
    const notUuid = dir('downloads');
    const uppercase = dir(randomUUID().toUpperCase()); // not a name we write: left alone
    // A symlink named like a uuid, pointing outside: neither removed nor followed.
    writeFileSync(join(outside, 'keep.txt'), 'keep');
    const link = join(storage, randomUUID());
    symlinkSync(outside, link);

    const result = await sweep(db, quiet);

    expect(result.orphans).toBe(1);
    expect(existsSync(orphan)).toBe(false);
    expect(existsSync(uppercase)).toBe(true);
    expect(existsSync(live)).toBe(true);
    expect(existsSync(notUuid)).toBe(true);
    expect(existsSync(link)).toBe(true);
    expect(existsSync(join(outside, 'keep.txt'))).toBe(true);
  });

  it('is quiet when the storage directory does not exist', async () => {
    const saved = process.env.STORAGE_DIR;
    process.env.STORAGE_DIR = join(storage, 'missing');
    try {
      await expect(sweep(db, quiet)).resolves.toMatchObject({ orphans: 0 });
    } finally {
      process.env.STORAGE_DIR = saved;
    }
  });
});
