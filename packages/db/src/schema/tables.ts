import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  char,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import {
  bytea,
  citext,
  confidence,
  countryCode,
  currencyCode,
  inet,
  moneyAmount,
  quantity,
  taxRate,
  unitPrice,
} from '../types';
import {
  accountType,
  billingProvider,
  firmRole,
  captureStatus,
  docType,
  extractionEngine,
  gstBasis,
  pageSource,
  reviewStatus,
  runStatus,
  billStatus,
  invoiceKind,
  invoiceStatus,
  partyKind,
  paymentMethod,
  stockMovementKind,
  subStatus,
  tenantKind,
  txnSource,
  txnStatus,
} from './enums';

/**
 * Drizzle declarations mirroring `migrations/*.sql`.
 *
 * THE SQL IS THE SOURCE OF TRUTH — these declarations are the typed query layer
 * over it, not the schema author. `drizzle-kit generate` is deliberately NOT the
 * migration author here, because the schema uses domains, plpgsql functions,
 * deferrable constraint triggers, RLS policies and security_invoker views that
 * no ORM DSL expresses.
 *
 * The gap that creates — declarations drifting from SQL — is closed by
 * `test/drift.test.ts`, which applies the migrations and compares every declared
 * table and column against `information_schema`.
 *
 * Constraints, triggers, policies and partial indexes are intentionally absent
 * below: they live in SQL and are verified by tests, not restated here.
 */

