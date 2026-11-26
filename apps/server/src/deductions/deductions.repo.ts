import { splitReceipt, type SplitLineInput } from '@snap/api-contract/receipt-split';
import { withTenantAs, type Tx } from '@snap/db';
import { sql } from 'drizzle-orm';

import { getDb } from '../db.js';
import { fyLabel, foldTotals, receiptRefOf, type DeductionSourceLine, type DeductionTotals } from './deduction-totals.js';

/**
 * Deduction totals for a PERSONAL workspace and one Australian financial year
 * (`fyStart` = the calendar year it starts in).
 *
 * Which receipts count: not deleted, not rejected, dated inside the year by
 * `documents.issue_date` (an undated receipt cannot be placed in a year and is
 * left out), with a category that has both a label and an item (retired
 * categories still count; business legacy ones with no item do not), on the
 * receipt or on one of its lines.
 *
 * How much: what was paid, GST included (employees: the GST is part of the
 * cost), split between the lines a person filed in a category of their own
 * (`document_lines.category_id`) and the rest of the receipt, which counts
 * under the receipt's category. The rule (each line's GST-inclusive cost, the
 * rest = total less those lines, parts adding up to the total to the cent) is
 * `splitReceipt` in `@snap/api-contract/receipt-split`, the same code the
 * review screens run. Never the sum of the lines alone: a reading can miss one.
 *
 * Who chose it: a filed line is always a person's choice (no machine files a
 * line). The rest counts only with `category_source = 'user'`; supplier-filed
 * ones are reported as "to review". Deductible totals are AUD only: a
 * categorised receipt in another currency is only counted
 * (`toReview.foreignCurrencyCount`), never added to an AUD sum.
 */
export async function deductionTotals(
  userId: string,
  tenantId: string,
  fyStart: number,
): Promise<DeductionTotals> {
  const from = `${fyStart}-07-01`;
  const to = `${fyStart + 1}-06-30`;
  return withTenantAs(getDb(), userId, tenantId, async (t) => {
    // Personal spaces only: a business space's categories never reach a tax return.
    const cats = await t.execute<{ id: string; label: string; item_id: string; private_use_percent: number | null }>(sql`
      select c.id::text as id, c.ato_deduction_code as label, c.engine_row_id as item_id,
             c.private_use_percent::int as private_use_percent
        from categories c
        join tenants tn on tn.id = c.tenant_id
       where c.tenant_id = ${tenantId} and tn.kind = 'personal'
         and c.ato_deduction_code is not null and c.engine_row_id is not null
    `);
    const taxCats = new Map(cats.rows.map((c) => [c.id, c]));
    if (taxCats.size === 0) return foldTotals(fyLabel(fyStart), [], await workKilometres(t, tenantId, from, to));

    // Credit notes and statements are not purchases (netting a credit note off a
    // deduction is a later piece of work).
    const docs = await t.execute<{
      document_id: string;
      category_id: string | null;
      source: string | null;
      currency: string;
      payable: string | null;
      tax: string | null;
      has_filed_lines: boolean;
      page_sha: string | null;
      mime: string | null;
      storage_key: string | null;
    }>(sql`
      select d.id as document_id, d.category_id::text as category_id, d.category_source as source,
             d.currency::text as currency, d.payable_amount::text as payable, d.tax_amount::text as tax,
             exists (select 1 from document_lines l where l.document_id = d.id and l.category_id is not null) as has_filed_lines,
             -- The stored original, never a re-encoded image (see receiptRefOf).
             -- Page 1 only counts when it is a photographed page (a PDF's pages are renders).
             (select encode(p.sha256, 'hex') from capture_pages p
               where p.capture_id = d.capture_id and p.page_number = 1 and p.source = 'capture') as page_sha,
             k.original_mime_type as mime, k.original_storage_key as storage_key
        from documents d
        left join captures k on k.id = d.capture_id
       where d.tenant_id = ${tenantId} and d.deleted_at is null and d.review_status <> 'rejected'
         and d.doc_type not in ('credit_note', 'statement')
         and d.issue_date between ${from}::date and ${to}::date
         and (d.category_id is not null
              or exists (select 1 from document_lines l where l.document_id = d.id and l.category_id is not null))
    `);

    // Every line of a receipt with a filed line: the GST and the rest depend on all of them.
    const splitIds = docs.rows.filter((d) => d.has_filed_lines).map((d) => d.document_id);
    const linesByDoc = new Map<string, SplitLineInput[]>();
    if (splitIds.length > 0) {
      const rows = await t.execute<{
        document_id: string;
        line_number: number;
        amount: string | null;
        gst_category_code: string | null;
        category_id: string | null;
      }>(sql`
        select document_id::text as document_id, line_number, line_net_amount::text as amount,
               gst_category_code, category_id::text as category_id
          from document_lines
         where document_id = any(${`{${splitIds.join(',')}}`}::uuid[])
         order by document_id, line_number
      `);
      for (const l of rows.rows) {
        const list = linesByDoc.get(l.document_id) ?? [];
        list.push({
          lineNumber: l.line_number,
          amount: l.amount,
          gstFree: isGstFreeCode(l.gst_category_code),
          categoryId: l.category_id,
        });
        linesByDoc.set(l.document_id, list);
      }
    }

    const lines: DeductionSourceLine[] = [];
    for (const d of docs.rows) lines.push(...documentSourceLines(d, linesByDoc.get(d.document_id) ?? [], taxCats));
    return foldTotals(fyLabel(fyStart), lines, await workKilometres(t, tenantId, from, to));
  });
}

