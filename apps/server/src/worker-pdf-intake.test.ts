import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { provisionTenant, wipeTenant } from './test-support/tenant.js';

/**
 * Task 9 (remediation item 22) — a multi-page PDF intake keeps its OWN bytes,
 * so a statement is classified from what it actually is, not defaulted to a
 * receipt.
 *
 * The failure this pins: `classifyCapture` (`worker.ts`) only has the
 * capture's `original_storage_key` to read the original from, and for a
 * demuxed PDF intake that key pointed at nothing — `capture_pages` holds only
 * rendered/rasterised pages — so the classifier fell through its own catch to
 * 'receipt' and a real bank statement went down the receipt extraction path.
 *
 * Two assertions, both through the REAL HTTP intake (`statement-caps.e2e
 * .test.ts`'s harness, mirrored here rather than imported — see that suite's
 * own header for why a real PUT is the honest level for this):
 *
 *  1. after a 3-page PDF PUT, the capture's `original_storage_key` resolves
 *     through `storage.get` to EXACTLY the bytes that were uploaded;
 *  2. `classifyCapture` on that same capture says 'statement' — resolved
 *     from those bytes, not from the fall-through default.
 *
 * Runs as the real worker role for `classifyCapture` (same reason
 * `worker-statement-routing.test.ts` gives in its header).
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TENANT = 'c9c9c9c9-0000-4000-8000-000000000001';
const USER = 'c9c9c9c9-0000-4000-8000-000000000002';
const WORKER_USER_ID = 'c9c9c9c9-0000-4000-8000-0000000000a1';

const STATEMENT_TEXT =
  'ACME BANK — Bank Statement. Account Number: 123-456-789. ' +
  'Statement period: 1 Aug 2026 to 31 Aug 2026. Opening balance 1,204.50. Closing balance 984.12.';

/** A minimal, valid 3-page PDF, each page holding real statement text —
 *  hand-assembled exactly like `statement-caps.e2e.test.ts`'s builder, so the
 *  bytes are legible to `extractPdfText` (a real text layer, past
 *  `NATIVE_TEXT_THRESHOLD`) without depending on any PDF library. */
