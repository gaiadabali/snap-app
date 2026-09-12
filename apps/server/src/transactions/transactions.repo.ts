import { randomUUID } from 'node:crypto';

import { money, withTenantAs, type Money, type Tx } from '@snap/db';
import { sql } from 'drizzle-orm';

import { getDb } from '../db.js';
import { linesGap } from '../extraction/validators.js';

/**
 * Where a confirmed scan becomes a posted, balanced ledger entry.
 *
 * `docs/PLAN.md` §5: a draft transaction is proposed from a document's lines
 * and tax subtotals, sum-zero by construction; posting it is a SEPARATE act
 * from confirming the document, and the sum-zero invariant is Postgres's job
 * (migration 0006's deferred constraint trigger), never re-checked here as
 * the authority — only pre-flighted with `@snap/db`'s money helpers so a
 * caller sees "these don't balance" rather than a raw constraint violation,
 * exactly as `money.ts` says a user should.
 *
 * Two rules, the same as every other repo module in this server:
 *
 *  1. Every query runs inside `withTenantAs`, which proves membership before
 *     any tenant context exists.
 *  2. Money is exact-decimal (`@snap/db`'s `money`) or a plain SQL `SUM`,
 *     never a JavaScript float.
 */

const tx = withTenantAs;

/* ── Chart of accounts: find-or-create ──────────────────────────────────── */

/**
 * No screen has ever created a chart of accounts — `accounts` has sat empty
 * since migration 0005. Rather than requiring a setup step before the first
 * scan can ever post (and rather than a migration, which is out of this
 * lane's remit), the handful of control accounts a scan-derived posting needs
 * are ensured to exist the first time they are, per tenant. Idempotent:
 * `ON CONFLICT` means a concurrent first-post from two documents cannot race
 * into two rows for the same code.
 */
async function ensureAccount(
  t: Tx,
  tenantId: string,
  code: string,
  name: string,
  accountType: 'asset' | 'liability' | 'expense',
): Promise<string> {
  const row = await t.execute<{ id: string }>(sql`
    insert into accounts (id, tenant_id, code, name, account_type)
    values (${randomUUID()}, ${tenantId}, ${code}, ${name}, ${accountType}::account_type)
    on conflict (tenant_id, code) do update set name = excluded.name
    returning id
  `);
  return row.rows[0]!.id;
}

const ACCOUNTS = {
  expense: { code: '6-0000', name: 'Uncategorised Purchases', type: 'expense' as const },
  gstReceivable: { code: '1-2100', name: 'GST Receivable', type: 'asset' as const },
  gstUnclaimable: {
    code: '6-9000',
    name: 'GST Paid — Not Claimable',
    type: 'expense' as const,
  },
  accountsPayable: { code: '2-1000', name: 'Trade Creditors', type: 'liability' as const },
  rounding: { code: '6-9100', name: 'Cash Rounding', type: 'expense' as const },
};

/* ── Tax codes ───────────────────────────────────────────────────────────── */

type TaxCodeRow = { id: string; code: string; claims_credit: boolean };

async function loadTaxCodes(t: Tx): Promise<Map<string, TaxCodeRow>> {
  const rows = await t.execute<TaxCodeRow>(sql`
    select id, code, claims_credit from tax_codes where tenant_id is null
  `);
  const byCode = new Map<string, TaxCodeRow>();
  for (const r of rows.rows) byCode.set(r.code, r);
  return byCode;
}

/**
 * Peppol UNCL5305 category (BT-151), as far as it decides which AU tax code
 * applies. `S` (standard) is the only rate this maps to a capital code for —
 * and never does, because nothing in the schema yet marks a purchase as
 * capital; every standard-rated purchase becomes non-capital `GST`. Worth
 * revisiting once categorisation lands, not invented here.
 */
function taxCodeFor(gstCategoryCode: string | null): string {
  switch (gstCategoryCode) {
    case 'S':
      return 'GST';
    case 'Z':
      return 'FRE';
    case 'E':
      return 'INP';
    default:
      return 'N-T';
  }
}

/* ── Draft from a document ──────────────────────────────────────────────── */

type Group = { categoryCode: string | null; taxable: string; tax: string };

export type DraftOutcome =
  | { ok: true; transactionId: string }
  | { ok: false; reason: 'missing' }
  | { ok: false; reason: 'not_confirmed'; reviewStatus: string }
  | { ok: false; reason: 'already_posted'; transactionId: string; status: string }
  | { ok: false; reason: 'ambiguous_tax_categories' }
  | { ok: false; reason: 'lines_dont_reconcile'; gap: string };