// ── Tenancy & identity (0002) ──────────────────────────────────────────────

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  abn: char('abn', { length: 11 }),
  // Generated column backed by the IMMUTABLE abn_is_valid() plpgsql function.
  abnValid: boolean('abn_valid').generatedAlwaysAs(sql`abn_is_valid(abn)`),
  /** business or personal (0012). Decides whether this workspace has a BAS. */
  kind: tenantKind('kind').notNull().default('business'),
  gstRegistered: boolean('gst_registered').notNull().default(false),
  gstBasis: gstBasis('gst_basis').notNull().default('cash'),
  simplerBas: boolean('simpler_bas').notNull().default(true),
  country: countryCode('country').notNull(),
  baseCurrency: currencyCode('base_currency').notNull(),
  financialYearStartMonth: smallint('financial_year_start_month').notNull().default(7),
  /** A `@snap/tax-engine` PROFILES key: 'truckie_long', 'nurse', 'sole', … */
  occupationProfileId: text('occupation_profile_id'),
  /** The practice that owns this client, or NULL for a direct-plan tenant (0011). */
  firmId: uuid('firm_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  /**
   * External IdP subject, or `pwd|<email>` for an account that registered with
   * a password.
   *
   * The comment here used to read "No password ever lands in this database."
   * Migration 0025 reversed that, and records why: no mail transport is
   * configured, so the magic link is generated and never sent, and Google
   * answers 501 without credentials. Passwords were the only remaining way
   * into an internal build.
   */
  subject: text('subject').notNull().unique(),
  email: citext('email'),
  displayName: text('display_name'),
  /**
   * Self-describing KDF string from `apps/server/src/auth/passwords.ts`.
   *
   * NULL for every account that arrived through an IdP or a magic link, which
   * is most of them. Never compared in SQL — verification is constant-time in
   * the application, and the only way this column is read at all is
   * `identity_password_lookup`, because the app role cannot read `users`.
   */
  passwordHash: text('password_hash'),
  passwordUpdatedAt: timestamp('password_updated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable('memberships', {
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id').notNull(),
  role: text('role').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A pending membership (0012).
 *
 * The token is stored only as a SHA-256: a database disclosure must not hand
 * out working join links, for the same reason a password is never stored.
 */
export const invitations = pgTable('invitations', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  email: citext('email').notNull(),
  role: text('role').notNull(),
  tokenHash: bytea('token_hash').notNull(),
  invitedBy: uuid('invited_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  acceptedBy: uuid('accepted_by'),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

export const apiClients = pgTable('api_clients', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  keyPrefix: text('key_prefix').notNull(),
  keyHash: bytea('key_hash').notNull(),
  scopes: text('scopes').array().notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Capture & extraction (0003) ────────────────────────────────────────────

export const captures = pgTable('captures', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  uploadedBy: uuid('uploaded_by'),
  /** Written once, never modified. This is the ATO legal record. */
  originalStorageKey: text('original_storage_key').notNull(),
  originalMimeType: text('original_mime_type').notNull(),
  originalByteSize: bigint('original_byte_size', { mode: 'bigint' }).notNull(),
  originalSha256: bytea('original_sha256').notNull(),
  /** Derivative sent to the model: deskewed, EXIF-stripped, <=1568px. */
  normalisedStorageKey: text('normalised_storage_key'),
  phash: bigint('phash', { mode: 'bigint' }),
  pageCount: integer('page_count').notNull().default(1),
  capturedAt: timestamp('captured_at', { withTimezone: true }),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  deviceMeta: jsonb('device_meta').notNull(),
  legibilityScore: confidence('legibility_score'),
  status: captureStatus('status').notNull().default('received'),
  retentionUntil: date('retention_until'),
});

export const extractionRuns = pgTable('extraction_runs', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  captureId: uuid('capture_id').notNull(),
  engine: extractionEngine('engine').notNull(),
  modelId: text('model_id'),
  promptVersion: text('prompt_version').notNull(),
  schemaVersion: text('schema_version').notNull(),
  tier: smallint('tier').notNull().default(1),
  status: runStatus('status').notNull().default('queued'),
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  latencyMs: integer('latency_ms'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  cachedTokens: integer('cached_tokens'),
  /** Per-scan cost accounting. Without this you cannot answer what a scan costs. */
  costMicros: bigint('cost_micros', { mode: 'bigint' }),
  rawResponse: jsonb('raw_response'),
  validatorReport: jsonb('validator_report'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Multi-page captures (0018) ─────────────────────────────────────────────

export const capturePages = pgTable('capture_pages', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  captureId: uuid('capture_id').notNull(),
  pageNumber: integer('page_number').notNull(),
  storageKey: text('storage_key').notNull(),
  mimeType: text('mime_type').notNull(),
  byteSize: bigint('byte_size', { mode: 'bigint' }).notNull(),
  sha256: bytea('sha256').notNull(),
  width: integer('width'),
  height: integer('height'),
  source: pageSource('source').notNull().default('capture'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── DocDOM layouts, shadow stage (0019) ─────────────────────────────────────

/**
 * Pointer + small index over a DocDOM written to object storage
 * (`docs/OCR.md` §5.7). See migration 0019 for why several rows per capture
 * are expected and what `shadow` means.
 */
export const documentLayouts = pgTable('document_layouts', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  captureId: uuid('capture_id').notNull(),
  extractionRunId: uuid('extraction_run_id'),
  storageKey: text('storage_key').notNull(),
  docdomVersion: text('docdom_version').notNull(),
  pageCount: integer('page_count').notNull(),
  /** Which engines contributed, for "what read this" without fetching the JSON. */
  engineIds: text('engine_ids').array().notNull().default(sql`'{}'::text[]`),
  spanCount: integer('span_count').notNull().default(0),
  unreadableCount: integer('unreadable_count').notNull().default(0),
  /** Shadow runs are advisory. A layout that fed a real document is not. */
  shadow: boolean('shadow').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Field grounding, shadow stage (0020) ────────────────────────────────────

/**
 * Per-field grounding of an extraction against a layout's DocDOM
 * (`packages/docai/src/grounding.ts`): does an independent OCR reading of the
 * same pixels support the value the extraction produced. See migration 0020
 * for the grounded/box CHECK invariant and why `UNIQUE (layout_id,
 * field_path)` means update-on-reground rather than accumulate — the same
 * shape `document_lines` (0004) uses for `replaceLines`.
 */
export const documentFieldGrounding = pgTable('document_field_grounding', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  captureId: uuid('capture_id').notNull(),
  layoutId: uuid('layout_id').notNull(),
  /** Schema path, the same vocabulary as `documents.locked_fields`. */
  fieldPath: text('field_path').notNull(),
  value: text('value').notNull(),
  grounded: boolean('grounded').notNull(),
  /** Empty when ungrounded — never null. */
  spanIds: text('span_ids').array().notNull().default(sql`'{}'::text[]`),
  box: jsonb('box'),
  page: integer('page'),
  /**
   * NUMERIC(5,4), not the shared `confidence` domain (NUMERIC(4,3), see
   * `../types.ts`) — the frozen contract (`docs/contracts/
   * phase1c-grounding.md` §2) specifies this precision directly, one decimal
   * digit finer than the domain, for the weakest-span confidence DocDOM's OCR
   * engines report. A plain column, not a new domain, because the contract
   * writes it as one and nothing else in the schema shares this precision.
   */
  confidence: numeric('confidence', { precision: 5, scale: 4 }).notNull().default('0'),
  /** False while grounding is advisory. The switch for §2's decision. */
  enforced: boolean('enforced').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Parties & documents (0004) ─────────────────────────────────────────────

export const parties = pgTable('parties', {
  id: uuid('id').primaryKey(),
  /** customer, supplier, or both (0013). */
  kind: partyKind('kind').notNull().default('supplier'),
  tenantId: uuid('tenant_id').notNull(),
  legalName: text('legal_name').notNull(),
  tradingName: text('trading_name'),
  nameNormalised: text('name_normalised').notNull(),
  abn: char('abn', { length: 11 }),
  abnValid: boolean('abn_valid').generatedAlwaysAs(sql`abn_is_valid(abn)`),
  /** Set only after a real ABR Lookup call — never inferred. */
  abnVerifiedAt: timestamp('abn_verified_at', { withTimezone: true }),
  abnStatus: text('abn_status'),
  gstRegistered: boolean('gst_registered'),
  acn: char('acn', { length: 9 }),
  addressLine1: text('address_line1'),
  addressLine2: text('address_line2'),
  city: text('city'),
  state: text('state'),
  postcode: text('postcode'),
  country: countryCode('country').notNull(),
  email: text('email'),
  phone: text('phone'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const documents = pgTable('documents', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  captureId: uuid('capture_id').notNull(),
  currentRunId: uuid('current_run_id'),
  docType: docType('doc_type').notNull().default('unknown'),
  /** BT-3, UNCL1001. NULL when the document is not Peppol-exportable. */
  documentTypeCode: text('document_type_code'),
  /** Set by the validators. GATES GST CREDIT CLAIMS — see v_bas_lines. */
  isTaxInvoice: boolean('is_tax_invoice').notNull().default(false),
  atoCompliance: jsonb('ato_compliance').notNull(),
  documentNumber: text('document_number'),
  issueDate: date('issue_date'),
  dueDate: date('due_date'),
  currency: currencyCode('currency').notNull(),
  supplierId: uuid('supplier_id'),
  buyerId: uuid('buyer_id'),
  lineExtensionAmount: moneyAmount('line_extension_amount'),
  taxExclusiveAmount: moneyAmount('tax_exclusive_amount'),
  taxAmount: moneyAmount('tax_amount'),
  taxInclusiveAmount: moneyAmount('tax_inclusive_amount'),
  roundingAmount: moneyAmount('rounding_amount').notNull(),
  payableAmount: moneyAmount('payable_amount'),
  paymentMethod: text('payment_method'),
  /** Masked PAN only. Storing a full PAN would drag this into PCI-DSS scope. */
  cardLast4: char('card_last4', { length: 4 }),
  cardBrand: text('card_brand'),
  reviewStatus: reviewStatus('review_status').notNull().default('needs_review'),
  confidenceOverall: confidence('confidence_overall'),
  fieldProvenance: jsonb('field_provenance').notNull(),
  dedupGroupId: uuid('dedup_group_id'),
  retentionUntil: date('retention_until'),
  /** Field paths a human confirmed. A machine run may not release these (0009). */
  lockedFields: text('locked_fields').array().notNull(),
  reviewedBy: uuid('reviewed_by'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  /** Attribution, for a workspace with more than one member (0012). */
  createdBy: uuid('created_by'),
  confirmedBy: uuid('confirmed_by'),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  /** 'shared' | 'private'. Private items still count toward household totals. */
  visibility: text('visibility').notNull().default('shared'),
  /** Optimistic concurrency: bumped by a trigger on every real change. */
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const documentLines = pgTable('document_lines', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  documentId: uuid('document_id').notNull(),
  lineNumber: integer('line_number').notNull(),
  description: text('description'),
  itemCode: text('item_code'),
  quantity: quantity('quantity'),
  /** BT-130, UN/ECE Rec 20: EA, LTR, KGM, HUR. */
  unitCode: text('unit_code'),
  unitPrice: unitPrice('unit_price'),
  lineNetAmount: moneyAmount('line_net_amount'),
  discountAmount: moneyAmount('discount_amount').notNull(),
  /** BT-151, UNCL5305: S standard, Z GST-free, E exempt, O out of scope. */
  gstCategoryCode: text('gst_category_code'),
  gstRate: taxRate('gst_rate'),
  gstAmount: moneyAmount('gst_amount'),
  categoryId: uuid('category_id'),
  lineConfidence: confidence('line_confidence'),
});

export const documentTaxSubtotals = pgTable('document_tax_subtotals', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  documentId: uuid('document_id').notNull(),
  categoryCode: text('category_code').notNull(),
  rate: taxRate('rate').notNull(),
  taxableAmount: moneyAmount('taxable_amount').notNull(),
  taxAmount: moneyAmount('tax_amount').notNull(),
});

export const documentFieldCorrections = pgTable('document_field_corrections', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  documentId: uuid('document_id').notNull(),
  fieldPath: text('field_path').notNull(),
  oldValue: text('old_value'),
  newValue: text('new_value'),
  fromRunId: uuid('from_run_id'),
  correctedBy: uuid('corrected_by'),
  correctedAt: timestamp('corrected_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Accounts, categories, tax codes (0005) ─────────────────────────────────

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  accountType: accountType('account_type').notNull(),
  parentId: uuid('parent_id'),
  /** Capital assets drive BAS G10 vs G11. */
  isCapital: boolean('is_capital').notNull().default(false),
  externalRefs: jsonb('external_refs').notNull(),
  isArchived: boolean('is_archived').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  parentId: uuid('parent_id'),
  defaultAccountId: uuid('default_account_id'),
  defaultTaxCodeId: uuid('default_tax_code_id'),
  /** `@snap/tax-engine` target row: 'D1.logbook.fuel', 'D3.laundry', … */
  engineRowId: text('engine_row_id'),
  atoDeductionCode: text('ato_deduction_code'),
  /**
   * False retires the category: it stops being offered for new documents and
   * stays attached to every document that already carries it. Categories are
   * never deleted — `document_lines.category_id` references them from records
   * with a five-year retention obligation.
   */
  active: boolean('active').notNull().default(true),
});

export const taxCodes = pgTable('tax_codes', {
  id: uuid('id').primaryKey(),
  /** NULL = system-seeded, readable by every tenant. */
  tenantId: uuid('tenant_id'),
  code: text('code').notNull(),
  name: text('name').notNull(),
  rate: taxRate('rate').notNull(),
  /** e.g. {G11,1B} */
  purchaseLabels: text('purchase_labels').array().notNull(),
  /** e.g. {G1,1A} */
  saleLabels: text('sale_labels').array().notNull(),
  /** true => a valid tax invoice is required to claim the credit. */
  claimsCredit: boolean('claims_credit').notNull().default(false),
  externalRefs: jsonb('external_refs').notNull(),
});

// ── Ledger (0006) ──────────────────────────────────────────────────────────

export const transactions = pgTable('transactions', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  txnDate: date('txn_date').notNull(),
  /** Cash-basis GST filters on this. */
  settledDate: date('settled_date'),
  payeeId: uuid('payee_id'),
  memo: text('memo'),
  reference: text('reference'),
  currency: currencyCode('currency').notNull(),
  status: txnStatus('status').notNull().default('draft'),
  source: txnSource('source').notNull().default('manual'),
  /** Evidence, kept for the life of the record. */
  documentId: uuid('document_id'),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  postedBy: uuid('posted_by'),
  voidedAt: timestamp('voided_at', { withTimezone: true }),
  voidReason: text('void_reason'),
  externalRefs: jsonb('external_refs').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const transactionSplits = pgTable('transaction_splits', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  transactionId: uuid('transaction_id').notNull(),
  lineNumber: integer('line_number').notNull(),
  accountId: uuid('account_id').notNull(),
  /** Signed: debits positive, credits negative. Posted splits must sum to zero. */
  amount: moneyAmount('amount').notNull(),
  /** NOT NULL => BAS-reportable. NULL => GST control posting or transfer leg. */
  taxCodeId: uuid('tax_code_id'),
  gstAmount: moneyAmount('gst_amount').notNull(),
  categoryId: uuid('category_id'),
  documentLineId: uuid('document_line_id'),
  description: text('description'),
});

// ── Operations (0007) ──────────────────────────────────────────────────────

export const reviewTasks = pgTable('review_tasks', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  documentId: uuid('document_id'),
  transactionId: uuid('transaction_id'),
  /** 'gst_arithmetic_failed', 'abn_invalid', 'possible_duplicate', … */
  reason: text('reason').notNull(),
  detail: jsonb('detail').notNull(),
  priority: smallint('priority').notNull().default(5),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolvedBy: uuid('resolved_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Append-only. UPDATE and DELETE are revoked in 0010, not merely policy-blocked. */
export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  tenantId: uuid('tenant_id'),
  actorType: text('actor_type').notNull(),
  actorId: uuid('actor_id'),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id'),
  before: jsonb('before'),
  after: jsonb('after'),
  requestId: text('request_id'),
  ip: inet('ip'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});

export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey(),
  /** NULL = system job. The worker role can see those; tenants cannot. */
  tenantId: uuid('tenant_id'),
  kind: text('kind').notNull(),
  payload: jsonb('payload').notNull(),
  runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(5),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  lockedBy: text('locked_by'),
  lastError: text('last_error'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const idempotencyKeys = pgTable('idempotency_keys', {
  tenantId: uuid('tenant_id').notNull(),
  key: text('key').notNull(),
  requestHash: bytea('request_hash').notNull(),
  responseCode: integer('response_code'),
  responseBody: jsonb('response_body'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const webhookEndpoints = pgTable('webhook_endpoints', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  url: text('url').notNull(),
  /** HMAC signing key, encrypted at rest. */
  secret: bytea('secret').notNull(),
  events: text('events').array().notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: uuid('id').primaryKey(),
  endpointId: uuid('endpoint_id').notNull(),
  event: text('event').notNull(),
  payload: jsonb('payload').notNull(),
  attempts: integer('attempts').notNull().default(0),
  statusCode: integer('status_code'),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const accountingConnections = pgTable('accounting_connections', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  provider: text('provider').notNull(),
  externalTenantId: text('external_tenant_id').notNull(),
  /** AEAD ciphertext, KMS-wrapped DEK. Money-adjacent credentials. */
  accessToken: bytea('access_token').notNull(),
  refreshToken: bytea('refresh_token').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  scopes: text('scopes').array().notNull(),
  connectedBy: uuid('connected_by'),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Billing & usage (0008) ─────────────────────────────────────────────────

export const plans = pgTable('plans', {
  id: uuid('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  /** AUD, GST-INCLUSIVE (consumer convention). */
  priceCents: integer('price_cents').notNull(),
  currency: currencyCode('currency').notNull(),
  /** NULL = unmetered. */
  scanQuota: integer('scan_quota'),
  seatLimit: integer('seat_limit').notNull().default(1),
  /** false => batch tier: slower, never less accurate. */
  realtime: boolean('realtime').notNull().default(true),
  retentionMonths: integer('retention_months').notNull().default(60),
  features: jsonb('features').notNull(),
  isActive: boolean('is_active').notNull().default(true),
});

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey(),
  /** Exactly one of tenantId / firmId is set — enforced by a CHECK in 0011. */
  tenantId: uuid('tenant_id'),
  firmId: uuid('firm_id'),
  /** Practice plans bill per client seat. */
  seats: integer('seats'),
  planId: uuid('plan_id').notNull(),
  status: subStatus('status').notNull().default('trialing'),
  provider: billingProvider('provider').notNull(),
  externalId: text('external_id'),
  currentPeriodStart: timestamp('current_period_start', { withTimezone: true }).notNull(),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }).notNull(),
  cancelAt: timestamp('cancel_at', { withTimezone: true }),
  canceledAt: timestamp('canceled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Fast pre-flight counter. `extraction_runs` stays the source of truth. */
export const usageCounters = pgTable('usage_counters', {
  tenantId: uuid('tenant_id').notNull(),
  periodStart: date('period_start').notNull(),
  metric: text('metric').notNull(),
  used: integer('used').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Top-up packs and goodwill credits, consumed after the plan quota. */
export const usageGrants = pgTable('usage_grants', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  metric: text('metric').notNull().default('scans'),
  amount: integer('amount').notNull(),
  remaining: integer('remaining').notNull(),
  source: text('source').notNull(),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
});

// ── Practices (0011) ──────────────────────────────────────────────────────

export const firms = pgTable('firms', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  abn: char('abn', { length: 11 }),
  abnValid: boolean('abn_valid').generatedAlwaysAs(sql`abn_is_valid(abn)`),
  /** Tax Practitioners Board registration — whose number stands behind the BAS. */
  taxAgentNumber: text('tax_agent_number'),
  country: countryCode('country').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const firmMemberships = pgTable('firm_memberships', {
  firmId: uuid('firm_id').notNull(),
  userId: uuid('user_id').notNull(),
  role: firmRole('role').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ── The business side (0014) ───────────────────────────────────────────────
   What you sell, what you are owed, what you owe, the trips you drove, and
   what a household intends to spend. Every amount is a NUMERIC domain, never
   a float: a cent lost to binary floating point is a BAS that does not
   reconcile, and it is unrecoverable after the fact. */

export const items = pgTable('items', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  sku: text('sku'),
  unit: text('unit').notNull().default('ea'),
  /** Ex-GST. On a sale GST is ADDED — the inverse of a purchase receipt. */
  sellPrice: unitPrice('sell_price').notNull(),
  costPrice: unitPrice('cost_price').notNull(),
  /** NULL means a service, which is not the same as none in stock. */
  stockOnHand: quantity('stock_on_hand'),
  lowStockAt: quantity('low_stock_at').notNull(),
  taxCode: text('tax_code').notNull().default('GSTONINCOME'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const stockMovements = pgTable('stock_movements', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  itemId: uuid('item_id').notNull(),
  kind: stockMovementKind('kind').notNull(),
  /** Signed: negative is stock leaving. */
  quantity: quantity('quantity').notNull(),
  note: text('note'),
  byUser: uuid('by_user'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});

export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  number: text('number').notNull(),
  kind: invoiceKind('kind').notNull().default('invoice'),
  status: invoiceStatus('status').notNull().default('draft'),
  partyId: uuid('party_id').notNull(),
  issueDate: date('issue_date').notNull(),
  dueDate: date('due_date').notNull(),
  /**
   * Stored, not only derived. These are what was SENT to a customer; recomputing
   * from the lines would silently rewrite a document someone has already paid.
   */
  netAmount: moneyAmount('net_amount').notNull(),
  gstAmount: moneyAmount('gst_amount').notNull(),
  totalAmount: moneyAmount('total_amount').notNull(),
  /** The estimate this was copied from. The estimate itself is never mutated. */
  convertedFrom: uuid('converted_from'),
  notes: text('notes'),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  voidedAt: timestamp('voided_at', { withTimezone: true }),
});

export const invoiceLines = pgTable('invoice_lines', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  invoiceId: uuid('invoice_id').notNull(),
  lineNumber: integer('line_number').notNull(),
  itemId: uuid('item_id'),
  description: text('description').notNull(),
  unit: text('unit').notNull().default('ea'),
  quantity: quantity('quantity').notNull(),
  unitPrice: unitPrice('unit_price').notNull(),
  netAmount: moneyAmount('net_amount').notNull(),
  gstAmount: moneyAmount('gst_amount').notNull(),
  totalAmount: moneyAmount('total_amount').notNull(),
});

export const payments = pgTable('payments', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  /** Always against an invoice: that is what lets "outstanding" be derived. */
  invoiceId: uuid('invoice_id').notNull(),
  paidOn: date('paid_on').notNull(),
  amount: moneyAmount('amount').notNull(),
  method: paymentMethod('method').notNull().default('bank'),
  reference: text('reference'),
  recordedBy: uuid('recorded_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const bills = pgTable('bills', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  supplierId: uuid('supplier_id'),
  reference: text('reference'),
  issueDate: date('issue_date').notNull(),
  dueDate: date('due_date').notNull(),
  totalAmount: moneyAmount('total_amount').notNull(),
  gstAmount: moneyAmount('gst_amount').notNull(),
  amountPaid: moneyAmount('amount_paid').notNull(),
  status: billStatus('status').notNull().default('unpaid'),
  category: text('category'),
  /** Set when a receipt for this bill is captured: obligation meets proof. */
  documentId: uuid('document_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const trips = pgTable('trips', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  tripDate: date('trip_date').notNull(),
  fromPlace: text('from_place').notNull(),
  toPlace: text('to_place').notNull(),
  km: quantity('km').notNull(),
  purpose: text('purpose'),
  /** False for private travel, including the commute. */
  workRelated: boolean('work_related').notNull().default(true),
  /** 'gps' or 'manual' — a logbook should say how it was measured. */
  source: text('source').notNull().default('manual'),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const budgets = pgTable('budgets', {
  tenantId: uuid('tenant_id').notNull(),
  category: text('category').notNull(),
  monthly: moneyAmount('monthly').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const goals = pgTable('goals', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  target: moneyAmount('target').notNull(),
  saved: moneyAmount('saved').notNull(),
  targetDate: date('target_date'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
