import { money, withTenantAs, type Money } from '@snap/db';
import { sql } from 'drizzle-orm';

import { getDb } from '../db.js';

const tx = withTenantAs;

/**
 * BAS: G1, G10, G11, 1A, 1B, and the unclaimable-GST figure — Lane M.
 *
 * `v_bas_lines` (migration 0006) already does the join this ticket must never
 * reinvent: transaction_splits -> transactions -> tax_codes -> documents,
 * filtered to `status = 'posted'` and carrying `gst_unclaimable` pre-computed
 * from `tax_codes.claims_credit` and `documents.is_tax_invoice`. Reporting is
 * therefore a `GROUP BY` over that view — docs/PLAN.md §5's whole point in
 * building the tax_codes table — not a second translation layer.
 *
 * Posted only, for free: the view's own `WHERE t.status = 'posted'` means a
 * draft (including one sitting unconfirmed for weeks) can never leak into a
 * BAS, without this file re-stating that filter.
 *
 * Dated by the tenant's own GST basis, not by whichever timestamp was handy:
 * `accrual_date` is `transactions.txn_date`, which Lane L's
 * `draftTransactionFromDocument` sets from `documents.issue_date` — never
 * from when a document was captured or posted. `cash_date` falls back to the
 * same value whenever no settlement date is recorded. An accrual-basis
 * tenant is reported on the former, a cash-basis tenant on the latter
 * (docs/PLAN.md §6: "filtered by period and the tenant's cash/accrual basis
 * setting").
 */

export type BasCheck = {
  label: '1A' | '1B';
  /** What this report actually computed for the label. */
  reported: Money;
  /** The corresponding G-label(s) divided by 11 — docs/PLAN.md §8's sanity check. */
  expected: Money;
  withinTolerance: boolean;
};

export type BasReport = {
  from: string;
  to: string;
  basis: 'cash' | 'accrual';
  simplerBas: boolean;
  G1: Money;
  G10: Money;
  G11: Money;
  '1A': Money;
  '1B': Money;
  /**
   * GST identified on a standard-rated purchase whose evidence document is
   * NOT a valid tax invoice — Lane L posts it to an expense account rather
   * than `GST Receivable`, and it is deliberately excluded from `1B` above.
   * Surfaced here rather than silently dropped: this is the figure that
   * makes "$342.18 of GST you cannot claim" a headline, not a missing number.
   */
  unclaimableGst: Money;
  /**
   * `1A ≈ G1/11` and `1B ≈ (G10+G11)/11`, shipped as sanity checks on the
   * report itself. This is a consistency check on well-formed, wholly
   * claimable/taxable data, not an identity: a period with GST-free sales
   * mixed into G1, or with unclaimable GST sitting outside 1B, will
   * legitimately diverge — and `unclaimableGst` above is exactly the number
   * that explains such a divergence rather than leaving it a mystery.
   */
  reconciliation: BasCheck[];
};

type Row = {
  g1: string;
  g10: string;
  g11: string;
  label_1a: string;
  label_1b: string;
  unclaimable_gst: string;
  g1_count: string;
  purchases_count: string;
};

/**
 * Rounding tolerance for the "≈" above: each contributing split's GST was
 * itself rounded half-up to the cent, independently, at draft time
 * (`money.gstFromInclusive`, docs/PLAN.md §5) — summing several already-
 * rounded splits and comparing to one rounding of the sum can differ by a
 * cent or two even when nothing is wrong. One cent per contributing split,
 * minimum two cents, is generous enough to absorb that without hiding a
 * split posted to the wrong control account.
 */
function reconcile(label: '1A' | '1B', reported: Money, base: Money, count: number): BasCheck {
  const expected = money.gstFromInclusive(base);
  const diff = money.subtract(reported, expected);
  const absDiff = money.compare(diff, money.ZERO) < 0 ? money.negate(diff) : diff;
  const tolerance = money.money((Math.max(count, 1) * 0.01).toFixed(2));
  return {
    label,
    reported,
    expected,
    withinTolerance: money.compare(absDiff, tolerance) <= 0,
  };
}

export async function basReport(
  userId: string,
  tenantId: string,
  from: string,
  to: string,
): Promise<BasReport> {
  return tx(getDb(), userId, tenantId, async (t) => {
    const tenantRows = await t.execute<{
      gst_basis: 'cash' | 'accrual';
      simpler_bas: boolean;
    }>(sql`
      select gst_basis::text as gst_basis, simpler_bas from tenants where id = ${tenantId}
    `);
    const basis = (tenantRows.rows[0]?.gst_basis ?? 'cash') as 'cash' | 'accrual';
    const simplerBas = tenantRows.rows[0]?.simpler_bas ?? true;
    // A controlled identifier, never user input: one of two literal column
    // names on `v_bas_lines`, chosen from the tenant's own `gst_basis` enum.
    const dateCol = sql.raw(basis === 'cash' ? 'cash_date' : 'accrual_date');

    const rows = await t.execute<Row>(sql`
      select
        coalesce(sum(gross_amount) filter (where 'G1'  = any(sale_labels)), 0)::text as g1,
        coalesce(sum(gross_amount) filter (where 'G10' = any(purchase_labels)), 0)::text as g10,
        coalesce(sum(gross_amount) filter (where 'G11' = any(purchase_labels)), 0)::text as g11,
        coalesce(sum(gst_amount)   filter (where '1A'  = any(sale_labels)), 0)::text as label_1a,
        coalesce(sum(gst_amount)   filter (where '1B'  = any(purchase_labels) and not gst_unclaimable), 0)::text as label_1b,
        coalesce(sum(gst_amount)   filter (where gst_unclaimable), 0)::text as unclaimable_gst,
        count(*) filter (where 'G1' = any(sale_labels)) as g1_count,
        count(*) filter (where 'G10' = any(purchase_labels) or 'G11' = any(purchase_labels)) as purchases_count
      from v_bas_lines
      where tenant_id = ${tenantId}
        and ${dateCol} >= ${from}::date
        and ${dateCol} <= ${to}::date
    `);
    const row = rows.rows[0]!;

    const g1 = money.money(row.g1);
    const g10 = money.money(row.g10);
    const g11 = money.money(row.g11);
    const oneA = money.money(row.label_1a);
    const oneB = money.money(row.label_1b);
    const unclaimableGst = money.money(row.unclaimable_gst);

    return {
      from,
      to,
      basis,
      simplerBas,
      G1: g1,
      G10: g10,
      G11: g11,
      '1A': oneA,
      '1B': oneB,
      unclaimableGst,
      reconciliation: [
        reconcile('1A', oneA, g1, Number(row.g1_count)),
        reconcile('1B', oneB, money.add(g10, g11), Number(row.purchases_count)),
      ],
    };
  });
}