/**
 * Proposes a draft transaction from a confirmed document.
 *
 * Splits come from `document_tax_subtotals` when the validators produced them
 * (the authoritative, per-category reconciliation — §4 "Mixed tax" of
 * `docs/PLAN.md`) and otherwise from a single aggregate built from the
 * document's own header totals, guarded by the same lines-vs-total check the
 * review screen shows (`linesGap`) so a document whose lines do not add up
 * cannot silently become a "balanced" posting.
 *
 * The database still has the last word: this only ever proposes a DRAFT, and
 * the deferred sum-zero trigger is inert for drafts (migration 0006). Nothing
 * here re-implements that check — it is arithmetic to figure out amounts, not
 * a substitute for the trigger's verdict at post time.
 *
 * `is_tax_invoice` is read, never recomputed: a standard-rated split whose
 * document is not a valid tax invoice still gets its GST identified
 * (`tax_code_id`, `gst_amount`) — that is what lets an "unclaimable GST"
 * report exist at all — but the GST is posted to an EXPENSE account, never to
 * the claimable `GST Receivable` asset. That is the literal meaning of "must
 * not produce a claimable GST split": no split increases a recoverable asset
 * unless the evidence document is one.
 */
export async function draftTransactionFromDocument(
  userId: string,
  tenantId: string,
  documentId: string,
): Promise<DraftOutcome> {
  return tx(getDb(), userId, tenantId, async (t) => {
    // Locks the document for the life of this transaction, so two concurrent
    // posts of the same scan cannot both pass the "no transaction yet" check
    // below and each insert one.
    const docRows = await t.execute<{
      id: string;
      is_tax_invoice: boolean;
      review_status: string;
      issue_date: string | null;
      document_number: string | null;
      currency: string;
      tax_exclusive_amount: string | null;
      tax_amount: string | null;
      payable_amount: string | null;
      rounding_amount: string;
      payment_method: string | null;
      card_brand: string | null;
      supplier_id: string | null;
      supplier_name: string | null;
    }>(sql`
      select d.id, d.is_tax_invoice, d.review_status::text as review_status,
             d.issue_date::text as issue_date, d.document_number, d.currency::text as currency,
             d.tax_exclusive_amount::text as tax_exclusive_amount,
             d.tax_amount::text as tax_amount,
             d.payable_amount::text as payable_amount,
             d.rounding_amount::text as rounding_amount,
             d.payment_method, d.card_brand, d.supplier_id,
             p.legal_name as supplier_name
        from documents d
        left join parties p on p.id = d.supplier_id
       where d.id = ${documentId} and d.deleted_at is null
       for update of d
    `);
    const doc = docRows.rows[0];
    if (!doc) return { ok: false, reason: 'missing' };

    // Rule 3 first, deliberately ahead of the confirmation gate below: a
    // document already carrying a live transaction must be refused as
    // "already posted" even if something later reset its review status —
    // that guarantee should not depend on review_status still agreeing with
    // history. A voided transaction does not count; that is what voiding is
    // for.
    const existing = await t.execute<{ id: string; status: string }>(sql`
      select id, status::text as status from transactions
       where document_id = ${documentId} and tenant_id = ${tenantId} and status <> 'void'
       limit 1
    `);
    if (existing.rows[0]) {
      return {
        ok: false,
        reason: 'already_posted',
        transactionId: existing.rows[0].id,
        status: existing.rows[0].status,
      };
    }

    if (doc.review_status !== 'auto_accepted' && doc.review_status !== 'reviewed') {
      return { ok: false, reason: 'not_confirmed', reviewStatus: doc.review_status };
    }

    const subtotals = await t.execute<{
      category_code: string;
      taxable_amount: string;
      tax_amount: string;
    }>(sql`
      select category_code, taxable_amount::text as taxable_amount, tax_amount::text as tax_amount
        from document_tax_subtotals where document_id = ${documentId}
    `);

    let groups: Group[];
    if (subtotals.rows.length > 0) {
      groups = subtotals.rows.map((r) => ({
        categoryCode: r.category_code,
        taxable: r.taxable_amount,
        tax: r.tax_amount,
      }));
    } else {
      // No per-category reconciliation on record. Fall back to the header
      // totals — but only when there is exactly one tax treatment on this
      // document; a mix with no subtotals means the validators never
      // reconciled it per-category, and guessing an allocation here would be
      // exactly the "recompute what the validators own" this ticket forbids.
      const lineCats = await t.execute<{ gst_category_code: string | null; net: string }>(sql`
        select gst_category_code, sum(line_net_amount)::text as net
          from document_lines where document_id = ${documentId}
         group by gst_category_code
      `);
      if (lineCats.rows.length === 0) return { ok: false, reason: 'ambiguous_tax_categories' };
      if (lineCats.rows.length > 1) return { ok: false, reason: 'ambiguous_tax_categories' };

      const lineSum = await t.execute<{ sum: string | null }>(sql`
        select sum(line_net_amount)::text as sum from document_lines where document_id = ${documentId}
      `);
      const gap = linesGap(
        Number(lineSum.rows[0]?.sum ?? 0),
        doc.payable_amount,
        doc.tax_amount,
      );
      if (Math.abs(gap) >= 0.02) {
        return { ok: false, reason: 'lines_dont_reconcile', gap: gap.toFixed(4) };
      }

      groups = [
        {
          categoryCode: lineCats.rows[0]!.gst_category_code,
          taxable: doc.tax_exclusive_amount ?? '0',
          tax: doc.tax_amount ?? '0',
        },
      ];
    }

    const taxCodes = await loadTaxCodes(t);
    const expenseAccountId = await ensureAccount(
      t,
      tenantId,
      ACCOUNTS.expense.code,
      ACCOUNTS.expense.name,
      ACCOUNTS.expense.type,
    );

    const splits: Array<{
      accountId: string;
      amount: Money;
      taxCodeId: string | null;
      gstAmount: Money;
      description: string | null;
    }> = [];

    for (const group of groups) {
      const code = taxCodeFor(group.categoryCode);
      const taxCode = taxCodes.get(code);
      const taxable = money.money(group.taxable || '0');
      const gst = money.money(group.tax || '0');

      splits.push({
        accountId: expenseAccountId,
        amount: taxable,
        taxCodeId: taxCode?.id ?? null,
        gstAmount: gst,
        description: group.categoryCode ? `Purchases — ${group.categoryCode}` : 'Purchases',
      });

      if (!money.isZero(gst)) {
        const claimable = (taxCode?.claims_credit ?? false) && doc.is_tax_invoice === true;
        const controlAccountId = claimable
          ? await ensureAccount(
              t,
              tenantId,
              ACCOUNTS.gstReceivable.code,
              ACCOUNTS.gstReceivable.name,
              ACCOUNTS.gstReceivable.type,
            )
          : await ensureAccount(
              t,
              tenantId,
              ACCOUNTS.gstUnclaimable.code,
              ACCOUNTS.gstUnclaimable.name,
              ACCOUNTS.gstUnclaimable.type,
            );
        splits.push({
          accountId: controlAccountId,
          amount: gst,
          taxCodeId: null, // control posting — excluded from BAS aggregation, never double-counted
          gstAmount: money.ZERO,
          description: claimable ? 'GST receivable' : 'GST — not claimable (no valid tax invoice)',
        });
      }
    }

    const rounding = money.money(doc.rounding_amount || '0');
    if (!money.isZero(rounding)) {
      const roundingAccountId = await ensureAccount(
        t,
        tenantId,
        ACCOUNTS.rounding.code,
        ACCOUNTS.rounding.name,
        ACCOUNTS.rounding.type,
      );
      splits.push({
        accountId: roundingAccountId,
        amount: rounding,
        taxCodeId: null,
        gstAmount: money.ZERO,
        description: 'Cash rounding',
      });
    }

    // The payment leg balances whatever the debit-side splits above came to.
    // This is ordinary double-entry, not a re-implementation of the trigger:
    // the trigger still runs at post time and is what this ticket's test
    // proves independently.
    const debitTotal = money.add(...splits.map((s) => s.amount));
    const paymentAccountId = doc.card_brand
      ? await ensureAccount(
          t,
          tenantId,
          `2-11${doc.card_brand.slice(0, 2).toUpperCase()}`,
          `Credit Card — ${doc.card_brand}`,
          'liability',
        )
      : await ensureAccount(
          t,
          tenantId,
          ACCOUNTS.accountsPayable.code,
          ACCOUNTS.accountsPayable.name,
          ACCOUNTS.accountsPayable.type,
        );
    splits.push({
      accountId: paymentAccountId,
      amount: money.negate(debitTotal),
      taxCodeId: null,
      gstAmount: money.ZERO,
      description: doc.document_number ? `Payable — ${doc.document_number}` : 'Payable',
    });

    // Pre-flight, per `money.ts`'s own stated purpose — never the authority.
    if (!money.balances(splits.map((s) => s.amount))) {
      throw new Error(
        `draftTransactionFromDocument built unbalanced splits for document ${documentId}: ` +
          JSON.stringify(splits),
      );
    }

    const transactionId = randomUUID();
    const memo = doc.document_number
      ? `${doc.supplier_name ?? 'Supplier'} — ${doc.document_number}`
      : (doc.supplier_name ?? 'Scanned purchase');
    await t.execute(sql`
      insert into transactions (
        id, tenant_id, txn_date, payee_id, memo, currency, status, source, document_id
      ) values (
        ${transactionId}, ${tenantId}, coalesce(${doc.issue_date}::date, current_date),
        ${doc.supplier_id}, ${memo}, ${doc.currency}::currency_code, 'draft', 'scan', ${documentId}
      )
    `);

    let lineNumber = 1;
    for (const split of splits) {
      await t.execute(sql`
        insert into transaction_splits (
          id, tenant_id, transaction_id, line_number, account_id, amount, tax_code_id, gst_amount, description
        ) values (
          ${randomUUID()}, ${tenantId}, ${transactionId}, ${lineNumber}, ${split.accountId},
          ${split.amount}, ${split.taxCodeId}, ${split.gstAmount}, ${split.description}
        )
      `);
      lineNumber += 1;
    }

    return { ok: true, transactionId };
  });
}

