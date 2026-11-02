import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { provisionTenant, wipeTenant } from './test-support/tenant.js';

/**
 * Group plan 1.29: what keeps one scan from waiting behind another.
 *
 *  - a model that never answers is cut at EXTRACTION_CALL_TIMEOUT_MS and the
 *    walk goes on to the next model, which saves the document;
 *  - the shadow OCR pass is queued as its own `shadow_ocr` job instead of
 *    running inside the extraction job, and a second loop drains it;
 *  - a job being handled has its lock renewed by the heartbeat.
 *
 * Real Postgres as the real worker role; the model is a stubbed `fetch`.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TENANT = 'c5e50000-0000-4000-8000-0000000000b1';
const WORKER_USER_ID = 'c5e50000-0000-4000-8000-0000000000b2';
const USER = 'c5e50000-0000-4000-8000-0000000000b3';

const RECEIPT_JSON = JSON.stringify({
  docType: { value: 'receipt', confidence: 0.95 },
  issueDate: { value: '2026-09-10', confidence: 0.95 },
  currency: { value: 'AUD', confidence: 0.95 },
  supplierName: { value: 'Ampol Riverside', confidence: 0.95 },
  payableAmount: { value: '84.20', confidence: 0.95 },
  taxAmount: { value: '7.65', confidence: 0.95 },
  lines: [],
  notes: { legible: true },
});

/** A call that only the abort signal can end, like a provider that hangs. */
function hang(init: RequestInit): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
  });
}

