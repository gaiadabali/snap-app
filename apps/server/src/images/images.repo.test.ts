import { randomUUID, createHash } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Cross-tenant proof for the signed-image reads
 * (`getCaptureOriginalForImage`, `getCapturePageForImage` — `repo.ts`, backing
 * `GET /v1/images/:token`, `docs/contracts/phase0-multipage.md` §8).
 *
 * This is the property the amendment calls out as mattering more than the
 * feature: "A token minted for one tenant's page must be useless against
 * another tenant's" and "the bytes must still be fetched through the normal
 * tenant-scoped path... it does not become a way to bypass RLS." A comment
 * asserting that is not proof; only a query that actually runs under RLS and
 * comes back empty is.
 *
 * TWO ROLES, ONE DATABASE — deliberately, mirroring
 * `packages/db/test/rls.test.ts`:
 *
 *  - `ADMIN_URL` (superuser, `pnpm db:up`'s default password) sets up
 *    fixtures directly, bypassing RLS — the only way to plant two tenants'
 *    data without the test itself needing tenant context.
 *  - `APP_URL` (`snap_app`, NOSUPERUSER NOBYPASSRLS — `node scripts/db.mjs
 *    appuser`) is what `repo.ts`'s functions under test actually run as, via
 *    `process.env.DATABASE_URL`. This is the role the real server connects
 *    as (`config.ts`), so a pass here means the real deployed behaviour was
 *    exercised, not a superuser connection that would make every assertion
 *    pass vacuously — the exact trap `rls.test.ts`'s own header comment
 *    warns about.
 *
 * Connection strings are the well-known local dev defaults
 * (`packages/db/scripts/db.mjs`) unless overridden. Skips cleanly — via a
 * live connection probe, not merely an env var being set — when no database
 * is reachable, so `pnpm test` stays green on a machine that never ran
 * `pnpm db:up`.
 */

const ADMIN_URL =
  process.env.SNAP_TEST_ADMIN_DATABASE_URL ?? 'postgres://postgres:verify@127.0.0.1:55499/snapapps';
const APP_URL =
  process.env.SNAP_TEST_APP_DATABASE_URL ??
  'postgres://snap_app:app-dev-password@127.0.0.1:55499/snapapps';

async function canConnect(connectionString: string): Promise<boolean> {
  const c = new Client({ connectionString, connectionTimeoutMillis: 2000 });
  try {
    await c.connect();
    await c.end();
    return true;
  } catch {
    return false;
  }
}

const hasDb = await canConnect(ADMIN_URL);
const describeIfDb = hasDb ? describe : describe.skip;

// `config()` is only invoked lazily, inside `getDb()`, the first time a
// `repo.ts` function actually runs a query — so setting these before ANY
// test body executes (not merely before importing `repo.ts`) is sufficient,
// same principle `tokens.test.ts` documents for the same reason.
process.env.DATABASE_URL = APP_URL;
process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';
process.env.IMAGE_TTL_SECONDS ??= '900';

describeIfDb('signed-image reads are tenant-scoped', () => {
  let admin: Client;
  let getCaptureOriginalForImage: typeof import('../repo.js').getCaptureOriginalForImage;
  let getCapturePageForImage: typeof import('../repo.js').getCapturePageForImage;
  let closeDb: typeof import('../db.js').closeDb;

  const TENANT_A = 'fca71000-0000-4000-8000-00000000000a';
  const TENANT_B = 'fca71000-0000-4000-8000-00000000000b';
  const USER_A = 'fca72000-0000-4000-8000-00000000000a';
  const USER_B = 'fca72000-0000-4000-8000-00000000000b';
  const CAPTURE_A = randomUUID();
  const CAPTURE_B = randomUUID();
  const sha = (s: string) => createHash('sha256').update(s).digest('hex');

  async function wipe(): Promise<void> {
    const tenants = [TENANT_A, TENANT_B];
    await admin.query('DELETE FROM capture_pages WHERE tenant_id = ANY($1::uuid[])', [tenants]);
    await admin.query('DELETE FROM captures WHERE tenant_id = ANY($1::uuid[])', [tenants]);
    await admin.query('DELETE FROM memberships WHERE tenant_id = ANY($1::uuid[])', [tenants]);
    await admin.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[USER_A, USER_B]]);
    await admin.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [tenants]);
  }

  beforeAll(async () => {
    admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await wipe();

    await admin.query(`INSERT INTO tenants (id, name) VALUES ($1,'Images Tenant A'), ($2,'Images Tenant B')`, [
      TENANT_A,
      TENANT_B,
    ]);
    await admin.query(
      `INSERT INTO users (id, subject, email) VALUES
         ($1,'idp|images-test-a','images-test-a@example.com'),
         ($2,'idp|images-test-b','images-test-b@example.com')`,
      [USER_A, USER_B],
    );
    await admin.query(
      `INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1,$2,'owner'), ($3,$4,'owner')`,
      [TENANT_A, USER_A, TENANT_B, USER_B],
    );

    // Tenant A's capture: original bytes + one page, distinguishable by key
    // and mime type from tenant B's.
    await admin.query(
      `INSERT INTO captures
         (id, tenant_id, uploaded_by, original_storage_key, original_mime_type,
          original_byte_size, original_sha256, page_count)
       VALUES ($1,$2,$3,'tenant-a/originals/aa/original-a','image/jpeg',1111,decode($4,'hex'),1)`,
      [CAPTURE_A, TENANT_A, USER_A, sha('capture-a-original')],
    );
    await admin.query(
      `INSERT INTO capture_pages
         (id, tenant_id, capture_id, page_number, storage_key, mime_type, byte_size, sha256, source)
       VALUES ($1,$2,$3,1,'tenant-a/pages/aa/page-a-1','image/jpeg',1111,decode($4,'hex'),'capture')`,
      [randomUUID(), TENANT_A, CAPTURE_A, sha('capture-a-page-1')],
    );

    // Tenant B's capture: same shape, different bytes, different tenant.
    await admin.query(
      `INSERT INTO captures
         (id, tenant_id, uploaded_by, original_storage_key, original_mime_type,
          original_byte_size, original_sha256, page_count)
       VALUES ($1,$2,$3,'tenant-b/originals/bb/original-b','application/pdf',2222,decode($4,'hex'),1)`,
      [CAPTURE_B, TENANT_B, USER_B, sha('capture-b-original')],
    );
    await admin.query(
      `INSERT INTO capture_pages
         (id, tenant_id, capture_id, page_number, storage_key, mime_type, byte_size, sha256, source)
       VALUES ($1,$2,$3,1,'tenant-b/pages/bb/page-b-1','image/png',2222,decode($4,'hex'),'pdf_render')`,
      [randomUUID(), TENANT_B, CAPTURE_B, sha('capture-b-page-1')],
    );

    const repo = await import('../repo.js');
    getCaptureOriginalForImage = repo.getCaptureOriginalForImage;
    getCapturePageForImage = repo.getCapturePageForImage;
    closeDb = (await import('../db.js')).closeDb;
  });

  afterAll(async () => {
    await wipe();
    await admin.end();
    await closeDb();
  });

  it("reads tenant A's own original with tenant A's own id", async () => {
    const found = await getCaptureOriginalForImage(TENANT_A, CAPTURE_A);
    expect(found).toEqual({ key: 'tenant-a/originals/aa/original-a', mime: 'image/jpeg' });
  });

  it("reads tenant A's own page 1 with tenant A's own id", async () => {
    const found = await getCapturePageForImage(TENANT_A, CAPTURE_A, 1);
    expect(found).toEqual({ key: 'tenant-a/pages/aa/page-a-1', mime: 'image/jpeg' });
  });

  it("a captureId that belongs to tenant A is invisible under tenant B's tenantId (original)", async () => {
    // The exact shape a forged or (hypothetically) mis-minted token would
    // take: a real captureId, but the wrong tenant claimed alongside it.
    // Nothing here should find tenant A's row.
    expect(await getCaptureOriginalForImage(TENANT_B, CAPTURE_A)).toBeNull();
  });

  it("a captureId that belongs to tenant A is invisible under tenant B's tenantId (page)", async () => {
    expect(await getCapturePageForImage(TENANT_B, CAPTURE_A, 1)).toBeNull();
  });

  it("symmetrically, tenant B's capture is invisible under tenant A's tenantId", async () => {
    expect(await getCaptureOriginalForImage(TENANT_A, CAPTURE_B)).toBeNull();
    expect(await getCapturePageForImage(TENANT_A, CAPTURE_B, 1)).toBeNull();
  });

  it('a page number that was never recorded returns null rather than another page', async () => {
    expect(await getCapturePageForImage(TENANT_A, CAPTURE_A, 2)).toBeNull();
  });
});
