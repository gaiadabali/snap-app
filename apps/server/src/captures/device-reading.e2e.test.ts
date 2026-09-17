import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * OD-7, against a real database as the application role.
 *
 * Almost every line of §3.5 is a refusal, and the reason is stated there: the
 * device reading must never be able to become the record. So the assertions
 * that matter are the row counts — `documents`, `extraction_runs` and
 * `review_tasks` unchanged before and after — and the shape of the one row it
 * IS allowed to write.
 *
 * §3.5 asks for that guarantee to be verified by breaking it: "the test is
 * verified by making the handler write a review task and watching it fail."
 * The last test here does exactly that, by inserting a review task itself and
 * asserting the count check catches it. A count assertion nobody has seen fail
 * is not known to be an assertion.
 *
 * Runs as `snap_app` — never a bypass role — because RLS on document_layouts
 * and document_field_grounding is half the control being tested.
 */
const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

describeIfDb('POST /v1/captures/:id/device-reading', () => {
  let controller: InstanceType<
    typeof import('./device-reading.controller.js').DeviceReadingController
  >;
  let admin: Client;
  let storageRoot: string;

  const TENANT = '11111111-2222-4333-8444-555555555001';
  const OTHER_TENANT = '11111111-2222-4333-8444-555555555002';
  const USER = '11111111-2222-4333-8444-555555555003';
  const CAPTURE = '11111111-2222-4333-8444-555555555004';
  const OTHER_CAPTURE = '11111111-2222-4333-8444-555555555005';

  const user = { userId: USER, email: 'od7@example.test', displayName: 'OD7', initials: 'O7' };

  const docdom = (pages = [{ number: 1, width: 600, height: 900 }]) => ({
    version: '1.0.0',
    pages,
    blocks: [{ id: 'b', kind: 'unknown', page: 1, order: 0, lines: [{ spans: [{ id: 's1' }, { id: 's2' }] }] }],
    tables: [],
    figures: [],
    fields: [],
    unreadable: [],
  });

  const body = (over: Record<string, unknown> = {}) => ({
    engine: 'device-mlkit',
    engineVersion: '19.0.1',
    docdom: docdom(),
    preview: {
      'header.payable_amount': {
        value: '36.20',
        grounded: true,
        spanIds: ['s1'],
        box: { x: 10, y: 20, width: 80, height: 20 },
        page: 1,
        confidence: 0.91,
      },
      // An abstention: must NOT produce a grounding row.
      'header.tax_amount': { value: null, grounded: false, spanIds: [], box: null, page: null, confidence: 0 },
    },
    timings: { recogniseMs: 320, structureMs: 4 },
    device: { platform: 'android', osVersion: '13', model: 'samsung SM-A715F', totalMemoryMb: 7519 },
    ...over,
  });

  const counts = async () => {
    const q = async (t: string) =>
      Number((await admin.query(`select count(*)::int as n from ${t}`)).rows[0].n);
    return {
      documents: await q('documents'),
      runs: await q('extraction_runs'),
      reviews: await q('review_tasks'),
    };
  };

  beforeAll(async () => {
    storageRoot = mkdtempSync(join(tmpdir(), 'od7-'));
    process.env.STORAGE_DIR = storageRoot;
    process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';

    admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL ?? url });
    await admin.connect();
    for (const [tenant, capture] of [
      [TENANT, CAPTURE],
      [OTHER_TENANT, OTHER_CAPTURE],
    ] as const) {
      await admin.query(
        `insert into tenants (id, name, kind) values ($1, $2, 'personal')
         on conflict (id) do nothing`,
        [tenant, `od7-${tenant.slice(-4)}`],
      );
      await admin.query(
        `insert into captures (
           id, tenant_id, original_storage_key, original_mime_type,
           original_byte_size, original_sha256, page_count, device_meta, status
         ) values ($1, $2, $3, 'image/jpeg', 1024, decode(repeat('ab', 32), 'hex'), 1, '{}'::jsonb, 'received')
         on conflict (id) do nothing`,
        [capture, tenant, `${tenant}/originals/ab/${capture}`],
      );
    }
    await admin.query(
      `insert into users (id, subject, email, display_name) values ($1, $2, $3, $4)
       on conflict (id) do nothing`,
      [USER, `test|${USER}`, user.email, user.displayName],
    );
    // Membership in ONE tenant only — the other is the isolation case.
    await admin.query(
      `insert into memberships (tenant_id, user_id, role) values ($1, $2, 'owner')
       on conflict do nothing`,
      [TENANT, USER],
    );

    const mod = await import('./device-reading.controller.js');
    controller = new mod.DeviceReadingController();
  });

  afterAll(async () => {
    await admin.query('delete from document_field_grounding where capture_id = any($1)', [
      [CAPTURE, OTHER_CAPTURE],
    ]);
    await admin.query('delete from document_layouts where capture_id = any($1)', [
      [CAPTURE, OTHER_CAPTURE],
    ]);
    await admin.query('delete from captures where id = any($1)', [[CAPTURE, OTHER_CAPTURE]]);
    await admin.query('delete from memberships where user_id = $1', [USER]);
    await admin.query('delete from users where id = $1', [USER]);
    await admin.query('delete from tenants where id = any($1)', [[TENANT, OTHER_TENANT]]);
    await admin.end();
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it('writes ONE shadow layout with no extraction run, and its grounding', async () => {
    const before = await counts();
    const { layoutId } = await controller.record(user, TENANT, CAPTURE, body() as never);
    expect(layoutId).toBeTruthy();

    const layout = (
      await admin.query('select * from document_layouts where id = $1', [layoutId])
    ).rows[0];
    expect(layout.shadow).toBe(true);
    expect(layout.extraction_run_id).toBeNull();
    expect(layout.engine_ids).toEqual(['device-mlkit']);
    expect(layout.docdom_version).toBe('1.0.0');
    expect(layout.page_count).toBe(1);
    expect(layout.span_count).toBe(2);

    const grounding = (
      await admin.query('select * from document_field_grounding where layout_id = $1', [layoutId])
    ).rows;
    // Only the field that carried a value. An abstention has nothing to point
    // at, and storing it would make `grounded` meaningless.
    expect(grounding).toHaveLength(1);
    expect(grounding[0].field_path).toBe('header.payable_amount');
    expect(grounding[0].value).toBe('36.20');

    // THE POINT OF THE WHOLE TICKET.
    expect(await counts()).toEqual(before);
  });

  it('stores what the handset said about itself', async () => {
    // The point of 0028. ON-DEVICE.md §1.2's 4GB floor is a support decision
    // with no evidence behind it, and the phone measures its own memory on
    // every capture. Before this the value reached the handler and was
    // dropped — computed and discarded, the same shape as the OD-8 preview
    // that was computed and never shown.
    const { layoutId } = await controller.record(user, TENANT, CAPTURE, body() as never);
    const row = (
      await admin.query('select device_meta from document_layouts where id = $1', [layoutId])
    ).rows[0];
    expect(row.device_meta).toMatchObject({
      platform: 'android',
      model: 'samsung SM-A715F',
      totalMemoryMb: 7519,
    });
  });

  it('leaves device_meta empty when the client sends no device block', async () => {
    const { layoutId } = await controller.record(
      user,
      TENANT,
      CAPTURE,
      body({ device: undefined }) as never,
    );
    const row = (
      await admin.query('select device_meta from document_layouts where id = $1', [layoutId])
    ).rows[0];
    expect(row.device_meta).toEqual({});
  });

  it('refuses a capture belonging to another tenant', async () => {
    const before = await counts();
    // The user has no membership in OTHER_TENANT. RLS is the boundary, not a
    // check in the handler.
    await expect(
      controller.record(user, OTHER_TENANT, OTHER_CAPTURE, body() as never),
    ).rejects.toThrow();
    expect(await counts()).toEqual(before);
  });

  it('refuses an engine that is not a device engine', async () => {
    await expect(
      controller.record(user, TENANT, CAPTURE, body({ engine: 'claude_vision' }) as never),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('refuses a DocDOM that is not version 1.0.0', async () => {
    await expect(
      controller.record(user, TENANT, CAPTURE, body({ docdom: { ...docdom(), version: '2.0.0' } }) as never),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('refuses a payload over the per-page cap with 413', async () => {
    const fat = { ...docdom(), filler: 'x'.repeat(300 * 1024) };
    await expect(
      controller.record(user, TENANT, CAPTURE, body({ docdom: fat }) as never),
    ).rejects.toMatchObject({ status: 413 });
  });

  it('refuses a box outside the page with 422', async () => {
    // "A coordinate bug should fail loudly at the seam" — a box past the edge
    // means the device's scale-back arithmetic is wrong, and accepting it
    // stores a highlight that will land in the margin.
    const off = {
      'header.payable_amount': {
        value: '36.20',
        grounded: true,
        spanIds: ['s1'],
        box: { x: 10, y: 20, width: 5000, height: 20 },
        page: 1,
        confidence: 0.9,
      },
    };
    await expect(
      controller.record(user, TENANT, CAPTURE, body({ preview: off }) as never),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('tolerates a sub-pixel overhang from scaling back a downscaled bitmap', async () => {
    const edge = {
      'header.payable_amount': {
        value: '36.20',
        grounded: true,
        spanIds: ['s1'],
        box: { x: 0, y: 0, width: 600.4, height: 900.4 },
        page: 1,
        confidence: 0.9,
      },
    };
    await expect(
      controller.record(user, TENANT, CAPTURE, body({ preview: edge }) as never),
    ).resolves.toMatchObject({ layoutId: expect.any(String) });
  });

  it('the row-count assertion can actually fail — verified by breaking it', async () => {
    // §3.5 rule 2 asks for this. Every other test asserts three counts are
    // unchanged; this one proves that assertion is load-bearing by writing a
    // review task itself and watching the comparison catch it.
    const before = await counts();
    const id = randomUUID();
    await admin.query(
      `insert into review_tasks (id, tenant_id, reason, detail, priority)
       values ($1, $2, 'od7-breaking-the-assertion', '{"why":"deliberate"}'::jsonb, 1)`,
      [id, TENANT],
    );
    const after = await counts();
    expect(after).not.toEqual(before);
    expect(after.reviews).toBe(before.reviews + 1);
    await admin.query('delete from review_tasks where id = $1', [id]);
    expect(await counts()).toEqual(before);
  });
});