describeIfDb('worker: scan speed (1.29)', () => {
  let admin: Client;
  let storageRoot: string;
  let worker: typeof import('./worker.js');
  let put: typeof import('./storage.js').put;
  let enqueueExtraction: typeof import('./repo.js').enqueueExtraction;
  let closeDb: typeof import('./db.js').closeDb;

  const savedEnv: Record<string, string | undefined> = {};
  const setEnv = (k: string, v: string | undefined) => {
    if (!(k in savedEnv)) savedEnv[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  };

  beforeAll(async () => {
    storageRoot = mkdtempSync(join(tmpdir(), 'scan-speed-worker-'));
    setEnv('STORAGE_DIR', storageRoot);
    setEnv('TOKEN_SECRET', process.env.TOKEN_SECRET ?? 'test-only-secret-at-least-32-characters-long');
    setEnv('WORKER_USER_ID', WORKER_USER_ID);
    setEnv('WORKER_DATABASE_URL', (process.env.DATABASE_URL ?? '').replace(/:\/\/[^:]+:/, '://snap_worker:'));
    setEnv('EXTRACTION_PROVIDER', 'openrouter');
    setEnv('OPENROUTER_API_KEY', 'sk-or-test');
    setEnv('EXTRACTION_CALL_TIMEOUT_MS', '150');
    setEnv('DOCAI_SIDECAR_URL', undefined);

    admin = await provisionTenant({
      tenantId: TENANT,
      name: 'Scan speed worker co',
      users: [{ id: USER, role: 'owner', subject: 'test|speed-user', email: 'user@scan-speed.test' }],
      serviceUsers: [{ id: WORKER_USER_ID, subject: 'test|speed-worker', email: 'worker@scan-speed.test' }],
    });

    const dbModule = await import('./db.js');
    closeDb = dbModule.closeDb;
    dbModule.useWorkerConnection();
    put = (await import('./storage.js')).put;
    enqueueExtraction = (await import('./repo.js')).enqueueExtraction;
    worker = await import('./worker.js');
  });

  beforeEach(async () => {
    await admin.query(`delete from jobs where tenant_id = $1`, [TENANT]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await closeDb();
    await admin.query(`delete from jobs where tenant_id = $1`, [TENANT]);
    await wipeTenant(admin, TENANT, [WORKER_USER_ID, USER]);
    await admin.end();
    rmSync(storageRoot, { recursive: true, force: true });
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  async function queuedCapture(): Promise<string> {
    const { key, byteSize } = put(TENANT, Buffer.from(`a photographed receipt ${randomUUID()}`));
    const id = randomUUID();
    await admin.query(
      `insert into captures (id, tenant_id, uploaded_by, original_storage_key, original_mime_type,
                             original_byte_size, original_sha256, status)
       values ($1, $2, $3, $4, 'image/jpeg', $5, decode($6, 'hex'), 'received')`,
      [id, TENANT, USER, key, byteSize, randomUUID().replace(/-/g, '').repeat(2)],
    );
    await enqueueExtraction(USER, TENANT, id);
    return id;
  }

  it('cuts a hung model, escalates, saves the document, and queues the shadow pass separately', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        calls.push(JSON.parse(init.body as string).model);
        if (calls.length === 1) return hang(init);
        return new Response(
          JSON.stringify({ choices: [{ message: { content: RECEIPT_JSON }, finish_reason: 'stop' }], usage: {} }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const captureId = await queuedCapture();
    const started = Date.now();
    expect(await worker.runOnce(1)).toBe(1);
    expect(Date.now() - started).toBeLessThan(5_000);

    expect(calls).toHaveLength(2);
    const warnings = warn.mock.calls.map((c) => c.join(' ')).join('\n');
    warn.mockRestore();
    expect(warnings).toMatch(/timed out after \d+ s — escalating/);
    expect(warnings).toMatch(/succeeded after 1 earlier failure\(s\): .*timed out/);

    const docs = await admin.query(`select id from documents where capture_id = $1`, [captureId]);
    expect(docs.rowCount).toBe(1);

    const jobs = (
      await admin.query(`select kind, completed_at, payload from jobs where tenant_id = $1 order by kind`, [TENANT])
    ).rows;
    expect(jobs.map((j) => j.kind)).toEqual(['extract', 'shadow_ocr']);
    expect(jobs[0].completed_at).not.toBeNull();
    expect(jobs[1].completed_at).toBeNull();
    expect(jobs[1].payload.captureId).toBe(captureId);
    expect(jobs[1].payload.extraction.payableAmount.value).toBe('84.2000');

    // The extraction loop never takes the shadow job; the shadow loop does.
    expect(await worker.runOnce(1)).toBe(0);
    expect(await worker.runShadowOnce()).toBe(1);
    const after = await admin.query(`select completed_at from jobs where tenant_id = $1 and kind = 'shadow_ocr'`, [
      TENANT,
    ]);
    expect(after.rows[0].completed_at).not.toBeNull();
  });

  it('fails cleanly, with the timeout named, when every model hangs', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => hang(init)));
    const captureId = await queuedCapture();
    await worker.runOnce(1);
    const job = (
      await admin.query(`select last_error, completed_at from jobs where tenant_id = $1 and kind = 'extract'`, [TENANT])
    ).rows[0];
    expect(job.completed_at).toBeNull();
    expect(job.last_error).toMatch(/timed out after/);
    expect((await admin.query(`select 1 from documents where capture_id = $1`, [captureId])).rowCount).toBe(0);
    // No document means no shadow job.
    expect((await admin.query(`select 1 from jobs where tenant_id = $1 and kind = 'shadow_ocr'`, [TENANT])).rowCount).toBe(0);
  }, 20_000);

  it('renews the lock of a job while it is being handled, and stops afterwards', async () => {
    const jobId = randomUUID();
    await admin.query(
      `insert into jobs (id, tenant_id, kind, locked_at, locked_by)
       values ($1, $2, 'extract', now() - interval '80 seconds', 'w-hb')`,
      [jobId, TENANT],
    );
    await worker.withHeartbeat(jobId, 'w-hb', () => new Promise((r) => setTimeout(r, 400)), 100);
    const renewed = await admin.query(`select extract(epoch from now() - locked_at) as age from jobs where id = $1`, [jobId]);
    expect(Number(renewed.rows[0].age)).toBeLessThan(10);

    // Heartbeat is off once fn has returned.
    await admin.query(`update jobs set locked_at = now() - interval '80 seconds' where id = $1`, [jobId]);
    await new Promise((r) => setTimeout(r, 300));
    const still = await admin.query(`select extract(epoch from now() - locked_at) as age from jobs where id = $1`, [jobId]);
    expect(Number(still.rows[0].age)).toBeGreaterThanOrEqual(79);
  });
});
