import { pgEnum } from 'drizzle-orm/pg-core';

/* Names and members must match migrations/0001 and 0008 exactly. The drift test
   compares these against pg_enum, so a typo fails the build rather than a query. */

export const captureStatus = pgEnum('capture_status', [
  'received',
  'processing',
  'extracted',
  'failed',
  'quarantined',
]);

export const docType = pgEnum('doc_type', [
  'tax_invoice',
  'invoice',
  'receipt',
  'credit_note',
  'statement',
  'unknown',
]);

export const reviewStatus = pgEnum('review_status', [
  'auto_accepted',
  'needs_review',
  'reviewed',
  'rejected',
]);

export const extractionEngine = pgEnum('extraction_engine', [
  'claude_vision',
  'claude_text',
  'ocr_llm',
  'manual',
  'import',
]);

export const runStatus = pgEnum('run_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
  'superseded',
]);

export const accountType = pgEnum('account_type', [
  'asset',
  'liability',
  'equity',
  'income',
  'expense',
]);

export const txnStatus = pgEnum('txn_status', ['draft', 'posted', 'void']);

export const txnSource = pgEnum('txn_source', [
  'scan',
  'manual',
  'import',
  'bank_feed',
  'recurring',
]);

export const gstBasis = pgEnum('gst_basis', ['cash', 'accrual']);

export const subStatus = pgEnum('sub_status', [
  'trialing',
  'active',
  'past_due',
  'canceled',
  'paused',
]);

export const billingProvider = pgEnum('billing_provider', [
  'stripe',
  'apple',
  'google',
  'manual',
]);

export const firmRole = pgEnum('firm_role', ['owner', 'admin', 'staff']);

/**
 * What a workspace is for (0012).
 *
 * Not cosmetic: a personal workspace has no ABN, cannot be GST-registered and
 * has no BAS, which the tenants table enforces with a CHECK.
 */
export const tenantKind = pgEnum('tenant_kind', ['business', 'personal']);

/**
 * What a party is to you (0013).
 *
 * `both` exists because the same entity often is: a fuel company you buy from
 * and also cart for.
 */
export const partyKind = pgEnum('party_kind', ['customer', 'supplier', 'both']);

/* ── The business side (0014) ───────────────────────────────────────────── */

/** A count records the DIFFERENCE it caused, so the history explains the balance. */
export const stockMovementKind = pgEnum('stock_movement_kind', [
  'count',
  'sale',
  'purchase',
  'adjustment',
]);

export const invoiceKind = pgEnum('invoice_kind', ['invoice', 'estimate']);

export const invoiceStatus = pgEnum('invoice_status', [
  'draft',
  'sent',
  'paid',
  'overdue',
  'void',
]);

export const paymentMethod = pgEnum('payment_method', ['bank', 'card', 'cash', 'other']);

export const billStatus = pgEnum('bill_status', ['unpaid', 'paid', 'overdue', 'void']);

/**
 * Where a page's bytes came from (0018).
 *
 * 'capture' is the ordinary camera path. The other two exist only once a PDF
 * has been demuxed: a digital-native PDF keeps its text layer as 'pdf_native'
 * and is rasterised too (the twin needs pixels either way); a scanned PDF has
 * nothing to read but the render, so it is 'pdf_render'.
 */
export const pageSource = pgEnum('page_source', ['capture', 'pdf_native', 'pdf_render']);

/**
 * What told the app a savings-goal contribution happened (0030, widened
 * 0032, grounded 0033).
 *
 * 'manual' is the user typing a number in — a claim, not an observation.
 * 'opening_balance' was written exactly once, by migration 0030 itself, to
 * carry forward a pre-existing `goals.saved` figure honestly rather than
 * inventing history for it. 'statement_line' was added by 0032
 * (docs/STATEMENTS.md Lane R, ticket R5a) with nothing producing it yet;
 * 0033 (ticket R5f-1) is what lets the API actually write it — the CHECK
 * `(source = 'statement_line') = (source_statement_line_id IS NOT NULL)`,
 * the RESTRICT FK to `statement_lines`, and a trigger requiring the line be
 * money IN and never over-claimed across contributions grounded in it.
 */
export const contributionSource = pgEnum('contribution_source', [
  'manual',
  'opening_balance',
  'statement_line',
]);

/* ── Statements (0031, docs/STATEMENTS.md Lane T, ticket T3) ───────────── */

/**
 * What kind of account a `financial_accounts` row represents.
 *
 * Drives what a statement for it can plausibly carry — a credit_card
 * statement's opening/closing balance is a debt, not cash — but that
 * interpretation belongs to the code that reads these tables (Lane R / T4),
 * not to a CHECK in this schema.
 */
export const financialAccountType = pgEnum('financial_account_type', [
  'transaction',
  'savings',
  'credit_card',
  'ewallet',
]);

/**
 * A statement's balance-check verdict (docs/STATEMENTS.md §4, ticket T4).
 *
 * 'pending' is what 0031 itself writes on every row: T4 is the validator
 * that computes 'pass'/'residual', and T5 (CSV intake) is the documented
 * writer of 'unverifiable' for a CSV with no opening/closing balance to
 * check against. Neither writer exists yet.
 */
export const statementBalanceCheck = pgEnum('statement_balance_check', [
  'pending',
  'pass',
  'residual',
  'unverifiable',
]);

/* ── The observation register (0032, docs/STATEMENTS.md §5.3.1, Lane R ticket
   R5a) ──────────────────────────────────────────────────────────────────── */

/**
 * What kind of evidence an `event_observations` row points at.
 *
 * Exactly one of `document_id` / `statement_line_id` is set, matching the
 * kind — enforced by `event_observations_pointer_matches_kind` in SQL, not
 * restated here.
 */
export const observationKind = pgEnum('observation_kind', ['document', 'statement_line']);

/**
 * A `match_candidates` row's life cycle: `suggested -> accepted | rejected`,
 * `accepted -> unlinked`. Never re-suggested once decided — that is what the
 * pair-uniqueness constraint on the table is for.
 */
export const matchCandidateStatus = pgEnum('match_candidate_status', [
  'suggested',
  'accepted',
  'rejected',
  'unlinked',
]);

/** Who proposed a `match_candidates` row — the automated matcher, or a person making a manual link. */
export const matchProposer = pgEnum('match_proposer', ['matcher', 'user']);
