import { randomUUID } from 'node:crypto';

import { money, withTenantAs, type Money, type Tx } from '@snap/db';
import { sql } from 'drizzle-orm';

import {
  compare as moneyCompare,
  linesGap as decimalLinesGap,
  type ConsumptionTaxSpec,
} from '@snap/tax-rules';

import { getDb } from '../db.js';
import { taxSubtotalsFromLines } from '../extraction/tax-subtotals';
import { readTenant } from '../repo.js';
import { rulesFor } from '../taxrules/taxrules.repo.js';
import {
  mergeObservations,
  taxCodeFor,
  type DraftSpec,
  type MergeAccounts,
  type MergeDocumentEvidence,
  type MergeGroup,
  type MergeStatementLineEvidence,
  type MergeVariance,
  type TaxCodeRow,
} from './merge.js';

// Australia-specific: the no-rule-set-installed fallback for deriving a
// document's per-category tax split at post time. Mirrors the same
// null-means-Australia convention `documents.controller.ts`'s
// `consumptionTaxFromRules` and `extraction/validators.ts`'s `jurisdictionOf`
// already use — a workspace onboarded before tax rule sets existed is treated
// as Australian here, not refused, because this re-derives a split for an
// ALREADY-CONFIRMED document rather than producing a fresh statutory figure.
const AU_CONSUMPTION_TAX: Pick<ConsumptionTaxSpec, 'inclusiveFraction' | 'baseFraction'> = {
  inclusiveFraction: { n: 1, d: 11 },
  baseFraction: { n: 1, d: 1 },
};

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
  accountType: 'asset' | 'liability' | 'expense' | 'income',
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
  // R5b (`docs/STATEMENTS.md` §5.3.1): the merge rule's own two new control
  // accounts. `variance` absorbs a human-named disagreement between a
  // receipt's total and the statement line that cleared it (a tip, a
  // surcharge, ...); `uncategorisedIncome` is the credit-side mirror of
  // `expense` (6-0000) for a statement line with no document at all.
  variance: { code: '6-9200', name: 'Payment variance', type: 'expense' as const },
  uncategorisedIncome: { code: '4-9000', name: 'Uncategorised Receipts', type: 'income' as const },
};

/**
 * The sale side's control accounts, same idempotent find-or-create as the
 * purchase side's `ACCOUNTS` above and via the same `ensureAccount`. Distinct
 * codes so the two never collide in one tenant's chart of accounts.
 */
const SALE_ACCOUNTS = {
  revenue: { code: '4-0000', name: 'Sales Revenue', type: 'income' as const },
  gstPayable: { code: '2-2200', name: 'GST Payable', type: 'liability' as const },
  accountsReceivable: { code: '1-1200', name: 'Trade Debtors', type: 'asset' as const },
};

/* ── Tax codes ───────────────────────────────────────────────────────────── */

/**
 * The tenant's country, read inside the CALLER'S transaction.
 *
 * Deliberately not `readTenant`, which opens its own connection: this is
 * consulted while a posting transaction is open, and a second connection
 * cannot see that transaction's uncommitted rows and would take a second trip
 * for a column already one join away.
 */
async function tenantCountry(t: Tx, tenantId: string): Promise<string> {
  const rows = await t.execute<{ country: string }>(sql`
    select country from tenants where id = ${tenantId} limit 1
  `);
  const country = rows.rows[0]?.country;
  if (!country) throw new Error(`tenant ${tenantId} has no country; cannot choose a tax code`);
  return country;
}

/**
 * The tenant's OWN country's tax codes, and only those.
 *
 * This selected every global row and keyed the map by `code` alone. `N-T`
 * exists in BOTH the Australian and Indonesian sets (verified in production:
 * two rows, AU and ID), so one silently overwrote the other and which one
 * survived depended on row order. `tax_codes.country` was right there and
 * never read.
 *
 * The damage was bounded only by luck: migration 0026 added
 * `transaction_splits_tax_code_country`, which REFUSES a split whose tax code
 * belongs to another country. So the first Indonesian tenant to post a
 * standard-rated document would have been handed the Australian `GST` code by
 * `taxCodeFor('S')` and met a trigger refusal — loud, but baffling, and
 * pointing at the ledger rather than at this function.
 *
 * Latent rather than live today: every production tenant is AU and no
 * transaction has ever been posted. It would have bitten on the first ID
 * tenant, which is the market `packages/tax-rules`' `id-2026` set exists for.
 */
async function loadTaxCodes(t: Tx, country: string): Promise<Map<string, TaxCodeRow>> {
  const rows = await t.execute<TaxCodeRow>(sql`
    select id, code, claims_credit from tax_codes
     where tenant_id is null and country = ${country}
  `);
  const byCode = new Map<string, TaxCodeRow>();
  for (const r of rows.rows) byCode.set(r.code, r);
  if (byCode.size === 0) {
    // Refuse rather than post with no tax code at all. An empty map would make
    // every lookup below undefined and the failure would surface as a null
    // constraint three layers away.
    throw new Error(
      `No global tax codes for country ${JSON.stringify(country)}. ` +
        'Posting would produce splits with no tax code; see packages/db migrations 0007 and 0026.',
    );
  }
  return byCode;
}

// `taxCodeFor` used to live here. R5b (`docs/STATEMENTS.md` §5.3.1) moved it,
// unchanged, to `merge.ts` — "the shared helper" the design calls for, so the
// country-awareness fixed alongside `loadTaxCodes` above cannot be
// reintroduced by a second, independent copy the next time this file grows a
// posting path. Imported at the top of this file.

