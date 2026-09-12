import { createHash } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb } from './db.js';
import { createCapture, finalizeCapturePages, recordCapturePage } from './repo.js';

/**
 * `finalizeCapturePages` — the PDF-demux write path (migration 0018 /
 * `docs/contracts/phase0-multipage.md` §3.1).
 *
 * Runs against a real Postgres rather than a mock: the behaviour under test
 * IS a Postgres UNIQUE constraint firing in a specific, anticipated shape,
 * and a mock cannot fire a real constraint. Requires DATABASE_URL — the same
 * superuser connection `pnpm db:up` prints, per the convention in
 * `packages/db/test/rls.test.ts` and `drift.test.ts` — and TOKEN_SECRET,
 * because `config()` validates its whole schema together the first time
 * anything calls `getDb()`, not just the variable actually needed here.
 *
 * RLS is deliberately not exercised here (that is `packages/db/test/
 * rls.test.ts`'s job, and 0018 has a dedicated `capture_pages` section in
 * it). This file is about the arithmetic and the constraint-handling, which
 * are true regardless of which role runs them.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * The documented algorithm, reimplemented independently of `repo.ts`'s
 * private `captureDedupHash` — so that if the two ever drift, THIS test
 * catches it, rather than the test only ever confirming the implementation
 * agrees with itself.
 */
const expectedDedupHash = (hexes: string[]): string =>
  hexes.length === 1
    ? hexes[0]!.toLowerCase()
    : createHash('sha256')
        .update(
          hexes.map((h) => h.toLowerCase()).join(''),
          'utf8',
        )
        .digest('hex');

