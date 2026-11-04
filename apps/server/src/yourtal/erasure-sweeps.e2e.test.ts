import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
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
const SOFT = 'e5c00000-0000-4000-8000-000000000002';
const SOFT_USER = 'e5c00000-0000-4000-8000-0000000000a2';

describeIfDb('erasure sweeps', () => {
  let admin: Client;
  let pool: Pool;
  let db: Db;
  let storage: string;
  let outside: string;
  let sweep: (db: Db, log?: typeof quiet, root?: string) => Promise<{ blanked: number; orphans: number }>;
  let ftrSweep: (db: Db, log?: typeof quiet) => Promise<{ expired: number }>;
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
  const purgeJob = (tenantId: string) => addJob('storage_purge', 1, { tenantId });
  const payload = async (id: string) => (await admin.query('select payload from jobs where id = $1', [id])).rows[0].payload;
  /** A tenant directory with a file in it, last modified `hoursOld` hours ago. */
  const dir = (name: string, hoursOld = 48) => {
    mkdirSync(join(storage, name, 'originals'), { recursive: true });
    writeFileSync(join(storage, name, 'originals', 'f'), 'x');
    const when = new Date(Date.now() - hoursOld * 3_600_000);
    utimesSync(join(storage, name), when, when);
    return join(storage, name);
  };

  beforeAll(async () => {
    storage = mkdtempSync(join(tmpdir(), 'erasure-sweeps-'));
    outside = mkdtempSync(join(tmpdir(), 'erasure-sweeps-outside-'));
    process.env.STORAGE_DIR = storage;
    admin = await provisionTenant({ tenantId: LIVE, name: 'Sweeps live', users: [{ id: USER, role: 'owner' }] });
    (await provisionTenant({ tenantId: SOFT, name: 'Sweeps soft-deleted', users: [{ id: SOFT_USER, role: 'owner', email: 'soft-sweeps@test.invalid', subject: 'test|soft-sweeps' }] })).end();
    await admin.query('update tenants set deleted_at = now() where id = $1', [SOFT]);
    pool = createPool(workerDatabaseUrl());
    db = createDb(pool);
    ({ runErasureSweepsOnce: sweep, runFtrSendSweepOnce: ftrSweep } = await import('./events-job.js'));
  });

  afterAll(async () => {
    await admin.query('delete from jobs where id = any($1)', [jobIds]);
    await wipeTenant(admin, LIVE, [USER]);
    await wipeTenant(admin, SOFT, [SOFT_USER]);
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

    const result = await sweep(db, quiet, storage);

    expect(result.blanked).toBeGreaterThanOrEqual(2);
    expect(await payload(old)).toEqual({});
    expect(await payload(oldTeen)).toEqual({});
    expect(await payload(recent)).toEqual({ set: 'recent' });
    expect(await payload(open)).toEqual({ set: 'still open' });
    expect(await payload(otherKind)).toEqual({ to: 'x@y.test' });
    // The row itself stays: it is what refuses a replayed jti.
    expect((await admin.query('select 1 from jobs where id = $1', [old])).rowCount).toBe(1);
    // Idempotent: a second pass touches none of these.
    expect((await sweep(db, quiet, storage)).blanked).toBe(0);
  });

  it('also empties a dead job (attempts used up) over 30 days old, but not a recent one or one still retrying', async () => {
    const dead = async (daysOld: number, attempts: number) => {
      const id = await addJob('teen_invite_end', null, { parentSub: 'p' });
      await admin.query(
        `update jobs set attempts = $2, max_attempts = 5, created_at = now() - make_interval(days => $3) where id = $1`,
        [id, attempts, daysOld],
      );
      return id;
    };
    const old = await dead(31, 5);
    const recent = await dead(5, 5);
    const retrying = await dead(31, 2);
    await sweep(db, quiet, storage);
    expect(await payload(old)).toEqual({});
    expect(await payload(recent)).toEqual({ parentSub: 'p' });
    expect(await payload(retrying)).toEqual({ parentSub: 'p' });
  });

  it('removes a purged workspace\'s old directory, and only that', async () => {
    const orphan = randomUUID();
    const orphanDir = dir(orphan);
    await purgeJob(orphan);
    const live = dir(LIVE);
    await purgeJob(LIVE); // a purge job for a workspace that exists changes nothing
    const notUuid = dir('downloads');
    const uppercase = dir(randomUUID().toUpperCase()); // not a name we write: left alone
    // A symlink named like a uuid, pointing outside: neither removed nor followed.
    writeFileSync(join(outside, 'keep.txt'), 'keep');
    const link = join(storage, randomUUID());
    symlinkSync(outside, link);

    const result = await sweep(db, quiet, storage);

    expect(result.orphans).toBe(1);
    expect(existsSync(orphanDir)).toBe(false);
    expect(existsSync(uppercase)).toBe(true);
    expect(existsSync(live)).toBe(true);
    expect(existsSync(notUuid)).toBe(true);
    expect(existsSync(link)).toBe(true);
    expect(existsSync(join(outside, 'keep.txt'))).toBe(true);
  });

  it('keeps a directory with no tenant and no purge job (a wrong or restored database must not empty the volume)', async () => {
    const stray = dir(randomUUID());
    expect((await sweep(db, quiet, storage)).orphans).toBe(0);
    expect(existsSync(stray)).toBe(true);
  });

  it('keeps a soft-deleted workspace\'s directory, even with a purge job', async () => {
    const soft = dir(SOFT);
    await purgeJob(SOFT);
    expect((await sweep(db, quiet, storage)).orphans).toBe(0);
    expect(existsSync(soft)).toBe(true);
  });

  it('keeps a purged workspace\'s directory until it is a day old', async () => {
    const id = randomUUID();
    const fresh = dir(id, 1);
    await purgeJob(id);
    expect((await sweep(db, quiet, storage)).orphans).toBe(0);
    expect(existsSync(fresh)).toBe(true);
    const when = new Date(Date.now() - 25 * 3_600_000);
    utimesSync(fresh, when, when);
    expect((await sweep(db, quiet, storage)).orphans).toBe(1);
    expect(existsSync(fresh)).toBe(false);
  });

  it('FTR sends: an open send over an hour old loses its bundle and is expired; a fresh or closed one is left', async () => {
    const add = async (status: string, minutesOld: number) =>
      (
        await admin.query(
          `insert into ftr_sends (tenant_id, user_id, financial_year, line_count, bundle_sha256, bundle, status, finished_at, created_at)
           values ($1, $2, '2025-26', 1, repeat('b', 64), $3, $4, $5, now() - make_interval(mins => $6)) returning id`,
          [LIVE, USER, status === 'started' ? '{"k":1}' : null, status, status === 'started' ? null : new Date(), minutesOld],
        )
      ).rows[0].id as string;
    const stale = await add('started', 90);
    const fresh = await add('started', 30);
    const sent = await add('sent', 300);
    const row = async (id: string) => (await admin.query('select status, bundle from ftr_sends where id = $1', [id])).rows[0];

    expect((await ftrSweep(db, quiet)).expired).toBe(1);
    expect(await row(stale)).toEqual({ status: 'expired', bundle: null });
    expect(await row(fresh)).toEqual({ status: 'started', bundle: '{"k":1}' });
    expect(await row(sent)).toEqual({ status: 'sent', bundle: null });
    expect((await ftrSweep(db, quiet)).expired).toBe(0);
  });

  it('is quiet when the storage directory does not exist', async () => {
    await expect(sweep(db, quiet, join(storage, 'missing'))).resolves.toMatchObject({ orphans: 0 });
  });
});