/* ── Draft from a document ──────────────────────────────────────────────── */

export type DraftOutcome =
  | { ok: true; transactionId: string }
  | { ok: false; reason: 'missing' }
  | { ok: false; reason: 'not_confirmed'; reviewStatus: string }
  | { ok: false; reason: 'already_posted'; transactionId: string; status: string }
  | { ok: false; reason: 'ambiguous_tax_categories' }
  | { ok: false; reason: 'lines_dont_reconcile'; gap: string };

/* ── Evidence loaders: the impure shell around `mergeObservations` ───────── */

type DocumentEvidenceRefusal =
  | { ok: false; reason: 'missing' }
  | { ok: false; reason: 'not_confirmed'; reviewStatus: string }
  | { ok: false; reason: 'ambiguous_tax_categories' }
  | { ok: false; reason: 'lines_dont_reconcile'; gap: string };

type DocumentEvidenceResult =
  | {
      ok: true;
      evidence: MergeDocumentEvidence;
      cardBrand: string | null;
      cardLast4: string | null;
    }
  | DocumentEvidenceRefusal;

/**
 * Locks and reads a confirmed document's debit-side evidence — everything
 * `mergeObservations` needs from a receipt, resolved. Shared by
 * `draftTransactionFromDocument` (the receipt-only path, unchanged in
 * behaviour) and `supersedeAndPost` (R5b, the merge path): the exact same
 * subtotals → derive-from-lines → header-fallback logic
 * `draftTransactionFromDocument` always had, extracted rather than
 * duplicated, per `docs/STATEMENTS.md` §5.3.1's own instruction ("extracted
 * without changing its output for the receipt-only case").
 *
 * Does NOT check "already has a live transaction" — that guarantee means two
 * different things to its two callers (a fresh draft must refuse; a supersede
 * expects one and is about to replace it), so it stays the caller's own,
 * explicit check.
 */
async function loadDocumentEvidence(
  t: Tx,
  tenantId: string,
  documentId: string,
  consumptionTax: Pick<ConsumptionTaxSpec, 'inclusiveFraction' | 'baseFraction'>,
): Promise<DocumentEvidenceResult> {
  // Locks the document for the life of the caller's transaction, so two
  // concurrent posts/merges of the same scan cannot both proceed.
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
    card_brand: string | null;
    card_last4: string | null;
    supplier_id: string | null;
    supplier_name: string | null;
  }>(sql`
    select d.id, d.is_tax_invoice, d.review_status::text as review_status,
           d.issue_date::text as issue_date, d.document_number, d.currency::text as currency,
           d.tax_exclusive_amount::text as tax_exclusive_amount,
           d.tax_amount::text as tax_amount,
           d.payable_amount::text as payable_amount,
           d.rounding_amount::text as rounding_amount,
           d.card_brand, d.card_last4, d.supplier_id,
           p.legal_name as supplier_name
      from documents d
      left join parties p on p.id = d.supplier_id
     where d.id = ${documentId} and d.deleted_at is null
     for update of d
  `);
  const doc = docRows.rows[0];
  if (!doc) return { ok: false, reason: 'missing' };

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

  let groups: MergeGroup[];
  if (subtotals.rows.length > 0) {
    groups = subtotals.rows.map((r) => ({
      categoryCode: r.category_code,
      taxable: money.money(r.taxable_amount || '0'),
      tax: money.money(r.tax_amount || '0'),
    }));
  } else {
    // No per-category reconciliation on record. One tax treatment falls back
    // to the header totals; more than one is DERIVED from the lines below, by
    // a function that refuses rather than guesses. The original rule — never
    // recompute what the validators own — is kept by that refusal, not by
    // declining to look.
    const lineCats = await t.execute<{ gst_category_code: string | null; net: string }>(sql`
      select gst_category_code, sum(line_net_amount)::text as net
        from document_lines where document_id = ${documentId}
       group by gst_category_code
    `);
    if (lineCats.rows.length === 0) return { ok: false, reason: 'ambiguous_tax_categories' };

    if (lineCats.rows.length > 1) {
      // More than one tax treatment and no stored subtotals. This used to be
      // an outright refusal, and while nothing could WRITE
      // `document_tax_subtotals` it meant the mixed GST/GST-free docket — the
      // product's whole wedge — could never be posted to the ledger.
      //
      // `taxSubtotalsFromLines` is not the guess the old comment rightly
      // forbade: it derives the split with exact decimal arithmetic and
      // returns NOTHING when it cannot state one honestly — lines that do not
      // reconcile to the payable, or a printed GST that disagrees with the
      // lines' own GST-free flags. So the refusal below still fires for every
      // case that earned it.
      //
      // Derived here as well as persisted on extraction, because documents
      // extracted before that write existed have lines and no subtotals, and
      // a migration cannot recover what was never computed.
      const rows = await t.execute<{ gst_category_code: string | null; line_net_amount: string }>(sql`
        select gst_category_code, line_net_amount::text as line_net_amount
          from document_lines where document_id = ${documentId} order by line_number
      `);
      const derived = taxSubtotalsFromLines(
        rows.rows.map((r) => ({
          amount: r.line_net_amount,
          gstFree: r.gst_category_code === 'Z',
        })),
        doc.tax_amount,
        doc.payable_amount,
        consumptionTax,
      );
      if (derived.length === 0) return { ok: false, reason: 'ambiguous_tax_categories' };

      groups = derived.map((d) => ({
        categoryCode: d.categoryCode,
        taxable: money.money(d.taxableAmount),
        tax: money.money(d.taxAmount),
      }));
    } else {
      const lineSum = await t.execute<{ sum: string | null }>(sql`
        select sum(line_net_amount)::text as sum from document_lines where document_id = ${documentId}
      `);
      // Counted in BigInt, like the ledger. A Number gap check on a 0.02
      // boundary lets 0.03 − 0.01 read as 0.019999999999999997 and admit a
      // docket the paper says is exactly on the refusal line.
      const gap = decimalLinesGap(lineSum.rows[0]?.sum ?? '0', doc.payable_amount, doc.tax_amount);
      const absGap = gap.startsWith('-') ? gap.slice(1) : gap;
      if (moneyCompare(absGap, '0.02') >= 0) {
        return { ok: false, reason: 'lines_dont_reconcile', gap };
      }

      groups = [
        {
          categoryCode: lineCats.rows[0]!.gst_category_code,
          taxable: money.money(doc.tax_exclusive_amount ?? '0'),
          tax: money.money(doc.tax_amount ?? '0'),
        },
      ];
    }
  }

  return {
    ok: true,
    cardBrand: doc.card_brand,
    cardLast4: doc.card_last4,
    evidence: {
      issueDate: doc.issue_date,
      documentNumber: doc.document_number,
      supplierId: doc.supplier_id,
      supplierName: doc.supplier_name,
      currency: doc.currency,
      isTaxInvoice: doc.is_tax_invoice,
      roundingAmount: money.money(doc.rounding_amount || '0'),
      groups,
    },
  };
}

