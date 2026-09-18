import { describe, expect, it } from 'vitest';

import { money, type Money } from '@snap/db';

import {
  mergeObservations,
  taxCodeFor,
  type MergeAccounts,
  type MergeDocumentEvidence,
  type MergeEvidence,
  type MergeRules,
  type MergeStatementLineEvidence,
  type TaxCodeRow,
} from './merge.js';

/**
 * `mergeObservations` as a PURE function — `docs/STATEMENTS.md` §5.3.1, Lane R
 * ticket R5b. No database in this file at all: every account id, every tax
 * code, is a fabricated fixture. That absence is the point — if this file
 * needed `DATABASE_URL` to prove the merge rule's arithmetic, the "same
 * evidence in, byte-identical splits out" property would not actually be
 * testable, only plausible.
 */

const ACCOUNTS: MergeAccounts = {
  expenseAccountId: 'acct-expense',
  gstReceivableAccountId: 'acct-gst-receivable',
  gstUnclaimableAccountId: 'acct-gst-unclaimable',
  roundingAccountId: 'acct-rounding',
  paymentAccountId: 'acct-payment',
  varianceAccountId: 'acct-variance',
  uncategorisedExpenseAccountId: 'acct-uncategorised-expense',
  uncategorisedIncomeAccountId: 'acct-uncategorised-income',
};

const AU_TAX_CODES = new Map<string, TaxCodeRow>([
  ['GST', { id: 'tax-au-gst', code: 'GST', claims_credit: true }],
  ['FRE', { id: 'tax-au-fre', code: 'FRE', claims_credit: false }],
  ['N-T', { id: 'tax-au-nt', code: 'N-T', claims_credit: false }],
]);

const ID_TAX_CODES = new Map<string, TaxCodeRow>([
  ['PPN', { id: 'tax-id-ppn', code: 'PPN', claims_credit: true }],
  ['PPN-BEBAS', { id: 'tax-id-bebas', code: 'PPN-BEBAS', claims_credit: false }],
  ['N-T', { id: 'tax-id-nt', code: 'N-T', claims_credit: false }],
]);

function auRules(over: Partial<MergeRules> = {}): MergeRules {
  return { taxCodes: AU_TAX_CODES, country: 'AU', accounts: ACCOUNTS, ruleVersion: 'test-1', ...over };
}

function idRules(over: Partial<MergeRules> = {}): MergeRules {
  return { taxCodes: ID_TAX_CODES, country: 'ID', accounts: ACCOUNTS, ruleVersion: 'test-1', ...over };
}

function m(v: string): Money {
  return money.money(v);
}

/** A confirmed AU tax invoice, $84.20 inclusive: $76.5455 taxable... rounded
 *  to whole-cent fixtures for legible assertions: $76.55 net + $7.65 GST. */
function receiptEvidence(over: Partial<MergeDocumentEvidence> = {}): MergeDocumentEvidence {
  return {
    issueDate: '2026-08-12',
    documentNumber: 'INV-001',
    supplierId: 'party-1',
    supplierName: 'Cafe Nice',
    currency: 'AUD',
    isTaxInvoice: true,
    roundingAmount: money.ZERO,
    groups: [{ categoryCode: 'S', taxable: m('76.5500'), tax: m('7.6500') }],
    ...over,
  };
}

function lineEvidence(over: Partial<MergeStatementLineEvidence> = {}): MergeStatementLineEvidence {
  return {
    postedDate: '2026-08-14',
    valueDate: null,
    amountSigned: m('-84.2000'), // money OUT: paid $84.20
    currency: 'AUD',
    descriptionRaw: 'CAFE NICE EFTPOS',
    accountId: 'acct-bank',
    ...over,
  };
}