/* ── Post ────────────────────────────────────────────────────────────────── */

export type PostOutcome =
  | { ok: true }
  | { ok: false; reason: 'missing' }
  | { ok: false; reason: 'not_draft'; status: string };

/**
 * Draft → posted. The one and only place `transactions.status` becomes
 * `'posted'`, which is what arms migration 0006's `trg_txn_balanced_on_post`.
 *
 * That trigger is `DEFERRABLE INITIALLY DEFERRED`, so it does not run on the
 * `UPDATE` below — it runs when this function's `withTenantAs` transaction
 * commits, i.e. when this call returns. An unbalanced transaction makes THIS
 * CALL reject, not the `UPDATE` statement, which is why the caller must
 * expect a rejected promise here rather than a normal falsy outcome — there
 * is no TypeScript-level balance check upstream of it to catch first.
 */
export async function postTransaction(
  userId: string,
  tenantId: string,
  transactionId: string,
): Promise<PostOutcome> {
  return tx(getDb(), userId, tenantId, async (t) => {
    const rows = await t.execute<{ id: string; status: string }>(sql`
      select id, status::text as status from transactions
       where id = ${transactionId} and tenant_id = ${tenantId}
       for update
    `);
    const row = rows.rows[0];
    if (!row) return { ok: false, reason: 'missing' };
    if (row.status !== 'draft') return { ok: false, reason: 'not_draft', status: row.status };

    await t.execute(sql`
      update transactions
         set status = 'posted', posted_at = now(), posted_by = ${userId}
       where id = ${transactionId} and tenant_id = ${tenantId}
    `);
    return { ok: true };
  });
}