type StatementLineEvidenceResult =
  | { ok: true; evidence: MergeStatementLineEvidence }
  | { ok: false; reason: 'missing_statement_line' };

/**
 * Locks and reads a statement line's evidence, joined through to the ledger
 * account its `financial_accounts` row IS (0031's "what makes the
 * double-entry side work without a second ledger"). RLS scopes this to the
 * caller's tenant already; a cross-tenant id simply reads back nothing.
 */
async function loadStatementLineEvidence(
  t: Tx,
  tenantId: string,
  statementLineId: string,
): Promise<StatementLineEvidenceResult> {
  const rows = await t.execute<{
    posted_date: string;
    value_date: string | null;
    amount_signed: string;
    description_raw: string;
    account_id: string;
    currency: string;
  }>(sql`
    select sl.posted_date::text as posted_date, sl.value_date::text as value_date,
           sl.amount_signed::text as amount_signed, sl.description_raw,
           fa.account_id, fa.currency::text as currency
      from statement_lines sl
      join statements st on st.id = sl.statement_id
      join financial_accounts fa on fa.id = st.financial_account_id
     where sl.id = ${statementLineId} and sl.tenant_id = ${tenantId}
     for update of sl
  `);
  const row = rows.rows[0];
  if (!row) return { ok: false, reason: 'missing_statement_line' };
  return {
    ok: true,
    evidence: {
      postedDate: row.posted_date,
      valueDate: row.value_date,
      amountSigned: money.money(row.amount_signed),
      currency: row.currency,
      descriptionRaw: row.description_raw,
      accountId: row.account_id,
    },
  };
}

/**
 * Every ledger account `mergeObservations` might reference, resolved
 * (find-or-create, via the same idempotent `ensureAccount` every other
 * posting path uses) in one place. The payment/bank leg follows §5.3.1's
 * resolution order exactly:
 *
 *  1. a matched statement line's own financial account — always, when there
 *     is one, because that IS the account the money moved through;
 *  2. otherwise, a `financial_accounts` row whose `account_last4` equals the
 *     document's `card_last4`, when exactly one such row exists;
 *  3. otherwise, the pre-R5 fallback: a card-brand suspense liability, or
 *     Trade Creditors when no card was read at all — unchanged, so a
 *     document-only draft with no matching financial account behaves exactly
 *     as it did before this ticket.
 */
async function resolveMergeAccounts(
  t: Tx,
  tenantId: string,
  opts: {
    cardBrand: string | null;
    cardLast4: string | null;
    statementLineAccountId: string | null;
  },
): Promise<MergeAccounts> {
  const expenseAccountId = await ensureAccount(
    t,
    tenantId,
    ACCOUNTS.expense.code,
    ACCOUNTS.expense.name,
    ACCOUNTS.expense.type,
  );
  const gstReceivableAccountId = await ensureAccount(
    t,
    tenantId,
    ACCOUNTS.gstReceivable.code,
    ACCOUNTS.gstReceivable.name,
    ACCOUNTS.gstReceivable.type,
  );
  const gstUnclaimableAccountId = await ensureAccount(
    t,
    tenantId,
    ACCOUNTS.gstUnclaimable.code,
    ACCOUNTS.gstUnclaimable.name,
    ACCOUNTS.gstUnclaimable.type,
  );
  const roundingAccountId = await ensureAccount(
    t,
    tenantId,
    ACCOUNTS.rounding.code,
    ACCOUNTS.rounding.name,
    ACCOUNTS.rounding.type,
  );
  const varianceAccountId = await ensureAccount(
    t,
    tenantId,
    ACCOUNTS.variance.code,
    ACCOUNTS.variance.name,
    ACCOUNTS.variance.type,
  );
  const uncategorisedIncomeAccountId = await ensureAccount(
    t,
    tenantId,
    ACCOUNTS.uncategorisedIncome.code,
    ACCOUNTS.uncategorisedIncome.name,
    ACCOUNTS.uncategorisedIncome.type,
  );

  let paymentAccountId: string;
  if (opts.statementLineAccountId) {
    paymentAccountId = opts.statementLineAccountId;
  } else if (opts.cardLast4) {
    const matches = await t.execute<{ account_id: string }>(sql`
      select account_id from financial_accounts
       where tenant_id = ${tenantId} and account_last4 = ${opts.cardLast4} and not is_archived
    `);
    paymentAccountId =
      matches.rows.length === 1
        ? matches.rows[0]!.account_id
        : await resolveBrandOrPayableAccount(t, tenantId, opts.cardBrand);
  } else {
    paymentAccountId = await resolveBrandOrPayableAccount(t, tenantId, opts.cardBrand);
  }

  return {
    expenseAccountId,
    gstReceivableAccountId,
    gstUnclaimableAccountId,
    roundingAccountId,
    paymentAccountId,
    varianceAccountId,
    // Same 6-0000 bucket a document-backed draft's own debit splits use —
    // R5d's "Uncategorised Purchases" is not a second account.
    uncategorisedExpenseAccountId: expenseAccountId,
    uncategorisedIncomeAccountId,
  };
}