describe('mergeObservations: purity', () => {
  it('same evidence in, byte-identical splits out — called twice, freshly built each time', () => {
    const build = (): [MergeEvidence, MergeRules] => [
      { document: receiptEvidence(), statementLine: lineEvidence(), variance: undefined },
      auRules(),
    ];
    const [ev1, rules1] = build();
    const [ev2, rules2] = build();
    // Deliberately NOT the same object references — a fresh structurally-equal
    // build each time, which is the only way this proves determinism rather
    // than object identity.
    expect(ev1).not.toBe(ev2);

    const out1 = mergeObservations(ev1, rules1);
    const out2 = mergeObservations(ev2, rules2);
    expect(out1).toEqual(out2);
    expect(out1.ok).toBe(true);
  });

  it('is pure across many independent calls, not just two', () => {
    const results = Array.from({ length: 5 }, () =>
      mergeObservations({ document: receiptEvidence(), statementLine: lineEvidence() }, auRules()),
    );
    for (const r of results) expect(r).toEqual(results[0]);
  });
});

describe('mergeObservations: dates', () => {
  it('txn_date is the receipt issue_date when a document is present', () => {
    const out = mergeObservations({ document: receiptEvidence(), statementLine: null }, auRules());
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.draft.txnDate).toBe('2026-08-12');
  });

  it('txn_date falls back to value_date ?? posted_date when the receipt has no issue_date, NEVER current_date', () => {
    const out = mergeObservations(
      {
        document: receiptEvidence({ issueDate: null }),
        statementLine: lineEvidence({ valueDate: '2026-08-13', postedDate: '2026-08-14' }),
      },
      auRules(),
    );
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.draft.txnDate).toBe('2026-08-13');
  });

  it('txn_date is posted_date when there is a line but no value_date either', () => {
    const out = mergeObservations(
      { document: receiptEvidence({ issueDate: null }), statementLine: lineEvidence({ valueDate: null }) },
      auRules(),
    );
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.draft.txnDate).toBe(lineEvidence().postedDate);
  });

  it('txn_date is null (the caller\'s SQL current_date fallback applies) only when there is no line and no issue_date', () => {
    const out = mergeObservations({ document: receiptEvidence({ issueDate: null }), statementLine: null }, auRules());
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.draft.txnDate).toBeNull();
  });

  it('settled_date is the line\'s posted_date, verbatim, and null with no line', () => {
    const withLine = mergeObservations({ document: receiptEvidence(), statementLine: lineEvidence() }, auRules());
    const withoutLine = mergeObservations({ document: receiptEvidence(), statementLine: null }, auRules());
    expect(withLine.ok && withLine.draft.settledDate).toBe('2026-08-14');
    expect(withoutLine.ok && withoutLine.draft.settledDate).toBeNull();
  });
});

describe('mergeObservations: source', () => {
  it("is 'scan' with a document, 'import' without", () => {
    const withDoc = mergeObservations({ document: receiptEvidence(), statementLine: lineEvidence() }, auRules());
    const withoutDoc = mergeObservations({ document: null, statementLine: lineEvidence() }, auRules());
    expect(withDoc.ok && withDoc.draft.source).toBe('scan');
    expect(withoutDoc.ok && withoutDoc.draft.source).toBe('import');
  });
});

describe('mergeObservations: the payment leg — no sign flip', () => {
  it("posts the line's amount_signed straight into the payment account when a line is present", () => {
    const out = mergeObservations({ document: receiptEvidence(), statementLine: lineEvidence() }, auRules());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const paymentSplit = out.draft.splits.find((s) => s.accountId === ACCOUNTS.paymentAccountId);
    expect(paymentSplit?.amount).toBe('-84.2000');
    // Splits still sum to zero — the ledger invariant, checked client-side.
    expect(money.balances(out.draft.splits.map((s) => s.amount))).toBe(true);
  });

  it('document-only: the payment leg is the negation of the debit total (unchanged pre-R5 behaviour)', () => {
    const out = mergeObservations({ document: receiptEvidence(), statementLine: null }, auRules());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const paymentSplit = out.draft.splits.find((s) => s.accountId === ACCOUNTS.paymentAccountId);
    // 76.55 + 7.65 = 84.20 debit total; payment leg is -84.20.
    expect(paymentSplit?.amount).toBe('-84.2000');
    expect(money.balances(out.draft.splits.map((s) => s.amount))).toBe(true);
  });
});