describeIfDb('finalizeCapturePages', () => {
  let admin: Client;
  const TENANT = 'fca7ca9e-0000-0000-0000-000000000001';
  const USER = 'fca7ca9e-0000-0000-0000-000000000002';

  async function readCapture(id: string) {
    const r = await admin.query<{
      page_count: number;
      sha256hex: string;
      storage_key: string;
      mime: string;
      bytes: string;
    }>(
      `select page_count, encode(original_sha256,'hex') as sha256hex,
              original_storage_key as storage_key, original_mime_type as mime,
              original_byte_size::text as bytes
         from captures where id = $1`,
      [id],
    );
    return r.rows[0]!;
  }

  beforeAll(async () => {
    if (!hasDb) return;
    // Fixtures here CREATE tenants, users and memberships, which the app role
    // deliberately cannot do. `DATABASE_URL` is the app role whenever another
    // suite is exercising row-level security with it, so the privileged
    // connection gets its own variable and falls back only when they happen to
    // be the same account.
    admin = new Client({
      connectionString: process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL,
    });
    await admin.connect();
    await admin.query('DELETE FROM capture_pages WHERE tenant_id = $1', [TENANT]);
    await admin.query('DELETE FROM captures WHERE tenant_id = $1', [TENANT]);
    await admin.query('DELETE FROM memberships WHERE tenant_id = $1', [TENANT]);
    await admin.query('DELETE FROM users WHERE id = $1', [USER]);
    await admin.query('DELETE FROM tenants WHERE id = $1', [TENANT]);
    await admin.query(`INSERT INTO tenants (id, name) VALUES ($1, 'finalizeCapturePages test')`, [
      TENANT,
    ]);
    await admin.query(
      `INSERT INTO users (id, subject, email) VALUES ($1, 'idp|finalize-test', 'finalize-test@example.com')`,
      [USER],
    );
    await admin.query(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'owner')`, [
      TENANT,
      USER,
    ]);
  });

  afterAll(async () => {
    if (!hasDb) return;
    await admin.query('DELETE FROM capture_pages WHERE tenant_id = $1', [TENANT]);
    await admin.query('DELETE FROM captures WHERE tenant_id = $1', [TENANT]);
    await admin.query('DELETE FROM memberships WHERE tenant_id = $1', [TENANT]);
    await admin.query('DELETE FROM users WHERE id = $1', [USER]);
    await admin.query('DELETE FROM tenants WHERE id = $1', [TENANT]);
    await admin.end();
    await closeDb();
  });

  it('recomputes page_count and original_sha256 from the demuxed pages, and leaves the PDF columns alone', async () => {
    const pdfSha = sha('pdf-file-happy-path');
    const created = await createCapture(USER, TENANT, {
      pages: [{ sha256: pdfSha, mimeType: 'application/pdf', byteSize: 5000 }],
    });
    expect(created.duplicate).toBe(false);
    const pdfStorageKey = created.pages[0]!.storageKey!;

    // The PDF itself lands as page 1 first — recorded before anyone knows
    // yet that the document needs demuxing at all.
    await recordCapturePage(USER, TENANT, {
      captureId: created.capture.id,
      pageNumber: 1,
      storageKey: pdfStorageKey,
      mimeType: 'application/pdf',
      byteSize: 5000,
      sha256: pdfSha,
      source: 'capture',
    });

    const before = await readCapture(created.capture.id);
    expect(before.page_count).toBe(1);
    expect(before.sha256hex).toBe(pdfSha);

    // Demux: 3 rendered pages replace/extend that single placeholder.
    const renders = [sha('render-page-1'), sha('render-page-2'), sha('render-page-3')];
    for (let i = 0; i < renders.length; i++) {
      await recordCapturePage(USER, TENANT, {
        captureId: created.capture.id,
        pageNumber: i + 1,
        storageKey: `rendered/${renders[i]}`,
        mimeType: 'image/png',
        byteSize: 1000,
        sha256: renders[i]!,
        source: 'pdf_render',
      });
    }

    const result = await finalizeCapturePages(
      USER,
      TENANT,
      created.capture.id,
      renders.map((sha256) => ({ sha256 })),
    );
    expect(result).toEqual({ ok: true });

    const after = await readCapture(created.capture.id);
    expect(after.page_count).toBe(3);
    expect(after.sha256hex).toBe(expectedDedupHash(renders));
    // The uploaded PDF stays the L0 original — finalize must not move these.
    expect(after.storage_key).toBe(pdfStorageKey);
    expect(after.mime).toBe('application/pdf');
    expect(after.bytes).toBe('5000');
  });

  it('is idempotent: re-finalizing with the same pages is a no-op, not a re-corruption', async () => {
    const pdfSha = sha('pdf-file-idempotent');
    const created = await createCapture(USER, TENANT, {
      pages: [{ sha256: pdfSha, mimeType: 'application/pdf', byteSize: 4000 }],
    });
    const renders = [sha('idem-page-1'), sha('idem-page-2')];
    for (let i = 0; i < renders.length; i++) {
      await recordCapturePage(USER, TENANT, {
        captureId: created.capture.id,
        pageNumber: i + 1,
        storageKey: `rendered/${renders[i]}`,
        mimeType: 'image/png',
        byteSize: 900,
        sha256: renders[i]!,
        source: 'pdf_render',
      });
    }
    const pages = renders.map((sha256) => ({ sha256 }));

    const first = await finalizeCapturePages(USER, TENANT, created.capture.id, pages);
    const second = await finalizeCapturePages(USER, TENANT, created.capture.id, pages);
    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true });

    const row = await readCapture(created.capture.id);
    expect(row.page_count).toBe(2);
    expect(row.sha256hex).toBe(expectedDedupHash(renders));
  });

  it('is order-sensitive: the same two page hashes in a different order hash differently', () => {
    const forward = expectedDedupHash(['aaaa', 'bbbb']);
    const backward = expectedDedupHash(['bbbb', 'aaaa']);
    expect(forward).not.toBe(backward);
  });

  it('throws rather than finalizing against pages that were never recorded', async () => {
    const pdfSha = sha('pdf-file-count-mismatch');
    const created = await createCapture(USER, TENANT, {
      pages: [{ sha256: pdfSha, mimeType: 'application/pdf', byteSize: 3000 }],
    });
    await recordCapturePage(USER, TENANT, {
      captureId: created.capture.id,
      pageNumber: 1,
      storageKey: 'only-one-recorded',
      mimeType: 'application/pdf',
      byteSize: 3000,
      sha256: pdfSha,
      source: 'capture',
    });

    // Only 1 page was ever recorded; claiming 2 must fail loudly rather than
    // writing a page_count nothing backs.
    await expect(
      finalizeCapturePages(USER, TENANT, created.capture.id, [
        { sha256: pdfSha },
        { sha256: sha('phantom-page') },
      ]),
    ).rejects.toThrow(/recorded page/);
  });

  it('reports a duplicate discovered only after demux, and leaves both rows untouched', async () => {
    const shaX = sha('pdf-file-x-distinct-encoding');
    const shaY = sha('pdf-file-y-distinct-encoding');
    const capX = await createCapture(USER, TENANT, {
      pages: [{ sha256: shaX, mimeType: 'application/pdf', byteSize: 1111 }],
    });
    const capY = await createCapture(USER, TENANT, {
      pages: [{ sha256: shaY, mimeType: 'application/pdf', byteSize: 2222 }],
    });
    // Two genuinely different PDFs — not a create-time duplicate.
    expect(capX.capture.id).not.toBe(capY.capture.id);

    // Both happen to render to the SAME two pages — the duplicate that could
    // not be known until after demux.
    const sharedRenders = [sha('shared-render-1'), sha('shared-render-2')];
    for (const cap of [capX, capY]) {
      for (let i = 0; i < sharedRenders.length; i++) {
        await recordCapturePage(USER, TENANT, {
          captureId: cap.capture.id,
          pageNumber: i + 1,
          storageKey: `rendered/${sharedRenders[i]}/${cap.capture.id}`,
          mimeType: 'image/png',
          byteSize: 800,
          sha256: sharedRenders[i]!,
          source: 'pdf_render',
        });
      }
    }
    const pages = sharedRenders.map((sha256) => ({ sha256 }));

    const first = await finalizeCapturePages(USER, TENANT, capX.capture.id, pages);
    expect(first).toEqual({ ok: true });

    const yBefore = await readCapture(capY.capture.id);
    const second = await finalizeCapturePages(USER, TENANT, capY.capture.id, pages);
    expect(second).toEqual({
      ok: false,
      reason: 'duplicate',
      duplicateCaptureId: capX.capture.id,
    });

    // Y is untouched — no partial write survives the failed attempt.
    const yAfter = await readCapture(capY.capture.id);
    expect(yAfter).toEqual(yBefore);
    expect(yAfter.sha256hex).toBe(shaY);
    expect(yAfter.page_count).toBe(1);
  });
});
