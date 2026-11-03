import { withTenantAs } from '@snap/db';
import { sql } from 'drizzle-orm';

import { getDb } from '../db.js';
import { fyLabel, foldTotals, type DeductionSourceLine, type DeductionTotals } from './deduction-totals.js';

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
 */
export async function deductionTotals(
  userId: string,
  tenantId: string,
  fyStart: number,
): Promise<DeductionTotals> {
  const from = `${fyStart}-07-01`;
  const to = `${fyStart + 1}-06-30`;
  return withTenantAs(getDb(), userId, tenantId, async (t) => {
    const rows = await t.execute<{
      document_id: string;
      label: string;
      item_id: string;
      private_use_percent: number | null;
      source: string;
      cents: string;
    }>(sql`
      with amounts as (
        select d.id as document_id, coalesce(l.category_id, d.category_id) as category_id,
               d.category_source, l.line_net_amount as amount
          from documents d
          join document_lines l on l.document_id = d.id
         where d.tenant_id = ${tenantId}
        union all
        select d.id, d.category_id, d.category_source, d.payable_amount
          from documents d
         where d.tenant_id = ${tenantId}
           and not exists (select 1 from document_lines l where l.document_id = d.id)
      )
      select a.document_id, c.ato_deduction_code as label, c.engine_row_id as item_id,
             c.private_use_percent::int as private_use_percent, a.category_source as source,
             round(coalesce(a.amount, 0) * 100)::bigint::text as cents
        from amounts a
        join documents d on d.id = a.document_id
        join categories c on c.id = a.category_id and c.tenant_id = d.tenant_id
        join tenants tn on tn.id = d.tenant_id
       where tn.kind = 'personal'
         and c.ato_deduction_code is not null and c.engine_row_id is not null
         and d.deleted_at is null and d.review_status <> 'rejected'
         and d.issue_date between ${from}::date and ${to}::date
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
    }));
    return foldTotals(fyLabel(fyStart), lines, Number(km.rows[0]?.km ?? 0));
  });
}