describe('mergeObservations: refusals', () => {
  it('refuses with no evidence at all', () => {
    const out = mergeObservations({ document: null, statementLine: null }, auRules());
    expect(out).toMatchObject({ ok: false, reason: 'no_evidence' });
  });

  it('refuses on a currency mismatch between the document and the line', () => {
    const out = mergeObservations(
      { document: receiptEvidence({ currency: 'AUD' }), statementLine: lineEvidence({ currency: 'USD' }) },
      auRules(),
    );
    expect(out).toMatchObject({ ok: false, reason: 'currency_mismatch', documentCurrency: 'AUD', lineCurrency: 'USD' });
  });

  it('refuses an amount disagreement with no variance_kind', () => {
    // Receipt says $84.20; the bank cleared $89.20 (a $5 tip).
    const out = mergeObservations(
      { document: receiptEvidence(), statementLine: lineEvidence({ amountSigned: m('-89.2000') }) },
      auRules(),
    );
    expect(out).toMatchObject({ ok: false, reason: 'amount_disagreement' });
    if (!out.ok && out.reason === 'amount_disagreement') {
      expect(out.documentAmount).toBe('84.2000');
      expect(out.lineAmount).toBe('-89.2000');
    }
  });
});

describe('mergeObservations: the variance split', () => {
  it("a -89.20 line accepted with variance_kind 'tip' adds exactly one +5.00 split to the variance account under N-T", () => {
    const out = mergeObservations(
      {
        document: receiptEvidence(),
        statementLine: lineEvidence({ amountSigned: m('-89.2000') }),
        variance: { kind: 'tip' },
      },
      auRules(),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    const varianceSplits = out.draft.splits.filter((s) => s.accountId === ACCOUNTS.varianceAccountId);
    expect(varianceSplits).toHaveLength(1);
    expect(varianceSplits[0]?.amount).toBe('5.0000');
    expect(varianceSplits[0]?.taxCodeId).toBe(AU_TAX_CODES.get('N-T')!.id);
    expect(varianceSplits[0]?.description).toContain('tip');

    // And the whole thing still balances to zero.
    expect(money.balances(out.draft.splits.map((s) => s.amount))).toBe(true);
    const paymentSplit = out.draft.splits.find((s) => s.accountId === ACCOUNTS.paymentAccountId);
    expect(paymentSplit?.amount).toBe('-89.2000');
  });

  it('a variance_kind that turns out to be exact (no residual) adds no split', () => {
    const out = mergeObservations(
      { document: receiptEvidence(), statementLine: lineEvidence(), variance: { kind: 'other' } },
      auRules(),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.draft.splits.some((s) => s.accountId === ACCOUNTS.varianceAccountId)).toBe(false);
  });
});

describe('mergeObservations: no document — R5d\'s worked examples', () => {
  it('a -84.20 line posts as Uncategorised Purchases +84.20 / account -84.20', () => {
    const out = mergeObservations(
      { document: null, statementLine: lineEvidence({ amountSigned: m('-84.2000') }) },
      auRules(),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const purchase = out.draft.splits.find((s) => s.accountId === ACCOUNTS.uncategorisedExpenseAccountId);
    const payment = out.draft.splits.find((s) => s.accountId === ACCOUNTS.paymentAccountId);
    expect(purchase?.amount).toBe('84.2000');
    expect(payment?.amount).toBe('-84.2000');
    expect(money.balances(out.draft.splits.map((s) => s.amount))).toBe(true);
  });

  it('a +2500.00 line posts as account +2500.00 / Uncategorised Receipts -2500.00', () => {
    const out = mergeObservations(
      { document: null, statementLine: lineEvidence({ amountSigned: m('2500.0000') }) },
      auRules(),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const receipt = out.draft.splits.find((s) => s.accountId === ACCOUNTS.uncategorisedIncomeAccountId);
    const payment = out.draft.splits.find((s) => s.accountId === ACCOUNTS.paymentAccountId);
    expect(receipt?.amount).toBe('-2500.0000');
    expect(payment?.amount).toBe('2500.0000');
    expect(money.balances(out.draft.splits.map((s) => s.amount))).toBe(true);
  });

  it('memo is the description_raw and payee is null with no document', () => {
    const out = mergeObservations({ document: null, statementLine: lineEvidence() }, auRules());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.draft.memo).toBe('CAFE NICE EFTPOS');
    expect(out.draft.payeeId).toBeNull();
  });
});

describe('mergeObservations: country-aware tax codes (the shared helper keeps R5a\'s fix)', () => {
  it("an Indonesian tenant's standard-rated document gets PPN, never GST", () => {
    const out = mergeObservations({ document: receiptEvidence(), statementLine: null }, idRules());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const taxable = out.draft.splits.find((s) => s.taxCodeId === ID_TAX_CODES.get('PPN')!.id);
    expect(taxable).toBeDefined();
    expect(out.draft.splits.some((s) => s.taxCodeId === AU_TAX_CODES.get('GST')!.id)).toBe(false);
  });

  it('an Australian tenant gets GST, never PPN, for the same category code', () => {
    const out = mergeObservations({ document: receiptEvidence(), statementLine: null }, auRules());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const taxable = out.draft.splits.find((s) => s.taxCodeId === AU_TAX_CODES.get('GST')!.id);
    expect(taxable).toBeDefined();
  });

  it("taxCodeFor('S', ...) is never a bare 'GST' for Indonesia — the exact collision R5a's design fixed", () => {
    expect(taxCodeFor('S', 'ID')).toBe('PPN');
    expect(taxCodeFor('S', 'AU')).toBe('GST');
    expect(taxCodeFor(null, 'ID')).toBe('N-T');
    expect(taxCodeFor(null, 'AU')).toBe('N-T');
  });
});

describe('mergeObservations: external_refs replay stamp', () => {
  it('stamps rule_version and candidate_ids', () => {
    const out = mergeObservations(
      { document: receiptEvidence(), statementLine: lineEvidence() },
      auRules({ ruleVersion: 'r5b.test', candidateIds: ['cand-1', 'cand-2'] }),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.draft.externalRefs).toEqual({
      merge: { ruleVersion: 'r5b.test', candidateIds: ['cand-1', 'cand-2'] },
    });
  });

  it('candidate_ids defaults to an empty array when omitted', () => {
    const out = mergeObservations({ document: receiptEvidence(), statementLine: null }, auRules());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.draft.externalRefs).toEqual({ merge: { ruleVersion: 'test-1', candidateIds: [] } });
  });
});

describe('mergeObservations: GST claimability, preserved from the pre-R5 rule', () => {
  it('a valid tax invoice posts claimable GST to the receivable account', () => {
    const out = mergeObservations({ document: receiptEvidence({ isTaxInvoice: true }), statementLine: null }, auRules());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.draft.splits.some((s) => s.accountId === ACCOUNTS.gstReceivableAccountId)).toBe(true);
    expect(out.draft.splits.some((s) => s.accountId === ACCOUNTS.gstUnclaimableAccountId)).toBe(false);
  });

  it('a document that is not a valid tax invoice never produces a claimable GST split', () => {
    const out = mergeObservations({ document: receiptEvidence({ isTaxInvoice: false }), statementLine: null }, auRules());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.draft.splits.some((s) => s.accountId === ACCOUNTS.gstUnclaimableAccountId)).toBe(true);
    expect(out.draft.splits.some((s) => s.accountId === ACCOUNTS.gstReceivableAccountId)).toBe(false);
  });
});