/* ── List ────────────────────────────────────────────────────────────────── */

export type TransactionSplitRow = {
  id: string;
  lineNumber: number;
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  amount: string;
  taxCodeId: string | null;
  taxCode: string | null;
  gstAmount: string;
  description: string | null;
};

export type TransactionRow = {
  id: string;
  txnDate: string;
  status: string;
  source: string;
  memo: string | null;
  reference: string | null;
  currency: string;
  documentId: string | null;
  postedAt: string | null;
  voidReason: string | null;
  splits: TransactionSplitRow[];
};

export async function listTransactions(
  userId: string,
  tenantId: string,
  filter: { status?: 'draft' | 'posted' | 'void' } = {},
): Promise<TransactionRow[]> {
  return tx(getDb(), userId, tenantId, async (t) => {
    const rows = await t.execute<{
      id: string;
      txn_date: string;
      status: string;
      source: string;
      memo: string | null;
      reference: string | null;
      currency: string;
      document_id: string | null;
      posted_at: string | null;
      void_reason: string | null;
      splits: TransactionSplitRow[];
    }>(sql`
      select t.id, t.txn_date::text as txn_date, t.status::text as status,
             t.source::text as source, t.memo, t.reference, t.currency::text as currency,
             t.document_id, t.posted_at::text as posted_at, t.void_reason,
             coalesce(
               json_agg(
                 json_build_object(
                   'id', s.id,
                   'lineNumber', s.line_number,
                   'accountId', s.account_id,
                   'accountCode', a.code,
                   'accountName', a.name,
                   'accountType', a.account_type,
                   'amount', s.amount::text,
                   'taxCodeId', s.tax_code_id,
                   'taxCode', tc.code,
                   'gstAmount', s.gst_amount::text,
                   'description', s.description
                 ) order by s.line_number
               ) filter (where s.id is not null),
               '[]'
             ) as splits
        from transactions t
        left join transaction_splits s on s.transaction_id = t.id
        left join accounts a on a.id = s.account_id
        left join tax_codes tc on tc.id = s.tax_code_id
       where t.tenant_id = ${tenantId}
         and (
           ${filter.status ?? null}::text is null
           or t.status = (${filter.status ?? null}::text)::txn_status
         )
       group by t.id
       order by t.txn_date desc, t.created_at desc
       limit 500
    `);
    return rows.rows.map((r) => ({
      id: r.id,
      txnDate: r.txn_date,
      status: r.status,
      source: r.source,
      memo: r.memo,
      reference: r.reference,
      currency: r.currency,
      documentId: r.document_id,
      postedAt: r.posted_at,
      voidReason: r.void_reason,
      splits: r.splits,
    }));
  });
}
