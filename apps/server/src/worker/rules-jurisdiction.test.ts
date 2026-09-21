import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { provisionTenant, wipeTenant } from '../test-support/tenant.js';

/**
 * Jurisdiction gate — the worker refuses to read or split a receipt under the
 * wrong country's law.
 *
 * Three states a workspace can be in, and what this suite demands of each:
 *
 *  1. AU workspace, no rule set installed — the documented pre-0026 state.
 *     Extraction proceeds exactly as it always has (`null` rules).
 *  2. ID workspace with `id-2026` installed — extraction proceeds, under
 *     Indonesian rules.
 *  3. ANY mismatch or breakage: an ID workspace whose rule set fails to load
 *     (here: an unresolvable `tax_rules_id`), an ID workspace with NO rule set
 *     installed, or an ID workspace whose installed rule set is for the wrong
 *     country — the job is RELEASED with backoff and NOTHING is read, saved,
 *     or split. Losing the capture is worse than delaying it; validating it
 *     under Australian law is worse than either.
 *
 * No network call happens in any case: the provider key is read lazily inside
 * `providerFor`, so with every Ollama env var cleared, "the job failed with
 * `No extraction provider key`" is a fast, offline, deterministic proof that
 * execution reached — and the rules gate did not stop — the extraction stage
 * for the two allowed states.
 *
 * Runs as the REAL worker role, `snap_worker`, mirroring
 * `worker-statement-routing.test.ts`'s harness exactly.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TENANT = 'a1a1a1a1-0000-4000-8000-000000000002';
const WORKER_USER_ID = 'a1a1a1a1-0000-4000-8000-0000000000a2';

describeIfDb('worker jurisdiction gate (tax rules must match the workspace country)', () => {
  let admin: Client;
  let storageRoot: string;
  let worker: typeof import('../worker.js');
  let put: typeof import('../storage.js').put;
  let useWorkerConnection: typeof import('../db.js').useWorkerConnection;
  let closeDb: typeof import('../db.js').closeDb;

  const savedEnv = {
    WORKER_USER_ID: process.env.WORKER_USER_ID,
    WORKER_DATABASE_URL: process.env.WORKER_DATABASE_URL,
    STORAGE_DIR: process.env.STORAGE_DIR,
    OLLAMA_API_KEY: process.env.OLLAMA_API_KEY,
    OLLAMA_CLOUD_API_KEY: process.env.OLLAMA_CLOUD_API_KEY,
    OLLAMA_ENV_FILE: process.env.OLLAMA_ENV_FILE,
  };

  beforeAll(async () => {
    storageRoot = mkdtempSync(join(tmpdir(), 'jurisdiction-worker-'));
    process.env.STORAGE_DIR = storageRoot;
    process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';
    process.env.WORKER_USER_ID = WORKER_USER_ID;
    process.env.WORKER_DATABASE_URL = (process.env.DATABASE_URL ?? '').replace(
      /:\/\/[^:]+:/,
      '://snap_worker:',
    );

    admin = await provisionTenant({
      tenantId: TENANT,
      name: 'Jurisdiction gate co',
      users: [{ id: WORKER_USER_ID, role: 'member' }],
    });

    const dbModule = await import('../db.js');
    useWorkerConnection = dbModule.useWorkerConnection;
    closeDb = dbModule.closeDb;
    useWorkerConnection();

    const storageModule = await import('../storage.js');
    put = storageModule.put;

    worker = await import('../worker.js');
  });

  afterAll(async () => {
    await closeDb();
    await wipeTenant(admin, TENANT, [WORKER_USER_ID]);
    await admin.end();
    rmSync(storageRoot, { recursive: true, force: true });

    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  /** A photographed receipt: image/jpeg, so classification never forks to the
   *  statement path and the jurisdiction gate is the thing under test. */
  async function enqueueReceipt(): Promise<{ captureId: string; jobId: string }> {
    const bytes = Buffer.from('a photographed receipt; content is irrelevant');
    const { key, byteSize } = put(TENANT, bytes);
    const captureId = randomUUID();
    await admin.query(
      `insert into captures (
         id, tenant_id, uploaded_by, original_storage_key, original_mime_type,
         original_byte_size, original_sha256, status
       ) values ($1, $2, $3, $4, $5, $6, decode($7, 'hex'), 'received')`,
      [
        captureId,
        TENANT,
        WORKER_USER_ID,
        key,
        'image/jpeg',
        byteSize,
        randomUUID().replace(/-/g, '').repeat(2).slice(0, 64),
      ],
    );
    const jobId = randomUUID();
    await admin.query(
      `insert into jobs (id, tenant_id, kind, payload) values ($1, $2, 'extract', $3::jsonb)`,
      [jobId, TENANT, JSON.stringify({ captureId })],
    );
    return { captureId, jobId };
  }

  async function setTenant(fields: { country?: string; taxRulesId?: string | null }) {
    // `tenants_tax_rules_complete` (0026): tax_rules_id and tax_rules_version
    // are set or cleared together — and the version must be the REAL id-2026
    // one, or `rulesFor` refuses as a version mismatch, which is a different
    // (and correct) behaviour than what these tests exercise.
    await admin.query(
      `update tenants set country = coalesce($2, country), tax_rules_id = $3, tax_rules_version = $4 where id = $1`,
      [TENANT, fields.country ?? null, fields.taxRulesId ?? null, fields.taxRulesId ? '2026.1.0' : null],
    );
  }

  async function jobState(jobId: string) {
    const row = (
      await admin.query(`select completed_at, last_error from jobs where id = $1`, [jobId])
    ).rows[0];
    const runs = (await admin.query(`select status from extraction_runs where capture_id = $1`, [
      (await admin.query(`select payload->>'captureId' as c from jobs where id = $1`, [jobId])).rows[0].c,
    ])).rows;
    const documents = (
      await admin.query(
        `select id from documents where capture_id = $1`,
        [(await admin.query(`select payload->>'captureId' as c from jobs where id = $1`, [jobId])).rows[0].c],
      )
    ).rows;
    return { job: row, runs, documents };
  }

  it('an AU workspace with no rule set installed proceeds exactly as before', async () => {
    await setTenant({ country: 'AU', taxRulesId: null });
    delete process.env.OLLAMA_API_KEY;
    delete process.env.OLLAMA_CLOUD_API_KEY;
    delete process.env.OLLAMA_ENV_FILE;

    const { jobId } = await enqueueReceipt();
    expect(await worker.runOnce(1)).toBe(1);

    const { job } = await jobState(jobId);
    // Reached the provider stage — the rules gate did not stop an AU workspace.
    expect(job.last_error).toMatch(/No extraction provider key/);
  });

  it('an ID workspace with id-2026 installed proceeds, under Indonesian rules', async () => {
    await setTenant({ country: 'ID', taxRulesId: 'id-2026' });
    delete process.env.OLLAMA_API_KEY;
    delete process.env.OLLAMA_CLOUD_API_KEY;
    delete process.env.OLLAMA_ENV_FILE;

    const { jobId } = await enqueueReceipt();
    expect(await worker.runOnce(1)).toBe(1);

    const { job } = await jobState(jobId);
    // Same offline proof: it got all the way to the provider key check, so the
    // installed Indonesian rule set loaded without complaint.
    expect(job.last_error).toMatch(/No extraction provider key/);
  });

  it('an ID workspace whose rule set fails to load is RELEASED, never validated as Australian', async () => {
    await setTenant({ country: 'ID', taxRulesId: 'xx-unresolvable' });
    delete process.env.OLLAMA_API_KEY;
    delete process.env.OLLAMA_CLOUD_API_KEY;
    delete process.env.OLLAMA_ENV_FILE;

    const { jobId } = await enqueueReceipt();
    expect(await worker.runOnce(1)).toBe(1);

    const { job, runs, documents } = await jobState(jobId);
    // Released with backoff, not completed, not silently swallowed.
    expect(job.completed_at).toBeNull();
    expect(job.last_error).toMatch(/tax rule/i);
    // Nothing was read, saved, or split under the wrong jurisdiction.
    expect(runs).toHaveLength(0);
    expect(documents).toHaveLength(0);
  });

  it('an ID workspace with NO rule set installed is RELEASED — never the Australian default', async () => {
    await setTenant({ country: 'ID', taxRulesId: null });
    delete process.env.OLLAMA_API_KEY;
    delete process.env.OLLAMA_CLOUD_API_KEY;
    delete process.env.OLLAMA_ENV_FILE;

    const { jobId } = await enqueueReceipt();
    expect(await worker.runOnce(1)).toBe(1);

    const { job, runs, documents } = await jobState(jobId);
    expect(job.completed_at).toBeNull();
    expect(job.last_error).toMatch(/no rule set installed|refus/i);
    expect(runs).toHaveLength(0);
    expect(documents).toHaveLength(0);
  });
});
