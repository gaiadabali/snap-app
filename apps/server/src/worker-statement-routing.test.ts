import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { provisionTenant, wipeTenant } from './test-support/tenant.js';

/**
 * T1 (`docs/STATEMENTS.md` §12 Lane T) — "a statement PDF and a receipt take
 * measurably different paths, proven by a test asserting the receipt schema
 * is never applied to a statement."
 *
 * Two levels, because the claim has two parts:
 *
 *  1. `classifyCapture` (exported from `worker.ts`) is right about the FORK
 *     itself, in isolation — a statement-shaped PDF, a receipt-shaped PDF, a
 *     non-PDF, and an unreadable original all land where `classify.ts` says
 *     they should.
 *  2. `runOnce` — the REAL job pipeline, real Postgres, real object storage —
 *     takes visibly different actions for the two cases: a statement writes
 *     ONE classification record and touches `documents` not at all;
 *     everything else proceeds toward the receipt reader.
 *
 * Level 2 never calls a real model. `OllamaCloudProvider`'s API key is read
 * lazily, inside `providerFor`, and throws synchronously with no network
 * call when absent (`extraction/provider.ts`'s `readKeyFromEnvFile`) — so
 * with every Ollama env var cleared, "the job failed with `No extraction
 * provider key`" is a fast, offline, deterministic proof that execution
 * reached the point classification is supposed to gate, which is exactly
 * what the statement case must never do.
 *
 * Runs as the REAL worker role, `snap_worker` — not `snap_app` and not the
 * admin/superuser connection — because that is what `scripts/worker.ts`
 * itself connects as (`useWorkerConnection()`, `db.ts`) before calling
 * `runOnce`/`runForever` in production, and `classifyCapture`'s cross-tenant
 * `jobs` read needs the same `app_worker` policy the real worker runs under.
 * Fixture rows are still written through the admin connection, same as every
 * other suite using `test-support/tenant.ts` — that boilerplate is not the
 * thing under test.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TENANT = 'a1a1a1a1-0000-4000-8000-000000000001';
const WORKER_USER_ID = 'a1a1a1a1-0000-4000-8000-0000000000a1';

/** A minimal, valid PDF with one page per content stream given — same builder
 *  shape as `extraction/pdf.test.ts` and `captures/statement-caps.e2e.test.ts`,
 *  duplicated rather than imported: proving the fork must not depend on
 *  reusing another suite's fixture. */
