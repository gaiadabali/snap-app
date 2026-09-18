import { money, type Money } from '@snap/db';

/**
 * The merge rule, as a pure function — `docs/STATEMENTS.md` §5.3.1 "The merge
 * rule, as a function", Lane R ticket R5b.
 *
 * `mergeObservations(evidence, rules)` is PURE: same evidence, same rule
 * version, byte-identical `DraftSpec` out. That is README principle 2
 * (extraction is a versioned, replayable function) applied to posting, and it
 * is the property `merge.test.ts` asserts directly, with no database in the
 * loop. Everything that needs a database — locking a document row, resolving
 * which ledger account a card or a statement line's `financial_accounts.
 * account_id` maps to, ensuring a control account exists — happens in
 * `transactions.repo.ts` BEFORE this is called, and is passed in already
 * resolved. This file must never import `@snap/db`'s `withTenantAs`, `Tx`, or
 * anything that touches a connection — that import boundary IS the purity
 * guarantee, not just a comment promising it.
 *
 * `current_date` never appears here. When neither a document's `issue_date`
 * nor a statement line is available to name a `txn_date`, this returns `null`
 * — the SQL-level `coalesce(..., current_date)` a caller applies for that one
 * remaining case (a document with no issue_date and no matched line — the
 * pre-R5 behaviour `draftTransactionFromDocument` already had) is therefore
 * the only place "today" can enter a posting, and it never fires once a
 * statement line is present. That is what makes "never `current_date` when a
 * line is present" true by construction rather than by discipline.
 */

/* ── Inputs: evidence already resolved by the impure shell ─────────────── */

export interface MergeGroup {
  categoryCode: string | null;
  taxable: Money;
  tax: Money;
}

/** The debit-side facts of a confirmed document — everything `mergeObservations`
 *  needs from a receipt/tax-invoice, with no document row shape leaking in. */
export interface MergeDocumentEvidence {
  issueDate: string | null;
  documentNumber: string | null;
  supplierId: string | null;
  supplierName: string | null;
  currency: string;
  isTaxInvoice: boolean;
  roundingAmount: Money;
  groups: MergeGroup[];
}

/** The facts of a statement line, joined to the ledger account its
 *  `financial_accounts` row IS — resolved by the caller, never derived here. */
export interface MergeStatementLineEvidence {
  postedDate: string;
  valueDate: string | null;
  /** 0031's convention: positive = money IN (deposit), negative = money OUT
   *  (withdrawal/purchase) — the SAME sign convention `transaction_splits.amount`
   *  uses for an asset account, not a second one. */
  amountSigned: Money;
  currency: string;
  descriptionRaw: string;
  /** `financial_accounts.account_id` — the ledger account this financial
   *  account IS. The payment leg posts here with no sign flip. */
  accountId: string;
}

export type MergeVarianceKind = 'tip' | 'surcharge' | 'other';

export interface MergeVariance {
  kind: MergeVarianceKind;
}

/** Every ledger account id the merge might need, resolved (find-or-create)
 *  by the caller. Passing ids in rather than codes/names keeps this file free
 *  of `ensureAccount` and every other database call. */
export interface MergeAccounts {
  expenseAccountId: string;
  gstReceivableAccountId: string;
  gstUnclaimableAccountId: string;
  roundingAccountId: string;
  /** The bank/card/creditor leg — resolved by the caller's own resolution
   *  order (statement line's account, else card_last4 match, else brand
   *  liability / Trade Creditors). */
  paymentAccountId: string;
  varianceAccountId: string;
  uncategorisedExpenseAccountId: string;
  uncategorisedIncomeAccountId: string;
}

// A `type` alias, deliberately, not an `interface`: `transactions.repo.ts`
// passes this as `t.execute<TaxCodeRow>`'s type argument, and only an object
// TYPE gets TypeScript's implicit index signature for that constraint — an
// `interface` here would fail `Record<string, unknown>` at the call site.
export type TaxCodeRow = {
  id: string;
  code: string;
  claims_credit: boolean;
};

export interface MergeRules {
  /** This tenant's OWN country's tax codes only — see `taxCodeFor` below for
   *  why "the tenant's own country's" is load-bearing. */
  taxCodes: Map<string, TaxCodeRow>;
  country: string;
  accounts: MergeAccounts;
  /** Stamped into `external_refs.merge.rule_version` — the replay stamp,
   *  the same reason `tenants.tax_rules_version` exists. */
  ruleVersion: string;
  /** `match_candidates` ids that produced this merge, if any (R5c). Empty for
   *  a plain document-only draft or a manual link with no suggestion behind it. */
  candidateIds?: string[];
}

