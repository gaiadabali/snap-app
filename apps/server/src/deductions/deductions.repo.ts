import { withTenantAs } from '@snap/db';
import { sql } from 'drizzle-orm';

import { getDb } from '../db.js';
import { fyLabel, foldTotals, receiptRefOf, type DeductionSourceLine, type DeductionTotals } from './deduction-totals.js';

/**
 * Deduction totals for a PERSONAL workspace and one Australian financial year
 * (`fyStart` = the calendar year it starts in).
 *
 * Which receipts count: not deleted, not rejected, dated inside the year by
 * `documents.issue_date` (an undated receipt cannot be placed in a year and is
 * left out), in a category that has both a label and an item (retired
 * categories still count; business legacy ones with no item do not). The
 * category of an amount is `coalesce(line.category_id, document.category_id)`,
 * as in `listCategories`; a document with no lines counts `payable_amount`
 * once under its own category. Amounts are as printed, GST included
 * (employees: the GST is part of the cost). Only `category_source = 'user'`
 * counts as a deduction; supplier-filed ones are reported as "to review".
 * Deductible totals are AUD only: a categorised receipt in another currency is
 * only counted (`toReview.foreignCurrencyCount`), never added to an AUD sum.
 */
export async function deductionTotals(
  userId: string,
  tenantId: string,
  fyStart: number,
): Promise<DeductionTotals> {
  const from = `${fyStart}-07-01`;
  const to = `${fyStart + 1}-06-30`;
  // Pushed into both branches of the CTE below. Credit notes and statements are
  // not purchases (netting a credit note off a deduction is a later piece of work).
  const docFilter = sql`d.deleted_at is null and d.review_status <> 'rejected'
    and d.doc_type not in ('credit_note', 'statement')
    and d.issue_date between ${from}::date and ${to}::date`;
  return withTenantAs(getDb(), userId, tenantId, async (t) => {
    const rows = await t.execute<{
      document_id: string;
      label: string;
      item_id: string;
      private_use_percent: number | null;
      source: string;
      currency: string;
      cents: string;
      page_sha: string | null;
      mime: string | null;
      storage_key: string | null;
    }>(sql`
      with amounts as (
        select d.id as document_id, coalesce(l.category_id, d.category_id) as category_id,
               d.category_source, d.currency::text as currency, l.line_net_amount as amount,
               d.capture_id
          from documents d
          join document_lines l on l.document_id = d.id
         where d.tenant_id = ${tenantId} and ${docFilter}
        union all
        select d.id, d.category_id, d.category_source, d.currency::text, d.payable_amount, d.capture_id
          from documents d
         where d.tenant_id = ${tenantId} and ${docFilter}
           and not exists (select 1 from document_lines l where l.document_id = d.id)
      )
      select a.document_id, c.ato_deduction_code as label, c.engine_row_id as item_id,
             c.private_use_percent::int as private_use_percent, a.category_source as source,
             a.currency,
             round(coalesce(a.amount, 0) * 100)::bigint::text as cents,
             -- The stored original, never a re-encoded image (see receiptRefOf).
             -- Page 1 only counts when it is a photographed page (a PDF's pages are renders).
             (select encode(p.sha256, 'hex') from capture_pages p
               where p.capture_id = a.capture_id and p.page_number = 1 and p.source = 'capture') as page_sha,
             k.original_mime_type as mime, k.original_storage_key as storage_key
        from amounts a
        left join captures k on k.id = a.capture_id
        join categories c on c.id = a.category_id and c.tenant_id = ${tenantId}
        join tenants tn on tn.id = c.tenant_id
       where tn.kind = 'personal'
         and c.ato_deduction_code is not null and c.engine_row_id is not null
    `);
    const km = await t.execute<{ km: string }>(sql`
      select round(coalesce(sum(r.km), 0))::bigint::text as km
        from trips r
        join tenants tn on tn.id = r.tenant_id
       where r.tenant_id = ${tenantId} and tn.kind = 'personal' and r.work_related
         and r.trip_date between ${from}::date and ${to}::date
    `);
    const lines: DeductionSourceLine[] = rows.rows.map((r) => ({
      documentId: r.document_id,
      label: r.label,
      itemId: r.item_id,
      privateUsePercent: r.private_use_percent,
      source: r.source === 'user' ? 'user' : 'supplier',
      amountCents: BigInt(r.cents),
      currency: r.currency,
      receiptRef: receiptRefOf(r.page_sha, r.mime, r.storage_key),
    }));
    return foldTotals(fyLabel(fyStart), lines, Number(km.rows[0]?.km ?? 0));
  });
}