function pdfWithPages(contentStreams: string[]): Buffer {
  const fontId = 3;
  const pageIds = contentStreams.map((_, i) => 4 + i * 2);
  const contentIds = contentStreams.map((_, i) => 5 + i * 2);

  const objs: string[] = [];
  objs[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  objs[2] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  contentStreams.forEach((stream, i) => {
    objs[pageIds[i]! - 1] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentIds[i]} 0 R >>`;
    objs[contentIds[i]! - 1] = `<< /Length ${stream.length} >> stream\n${stream}\nendstream`;
  });

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  objs.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj ${body} endobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objs.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

/** BT/Tj text on one page, escaped for the PDF string literal. */
function onePagePdf(text: string): Buffer {
  const escaped = text.replace(/[()\\]/g, (c) => `\\${c}`);
  return pdfWithPages([`BT /F1 10 Tf 20 250 Td (${escaped}) Tj ET`]);
}

const STATEMENT_TEXT =
  'ACME BANK — Bank Statement. Account Number: 123-456-789. ' +
  'Statement period: 1 Aug 2026 to 31 Aug 2026. Opening balance 1,204.50. Closing balance 984.12.';
const RECEIPT_PDF_TEXT = 'Tax Invoice. Corner Store Pty Ltd ABN 12 345 678 901. Total payable $110.00.';

describeIfDb('worker statement routing (T1)', () => {
  let admin: Client;
  let storageRoot: string;
  let worker: typeof import('./worker.js');
  let put: typeof import('./storage.js').put;
  let useWorkerConnection: typeof import('./db.js').useWorkerConnection;
  let closeDb: typeof import('./db.js').closeDb;

  const savedEnv = {
    WORKER_USER_ID: process.env.WORKER_USER_ID,
    WORKER_DATABASE_URL: process.env.WORKER_DATABASE_URL,
    STORAGE_DIR: process.env.STORAGE_DIR,
    OLLAMA_API_KEY: process.env.OLLAMA_API_KEY,
    OLLAMA_CLOUD_API_KEY: process.env.OLLAMA_CLOUD_API_KEY,
    OLLAMA_ENV_FILE: process.env.OLLAMA_ENV_FILE,
  };

  beforeAll(async () => {
    storageRoot = mkdtempSync(join(tmpdir(), 't1-worker-'));
    process.env.STORAGE_DIR = storageRoot;
    process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';
    process.env.WORKER_USER_ID = WORKER_USER_ID;

    // The worker's real cross-tenant `jobs` read needs `app_worker`
    // (`snap_worker`), not the ordinary application role — see the header.
    // Same host/db as `DATABASE_URL`, just the worker login instead of the
    // API's, matching what `packages/db/scripts/db.mjs appuser` provisions.
    process.env.WORKER_DATABASE_URL = (process.env.DATABASE_URL ?? '').replace(
      /:\/\/[^:]+:/,
      '://snap_worker:',
    );

    admin = await provisionTenant({
      tenantId: TENANT,
      name: 'T1 statement routing co',
      users: [{ id: WORKER_USER_ID, role: 'member' }],
    });

    const dbModule = await import('./db.js');
    useWorkerConnection = dbModule.useWorkerConnection;
    closeDb = dbModule.closeDb;
    // Must run before ANYTHING calls `getDb()` (the pool is a module
    // singleton created on first use) — this mirrors `scripts/worker.ts`
    // exactly, which calls it before `runForever()` for the same reason.
    useWorkerConnection();

    const storageModule = await import('./storage.js');
    put = storageModule.put;

    worker = await import('./worker.js');
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

  /** Inserts a `captures` row via the admin connection, the same fixture
   *  shape `device-reading.e2e.test.ts` and `capture-document.e2e.test.ts`
   *  use, with `original_storage_key`/`original_mime_type` pointing at
   *  whatever bytes the test actually put in storage. */
  async function makeCapture(mime: string, storageKey: string, byteSize: number): Promise<string> {
    const id = randomUUID();
    await admin.query(
      `insert into captures (
         id, tenant_id, uploaded_by, original_storage_key, original_mime_type,
         original_byte_size, original_sha256, status
       ) values ($1, $2, $3, $4, $5, $6, decode($7, 'hex'), 'received')`,
      [id, TENANT, WORKER_USER_ID, storageKey, mime, byteSize, randomUUID().replace(/-/g, '').repeat(2).slice(0, 64)],
    );
    return id;
  }

  async function enqueue(captureId: string): Promise<string> {
    const id = randomUUID();
    await admin.query(`insert into jobs (id, tenant_id, kind, payload) values ($1, $2, 'extract', $3::jsonb)`, [
      id,
      TENANT,
      JSON.stringify({ captureId }),
    ]);
    return id;
  }

  /* ── Level 1: classifyCapture in isolation ────────────────────────────── */

  describe('classifyCapture', () => {
    it('classifies a native-text statement PDF as a statement', async () => {
      const bytes = onePagePdf(STATEMENT_TEXT);
      const { key, byteSize } = put(TENANT, bytes);
      const captureId = await makeCapture('application/pdf', key, byteSize);

      const result = await worker.classifyCapture(TENANT, captureId);
      expect(result?.kind).toBe('statement');
      expect(result?.signals.length).toBeGreaterThanOrEqual(2);
    });

    it('classifies an ordinary native-text PDF (a tax invoice) as a receipt, not a statement', async () => {
      const bytes = onePagePdf(RECEIPT_PDF_TEXT);
      const { key, byteSize } = put(TENANT, bytes);
      const captureId = await makeCapture('application/pdf', key, byteSize);

      const result = await worker.classifyCapture(TENANT, captureId);
      expect(result?.kind).toBe('receipt');
    });

    it('never even attempts a non-PDF capture — every photographed receipt', async () => {
      const bytes = Buffer.from('not really a jpeg, the mime type is what routes this');
      const { key, byteSize } = put(TENANT, bytes);
      const captureId = await makeCapture('image/jpeg', key, byteSize);

      const result = await worker.classifyCapture(TENANT, captureId);
      expect(result).toBeNull();
    });

    it('falls back to null — safe, not thrown — when the original bytes are not actually there', async () => {
      // The real gap this module's own header names: captures.controller.ts
      // never persists the raw PDF for a capture that gets demuxed into
      // capture_pages rows, so `original_storage_key` can point at a key
      // nothing ever wrote. This is that exact shape, constructed directly.
      const captureId = await makeCapture('application/pdf', `${TENANT}/originals/does/not/exist`, 999);

      const result = await worker.classifyCapture(TENANT, captureId);
      expect(result).toBeNull();
    });

    it('returns null for a capture id that does not exist at all', async () => {
      const result = await worker.classifyCapture(TENANT, randomUUID());
      expect(result).toBeNull();
    });
  });

  /* ── Level 2: the real fork, through runOnce ──────────────────────────── */

  describe('runOnce — the end-to-end fork', () => {
    it('a statement: records the classification, never writes a document, stops the job cleanly', async () => {
      const bytes = onePagePdf(STATEMENT_TEXT);
      const { key, byteSize } = put(TENANT, bytes);
      const captureId = await makeCapture('application/pdf', key, byteSize);
      const jobId = await enqueue(captureId);

      const claimed = await worker.runOnce(1);
      expect(claimed).toBe(1);

      const runs = (
        await admin.query(`select status, error from extraction_runs where capture_id = $1`, [captureId])
      ).rows;
      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe('failed');
      expect(runs[0].error).toMatch(/^statement_classified:/);
      expect(runs[0].error).toMatch(/native text layer shows/);

      const documents = await admin.query(`select id from documents where capture_id = $1`, [captureId]);
      expect(documents.rows).toHaveLength(0);

      const job = (await admin.query(`select completed_at, last_error from jobs where id = $1`, [jobId])).rows[0];
      expect(job.completed_at).not.toBeNull();
      expect(job.last_error).toBeNull();
    });

    it('a receipt (no PDF signal): proceeds PAST classification and reaches the real extraction attempt', async () => {
      // No network call actually happens — see the header. What matters is
      // that it gets far enough to hit the provider-config check, which only
      // runs after classification has already said "not a statement".
      delete process.env.OLLAMA_API_KEY;
      delete process.env.OLLAMA_CLOUD_API_KEY;
      delete process.env.OLLAMA_ENV_FILE;

      const bytes = Buffer.from('a photographed receipt would be real jpeg bytes; content is irrelevant here');
      const { key, byteSize } = put(TENANT, bytes);
      const captureId = await makeCapture('image/jpeg', key, byteSize);
      const jobId = await enqueue(captureId);

      const claimed = await worker.runOnce(1);
      expect(claimed).toBe(1);

      // The classification write never happened for this capture.
      const classified = await admin.query(
        `select id from extraction_runs where capture_id = $1 and error like 'statement_classified:%'`,
        [captureId],
      );
      expect(classified.rows).toHaveLength(0);

      // It reached the provider stage — the fast, offline, deterministic
      // signal that execution proceeded past the classification gate.
      const job = (await admin.query(`select last_error from jobs where id = $1`, [jobId])).rows[0];
      expect(job.last_error).toMatch(/No extraction provider key/);
    });

    it('a non-statement native-text PDF: also proceeds past classification, same as any receipt', async () => {
      delete process.env.OLLAMA_API_KEY;
      delete process.env.OLLAMA_CLOUD_API_KEY;
      delete process.env.OLLAMA_ENV_FILE;

      const bytes = onePagePdf(RECEIPT_PDF_TEXT);
      const { key, byteSize } = put(TENANT, bytes);
      const captureId = await makeCapture('application/pdf', key, byteSize);
      const jobId = await enqueue(captureId);

      const claimed = await worker.runOnce(1);
      expect(claimed).toBe(1);

      const classified = await admin.query(
        `select id from extraction_runs where capture_id = $1 and error like 'statement_classified:%'`,
        [captureId],
      );
      expect(classified.rows).toHaveLength(0);

      const job = (await admin.query(`select last_error from jobs where id = $1`, [jobId])).rows[0];
      expect(job.last_error).toMatch(/No extraction provider key/);
    });
  });
});
