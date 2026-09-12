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
