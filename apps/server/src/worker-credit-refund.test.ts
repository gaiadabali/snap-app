import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { provisionTenant, wipeTenant } from './test-support/tenant.js';

/**
 * 7.1.c through the REAL job pipeline: when a capture's extraction job fails
 * its LAST attempt, `runOnce` gives the scan's credit back; an earlier failed
 * attempt does not, and a capture that already has a document never does.
 *
 * No model is called. As in `worker-statement-routing.test.ts`, every Ollama
 * key is cleared, so `providerFor` throws "No extraction provider key" before
 * any request: a fast, offline failure of the extraction attempt, which is
 * all this needs. Runs as the real worker role (`snap_worker`), because only
 * `app_worker` may mark a spend refunded (migration 0039).
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TENANT = 'c5e50000-0000-4000-8000-000000000001';
const WORKER_USER_ID = 'c5e50000-0000-4000-8000-0000000000a1';
/** The person who photographed the receipt and whose upload spent the credit. */
const USER = 'c5e50000-0000-4000-8000-0000000000a2';

describeIfDb('worker: an unreadable scan gives its credit back (7.1.c)', () => {
  let admin: Client;
  let storageRoot: string;
  let worker: typeof import('./worker.js');
  let put: typeof import('./storage.js').put;
  let enqueueExtraction: typeof import('./repo.js').enqueueExtraction;
  let closeDb: typeof import('./db.js').closeDb;
  let grantId: string;

  const savedEnv = {
    WORKER_USER_ID: process.env.WORKER_USER_ID,
    WORKER_DATABASE_URL: process.env.WORKER_DATABASE_URL,
    STORAGE_DIR: process.env.STORAGE_DIR,
    OLLAMA_API_KEY: process.env.OLLAMA_API_KEY,
    OLLAMA_CLOUD_API_KEY: process.env.OLLAMA_CLOUD_API_KEY,
    OLLAMA_ENV_FILE: process.env.OLLAMA_ENV_FILE,
  };

  beforeAll(async () => {
    storageRoot = mkdtempSync(join(tmpdir(), 'credit-refund-worker-'));
    process.env.STORAGE_DIR = storageRoot;
    process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';
    process.env.WORKER_USER_ID = WORKER_USER_ID;
    process.env.WORKER_DATABASE_URL = (process.env.DATABASE_URL ?? '').replace(/:\/\/[^:]+:/, '://snap_worker:');
    delete process.env.OLLAMA_API_KEY;
    delete process.env.OLLAMA_CLOUD_API_KEY;
    delete process.env.OLLAMA_ENV_FILE;

    admin = await provisionTenant({
      tenantId: TENANT,
      name: 'Credit refund worker co',
      users: [{ id: USER, role: 'owner', subject: 'test|refund-user', email: 'user@credit-refund.test' }],
      // No membership: the worker enters through `withWorkerTenant`, as in production.
      serviceUsers: [{ id: WORKER_USER_ID, subject: 'test|refund-worker', email: 'worker@credit-refund.test' }],
    });

    const dbModule = await import('./db.js');
    closeDb = dbModule.closeDb;
    // Before anything calls getDb(), exactly as scripts/worker.ts does.
    dbModule.useWorkerConnection();
    put = (await import('./storage.js')).put;
    enqueueExtraction = (await import('./repo.js')).enqueueExtraction;
    worker = await import('./worker.js');
  });

  beforeEach(async () => {
    // One due job at a time: runOnce claims whatever is due.
    await admin.query(`delete from jobs where tenant_id = $1`, [TENANT]);
    await admin.query(`delete from credit_spends where tenant_id = $1`, [TENANT]);
    await admin.query(`delete from usage_grants where tenant_id = $1`, [TENANT]);
    grantId = randomUUID();
    await admin.query(
      `insert into usage_grants (id, tenant_id, metric, amount, remaining, source) values ($1, $2, 'scans', 5, 5, 'signup_bonus')`,
      [grantId, TENANT],
    );
  });

  afterAll(async () => {
    await closeDb();
    await admin.query(`delete from jobs where tenant_id = $1`, [TENANT]);
    await admin.query(`delete from credit_spends where tenant_id = $1`, [TENANT]);
    await admin.query(`delete from usage_grants where tenant_id = $1`, [TENANT]);
    await wipeTenant(admin, TENANT, [WORKER_USER_ID, USER]);
    await admin.end();
    rmSync(storageRoot, { recursive: true, force: true });
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  /** A stored photo, queued (and its credit spent) the way the upload handler does it. */
  async function queuedCapture(maxAttempts: number): Promise<string> {
    const { key, byteSize } = put(TENANT, Buffer.from(`a photographed receipt ${randomUUID()}`));
    const id = randomUUID();
    await admin.query(
      `insert into captures (id, tenant_id, uploaded_by, original_storage_key, original_mime_type,
                             original_byte_size, original_sha256, status)
       values ($1, $2, $3, $4, 'image/jpeg', $5, decode($6, 'hex'), 'received')`,
      [id, TENANT, USER, key, byteSize, randomUUID().replace(/-/g, '').repeat(2)],
    );
    await enqueueExtraction(USER, TENANT, id);
    await admin.query(`update jobs set max_attempts = $2 where tenant_id = $1`, [TENANT, maxAttempts]);
    return id;
  }

  const remaining = async () =>
    (await admin.query(`select remaining from usage_grants where id = $1`, [grantId])).rows[0].remaining as number;
  const spend = async (captureId: string) =>
    (await admin.query(`select refunded_at is not null as refunded, refund_reason from credit_spends where capture_id = $1`, [captureId]))
      .rows[0];

  it('gives the credit back when the last attempt fails, and only once', async () => {
    const captureId = await queuedCapture(1);
    expect(await remaining()).toBe(4);

    expect(await worker.runOnce(1)).toBe(1);
    const job = (await admin.query(`select attempts, completed_at, last_error from jobs where tenant_id = $1`, [TENANT])).rows[0];
    expect(job).toMatchObject({ attempts: 1, completed_at: null });
    expect(job.last_error).toMatch(/No extraction provider key/);
    expect(await spend(captureId)).toEqual({ refunded: true, refund_reason: 'unreadable' });
    expect(await remaining()).toBe(5);

    // The exhausted job is never claimed again, and nothing is given back twice.
    await worker.runOnce(1);
    const after = (await admin.query(`select attempts from jobs where tenant_id = $1`, [TENANT])).rows[0];
    expect(after.attempts).toBe(1);
    expect(await remaining()).toBe(5);
  });

  it('keeps the credit while the queue will still try again', async () => {
    const captureId = await queuedCapture(2);
    await worker.runOnce(1);
    expect(await spend(captureId)).toEqual({ refunded: false, refund_reason: null });
    expect(await remaining()).toBe(4);
  });

  it('never gives back the credit of a capture that has a document', async () => {
    const captureId = await queuedCapture(1);
    await admin.query(
      `insert into documents (id, tenant_id, capture_id, is_tax_invoice, review_status, currency)
       values ($1, $2, $3, false, 'auto_accepted', 'AUD')`,
      [randomUUID(), TENANT, captureId],
    );
    await worker.runOnce(1);
    expect(await spend(captureId)).toEqual({ refunded: false, refund_reason: null });
    expect(await remaining()).toBe(4);
  });
});
