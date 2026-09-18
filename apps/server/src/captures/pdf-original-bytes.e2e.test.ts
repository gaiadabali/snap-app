import { createHash } from 'node:crypto';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { provisionTenant, wipeTenant } from '../test-support/tenant.js';

/**
 * The bug a coordinator caught mid-T5: `upload()`'s PDF branch wrote every
 * RENDERED page to storage and never wrote the raw PDF itself anywhere.
 * `captures.original_storage_key` was set at `POST /v1/captures` time from
 * the client's declared hash, and nothing ever put bytes at that key (or at
 * any key) for the original file — `capture_pages` holds rasterised renders
 * only. T1's statement classifier (`worker.ts`) reads exactly this column to
 * get the PDF's real text layer; with nothing there it silently fell back to
 * the receipt path for every real statement.
 *
 * This suite proves the fix through the real endpoint: the bytes at
 * `original_storage_key` after a genuine upload are not merely present but
 * actually parse as the uploaded PDF (same page count via `demuxPdf`), and a
 * retried PUT does not corrupt or duplicate them.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TENANT = 'e8e8e8e8-0000-4000-8000-000000000001';
const USER = 'e8e8e8e8-0000-4000-8000-000000000002';

/** A minimal, valid, hand-built multi-page PDF — same construction as
 *  `statement-caps.e2e.test.ts`'s fixture, so this suite proves something
 *  about the real endpoint rather than about a library-generated PDF. */
function fixturePdf(pageCount: number): Buffer {
  const contentStreams = Array.from({ length: pageCount }, (_, i) => {
    const text = `Original-bytes fixture, page ${i + 1} of ${pageCount}`;
    const escaped = text.replace(/[()\\]/g, (c) => `\\${c}`);
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

describeIfDb('the raw PDF is actually persisted at original_storage_key', () => {
  let app: NestFastifyApplication;
  let admin: Client;
  let issueSession: typeof import('../tokens.js').issueSession;
  let getStored: typeof import('../storage.js').get;
  let demuxPdf: typeof import('../extraction/pdf.js').demuxPdf;

  const auth = () => ({
    authorization: `Bearer ${issueSession(USER)}`,
    'x-workspace-id': TENANT,
  });

  beforeAll(async () => {
    process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';
    process.env.ADMIN_KMS_MASTER_KEY ??= '11'.repeat(32);

    admin = await provisionTenant({
      tenantId: TENANT,
      name: 'Original Bytes Test Co',
      users: [{ id: USER, role: 'owner' }],
    });

    const tokens = await import('../tokens.js');
    issueSession = tokens.issueSession;
    const storage = await import('../storage.js');
    getStored = storage.get;
    const pdf = await import('../extraction/pdf.js');
    demuxPdf = pdf.demuxPdf;

    const { AppModule } = await import('../app.module.js');
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
    fastify.addContentTypeParser(/^image\//, rawBody, passthrough);
    fastify.addContentTypeParser(/^application\/pdf$/, rawBody, passthrough);
    fastify.addContentTypeParser(/^text\/csv$/, rawBody, passthrough);

    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await wipeTenant(admin, TENANT, [USER]);
    await admin.end();
    await app.close();
  });

  async function registerPdfCapture(bytes: Buffer): Promise<{ uploadUrl: string; captureId: string }> {
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/captures',
      headers: auth(),
      payload: {
        pages: [{ sha256, mimeType: 'application/pdf', byteSize: bytes.byteLength }],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    return { uploadUrl: body.uploadUrl as string, captureId: body.captureId as string };
  }

  async function originalStorageKeyFor(captureId: string): Promise<string> {
    const { rows } = await admin.query<{ original_storage_key: string }>(
      `select original_storage_key from captures where tenant_id = $1 and id = $2`,
      [TENANT, captureId],
    );
    expect(rows).toHaveLength(1);
    return rows[0]!.original_storage_key;
  }

  it('leaves the real PDF bytes at original_storage_key — not merely present, but parseable', async () => {
    const pdf = fixturePdf(3);
    const { uploadUrl, captureId } = await registerPdfCapture(pdf);

    const res = await app.inject({
      method: 'PUT',
      url: uploadUrl,
      headers: { ...auth(), 'content-type': 'application/pdf' },
      payload: pdf,
    });
    expect(res.statusCode).toBe(200);

    const key = await originalStorageKeyFor(captureId);

    // Not just "a file exists" — bytes read back from that exact key must
    // themselves parse as a 3-page PDF, the same document that was uploaded.
    const stored = getStored(key);
    expect(stored.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const rendered = await demuxPdf(stored);
    expect(rendered).toHaveLength(3);
    expect(stored.equals(pdf)).toBe(true);
  });

  it('a retried PUT of the same PDF does not corrupt or duplicate the original', async () => {
    const pdf = fixturePdf(2);
    const { uploadUrl, captureId } = await registerPdfCapture(pdf);

    const first = await app.inject({
      method: 'PUT',
      url: uploadUrl,
      headers: { ...auth(), 'content-type': 'application/pdf' },
      payload: pdf,
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'PUT',
      url: uploadUrl,
      headers: { ...auth(), 'content-type': 'application/pdf' },
      payload: pdf,
    });
    expect(second.statusCode).toBe(200);

    const key = await originalStorageKeyFor(captureId);
    const stored = getStored(key);
    expect(stored.equals(pdf)).toBe(true);
  });
});
