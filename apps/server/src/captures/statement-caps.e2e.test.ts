import { randomUUID, createHash } from 'node:crypto';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { provisionTenant, wipeTenant } from '../test-support/tenant.js';

/**
 * T7 — the page and size caps admit a real statement, through real HTTP.
 *
 * `docs/STATEMENTS.md` §12 (Lane T, T7) names the target directly: "a
 * 40-page statement PDF either imports or is refused with a message naming
 * the cap ... silence at the boundary is the failure mode here." So this
 * suite proves both directions against the real endpoint rather than a unit
 * test of the DTO decorators — the decorators only bind `CreateCaptureDto`,
 * which a PDF capture never fills past ONE declared page (see
 * `captures.controller.ts`'s "PDF must be the only page" rule); the cap that
 * actually matters for a PDF is the post-demux check added in `upload()`,
 * and only a real multipart-free PUT of real PDF bytes exercises it.
 *
 * Refusal first, per this repository's own convention
 * (`taxrules.e2e.test.ts`'s header): a cap that has never rejected anything
 * proves nothing.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TENANT = 'e7e7e7e7-0000-4000-8000-000000000001';
const USER = 'e7e7e7e7-0000-4000-8000-000000000002';

/**
 * A minimal, valid, hand-assembled multi-page PDF with N pages, each holding
 * real text — long enough (`docs/STATEMENTS.md` §5.6, `NATIVE_TEXT_THRESHOLD`
 * in `extraction/pdf.ts`, 20 characters) to read as a genuine text layer, not
 * a stray label. Modelled on `extraction/pdf.test.ts`'s own fixture builder
 * — hand-built rather than library-generated, because the two things worth
 * proving here (does the real endpoint accept N pages, does it refuse N+)
 * deserve a PDF that is not itself a black box.
 */
function statementPdf(pageCount: number): Buffer {
  const contentStreams = Array.from({ length: pageCount }, (_, i) => {
    const text = `Statement page ${i + 1} of ${pageCount} — opening 1,234.56, closing 2,345.67`;
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

describeIfDb('statement intake caps — real HTTP (T7)', () => {
  let app: NestFastifyApplication;
  let admin: Client;
  let issueSession: typeof import('../tokens.js').issueSession;

  const auth = () => ({
    authorization: `Bearer ${issueSession(USER)}`,
    'x-workspace-id': TENANT,
  });

  beforeAll(async () => {
    process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';
    process.env.ADMIN_KMS_MASTER_KEY ??= '11'.repeat(32);

    admin = await provisionTenant({
      tenantId: TENANT,
      name: 'Statement Test Co',
      users: [{ id: USER, role: 'owner' }],
    });

    const tokens = await import('../tokens.js');
    issueSession = tokens.issueSession;

    const { AppModule } = await import('../app.module.js');
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      // `bodyLimit` and `maxParamLength` mirror `main.ts`'s `bootstrap()` —
      // the upload token in the URL runs past Fastify's 100-char default,
      // so without raising it here every PUT below fails 414 before this
      // suite ever reaches the cap it exists to test.
      new FastifyAdapter({
        bodyLimit: 32 * 1024 * 1024,
        routerOptions: { maxParamLength: 600 },
      }),
      { logger: false },
    );

    // Mirrors `main.ts`'s raw-body wiring for `/v1/uploads/:token` — without
    // it Fastify answers 415 before the controller ever sees the PDF bytes,
    // which would make this suite test Fastify's defaults instead of T7.
    const fastify = app.getHttpAdapter().getInstance();
    const rawBody = { parseAs: 'buffer' as const, bodyLimit: 32 * 1024 * 1024 };
    const passthrough = (
      _request: unknown,
      body: Buffer,
      done: (err: Error | null, body?: Buffer) => void,
    ) => done(null, body);
    fastify.addContentTypeParser(/^image\//, rawBody, passthrough);
    fastify.addContentTypeParser(/^application\/pdf$/, rawBody, passthrough);

    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await wipeTenant(admin, TENANT, [USER]);
    await admin.end();
    await app.close();
  });

  /** POST /v1/captures for a single declared PDF page, returning its upload URL. */
  async function registerPdfCapture(bytes: Buffer): Promise<string> {
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
    return res.json().uploadUrl as string;
  }

  /* ── Refusal first ────────────────────────────────────────────────────── */

  it('refuses a PDF past the page cap, naming the cap — not silently, not by timeout', async () => {
    // Well past MAX_CAPTURE_PAGES (50) — a genuinely abusive upload, the
    // shape of thing the missing cap let through before T7: no page-count
    // check existed at all for a PDF, because it always declares ONE page at
    // registration and the declared-pages cap never sees its real count.
    const abusive = statementPdf(120);
    const uploadUrl = await registerPdfCapture(abusive);

    const res = await app.inject({
      method: 'PUT',
      url: uploadUrl,
      headers: { ...auth(), 'content-type': 'application/pdf' },
      payload: abusive,
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    // The cap is NAMED in the message — asserting the number, not just the
    // status code, is what proves this is a deliberate refusal rather than
    // an accidental 400 from something else going wrong.
    expect(body.message).toMatch(/120 pages/);
    expect(body.message).toMatch(/50-page cap/);
  });

  /* ── Acceptance ───────────────────────────────────────────────────────── */

  it('accepts a realistic 40-page statement PDF — the docs stated target', async () => {
    const statement = statementPdf(40);
    const uploadUrl = await registerPdfCapture(statement);

    const res = await app.inject({
      method: 'PUT',
      url: uploadUrl,
      headers: { ...auth(), 'content-type': 'application/pdf' },
      payload: statement,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.queued).toBe(true);
    expect(body.pages).toBe(40);

    // Not just a 200 — every one of the 40 pages actually landed as its own
    // `capture_pages` row, tagged `pdf_native` (real embedded text, per this
    // fixture's content streams), under the app's own tenant-scoped role.
    const { rows } = await admin.query(
      `select count(*)::int as n, count(*) filter (where source = 'pdf_native')::int as native
         from capture_pages cp
         join captures c on c.id = cp.capture_id
        where c.tenant_id = $1`,
      [TENANT],
    );
    expect(rows[0].n).toBe(40);
    expect(rows[0].native).toBe(40);
  });

  it('still refuses a capture that DECLARES more than the cap up front', async () => {
    // The other axis MAX_CAPTURE_PAGES bounds: a capture built from
    // individually photographed statement pages, not a single PDF. 51
    // declared pages — one past the cap — proves the boundary is exact, not
    // "comfortably large".
    const pages = Array.from({ length: 51 }, () => ({
      sha256: createHash('sha256').update(randomUUID()).digest('hex'),
      mimeType: 'image/jpeg',
      byteSize: 1024,
    }));

    const res = await app.inject({
      method: 'POST',
      url: '/v1/captures',
      headers: auth(),
      payload: { pages },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).toMatch(/more than 50 pages/);
  });
});
