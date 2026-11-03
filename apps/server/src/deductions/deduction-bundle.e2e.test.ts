import { createHash, randomUUID } from 'node:crypto';

import { validateDeductionBundle, validateDeductionBundleJson } from '@snap/api-contract/deduction-bundle';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';

import { closeDb } from '../db.js';
import { provisionTenant, wipeTenant } from '../test-support/tenant.js';
import { DeductionBundleController } from './deduction-bundle.controller.js';

/** GET /v1/deduction-bundle against real Postgres as snap_app. */
process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TENANT = 'd0d0d0d0-0000-4000-8000-0000000000e1';
const OTHER = 'd0d0d0d0-0000-4000-8000-0000000000e2';
const BIZ = 'd0d0d0d0-0000-4000-8000-0000000000e3';
const OWNER = 'd0d0d0d0-0000-4000-8000-0000000000e4';
const OTHER_OWNER = 'd0d0d0d0-0000-4000-8000-0000000000e5';
const BIZ_OWNER = 'd0d0d0d0-0000-4000-8000-0000000000e6';
const MEMBER = 'd0d0d0d0-0000-4000-8000-0000000000e7';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const user = (id: string) => ({ userId: id, email: `${id}@x.test`, displayName: 'x', initials: 'X' }) as never;

describeIfDb('deduction bundle endpoint', () => {
  let admin: Client;
  const cat = { tools: randomUUID(), tools40: randomUUID(), laundry: randomUUID() };
  const controller = new DeductionBundleController();
  const headers: Record<string, string> = {};
  const reply = { header: (k: string, v: string) => void (headers[k] = v) };
  const get = (u: string, t: string, fy?: string) => controller.bundle(user(u), t, reply, fy);

  /** A receipt whose original is the bytes `original`, optionally multi-page (page 1 first). */
  async function addDoc(tenant: string, o: { original: string; cat: string; payable: string; date?: string; source?: string; pages?: string[]; pdf?: 'keyed' | 'unkeyed' }) {
    const capture = randomUUID();
    const id = randomUUID();
    const owner = tenant === OTHER ? OTHER_OWNER : tenant === BIZ ? BIZ_OWNER : OWNER;
    await admin.query(
      `insert into captures (id, tenant_id, uploaded_by, original_storage_key, original_mime_type,
                             original_byte_size, original_sha256, status)
       values ($1,$2,$3,$4,'image/png',1, decode($5,'hex'),'received')`,
      [capture, tenant, owner,
       o.pdf === 'keyed' ? `${tenant}/originals/${sha(o.original).slice(0, 2)}/${sha(o.original)}` : `${tenant}/o/${capture}`,
       sha(o.original)],
    );
    if (o.pdf) await admin.query(`update captures set original_mime_type = 'application/pdf' where id = $1`, [capture]);
    let n = 1;
    // A PDF's pages are renders: their hashes must never become the receipt's ref.
    for (const page of o.pdf ? [`render-of-${o.original}`] : o.pages ?? [o.original]) {
      await admin.query(
        `insert into capture_pages (id, tenant_id, capture_id, page_number, storage_key, mime_type, byte_size, sha256, source)
         values ($1,$2,$3,$4,$5,'image/png',1,decode($6,'hex'),$7)`,
        [randomUUID(), tenant, capture, n++, `${tenant}/pages/${randomUUID()}`, sha(page), o.pdf ? 'pdf_render' : 'capture'],
      );
    }
    await admin.query(
      `insert into documents (id, tenant_id, capture_id, issue_date, payable_amount, category_id, category_source,
                              review_status, currency, doc_type)
       values ($1,$2,$3,$4,$5,$6,$7,'reviewed','AUD','receipt')`,
      [id, tenant, capture, o.date ?? '2025-09-01', o.payable, o.cat, o.source ?? 'user'],
    );
  }

  beforeAll(async () => {
    if (!hasDb) return;
    admin = await provisionTenant({
      tenantId: TENANT, name: 'Bundle co',
      users: [{ id: OWNER, role: 'owner', subject: 'test|db-owner', email: 'o@db.test', displayName: 'Owner' }],
    });
    await admin.query(`update tenants set kind = 'personal', abn = null, gst_registered = false, occupation_profile_id = 'teacher' where id = $1`, [TENANT]);
    for (const [t, u, k] of [[OTHER, OTHER_OWNER, 'personal'], [BIZ, BIZ_OWNER, 'business']] as const) {
      await admin.query(`insert into tenants (id, name, kind) values ($1, $2, $3) on conflict do nothing`, [t, `db ${k}`, k]);
      await admin.query(`insert into users (id, subject, email, display_name) values ($1,$2,$3,'x') on conflict do nothing`, [u, `test|${u}`, `${u}@db.test`]);
      await admin.query(`insert into memberships (tenant_id, user_id, role) values ($1,$2,'owner') on conflict do nothing`, [t, u]);
    }
    const ins = (id: string, t: string, name: string, label: string, item: string, p: number | null) =>
      admin.query(
        `insert into categories (id, tenant_id, name, ato_deduction_code, engine_row_id, private_use_percent, active)
         values ($1,$2,$3,$4,$5,$6,true)`,
        [id, t, name, label, item, p],
      );
    await ins(cat.tools, TENANT, 'Tools', 'D5', 'tools', null);
    await ins(cat.tools40, TENANT, 'Phone', 'D5', 'phoneDevices', 40);
    await ins(cat.laundry, TENANT, 'Laundry', 'D3', 'washPowder', null);
    const otherCat = randomUUID();
    const bizCat = randomUUID();
    await ins(otherCat, OTHER, 'Tools', 'D5', 'tools', null);
    await ins(bizCat, BIZ, 'Tools', 'D5', 'tools', null);

    // Phone at 40% private: 899.99 -> 89999 * 60 / 100 = 53999.4 -> 53999 cents (half up), two receipts of it.
    await addDoc(TENANT, { original: 'phone-1', cat: cat.tools40, payable: '899.99' });
    await addDoc(TENANT, { original: 'phone-2', cat: cat.tools40, payable: '0.10' }); // 10 * 60 / 100 = 6
    // Tools: a two-page receipt cites page 1's bytes, not the combined capture hash.
    await addDoc(TENANT, { original: 'combined-hash', pages: ['tools-page-1', 'tools-page-2'], cat: cat.tools, payable: '12.34' });
    await addDoc(TENANT, { original: 'laundry-1', cat: cat.laundry, payable: '20.00' });
    // PDFs: the ref is the hash in the original's storage key; with none, no ref (still counted).
    await addDoc(TENANT, { original: 'pdf-keyed', pdf: 'keyed', cat: cat.laundry, payable: '1.00' });
    await addDoc(TENANT, { original: 'pdf-unkeyed', pdf: 'unkeyed', cat: cat.laundry, payable: '2.00' });
    // Not exported: supplier-filed, another year.
    await addDoc(TENANT, { original: 'supplier', cat: cat.tools, payable: '40.00', source: 'supplier' });
    await addDoc(TENANT, { original: 'old-year', cat: cat.tools, payable: '94.00', date: '2024-09-01' });
    await addDoc(OTHER, { original: 'other-person', cat: otherCat, payable: '1000.00' });
    await addDoc(BIZ, { original: 'biz', cat: bizCat, payable: '1000.00' });
    await admin.query(
      `insert into trips (id, tenant_id, trip_date, from_place, to_place, km, work_related) values ($1,$2,'2025-08-01','a','b','10.6',true)`,
      [randomUUID(), TENANT],
    );
  });

  afterAll(async () => {
    if (!hasDb) return;
    for (const t of [OTHER, BIZ]) {
      for (const tbl of ['document_lines', 'documents', 'capture_pages', 'captures', 'categories', 'memberships']) {
        await admin.query(`delete from ${tbl} where tenant_id = $1`, [t]);
      }
      await admin.query('delete from tenants where id = $1', [t]);
    }
    await admin.query('delete from trips where tenant_id = $1', [TENANT]);
    await admin.query('delete from capture_pages where tenant_id = $1', [TENANT]);
    await wipeTenant(admin, TENANT, [OWNER, MEMBER]);
    await admin.query('delete from users where id = any($1)', [[OTHER_OWNER, BIZ_OWNER]]);
    await admin.end();
    await closeDb();
  });

  it('builds the exact bundle: work share amounts, p omitted, hashes of the stored originals, km', async () => {
    const b = await get(OWNER, TENANT, '2025-26');
    expect(b.generatedAt).toMatch(/Z$/);
    expect({ ...b, generatedAt: 'x' }).toEqual({
      schemaVersion: 1,
      financialYear: '2025-26',
      generatedAt: 'x',
      source: { app: 'snapapp', appVersion: '0.1.0' },
      occupation: 'teacher',
      workKilometres: 11,
      lines: [
        { label: 'D3', itemId: 'washPowder', description: 'Washing powder', amount: '23.00', gstInclusive: true, receiptCount: 3, receiptRefs: [sha('laundry-1'), sha('pdf-keyed')].sort() },
        // 53999 + 6 cents, each receipt rounded on its own
        { label: 'D5', itemId: 'phoneDevices', description: 'Mobile phone and devices', amount: '540.05', gstInclusive: true, receiptCount: 2, receiptRefs: [sha('phone-1'), sha('phone-2')].sort() },
        { label: 'D5', itemId: 'tools', description: 'Tools', amount: '12.34', gstInclusive: true, receiptCount: 1, receiptRefs: [sha('tools-page-1')] },
      ],
    });
    for (const l of b.lines) expect(l).not.toHaveProperty('privateUsePercent');
    expect(headers['Content-Disposition']).toBe('attachment; filename="snap-deductions-2025-26.json"');
  });

  it('no fy means the newest started year, 2025-26, not the calendar\u2019s 2026-27', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-03T00:00:00Z'));
    try {
      expect(controller.year()).toEqual({ financialYear: '2025-26' });
      expect((await get(OWNER, TENANT)).financialYear).toBe('2025-26');
    } finally {
      vi.useRealTimers();
    }
  });

  it('is not cached', async () => {
    await get(OWNER, TENANT, '2025-26');
    expect(headers['Cache-Control']).toBe('private, no-store');
  });

  it('is an owner or manager action: a plain member gets 403', async () => {
    await admin.query(`insert into users (id, subject, email, display_name) values ($1,'test|db-member','m@db.test','M') on conflict do nothing`, [MEMBER]);
    await admin.query(`insert into memberships (tenant_id, user_id, role) values ($1,$2,'member') on conflict do nothing`, [TENANT, MEMBER]);
    await expect(get(MEMBER, TENANT, '2025-26')).rejects.toMatchObject({ status: 403 });
  });

  it('the file passes the validator after a JSON round trip', async () => {
    const b = await get(OWNER, TENANT, '2025-26');
    expect(validateDeductionBundleJson(JSON.stringify(b)).ok).toBe(true);
    expect(validateDeductionBundle(b).ok).toBe(true);
  });

  it('refuses a bad or unknown year', async () => {
    for (const fy of ['2025-27', '2025/26', '2024-25', '', 'junk']) {
      await expect(get(OWNER, TENANT, fy)).rejects.toMatchObject({ status: 400 });
    }
  });

  it('refuses a business workspace', async () => {
    await expect(get(BIZ_OWNER, BIZ, '2025-26')).rejects.toMatchObject({ status: 403 });
  });

  it('never returns another workspace’s receipts', async () => {
    // OWNER names OTHER's workspace: the tenant check refuses before any query.
    await expect(get(OWNER, OTHER, '2025-26')).rejects.toMatchObject({ name: 'NotAMemberError' });
    const mine = await get(OWNER, TENANT, '2025-26');
    expect(JSON.stringify(mine)).not.toContain(sha('other-person'));
    expect(JSON.stringify(mine)).not.toContain(sha('biz'));
  });
});
