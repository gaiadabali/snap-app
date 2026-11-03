import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { closeDb } from '../db.js';
import { SummariesController, sydneyToday } from '../summaries/summaries.controller.js';
import { provisionTenant, wipeTenant } from '../test-support/tenant.js';
import { fyStartYear } from './deduction-totals.js';
import { deductionTotals } from './deductions.repo.js';

/** Deduction totals and the overview estimate against real Postgres as snap_app. */
process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TENANT = 'd0d0d0d0-0000-4000-8000-0000000000f1';
const OTHER = 'd0d0d0d0-0000-4000-8000-0000000000f2';
const BIZ = 'd0d0d0d0-0000-4000-8000-0000000000f3';
const OWNER = 'd0d0d0d0-0000-4000-8000-0000000000f4';
const OTHER_OWNER = 'd0d0d0d0-0000-4000-8000-0000000000f5';
const BIZ_OWNER = 'd0d0d0d0-0000-4000-8000-0000000000f6';

describeIfDb('deduction totals', () => {
  let admin: Client;
  const cat = { tools: randomUUID(), tools50: randomUUID(), retired: randomUUID(), legacy: randomUUID(), laundry: randomUUID() };
  const otherCat = randomUUID();
  const bizCat = randomUUID();

  async function addDoc(tenant: string, o: {
    date?: string | null; cat?: string | null; source?: string | null; payable?: string;
    status?: string; deleted?: boolean; currency?: string; docType?: string; lines?: Array<{ amount: string; cat?: string | null }>;
  }) {
    const capture = randomUUID();
    const id = randomUUID();
    await admin.query(
      `insert into captures (id, tenant_id, uploaded_by, original_storage_key, original_mime_type,
                             original_byte_size, original_sha256, status)
       values ($1,$2,$3,$4,'image/png',1, decode($5,'hex'),'received')`,
      [capture, tenant, tenant === OTHER ? OTHER_OWNER : tenant === BIZ ? BIZ_OWNER : OWNER, `${tenant}/o/${capture}`,
       randomUUID().replace(/-/g, '').repeat(2).slice(0, 64)],
    );
    await admin.query(
      `insert into documents (id, tenant_id, capture_id, issue_date, payable_amount, category_id, category_source,
                              review_status, deleted_at, currency, doc_type)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, tenant, capture, o.date === undefined ? '2025-09-01' : o.date, o.payable ?? '0', o.cat ?? null,
       o.source === undefined ? (o.cat ? 'user' : null) : o.source, o.status ?? 'reviewed', o.deleted ? new Date() : null, o.currency ?? 'AUD', o.docType ?? 'receipt'],
    );
    let n = 1;
    for (const l of o.lines ?? []) {
      await admin.query(
        `insert into document_lines (id, tenant_id, document_id, line_number, line_net_amount, category_id)
         values ($1,$2,$3,$4,$5,$6)`,
        [randomUUID(), tenant, id, n++, l.amount, l.cat ?? null],
      );
    }
    return id;
  }

  beforeAll(async () => {
    if (!hasDb) return;
    admin = await provisionTenant({
      tenantId: TENANT, name: 'Deduction totals co',
      users: [{ id: OWNER, role: 'owner', subject: 'test|dt-owner', email: 'o@dt.test', displayName: 'Owner' }],
    });
    await admin.query(`update tenants set kind = 'personal', abn = null, gst_registered = false where id = $1`, [TENANT]);
    for (const [t, u, k] of [[OTHER, OTHER_OWNER, 'personal'], [BIZ, BIZ_OWNER, 'business']] as const) {
      await admin.query(`insert into tenants (id, name, kind) values ($1, $2, $3) on conflict do nothing`, [t, `dt ${k}`, k]);
      await admin.query(
        `insert into users (id, subject, email, display_name) values ($1,$2,$3,'x') on conflict do nothing`,
        [u, `test|${u}`, `${u}@dt.test`],
      );
      await admin.query(`insert into memberships (tenant_id, user_id, role) values ($1,$2,'owner') on conflict do nothing`, [t, u]);
    }
    const ins = (id: string, t: string, name: string, label: string | null, item: string | null, p: number | null, active = true) =>
      admin.query(
        `insert into categories (id, tenant_id, name, ato_deduction_code, engine_row_id, private_use_percent, active)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [id, t, name, label, item, p, active],
      );
    await ins(cat.tools, TENANT, 'Tools', 'D5', 'tools', null);
    await ins(cat.tools50, TENANT, 'Tools half', 'D5', 'tools', 50);
    await ins(cat.laundry, TENANT, 'Laundry', 'D3', 'washPowder', null);
    await ins(cat.retired, TENANT, 'Old', 'D5', 'licences', null, false);
    await ins(cat.legacy, TENANT, 'Legacy', 'D5', null, null);
    await ins(otherCat, OTHER, 'Tools', 'D5', 'tools', null);
    await ins(bizCat, BIZ, 'Tools', 'D5', 'tools', null);
  });

  afterAll(async () => {
    if (!hasDb) return;
    for (const t of [OTHER, BIZ]) {
      await admin.query('delete from trips where tenant_id = $1', [t]);
      await admin.query('delete from document_lines where tenant_id = $1', [t]);
      await admin.query('delete from documents where tenant_id = $1', [t]);
      await admin.query('delete from captures where tenant_id = $1', [t]);
      await admin.query('delete from categories where tenant_id = $1', [t]);
      await admin.query('delete from memberships where tenant_id = $1', [t]);
      await admin.query('delete from tenants where id = $1', [t]);
    }
    await admin.query('delete from trips where tenant_id = $1', [TENANT]);
    await wipeTenant(admin, TENANT, [OWNER]);
    await admin.query('delete from users where id = any($1)', [[OTHER_OWNER, BIZ_OWNER]]);
    await admin.end();
    await closeDb();
  });

  it('totals per label and item with the D-1 rule, coalesce, and exclusions', async () => {
    // Lines: own category wins; a line with none falls back to the document's. Lines
    // go to two different items, and payable (30.51) must NOT be counted on top.
    await addDoc(TENANT, {
      cat: cat.tools, payable: '30.51',
      lines: [{ amount: '10.01', cat: cat.tools50 }, { amount: '20.00', cat: cat.laundry }, { amount: '0.50' }],
    });
    // no lines: payable once, under the document's category
    await addDoc(TENANT, { cat: cat.laundry, payable: '33.30' });
    // retired category still counts
    await addDoc(TENANT, { cat: cat.retired, payable: '5.00' });
    // label without item, uncategorised, rejected, deleted, undated, other FY: all out
    await addDoc(TENANT, { cat: cat.legacy, payable: '99.00' });
    await addDoc(TENANT, { payable: '98.00' });
    await addDoc(TENANT, { cat: cat.tools, payable: '97.00', status: 'rejected' });
    await addDoc(TENANT, { cat: cat.tools, payable: '96.00', deleted: true });
    await addDoc(TENANT, { cat: cat.tools, payable: '95.00', date: null });
    await addDoc(TENANT, { cat: cat.tools, payable: '94.00', date: '2024-09-01' });
    // supplier-filed, and category set with no source: to review, not counted
    await addDoc(TENANT, { cat: cat.tools, payable: '40.00', source: 'supplier' });
    await addDoc(TENANT, { cat: cat.tools, payable: '7.00', source: null });
    // foreign currency: counted, never summed; credit notes and statements: out
    await addDoc(TENANT, { cat: cat.tools, payable: '500.00', currency: 'USD' });
    await addDoc(TENANT, { cat: cat.tools, payable: '91.00', docType: 'credit_note' });
    await addDoc(TENANT, { cat: cat.tools, payable: '92.00', docType: 'statement' });
    // other tenants never leak in
    await addDoc(OTHER, { cat: otherCat, payable: '1000.00' });
    await addDoc(BIZ, { cat: bizCat, payable: '1000.00' });

    const t = await deductionTotals(OWNER, TENANT, 2025);
    expect(t.financialYear).toBe('2025-26');
    // tools: 10.01 at 50% -> 1001 cents -> 501 (half up), plus 0.50 at the document's 0% -> 50
    // washPowder: the 20.00 line (0%) plus the line-less 33.30 receipt
    expect(t.items).toEqual([
      { label: 'D3', itemId: 'washPowder', receiptCount: 2, workCents: 5330n, receiptRefs: expect.any(Array) },
      { label: 'D5', itemId: 'licences', receiptCount: 1, workCents: 500n, receiptRefs: expect.any(Array) },
      { label: 'D5', itemId: 'tools', receiptCount: 1, workCents: 551n, receiptRefs: expect.any(Array) },
    ]);
    expect(t.totalCents).toBe(6381n);
    expect(t.toReview).toEqual({ receiptCount: 2, amountCents: 4700n, foreignCurrencyCount: 1 });
  });

  it('puts 30 Jun and 1 Jul in different years', async () => {
    const y25 = (await deductionTotals(OWNER, TENANT, 2025)).totalCents;
    const y26 = (await deductionTotals(OWNER, TENANT, 2026)).totalCents;
    await addDoc(TENANT, { cat: cat.laundry, payable: '1.00', date: '2026-06-30' });
    await addDoc(TENANT, { cat: cat.laundry, payable: '2.00', date: '2026-07-01' });
    expect((await deductionTotals(OWNER, TENANT, 2025)).totalCents - y25).toBe(100n);
    expect((await deductionTotals(OWNER, TENANT, 2026)).totalCents - y26).toBe(200n);
  });

  it('sums work trips into whole km for the year', async () => {
    const trip = (d: string, km: string, work: boolean, t = TENANT) =>
      admin.query(
        `insert into trips (id, tenant_id, trip_date, from_place, to_place, km, work_related) values ($1,$2,$3,'a','b',$4,$5)`,
        [randomUUID(), t, d, km, work],
      );
    await trip('2025-07-01', '10.4', true);
    await trip('2026-06-30', '10.4', true); // 20.8 -> 21
    await trip('2025-08-01', '50', false);
    await trip('2026-07-01', '7', true); // next FY
    await trip('2025-08-01', '300', true, OTHER);
    expect((await deductionTotals(OWNER, TENANT, 2025)).workKilometres).toBe(21);
    expect((await deductionTotals(OWNER, TENANT, 2026)).workKilometres).toBe(7);
  });

  it('a business workspace has no deductions', async () => {
    const t = await deductionTotals(BIZ_OWNER, BIZ, 2025);
    expect(t.totalCents).toBe(0n);
    expect(t.items).toEqual([]);
  });

  it('the overview returns the real estimate', async () => {
    const fy = fyStartYear(sydneyToday());
    const before = await deductionTotals(OWNER, TENANT, fy);
    await addDoc(TENANT, { cat: cat.tools, payable: '12.34', date: `${fy}-07-15` });
    const o = await new SummariesController().overview(
      { userId: OWNER, email: 'o@dt.test', displayName: 'Owner', initials: 'O' } as never,
      TENANT,
    );
    const d5 = before.items.filter((i) => i.label === 'D5').reduce((a, i) => a + i.workCents, 0n) + 1234n;
    expect(o.deductions.estimateTotal).toBe(Number(before.totalCents + 1234n) / 100);
    expect(o.deductions.byLabel.D5).toBe(Number(d5) / 100);
    expect(o.deductions.financialYear).toBe(`${fy}-${String((fy + 1) % 100).padStart(2, '0')}`);
    expect(o.deductions.toReview?.foreignCurrencyCount).toBe(before.toReview.foreignCurrencyCount);
  });
});