export interface MergeEvidence {
  document: MergeDocumentEvidence | null;
  statementLine: MergeStatementLineEvidence | null;
  /** A human's account of an amount disagreement, named only at accept —
   *  never derived by a matcher. */
  variance?: MergeVariance;
}

/* ── Outputs ─────────────────────────────────────────────────────────────── */

export interface MergeSplit {
  accountId: string;
  amount: Money;
  taxCodeId: string | null;
  gstAmount: Money;
  description: string | null;
}

export interface DraftSpec {
  /** `null` only when there is no document `issue_date` AND no statement
   *  line — the one case the caller still resolves with SQL `current_date`. */
  txnDate: string | null;
  settledDate: string | null;
  source: 'scan' | 'import';
  payeeId: string | null;
  memo: string | null;
  currency: string;
  splits: MergeSplit[];
  externalRefs: Record<string, unknown>;
}

export type MergeRefusal =
  | { ok: false; reason: 'no_evidence' }
  | { ok: false; reason: 'amount_disagreement'; documentAmount: Money; lineAmount: Money }
  | { ok: false; reason: 'currency_mismatch'; documentCurrency: string; lineCurrency: string };

export type MergeOutcome = { ok: true; draft: DraftSpec } | MergeRefusal;

/* ── Tax codes: the tenant's OWN country's, and only those ─────────────── */

/**
 * Peppol UNCL5305 category (BT-151) → the tax code for THIS tenant's country.
 *
 * Moved here from `transactions.repo.ts` verbatim (R5b, `docs/STATEMENTS.md`
 * §5.3.1: "the merge must not inherit this [collision]; R5b fixes it at the
 * shared helper"). The standard-rated code differs per jurisdiction — `GST`
 * in Australia, `PPN` in Indonesia — and returning a bare `'GST'` here was
 * half of a real collision fixed by 333ea50: `loadTaxCodes` used to select
 * every global row and key a `Map` by `code` alone, so `N-T` (present in both
 * the AU and ID sets) silently overwrote itself, and `taxCodeFor('S')` handed
 * an Indonesian tenant the Australian `GST` code. `loadTaxCodes`
 * (`transactions.repo.ts`, unchanged by this file) now selects only the
 * caller's own country's rows, so this function's `country` parameter is
 * genuinely load-bearing rather than decorative — `caller passes the wrong
 * country, gets the wrong code` is still possible, but `caller passes the
 * right country, gets a code from the WRONG country's set` cannot happen once
 * this and `loadTaxCodes` agree on `country`.
 *
 * `S` (standard) is the only rate this maps to a capital code for — and never
 * does, because nothing in the schema yet marks a purchase as capital; every
 * standard-rated purchase becomes non-capital `GST`/`PPN`.
 */
export function taxCodeFor(gstCategoryCode: string | null, country: string): string {
  const standard = country === 'ID' ? 'PPN' : 'GST';
  switch (gstCategoryCode) {
    case 'S':
      return standard;
    case 'Z':
      return country === 'ID' ? 'PPN-BEBAS' : 'FRE';
    case 'E':
      return country === 'ID' ? 'NON-PPN' : 'INP';
    default:
      return 'N-T';
  }
}

/* ── The merge rule itself ──────────────────────────────────────────────── */

function moneyEquals(a: Money, b: Money): boolean {
  return money.compare(a, b) === 0;
}