async function resolveBrandOrPayableAccount(
  t: Tx,
  tenantId: string,
  cardBrand: string | null,
): Promise<string> {
  return cardBrand
    ? ensureAccount(
        t,
        tenantId,
        `2-11${cardBrand.slice(0, 2).toUpperCase()}`,
        `Credit Card — ${cardBrand}`,
        'liability',
      )
    : ensureAccount(
        t,
        tenantId,
        ACCOUNTS.accountsPayable.code,
        ACCOUNTS.accountsPayable.name,
        ACCOUNTS.accountsPayable.type,
      );
}

/** Stamped into every merged draft's `external_refs.merge.rule_version` — the
 *  replay stamp `docs/STATEMENTS.md` §5.3.1 calls for. Bumped only if the
 *  merge rule's OUTPUT for the same evidence would change; the value itself
 *  is opaque, never parsed back. */
const MERGE_RULE_VERSION = 'r5b.2026-09-18';

async function insertDraftTransaction(
  t: Tx,
  tenantId: string,
  transactionId: string,
  documentId: string | null,
  draft: DraftSpec,
): Promise<void> {
  await t.execute(sql`
    insert into transactions (
      id, tenant_id, txn_date, settled_date, payee_id, memo, currency, status, source, document_id, external_refs
    ) values (
      ${transactionId}, ${tenantId}, coalesce(${draft.txnDate}::date, current_date), ${draft.settledDate}::date,
      ${draft.payeeId}, ${draft.memo}, ${draft.currency}::currency_code, 'draft', ${draft.source}::txn_source,
      ${documentId}, ${JSON.stringify(draft.externalRefs)}::jsonb
    )
  `);

  let lineNumber = 1;
  for (const split of draft.splits) {
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
}

/**
 * Proposes a draft transaction from a confirmed document.
 *
 * Splits come from `document_tax_subtotals` when the validators produced them
 * (the authoritative, per-category reconciliation — §4 "Mixed tax" of
 * `docs/PLAN.md`) and otherwise from a single aggregate built from the
 * document's own header totals, guarded by the same lines-vs-total check the
 * review screen shows (`linesGap`) so a document whose lines do not add up
 * cannot silently become a "balanced" posting. Both paths are
 * `loadDocumentEvidence`'s, above; this function is now that evidence run
 * through `mergeObservations` with no statement line (R5b).
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
 *
 * R5b also makes this insert its `kind = 'document'` `event_observations` row
 * in the SAME transaction — migration 0032's deferred trigger requires one of
 * every non-void, document-backed transaction at COMMIT, and this is the only
 * path that creates one today.
 */
export async function draftTransactionFromDocument(
  userId: string,
  tenantId: string,
  documentId: string,
): Promise<DraftOutcome> {
  // Resolved before the transaction below, same pattern as
  // `documents.controller.ts`'s `update()`: the divisor is the jurisdiction,
  // 1/11 in Australia and 11/111 in Indonesia (docs/INDONESIA.md §2.2).
  const tenant = await readTenant(userId, tenantId);
  const taxRules = tenant?.tax_rules_id ? await rulesFor(tenant) : null;
  const consumptionTax: Pick<ConsumptionTaxSpec, 'inclusiveFraction' | 'baseFraction'> = taxRules
    ? {
        inclusiveFraction: taxRules.consumptionTax.inclusiveFraction,
        baseFraction: taxRules.consumptionTax.baseFraction,
      }
    : AU_CONSUMPTION_TAX;

  return tx(getDb(), userId, tenantId, async (t) => {
    // Rule 3, deliberately ahead of everything `loadDocumentEvidence` checks:
    // a document already carrying a live transaction must be refused as
    // "already posted" even if something later reset its review status —
    // that guarantee should not depend on review_status still agreeing with
    // history. A voided transaction does not count; that is what voiding is
    // for. (`supersedeAndPost` below does NOT run this check — an existing
    // live transaction is exactly what it expects to replace.)
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

    const loaded = await loadDocumentEvidence(t, tenantId, documentId, consumptionTax);
    if (!loaded.ok) return loaded;

    const country = await tenantCountry(t, tenantId);
    const taxCodes = await loadTaxCodes(t, country);
    const accounts = await resolveMergeAccounts(t, tenantId, {
      cardBrand: loaded.cardBrand,
      cardLast4: loaded.cardLast4,
      statementLineAccountId: null,
    });

    // R5b: this IS `mergeObservations` with no statement line — "extracted
    // without changing its output for the receipt-only case"
    // (`docs/STATEMENTS.md` §5.3.1).
    const merged = mergeObservations(
      { document: loaded.evidence, statementLine: null },
      { taxCodes, country, accounts, ruleVersion: MERGE_RULE_VERSION },
    );
    if (!merged.ok) {
      // Unreachable with `statementLine: null` (amount_disagreement and
      // currency_mismatch both require one; no_evidence requires neither
      // side, and `document` is always non-null here) — defensive, not a
      // real branch.
      throw new Error(
        `mergeObservations unexpectedly refused a document-only draft for ${documentId}: ${JSON.stringify(merged)}`,
      );
    }

    // Pre-flight, per `money.ts`'s own stated purpose — never the authority.
    if (!money.balances(merged.draft.splits.map((s) => s.amount))) {
      throw new Error(
        `draftTransactionFromDocument built unbalanced splits for document ${documentId}: ` +
          JSON.stringify(merged.draft.splits),
      );
    }

    const transactionId = randomUUID();
    await insertDraftTransaction(t, tenantId, transactionId, documentId, merged.draft);

    // R5b (`docs/STATEMENTS.md` §5.3.1): the observation row migration 0032's
    // deferred trigger requires of every non-void, document-backed
    // transaction at COMMIT. The document was already confirmed by a human,
    // separately (0009's "two separate acts") — this draft act is what
    // records that its evidence observes this event, not a second
    // confirmation of the document itself.
    await t.execute(sql`
      insert into event_observations (id, tenant_id, transaction_id, kind, document_id, confirmed_by, confirmed_at)
      values (${randomUUID()}, ${tenantId}, ${transactionId}, 'document', ${documentId}, ${userId}, now())
    `);

    return { ok: true, transactionId };
  });
}

/* ── Supersede, never edit ────────────────────────────────────────────────
 * `docs/STATEMENTS.md` §5.3.1 "Materialisation: supersede, never edit", Lane R
 * ticket R5b. A posted transaction is immutable (0009 guarantee 3); when an
 * event's evidence set changes, the live transaction(s) materialising the OLD
 * evidence are voided and a fresh merged transaction is drafted and posted —
 * in ONE `withTenantAs`, so migration 0032's deferred constraint triggers see
 * only the FINAL state at commit, regardless of the order these writes happen
 * in. D-S6 (§14.1c): accepting a match IS the act of posting it — this
 * function ends with a post, not a draft a second call must confirm.
 * ────────────────────────────────────────────────────────────────────────── */

export interface SupersedeInput {
  documentId: string | null;
  statementLineId: string | null;
  variance?: MergeVariance;
  /** `match_candidates` ids behind this merge (R5c). Omitted for a
   *  document-only draft-turned-merge or a manual link with no suggestion. */
  candidateIds?: string[];
}

export type SupersedeOutcome =
  | { ok: true; transactionId: string }
  | { ok: false; reason: 'no_evidence' }
  | { ok: false; reason: 'missing_document' }
  | { ok: false; reason: 'missing_statement_line' }
  | { ok: false; reason: 'document_not_confirmed'; reviewStatus: string }
  | { ok: false; reason: 'ambiguous_tax_categories' }
  | { ok: false; reason: 'lines_dont_reconcile'; gap: string }
  | { ok: false; reason: 'amount_disagreement'; documentAmount: Money; lineAmount: Money }
  | { ok: false; reason: 'currency_mismatch'; documentCurrency: string; lineCurrency: string };

/**
 * Void whatever live transaction(s) currently materialise `input`'s evidence,
 * draft the merged transaction `mergeObservations` proposes for the FULL
 * evidence set, re-point (or create) the `event_observations` rows onto it,
 * and post it — through `runPostUpdate` below, the same UPDATE
 * `postTransaction` calls, so its "one and only place `transactions.status`
 * becomes `'posted'`" comment stays literally true.
 *
 * Per §5.3.1: "every match changes the payment leg... so there is no safe
 * in-place path" — a document-only transaction posts to a card-brand suspense
 * account; once matched, the payment leg becomes the real bank account. There
 * is no supported "supersede nothing" call: at least one of `documentId` /
 * `statementLineId` must be given, or this refuses `no_evidence`.
 */
export async function supersedeAndPost(
  userId: string,
  tenantId: string,
  input: SupersedeInput,
): Promise<SupersedeOutcome> {
  if (!input.documentId && !input.statementLineId) {
    return { ok: false, reason: 'no_evidence' };
  }

  const tenant = await readTenant(userId, tenantId);
  const taxRules = tenant?.tax_rules_id ? await rulesFor(tenant) : null;
  const consumptionTax: Pick<ConsumptionTaxSpec, 'inclusiveFraction' | 'baseFraction'> = taxRules
    ? {
        inclusiveFraction: taxRules.consumptionTax.inclusiveFraction,
        baseFraction: taxRules.consumptionTax.baseFraction,
      }
    : AU_CONSUMPTION_TAX;

  return tx(getDb(), userId, tenantId, async (t) => {
    let docLoaded: DocumentEvidenceResult | null = null;
    if (input.documentId) {
      docLoaded = await loadDocumentEvidence(t, tenantId, input.documentId, consumptionTax);
      if (!docLoaded.ok) {
        if (docLoaded.reason === 'missing') return { ok: false, reason: 'missing_document' };
        if (docLoaded.reason === 'not_confirmed') {
          return { ok: false, reason: 'document_not_confirmed', reviewStatus: docLoaded.reviewStatus };
        }
        return docLoaded;
      }
    }

    let lineLoaded: StatementLineEvidenceResult | null = null;
    if (input.statementLineId) {
      lineLoaded = await loadStatementLineEvidence(t, tenantId, input.statementLineId);
      if (!lineLoaded.ok) return lineLoaded;
    }

    const country = await tenantCountry(t, tenantId);
    const taxCodes = await loadTaxCodes(t, country);
    const accounts = await resolveMergeAccounts(t, tenantId, {
      cardBrand: docLoaded?.cardBrand ?? null,
      cardLast4: docLoaded?.cardLast4 ?? null,
      statementLineAccountId: lineLoaded?.evidence.accountId ?? null,
    });

    const merged = mergeObservations(
      {
        document: docLoaded?.evidence ?? null,
        statementLine: lineLoaded?.evidence ?? null,
        variance: input.variance,
      },
      { taxCodes, country, accounts, ruleVersion: MERGE_RULE_VERSION, candidateIds: input.candidateIds },
    );
    if (!merged.ok) return merged;

    // Pre-flight, per `money.ts`'s own stated purpose — never the authority.
    if (!money.balances(merged.draft.splits.map((s) => s.amount))) {
      throw new Error(`supersedeAndPost built unbalanced splits: ${JSON.stringify(merged.draft.splits)}`);
    }

    // Every LIVE transaction currently materialising either piece of
    // evidence — there may be two: the receipt's own and a line-posted-
    // standalone one (§5.3.1 Q4).
    const existingIds = new Set<string>();
    if (input.documentId) {
      const r = await t.execute<{ transaction_id: string }>(sql`
        select transaction_id from event_observations
         where tenant_id = ${tenantId} and document_id = ${input.documentId} and kind = 'document'
      `);
      if (r.rows[0]) existingIds.add(r.rows[0].transaction_id);
    }
    if (input.statementLineId) {
      const r = await t.execute<{ transaction_id: string }>(sql`
        select transaction_id from event_observations
         where tenant_id = ${tenantId} and statement_line_id = ${input.statementLineId} and kind = 'statement_line'
      `);
      if (r.rows[0]) existingIds.add(r.rows[0].transaction_id);
    }

    const newTransactionId = randomUUID();

    for (const oldId of existingIds) {
      await t.execute(sql`
        update transactions
           set status = 'void', voided_at = now(),
               void_reason = ${`superseded: evidence merged into ${newTransactionId}`},
               external_refs = external_refs || jsonb_build_object('superseded_by', ${newTransactionId}::text)
         where id = ${oldId} and tenant_id = ${tenantId} and status <> 'void'
      `);
    }

    await insertDraftTransaction(t, tenantId, newTransactionId, input.documentId, merged.draft);

    // Re-point each evidence row already observing an event onto the new
    // transaction (never delete-then-insert: a voided old row must carry NO
    // observation at COMMIT, per 0032's trigger 1, and re-pointing is what
    // lets that be true in the SAME statement set as the insert above,
    // regardless of order). Insert fresh when there was nothing to re-point.
    if (input.documentId) {
      const repointed = await t.execute(sql`
        update event_observations
           set transaction_id = ${newTransactionId}, confirmed_by = ${userId}, confirmed_at = now()
         where tenant_id = ${tenantId} and document_id = ${input.documentId} and kind = 'document'
      `);
      if ((repointed.rowCount ?? 0) === 0) {
        await t.execute(sql`
          insert into event_observations (id, tenant_id, transaction_id, kind, document_id, confirmed_by, confirmed_at)
          values (${randomUUID()}, ${tenantId}, ${newTransactionId}, 'document', ${input.documentId}, ${userId}, now())
        `);
      }
    }
    if (input.statementLineId) {
      const repointed = await t.execute(sql`
        update event_observations
           set transaction_id = ${newTransactionId}, confirmed_by = ${userId}, confirmed_at = now()
         where tenant_id = ${tenantId} and statement_line_id = ${input.statementLineId} and kind = 'statement_line'
      `);
      if ((repointed.rowCount ?? 0) === 0) {
        await t.execute(sql`
          insert into event_observations (id, tenant_id, transaction_id, kind, statement_line_id, confirmed_by, confirmed_at)
          values (${randomUUID()}, ${tenantId}, ${newTransactionId}, 'statement_line', ${input.statementLineId}, ${userId}, now())
        `);
      }
    }

    // D-S6: accepting a match IS the act of posting it — one tap, not
    // accept-then-post. `runPostUpdate` is the exact UPDATE `postTransaction`
    // performs; deferred triggers (0006's balance check, 0032's two) are all
    // checked once, at this same COMMIT.
    const posted = await runPostUpdate(t, tenantId, newTransactionId, userId);
    if (!posted.ok) {
      // Unreachable: the row was just inserted as 'draft' by this same
      // transaction, under the same connection's lock.
      throw new Error(`supersedeAndPost: freshly drafted transaction ${newTransactionId} failed to post: ${JSON.stringify(posted)}`);
    }

    return { ok: true, transactionId: newTransactionId };
  });
}

/* ── Draft from an invoice (the sale side) ──────────────────────────────── */

export type DraftSaleOutcome =
  | { ok: true; transactionId: string }
  | { ok: false; reason: 'missing' }
  | { ok: false; reason: 'not_sent'; status: string }
  | { ok: false; reason: 'already_posted'; transactionId: string; status: string }
  | { ok: false; reason: 'no_lines' }
  | { ok: false; reason: 'lines_dont_reconcile'; gap: string };

/**
 * Proposes a draft transaction from a sent invoice — the mirror image of
 * `draftTransactionFromDocument` above, and built to the same two rules.
 *
 * `docs/PLAN.md` §5's sign convention: assets and expenses increase positive,
 * liabilities/equity/income increase negative. A sale is therefore revenue
 * CREDIT (negative), GST payable CREDIT (negative), the receivable DEBIT
 * (positive) — the mirror of the purchase side's expense/GST-receivable/
 * payable shape, not a reinvention of it.
 *
 * Unlike a scanned document, an invoice's lines are not OCR output needing a
 * validators' reconciliation pass — `invoice_lines.net_amount`/`gst_amount`
 * are exact stored decimals the app itself wrote. So there is no "ambiguous
 * tax categories" fallback here: every line groups cleanly by its effective
 * tax code (the referenced item's `tax_code`, or `GSTONINCOME` for a
 * line with no item — the same default `items.tax_code` itself carries).
 * `tax_codes` is looked up for that code's id, never re-derived from a label
 * union computed here — the whole reason migration 0005 built that table.
 */
export async function draftTransactionFromInvoice(
  userId: string,
  tenantId: string,
  invoiceId: string,
): Promise<DraftSaleOutcome> {
  return tx(getDb(), userId, tenantId, async (t) => {
    // Locks the invoice for the life of this transaction, same reason as the
    // document lock above: two concurrent posts of the same invoice cannot
    // both pass the "no transaction yet" check below.
    const invRows = await t.execute<{
      id: string;
      status: string;
      party_id: string;
      party_name: string;
      issue_date: string;
      number: string;
      net_amount: string;
      gst_amount: string;
      total_amount: string;
    }>(sql`
      select i.id, i.status::text as status, i.party_id, p.legal_name as party_name,
             i.issue_date::text as issue_date, i.number,
             i.net_amount::text as net_amount, i.gst_amount::text as gst_amount,
             i.total_amount::text as total_amount
        from invoices i
        join parties p on p.id = i.party_id
       where i.id = ${invoiceId} and i.tenant_id = ${tenantId}
       for update of i
    `);
    const invoice = invRows.rows[0];
    if (!invoice) return { ok: false, reason: 'missing' };

    // Rule (already posted) first, same ordering as the purchase side: a
    // live transaction must be refused even if something later changed the
    // invoice's status. `transactions` has no `invoice_id` column (only a
    // scanned document gets that FK, via `document_id`) — `external_refs`
    // is the extensibility bag migration 0006 already ships for exactly
    // this ("{"xero":{"id":...}}"), so the link is tagged there rather than
    // improvising a schema change for it.
    const existing = await t.execute<{ id: string; status: string }>(sql`
      select id, status::text as status from transactions
       where tenant_id = ${tenantId} and status <> 'void'
         and external_refs ->> 'invoice_id' = ${invoiceId}
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

    // 'sent' is the invoice having gone to the customer; 'paid' and
    // 'overdue' are states an already-sent invoice can carry (a payment
    // never rewrites `invoices.status` itself — see `business.repo.ts`'s
    // `recordPayment` — but seeded/historical data may set it directly), so
    // all three count as "sent" here. 'draft' (nobody has been asked to pay
    // it) and 'void' do not.
    if (invoice.status !== 'sent' && invoice.status !== 'paid' && invoice.status !== 'overdue') {
      return { ok: false, reason: 'not_sent', status: invoice.status };
    }

    const lineGroups = await t.execute<{ code: string; net: string; gst: string }>(sql`
      select coalesce(it.tax_code, 'GSTONINCOME') as code,
             sum(il.net_amount)::text as net,
             sum(il.gst_amount)::text as gst
        from invoice_lines il
        left join items it on it.id = il.item_id
       where il.invoice_id = ${invoiceId}
       group by coalesce(it.tax_code, 'GSTONINCOME')
    `);
    if (lineGroups.rows.length === 0) return { ok: false, reason: 'no_lines' };

    // The lines must add up to the header — the same discipline as the
    // purchase side's `linesGap`, just against exact stored figures rather
    // than an OCR reconciliation, so an exact match is the bar.
    const sumNet = money.add(...lineGroups.rows.map((g) => money.money(g.net || '0')));
    const sumGst = money.add(...lineGroups.rows.map((g) => money.money(g.gst || '0')));
    const netGap = money.subtract(sumNet, money.money(invoice.net_amount));
    const gstGap = money.subtract(sumGst, money.money(invoice.gst_amount));
    if (!money.isZero(netGap) || !money.isZero(gstGap)) {
      const gap = money.add(netGap, gstGap);
      return { ok: false, reason: 'lines_dont_reconcile', gap };
    }

    const country = await tenantCountry(t, tenantId);
    const taxCodes = await loadTaxCodes(t, country);
    const revenueAccountId = await ensureAccount(
      t,
      tenantId,
      SALE_ACCOUNTS.revenue.code,
      SALE_ACCOUNTS.revenue.name,
      SALE_ACCOUNTS.revenue.type,
    );

    const splits: Array<{
      accountId: string;
      amount: Money;
      taxCodeId: string | null;
      gstAmount: Money;
      description: string | null;
    }> = [];

    for (const group of lineGroups.rows) {
      const net = money.money(group.net || '0');
      const gst = money.money(group.gst || '0');
      // Falls back to GSTONINCOME rather than silently excluding the line
      // from BAS: `items.tax_code` defaults to it too, so a code this table
      // does not recognise is a data problem elsewhere, not licence to
      // under-report G1.
      const taxCode = taxCodes.get(group.code) ?? taxCodes.get('GSTONINCOME');

      splits.push({
        accountId: revenueAccountId,
        amount: money.negate(net),
        taxCodeId: taxCode?.id ?? null,
        gstAmount: gst,
        description: `Sales — ${group.code}`,
      });

      if (!money.isZero(gst)) {
        const gstPayableAccountId = await ensureAccount(
          t,
          tenantId,
          SALE_ACCOUNTS.gstPayable.code,
          SALE_ACCOUNTS.gstPayable.name,
          SALE_ACCOUNTS.gstPayable.type,
        );
        splits.push({
          accountId: gstPayableAccountId,
          amount: money.negate(gst),
          taxCodeId: null, // control posting — excluded from BAS aggregation, never double-counted
          gstAmount: money.ZERO,
          description: 'GST payable',
        });
      }
    }

    // The receivable leg balances whatever the credit-side splits above came
    // to — ordinary double-entry, the mirror of the purchase side's payment
    // leg. The trigger still has the final word at post time.
    const creditTotal = money.add(...splits.map((s) => s.amount));
    const receivableAccountId = await ensureAccount(
      t,
      tenantId,
      SALE_ACCOUNTS.accountsReceivable.code,
      SALE_ACCOUNTS.accountsReceivable.name,
      SALE_ACCOUNTS.accountsReceivable.type,
    );
    splits.push({
      accountId: receivableAccountId,
      amount: money.negate(creditTotal),
      taxCodeId: null,
      gstAmount: money.ZERO,
      description: `Receivable — ${invoice.number}`,
    });

    // Pre-flight, per `money.ts`'s own stated purpose — never the authority.
    if (!money.balances(splits.map((s) => s.amount))) {
      throw new Error(
        `draftTransactionFromInvoice built unbalanced splits for invoice ${invoiceId}: ` +
          JSON.stringify(splits),
      );
    }

    const transactionId = randomUUID();
    const memo = `${invoice.party_name} — ${invoice.number}`;
    await t.execute(sql`
      insert into transactions (
        id, tenant_id, txn_date, payee_id, memo, currency, status, source, external_refs
      ) values (
        ${transactionId}, ${tenantId}, ${invoice.issue_date}::date,
        ${invoice.party_id}, ${memo}, 'AUD'::currency_code, 'draft', 'manual',
        jsonb_build_object('invoice_id', ${invoiceId}::text)
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
 * `'posted'`, which is what arms migration 0006's `trg_txn_balanced_on_post`
 * (and, since R5b, 0032's two deferred triggers as well).
 *
 * Extracted from `postTransaction` below (R5b, `docs/STATEMENTS.md` §5.3.1:
 * "post it — through the same UPDATE `postTransaction` already owns,
 * extracted into a shared helper so that comment stays true") so
 * `supersedeAndPost` can run this exact UPDATE inside ITS OWN, larger
 * transaction rather than opening a second `withTenantAs` — voiding the old
 * transaction(s), inserting the new one, re-pointing observations, and
 * posting must all be one commit, or the deferred triggers would be checked
 * against a half-built intermediate state.
 *
 * `t` is the CALLER's transaction: this function neither opens nor commits
 * one, so every deferred trigger armed by the `UPDATE` below is checked at
 * the caller's COMMIT, not here.
 */
async function runPostUpdate(t: Tx, tenantId: string, transactionId: string, userId: string): Promise<PostOutcome> {
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
}

/**
 * Draft → posted. The one and only place `transactions.status` becomes
 * `'posted'` — via `runPostUpdate` above, which is now that place's single
 * implementation, shared with `supersedeAndPost`.
 *
 * That trigger is `DEFERRABLE INITIALLY DEFERRED`, so it does not run on the
 * `UPDATE` inside `runPostUpdate` — it runs when THIS function's
 * `withTenantAs` transaction commits, i.e. when this call returns. An
 * unbalanced transaction makes THIS CALL reject, not the `UPDATE` statement,
 * which is why the caller must expect a rejected promise here rather than a
 * normal falsy outcome — there is no TypeScript-level balance check upstream
 * of it to catch first.
 */
export async function postTransaction(
  userId: string,
  tenantId: string,
  transactionId: string,
): Promise<PostOutcome> {
  return tx(getDb(), userId, tenantId, (t) => runPostUpdate(t, tenantId, transactionId, userId));
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
             t.document_id,
             -- to_json, NOT ::text: a timestamptz cast to text renders a SPACE
             -- where ISO 8601 wants a T, and TransactionSummary.postedAt is
             -- declared IsoDateTime. V8 forgives it, Hermes does not, and
             -- Date.parse answers NaN rather than throwing -- which every
             -- comparison then reads as false, so a broken timestamp looks
             -- like a valid one. Null survives as null, not the text 'null'.
             to_json(t.posted_at)#>>'{}' as posted_at,
             t.void_reason,
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
