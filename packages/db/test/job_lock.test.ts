import { Client, Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { claimJobs, createDb, renewJobLock, type Db } from '../src/client';

/**
 * The job lock and its heartbeat (group plan 1.29.d).
 *
 * A claimed job is "owned" until `locked_at` is older than the claim's lock
 * timeout. A worker killed by a redeploy stops renewing, so its job is taken
 * over once the timeout passes; a live worker that heartbeats is never taken
 * over, however slow its job. Run as the real worker login role.
 */
const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

const KIND = 'lock_test';
const TIMEOUT_S = 90;

function workerUrl(): string {
  if (process.env.SNAP_TEST_WORKER_DATABASE_URL) return process.env.SNAP_TEST_WORKER_DATABASE_URL;
  const u = new URL(url!);
  u.username = 'snap_worker';
  u.password = process.env.APP_DB_PASSWORD || 'app-dev-password';
  return u.toString();
}

describeIfDb('job lock timeout and heartbeat', () => {
  let owner: Client;
  let pool: Pool;
  let db: Db;
  let jobId: string;

  beforeAll(async () => {
    owner = new Client({ connectionString: url });
    await owner.connect();
    pool = new Pool({ connectionString: workerUrl(), max: 2 });
    db = createDb(pool);
  });

  afterAll(async () => {
    await owner.query('DELETE FROM jobs WHERE kind = $1', [KIND]);
    await owner.end();
    await pool.end();
  });

  beforeEach(async () => {
    await owner.query('DELETE FROM jobs WHERE kind = $1', [KIND]);
    const r = await owner.query(
      `INSERT INTO jobs (id, tenant_id, kind) VALUES (gen_random_uuid(), NULL, $1) RETURNING id`,
      [KIND],
    );
    jobId = r.rows[0].id;
  });

  const age = (seconds: number) =>
    owner.query(`UPDATE jobs SET locked_at = now() - make_interval(secs => $2) WHERE id = $1`, [jobId, seconds]);

  it('does not hand out a job whose lock is fresh', async () => {
    expect(await claimJobs(db, KIND, 'w1', 1, TIMEOUT_S)).toHaveLength(1);
    expect(await claimJobs(db, KIND, 'w2', 1, TIMEOUT_S)).toHaveLength(0);
  });

  it('reclaims a job whose lock is older than the timeout (worker died)', async () => {
    await claimJobs(db, KIND, 'w1', 1, TIMEOUT_S);
    await age(TIMEOUT_S + 5);
    const again = await claimJobs(db, KIND, 'w2', 1, TIMEOUT_S);
    expect(again).toHaveLength(1);
    expect(again[0]!.id).toBe(jobId);
    expect(again[0]!.attempts).toBe(2);
  });

  it('does not reclaim a job whose lock a heartbeat renewed', async () => {
    await claimJobs(db, KIND, 'w1', 1, TIMEOUT_S);
    await age(TIMEOUT_S + 5);
    expect(await renewJobLock(db, jobId, 'w1')).toBe(true);
    expect(await claimJobs(db, KIND, 'w2', 1, TIMEOUT_S)).toHaveLength(0);
  });

  it('refuses a heartbeat from a worker that no longer holds the job', async () => {
    await claimJobs(db, KIND, 'w1', 1, TIMEOUT_S);
    await age(TIMEOUT_S + 5);
    await claimJobs(db, KIND, 'w2', 1, TIMEOUT_S);
    expect(await renewJobLock(db, jobId, 'w1')).toBe(false);
  });

  it('does not renew a completed job', async () => {
    await claimJobs(db, KIND, 'w1', 1, TIMEOUT_S);
    await owner.query(`UPDATE jobs SET completed_at = now() WHERE id = $1`, [jobId]);
    expect(await renewJobLock(db, jobId, 'w1')).toBe(false);
  });
});