export function mergeObservations(evidence: MergeEvidence, rules: MergeRules): MergeOutcome {
  const { document, statementLine, variance } = evidence;

  if (!document && !statementLine) {
    return { ok: false, reason: 'no_evidence' };
  }

  if (document && statementLine && document.currency !== statementLine.currency) {
    return {
      ok: false,
      reason: 'currency_mismatch',
      documentCurrency: document.currency,
      lineCurrency: statementLine.currency,
    };
  }

  // txn_date: the receipt's issue_date; failing that, the line's value_date,
  // else its posted_date. Never current_date — that fallback, when it still
  // applies at all, lives in the caller's SQL, only for the document-only,
  // no-issue-date case (see file header).
  const txnDate: string | null =
    document?.issueDate ?? (statementLine ? statementLine.valueDate ?? statementLine.postedDate : null);

  // settled_date: the statement line's posted_date, verbatim — 0031 named the
  // column for exactly this, no transformation.
  const settledDate: string | null = statementLine?.postedDate ?? null;

  const source: 'scan' | 'import' = document ? 'scan' : 'import';
  const currency = document?.currency ?? statementLine!.currency;

  const payeeId = document?.supplierId ?? null;
  const memo = document
    ? document.documentNumber
      ? `${document.supplierName ?? 'Supplier'} — ${document.documentNumber}`
      : (document.supplierName ?? 'Scanned purchase')
    : (statementLine?.descriptionRaw ?? null);

  const splits: MergeSplit[] = [];
  let debitTotal: Money = money.ZERO;

  if (document) {
    // From the document, exactly as today: subtotals → tax codes → GST
    // control legs → rounding.
    for (const group of document.groups) {
      const code = taxCodeFor(group.categoryCode, rules.country);
      const taxCode = rules.taxCodes.get(code);

      splits.push({
        accountId: rules.accounts.expenseAccountId,
        amount: group.taxable,
        taxCodeId: taxCode?.id ?? null,
        gstAmount: group.tax,
        description: group.categoryCode ? `Purchases — ${group.categoryCode}` : 'Purchases',
      });
      debitTotal = money.add(debitTotal, group.taxable);

      if (!money.isZero(group.tax)) {
        const claimable = (taxCode?.claims_credit ?? false) && document.isTaxInvoice === true;
        splits.push({
          accountId: claimable ? rules.accounts.gstReceivableAccountId : rules.accounts.gstUnclaimableAccountId,
          amount: group.tax,
          taxCodeId: null, // control posting — excluded from BAS aggregation, never double-counted
          gstAmount: money.ZERO,
          description: claimable ? 'GST receivable' : 'GST — not claimable (no valid tax invoice)',
        });
        debitTotal = money.add(debitTotal, group.tax);
      }
    }

    if (!money.isZero(document.roundingAmount)) {
      splits.push({
        accountId: rules.accounts.roundingAccountId,
        amount: document.roundingAmount,
        taxCodeId: null,
        gstAmount: money.ZERO,
        description: 'Cash rounding',
      });
      debitTotal = money.add(debitTotal, document.roundingAmount);
    }
  } else if (statementLine) {
    // No document: one split, uncategorised. The split's sign is the
    // NEGATION of amount_signed so it balances the payment leg below, which
    // takes amount_signed unflipped — R5d's own worked examples:
    //   -84.20 line -> Uncategorised Purchases +84.20 / account -84.20
    //  +2500.00 line -> account +2500.00 / Uncategorised Receipts -2500.00
    const isMoneyOut = money.compare(statementLine.amountSigned, money.ZERO) < 0;
    const splitAmount = money.negate(statementLine.amountSigned);
    splits.push({
      accountId: isMoneyOut ? rules.accounts.uncategorisedExpenseAccountId : rules.accounts.uncategorisedIncomeAccountId,
      amount: splitAmount,
      taxCodeId: null,
      gstAmount: money.ZERO,
      description: statementLine.descriptionRaw,
    });
    debitTotal = splitAmount;
  }

  // Amount authority is the statement line. sum(debit side) must equal
  // -amount_signed; a disagreement is a refusal unless a human names a
  // variance_kind, in which case one extra split absorbs the difference.
  if (document && statementLine) {
    const expected = money.negate(statementLine.amountSigned);
    if (!moneyEquals(debitTotal, expected)) {
      if (!variance) {
        return {
          ok: false,
          reason: 'amount_disagreement',
          documentAmount: debitTotal,
          lineAmount: statementLine.amountSigned,
        };
      }
      const residual = money.subtract(expected, debitTotal);
      if (!money.isZero(residual)) {
        splits.push({
          accountId: rules.accounts.varianceAccountId,
          amount: residual,
          taxCodeId: rules.taxCodes.get(taxCodeFor(null, rules.country))?.id ?? null,
          gstAmount: money.ZERO,
          description: `Payment variance — ${variance.kind}`,
        });
        debitTotal = money.add(debitTotal, residual);
      }
    }
  }

  // The payment leg. With a statement line: its amount_signed, straight into
  // the resolved account, no sign flip — 0031's stated promise, and exact by
  // construction once the debit side above equals -amount_signed. Without one:
  // ordinary double-entry, the negation of whatever the debit side came to.
  const paymentAmount = statementLine ? statementLine.amountSigned : money.negate(debitTotal);
  splits.push({
    accountId: rules.accounts.paymentAccountId,
    amount: paymentAmount,
    taxCodeId: null,
    gstAmount: money.ZERO,
    description: document
      ? document.documentNumber
        ? `Payable — ${document.documentNumber}`
        : 'Payable'
      : statementLine!.descriptionRaw,
  });

  return {
    ok: true,
    draft: {
      txnDate,
      settledDate,
      source,
      payeeId,
      memo,
      currency,
      splits,
      externalRefs: {
        merge: {
          ruleVersion: rules.ruleVersion,
          candidateIds: rules.candidateIds ?? [],
        },
      },
    },
  };
}
