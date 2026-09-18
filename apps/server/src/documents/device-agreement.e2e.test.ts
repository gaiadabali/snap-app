import { createHash, randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * `deviceAgreementFindings` against a real Postgres — OD-12's "done when":
 * *"a forced disagreement appears as a note carrying both values."*
 *
 * Two roles, mirroring `images.repo.test.ts`'s own header: `admin` (superuser)
 * plants a document, a device layout and its grounding rows directly,
 * bypassing RLS — the only way to set up two tenants' worth of fixtures
 * without the test itself needing tenant context first. The function under
 * test runs as `snap_app`, via `process.env.DATABASE_URL`, through
 * `withTenantAs` — the same role and the same path the deployed server uses.
 *
 * Skips cleanly on a machine with no local `snapdb` running.
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

process.env.DATABASE_URL = APP_URL;
process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';

describeIfDb('deviceAgreementFindings — a forced disagreement, against real Postgres', () => {
  let admin: Client;
  let deviceAgreementFindings: typeof import('./device-agreement.js').deviceAgreementFindings;
  let closeDb: typeof import('../db.js').closeDb;

  const TENANT = randomUUID();
  const USER = randomUUID();
  const CAPTURE_DIFFERS = randomUUID();
  const CAPTURE_AGREES = randomUUID();
  const CAPTURE_NO_DEVICE = randomUUID();
  const SUPPLIER = randomUUID();
  const DOC_DIFFERS = randomUUID();
  const DOC_AGREES = randomUUID();
  const DOC_NO_DEVICE = randomUUID();
  const LAYOUT_DIFFERS = randomUUID();
  const LAYOUT_AGREES = randomUUID();

  async function wipe(): Promise<void> {
    const captures = [CAPTURE_DIFFERS, CAPTURE_AGREES, CAPTURE_NO_DEVICE];
    await admin.query('delete from document_field_grounding where capture_id = any($1::uuid[])', [captures]);
    await admin.query('delete from document_layouts where capture_id = any($1::uuid[])', [captures]);
    await admin.query('delete from documents where capture_id = any($1::uuid[])', [captures]);
    await admin.query('delete from captures where id = any($1::uuid[])', [captures]);
    await admin.query('delete from parties where id = $1', [SUPPLIER]);
    await admin.query('delete from memberships where tenant_id = $1', [TENANT]);
    await admin.query('delete from users where id = $1', [USER]);
    await admin.query('delete from tenants where id = $1', [TENANT]);
  }

  beforeAll(async () => {
    admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await wipe();

    await admin.query(`insert into tenants (id, name, kind) values ($1, 'od12-test', 'personal')`, [TENANT]);
    await admin.query(
      `insert into users (id, subject, email, display_name) values ($1, $2, $3, $4)`,
      [USER, `test|${USER}`, 'od12@example.test', 'OD12'],
    );
    await admin.query(`insert into memberships (tenant_id, user_id, role) values ($1, $2, 'owner')`, [
      TENANT,
      USER,
    ]);
    await admin.query(
      `insert into parties (id, tenant_id, legal_name, name_normalised, abn)
       values ($1, $2, 'Kalinda Grocers', 'kalinda grocers', '51824753556')`,
      [SUPPLIER, TENANT],
    );

    for (const capture of [CAPTURE_DIFFERS, CAPTURE_AGREES, CAPTURE_NO_DEVICE]) {
      const sha = createHash('sha256').update(capture).digest('hex');
      await admin.query(
        `insert into captures (
           id, tenant_id, original_storage_key, original_mime_type,
           original_byte_size, original_sha256, page_count, device_meta, status
         ) values ($1, $2, $3, 'image/jpeg', 1024, decode($4, 'hex'), 1, '{}'::jsonb, 'received')`,
        [capture, TENANT, `${TENANT}/originals/ab/${capture}`, sha],
      );
    }

    // DOC_DIFFERS: the document's own payable_amount ($46.50) will disagree
    // with the device layout's preview reading ($48.50) set up below.
    await admin.query(
      `insert into documents (id, tenant_id, capture_id, supplier_id, issue_date, payable_amount, tax_amount)
       values ($1, $2, $3, $4, '2026-08-22', 46.50, 4.23)`,
      [DOC_DIFFERS, TENANT, CAPTURE_DIFFERS, SUPPLIER],
    );
    // DOC_AGREES: the document and the device reading say the same total.
    await admin.query(
      `insert into documents (id, tenant_id, capture_id, supplier_id, issue_date, payable_amount, tax_amount)
       values ($1, $2, $3, $4, '2026-08-22', 48.50, 4.41)`,
      [DOC_AGREES, TENANT, CAPTURE_AGREES, SUPPLIER],
    );
    // DOC_NO_DEVICE: a perfectly ordinary document with no device reading at all.
    await admin.query(
      `insert into documents (id, tenant_id, capture_id, supplier_id, issue_date, payable_amount, tax_amount)
       values ($1, $2, $3, $4, '2026-08-22', 12.00, 1.09)`,
      [DOC_NO_DEVICE, TENANT, CAPTURE_NO_DEVICE, SUPPLIER],
    );

    for (const [layout, capture] of [
      [LAYOUT_DIFFERS, CAPTURE_DIFFERS],
      [LAYOUT_AGREES, CAPTURE_AGREES],
    ] as const) {
      await admin.query(
        `insert into document_layouts (
           id, tenant_id, capture_id, extraction_run_id, storage_key, docdom_version,
           page_count, engine_ids, span_count, unreadable_count, shadow, device_meta
         ) values (
           $1, $2, $3, null, $4, '1.0.0', 1, array['device-mlkit']::text[], 4, 0, true, $5::jsonb
         )`,
        [
          layout,
          TENANT,
          capture,
          `${TENANT}/layouts/${capture}/device-${layout}.json`,
          JSON.stringify({ platform: 'android', osVersion: '13', model: 'samsung SM-A715F', totalMemoryMb: 7519 }),
        ],
      );
    }

    // The device read $48.50 in both cases — DOC_DIFFERS' own record says
    // $46.50 (forced disagreement); DOC_AGREES' says $48.50 (confirmed).
    for (const layout of [LAYOUT_DIFFERS, LAYOUT_AGREES]) {
      await admin.query(
        `insert into document_field_grounding (
           id, tenant_id, capture_id, layout_id, field_path, value, grounded, span_ids, box, page, confidence
         ) values ($1, $2, $3, $4, 'header.payable_amount', '48.50', false, '{}', null, null, 0.9)`,
        [randomUUID(), TENANT, layout === LAYOUT_DIFFERS ? CAPTURE_DIFFERS : CAPTURE_AGREES, layout],
      );
    }

    ({ deviceAgreementFindings } = await import('./device-agreement.js'));
    ({ closeDb } = await import('../db.js'));
  });

  afterAll(async () => {
    await wipe();
    await admin.end();
    await closeDb?.();
  });

  it('a forced disagreement is a note carrying BOTH values', async () => {
    const findings = await deviceAgreementFindings(USER, TENANT, {
      capture_id: CAPTURE_DIFFERS,
      supplier_name: 'Kalinda Grocers',
      supplier_abn: '51824753556',
      issue_date: '2026-08-22',
      payable_amount: '46.50',
      tax_amount: '4.23',
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: 'device_agreement_diff',
      severity: 'note',
      field: 'payableAmount',
    });
    expect(findings[0]!.message).toContain('48.50');
    expect(findings[0]!.message).toContain('46.50');
  });

  it('no finding when the device and the record agree', async () => {
    const findings = await deviceAgreementFindings(USER, TENANT, {
      capture_id: CAPTURE_AGREES,
      supplier_name: 'Kalinda Grocers',
      supplier_abn: '51824753556',
      issue_date: '2026-08-22',
      payable_amount: '48.50',
      tax_amount: '4.41',
    });
    expect(findings).toEqual([]);
  });

  it('no finding, no error, when no device reading exists for the capture', async () => {
    const findings = await deviceAgreementFindings(USER, TENANT, {
      capture_id: CAPTURE_NO_DEVICE,
      supplier_name: 'Kalinda Grocers',
      supplier_abn: '51824753556',
      issue_date: '2026-08-22',
      payable_amount: '12.00',
      tax_amount: '1.09',
    });
    expect(findings).toEqual([]);
  });

  it("another tenant's device layout is invisible — RLS, not application logic, is what keeps this honest", async () => {
    const OTHER_TENANT = randomUUID();
    const OTHER_USER = randomUUID();
    await admin.query(`insert into tenants (id, name, kind) values ($1, 'od12-other', 'personal')`, [
      OTHER_TENANT,
    ]);
    await admin.query(
      `insert into users (id, subject, email, display_name) values ($1, $2, $3, $4)`,
      [OTHER_USER, `test|${OTHER_USER}`, 'od12-other@example.test', 'OD12 Other'],
    );
    await admin.query(`insert into memberships (tenant_id, user_id, role) values ($1, $2, 'owner')`, [
      OTHER_TENANT,
      OTHER_USER,
    ]);
    try {
      // Same capture id looked up under a DIFFERENT tenant's membership finds
      // nothing — RLS scopes document_layouts by tenant_id, and this function
      // must never leak a disagreement (or its absence) across the boundary.
      const findings = await deviceAgreementFindings(OTHER_USER, OTHER_TENANT, {
        capture_id: CAPTURE_DIFFERS,
        supplier_name: null,
        supplier_abn: null,
        issue_date: null,
        payable_amount: null,
        tax_amount: null,
      });
      expect(findings).toEqual([]);
    } finally {
      await admin.query('delete from memberships where tenant_id = $1', [OTHER_TENANT]);
      await admin.query('delete from users where id = $1', [OTHER_USER]);
      await admin.query('delete from tenants where id = $1', [OTHER_TENANT]);
    }
  });
});
