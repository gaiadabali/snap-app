import { createHash, randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * `agreementRateByField` against a real Postgres — the proof that OD-12's
 * second "done when" clause is actually true: *"agreement rate per field is
 * queryable per engine version and per device model."* Migration 0028 exists
 * for exactly this query; this test is what makes that a checked fact rather
 * than an assertion in a comment.
 *
 * See `agreement-report.ts`'s header for the one honest gap: `engineVersion`
 * is accepted by the device-reading DTO but never persisted anywhere on disk
 * today, so this groups by engine ID and OS version/device model — what the
 * schema actually carries — not literally by "engine version". That gap sits
 * in `apps/server/src/captures/device-reading.controller.ts`, outside this
 * ticket's files.
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

describeIfDb('agreementRateByField — the join 0028 was built to make possible', () => {
  let admin: Client;
  let agreementRateByField: typeof import('./agreement-report.js').agreementRateByField;
  let closeDb: typeof import('../db.js').closeDb;

  const TENANT = randomUUID();
  const USER = randomUUID();
  const SUPPLIER = randomUUID();

  // Three captures on ONE engine/device (two agree, one disagrees on the
  // total → rate 2/3) and a fourth on a DIFFERENT device model, agreeing —
  // enough to prove the grouping is per (field, engine, device), not global.
  const CAPTURE_A1 = randomUUID();
  const CAPTURE_A2 = randomUUID();
  const CAPTURE_A3 = randomUUID();
  const CAPTURE_B1 = randomUUID();

  async function wipe(): Promise<void> {
    const captures = [CAPTURE_A1, CAPTURE_A2, CAPTURE_A3, CAPTURE_B1];
    await admin.query('delete from document_field_grounding where capture_id = any($1::uuid[])', [captures]);
    await admin.query('delete from document_layouts where capture_id = any($1::uuid[])', [captures]);
    await admin.query('delete from documents where capture_id = any($1::uuid[])', [captures]);
    await admin.query('delete from captures where id = any($1::uuid[])', [captures]);
    await admin.query('delete from parties where id = $1', [SUPPLIER]);
    await admin.query('delete from memberships where tenant_id = $1', [TENANT]);
    await admin.query('delete from users where id = $1', [USER]);
    await admin.query('delete from tenants where id = $1', [TENANT]);
  }

  /** Plants one capture + document + device layout + one grounding row. */
  async function plant(
    capture: string,
    documentPayable: string,
    devicePayable: string,
    deviceMeta: Record<string, unknown>,
  ): Promise<void> {
    const sha = createHash('sha256').update(capture).digest('hex');
    await admin.query(
      `insert into captures (
         id, tenant_id, original_storage_key, original_mime_type,
         original_byte_size, original_sha256, page_count, device_meta, status
       ) values ($1, $2, $3, 'image/jpeg', 1024, decode($4, 'hex'), 1, '{}'::jsonb, 'received')`,
      [capture, TENANT, `${TENANT}/originals/ab/${capture}`, sha],
    );
    await admin.query(
      `insert into documents (id, tenant_id, capture_id, supplier_id, issue_date, payable_amount, tax_amount)
       values ($1, $2, $3, $4, '2026-08-22', $5, 1.00)`,
      [randomUUID(), TENANT, capture, SUPPLIER, documentPayable],
    );
    const layout = randomUUID();
    await admin.query(
      `insert into document_layouts (
         id, tenant_id, capture_id, extraction_run_id, storage_key, docdom_version,
         page_count, engine_ids, span_count, unreadable_count, shadow, device_meta
       ) values ($1, $2, $3, null, $4, '1.0.0', 1, array['device-mlkit']::text[], 1, 0, true, $5::jsonb)`,
      [layout, TENANT, capture, `${TENANT}/layouts/${capture}/device-${layout}.json`, JSON.stringify(deviceMeta)],
    );
    await admin.query(
      `insert into document_field_grounding (
         id, tenant_id, capture_id, layout_id, field_path, value, grounded, span_ids, box, page, confidence
       ) values ($1, $2, $3, $4, 'header.payable_amount', $5, false, '{}', null, null, 0.9)`,
      [randomUUID(), TENANT, capture, layout, devicePayable],
    );
  }

  beforeAll(async () => {
    admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await wipe();

    await admin.query(`insert into tenants (id, name, kind) values ($1, 'od12-report-test', 'personal')`, [
      TENANT,
    ]);
    await admin.query(
      `insert into users (id, subject, email, display_name) values ($1, $2, $3, $4)`,
      [USER, `test|${USER}`, 'od12-report@example.test', 'OD12 Report'],
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

    const samsungA16 = { platform: 'android', osVersion: '14', model: 'Galaxy A16 5G', totalMemoryMb: 4096 };
    const iphone11 = { platform: 'ios', osVersion: '17.6', model: 'iPhone 11', totalMemoryMb: 4096 };

    await plant(CAPTURE_A1, '48.50', '48.50', samsungA16); // agrees
    await plant(CAPTURE_A2, '48.50', '48.50', samsungA16); // agrees
    await plant(CAPTURE_A3, '46.50', '48.50', samsungA16); // disagrees
    await plant(CAPTURE_B1, '10.00', '10.00', iphone11); // agrees, different device

    ({ agreementRateByField } = await import('./agreement-report.js'));
    ({ closeDb } = await import('../db.js'));
  });

  afterAll(async () => {
    await wipe();
    await admin.end();
    await closeDb?.();
  });

  it('runs, and reports a rate per field, per engine, per device model', async () => {
    const rows = await agreementRateByField(USER, TENANT);

    const a16Row = rows.find((r) => r.deviceModel === 'Galaxy A16 5G' && r.fieldPath === 'header.payable_amount');
    expect(a16Row).toBeDefined();
    expect(a16Row).toMatchObject({ engineId: 'device-mlkit', total: 3, agree: 2 });
    expect(a16Row!.rate).toBeCloseTo(2 / 3, 5);

    const iphoneRow = rows.find((r) => r.deviceModel === 'iPhone 11' && r.fieldPath === 'header.payable_amount');
    expect(iphoneRow).toBeDefined();
    expect(iphoneRow).toMatchObject({ engineId: 'device-mlkit', total: 1, agree: 1 });
    expect(iphoneRow!.rate).toBe(1);

    // The two device models are NOT collapsed into one bucket — the whole
    // point of the query, and the reason 0028 stores device_meta at all.
    expect(a16Row).not.toEqual(iphoneRow);
  });

  it("another tenant's data never enters the rate — RLS scopes the join", async () => {
    const OTHER_TENANT = randomUUID();
    const OTHER_USER = randomUUID();
    await admin.query(`insert into tenants (id, name, kind) values ($1, 'od12-report-other', 'personal')`, [
      OTHER_TENANT,
    ]);
    await admin.query(
      `insert into users (id, subject, email, display_name) values ($1, $2, $3, $4)`,
      [OTHER_USER, `test|${OTHER_USER}`, 'od12-report-other@example.test', 'Other'],
    );
    await admin.query(`insert into memberships (tenant_id, user_id, role) values ($1, $2, 'owner')`, [
      OTHER_TENANT,
      OTHER_USER,
    ]);
    try {
      const rows = await agreementRateByField(OTHER_USER, OTHER_TENANT);
      expect(rows).toEqual([]);
    } finally {
      await admin.query('delete from memberships where tenant_id = $1', [OTHER_TENANT]);
      await admin.query('delete from users where id = $1', [OTHER_USER]);
      await admin.query('delete from tenants where id = $1', [OTHER_TENANT]);
    }
  });
});