/** A tax category, as `documentSourceLines` needs it. */
export interface TaxCategoryRow {
  label: string;
  item_id: string;
  private_use_percent: number | null;
}

/**
 * One receipt's source lines: one per (category, who chose it), from `splitReceipt`. A line
 * filed in the receipt's own category and the rest of the receipt add up before the work
 * share is taken. Parts in a category that is not a tax category (or in none) are left out.
 * Pure, so it is unit-tested without a database.
 */
export function documentSourceLines(
  d: {
    document_id: string;
    category_id: string | null;
    source: string | null;
    currency: string;
    payable: string | null;
    tax: string | null;
    page_sha: string | null;
    mime: string | null;
    storage_key: string | null;
  },
  lines: readonly SplitLineInput[],
  taxCats: ReadonlyMap<string, TaxCategoryRow>,
): DeductionSourceLine[] {
  const split = splitReceipt({ payable: d.payable, taxAmount: d.tax, categoryId: d.category_id, lines });
  const parts = new Map<string, { categoryId: string; source: 'user' | 'supplier'; cents: bigint }>();
  for (const p of split.parts) {
    if (!p.categoryId || p.cents === 0n || !taxCats.has(p.categoryId)) continue;
    const source = !p.rest || d.source === 'user' ? 'user' : 'supplier';
    const key = `${p.categoryId}|${source}`;
    const e = parts.get(key) ?? { categoryId: p.categoryId, source, cents: 0n };
    e.cents += p.cents;
    parts.set(key, e);
  }
  const ref = receiptRefOf(d.page_sha, d.mime, d.storage_key);
  return [...parts.values()].map((p) => {
    const c = taxCats.get(p.categoryId)!;
    return {
      documentId: d.document_id,
      label: c.label,
      itemId: c.item_id,
      privateUsePercent: c.private_use_percent,
      source: p.source,
      amountCents: p.cents,
      currency: d.currency,
      receiptRef: ref,
    };
  });
}

async function workKilometres(t: Tx, tenantId: string, from: string, to: string): Promise<number> {
  const km = await t.execute<{ km: string }>(sql`
    select round(coalesce(sum(r.km), 0))::bigint::text as km
      from trips r
      join tenants tn on tn.id = r.tenant_id
     where r.tenant_id = ${tenantId} and tn.kind = 'personal' and r.work_related
       and r.trip_date between ${from}::date and ${to}::date
  `);
  return Number(km.rows[0]?.km ?? 0);
}

/** Z (GST-free), E (exempt) and O (out of scope) carry no GST; S and anything unknown is standard-rated. */
export function isGstFreeCode(code: string | null): boolean {
  return code === 'Z' || code === 'E' || code === 'O';
}