function statementPdf(pageCount: number): Buffer {
  const contentStreams = Array.from({ length: pageCount }, (_, i) => {
    const escaped = STATEMENT_TEXT.replace(/[()\\]/g, (c) => `\\${c}`);
    void i;
    return `BT /F1 10 Tf 20 270 Td (${escaped}) Tj ET`;
  });

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

describeIfDb('PDF intake persists its own bytes for classification (Task 9)', () => {
  let app: NestFastifyApplication;
  let admin: Client;
  let issueSession: typeof import('./tokens.js').issueSession;
  let classifyCapture: typeof import('./worker.js').classifyCapture;
  let useWorkerConnection: typeof import('./db.js').useWorkerConnection;
  let closeDb: typeof import('./db.js').closeDb;
  let getStored: typeof import('./storage.js').get;
  let storageRoot: string;

  const savedEnv: Record<string, string | undefined> = {};
  for (const key of [
    'TOKEN_SECRET',
    'ADMIN_KMS_MASTER_KEY',
    'STORAGE_DIR',
    'WORKER_USER_ID',
    'WORKER_DATABASE_URL',
    'OLLAMA_API_KEY',
    'OLLAMA_CLOUD_API_KEY',
    'OLLAMA_ENV_FILE',
  ]) {
    savedEnv[key] = process.env[key];
  }

  const auth = () => ({
    authorization: `Bearer ${issueSession(USER)}`,
    'x-workspace-id': TENANT,
  });

  beforeAll(async () => {
    storageRoot = mkdtempSync(join(tmpdir(), 'task9-pdf-'));
    process.env.STORAGE_DIR = storageRoot;
    process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';
    process.env.ADMIN_KMS_MASTER_KEY ??= '11'.repeat(32);
    process.env.WORKER_USER_ID = WORKER_USER_ID;

    // Same worker-role wiring `worker-statement-routing.test.ts` uses, for the
    // same reason: `classifyCapture` runs under `snap_worker` in production.
    process.env.WORKER_DATABASE_URL = (process.env.DATABASE_URL ?? '').replace(/:\/\/[^:]+:/, '://snap_worker:');

    admin = await provisionTenant({
      tenantId: TENANT,
      name: 'Task 9 pdf persistence co',
      users: [
        { id: USER, role: 'owner', subject: 'test|task9-owner', email: 'task9-owner@test.invalid' },
        { id: WORKER_USER_ID, role: 'member', subject: 'test|task9-worker', email: 'task9-worker@test.invalid' },
      ],
    });

    const tokens = await import('./tokens.js');
    issueSession = tokens.issueSession;

    const dbModule = await import('./db.js');
    useWorkerConnection = dbModule.useWorkerConnection;
    closeDb = dbModule.closeDb;
    useWorkerConnection();

    const storageModule = await import('./storage.js');
    getStored = storageModule.get;

    const worker = await import('./worker.js');
    classifyCapture = worker.classifyCapture;

    // The real intake endpoint, wired exactly like `statement-caps.e2e.test.ts`
    // — bodyLimit and maxParamLength because the upload token in the URL runs
    // past Fastify's defaults, and the raw-body parsers because without them
    // Fastify answers 415 before the controller ever sees PDF bytes.
    const { AppModule } = await import('./app.module.js');
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter({
        bodyLimit: 32 * 1024 * 1024,
        routerOptions: { maxParamLength: 600 },
      }),
      { logger: false },
    );
    const fastify = app.getHttpAdapter().getInstance();
    const rawBody = { parseAs: 'buffer' as const, bodyLimit: 32 * 1024 * 1024 };
    const passthrough = (
      _request: unknown,
      body: Buffer,
      done: (err: Error | null, body?: Buffer) => void,
    ) => done(null, body);
    fastify.addContentTypeParser(/^application\/pdf$/, rawBody, passthrough);

    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    if (app) await app.close();
    await closeDb();
    await wipeTenant(admin, TENANT, [USER, WORKER_USER_ID]);
    await admin.end();
    rmSync(storageRoot, { recursive: true, force: true });

    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('a 3-page PDF intake keeps the uploaded bytes under original_storage_key, and classifies from them', async () => {
    const bytes = statementPdf(3);
    const sha256 = createHash('sha256').update(bytes).digest('hex');

    // The normal capture path: register one declared PDF page, then PUT the
    // real bytes — exactly what the mobile client's file intake does.
    const registerRes = await app.inject({
      method: 'POST',
      url: '/v1/captures',
      headers: auth(),
      payload: { pages: [{ sha256, mimeType: 'application/pdf', byteSize: bytes.byteLength }] },
    });
    expect(registerRes.statusCode).toBe(201);

    const putRes = await app.inject({
      method: 'PUT',
      url: registerRes.json().uploadUrl as string,
      headers: { ...auth(), 'content-type': 'application/pdf' },
      payload: bytes,
    });
    expect(putRes.statusCode).toBe(200);
    expect(putRes.json().queued).toBe(true);
    expect(putRes.json().pages).toBe(3);

    // The capture row the intake produced, read back through the admin
    // connection like every suite using `test-support/tenant.ts`.
    const captures = (
      await admin.query(
        `select id, original_storage_key as key, original_mime_type as mime
           from captures where tenant_id = $1`,
        [TENANT],
      )
    ).rows;
    expect(captures).toHaveLength(1);
    const [capture] = captures as [{ id: string; key: string; mime: string }];

    // Assertion 1 — the key resolves to the EXACT bytes that were uploaded.
    // Before the intake persisted the original, this key pointed at nothing
    // (`capture_pages` only ever holds rendered pages) and this read threw
    // ENOENT — the whole reason classification fell through to 'receipt'.
    expect(capture.mime).toBe('application/pdf');
    expect(getStored(capture.key).equals(bytes)).toBe(true);

    // Assertion 2 — classification resolved from those bytes: a bank
    // statement's own text layer says 'statement', not the fall-through
    // 'receipt' default. (No model call is involved — classification is
    // `classifyExtractedText` over the PDF's native text.)
    const classification = await classifyCapture(TENANT, capture.id);
    expect(classification?.kind).toBe('statement');
    expect(classification?.signals.length).toBeGreaterThanOrEqual(2);
  });

  it('a fresh capture id that never went through intake still answers null — no phantom classification', async () => {
    expect(await classifyCapture(TENANT, randomUUID())).toBeNull();
  });
});
