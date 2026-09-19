/**
 * Wire types shared by the mobile app and the server.
 *
 * TYPES ONLY. No imports, no runtime code, nothing that survives compilation.
 * This is the only `@snap/*` package the mobile app may depend on — see
 * `test/boundaries.test.ts` at the repo root, which enforces that.
 *
 * Why the boundary matters more than bundle size: the tax engine's ATO rates
 * change every 1 July. If the engine shipped inside the app, a rate change
 * would need an App Store release, and every user who had not updated would
 * silently compute the wrong deductions for the new financial year. Server-side,
 * the annual rate update is a deploy.
 *
 * Money crosses the wire as a decimal STRING, never a number. A JSON float
 * cannot represent 110.10 exactly, and a BAS that is out by a cent is wrong.
 */

/** A decimal amount as a string, e.g. "110.0000". Never parse this to a number. */
export type MoneyString = string;
/** ISO 8601 date, `YYYY-MM-DD`. */
export type IsoDate = string;
/** ISO 8601 timestamp. */
export type IsoDateTime = string;

export type CaptureStatus =
  | 'received'
  | 'processing'
  | 'extracted'
  | 'failed'
  | 'quarantined';

export type DocType =
  | 'tax_invoice'
  | 'invoice'
  | 'receipt'
  | 'credit_note'
  | 'statement'
  | 'unknown';

export type ReviewStatus = 'auto_accepted' | 'needs_review' | 'reviewed' | 'rejected';

/** Where a page's bytes came from. 'capture' is the ordinary camera path; the
 *  other two only exist once a PDF has been demuxed (§4 of the multi-page
 *  capture contract).
 *
 *  Deliberately NO member for a CSV row dump (`docs/STATEMENTS.md` T5): a CSV
 *  statement never produces a rasterised page at all, so it never reaches
 *  `capture_pages` or this type — see the T5 report for why that is the
 *  resolution rather than an oversight. */
export type PageSource = 'capture' | 'pdf_native' | 'pdf_render';

/**
 * The balance-check verdict on a `statements` row (`docs/STATEMENTS.md` §4,
 * §5.6). `'unverifiable'` is not a soft synonym for `'pass'` — it is the
 * state a CSV with no printed opening/closing balance MUST land in, because
 * §4's identity has nothing to check. A client showing this to a person must
 * say so, not render it as if it were verified.
 */
export type StatementBalanceCheck = 'pending' | 'pass' | 'residual' | 'unverifiable';

// ── Upload ────────────────────────────────────────────────────────────────

/** One page's bytes, described before any upload happens. */
export interface CapturePageInput {
  /** SHA-256 of THIS PAGE's bytes, hex. Lets the server dedupe before upload. */
  sha256: string;
  /** `image/*` or `application/pdf`. */
  mimeType: string;
  byteSize: number;
}

/**
 * `POST /v1/captures` — requires an `Idempotency-Key` header.
 *
 * Replaces the old single-file `{sha256, mimeType, byteSize, pageCount}`
 * shape outright — nothing had shipped against it, so there is nothing to
 * keep deprecated. A tax invoice from a workshop routinely runs to two pages,
 * and the second one carries the GST summary; treating them as separate
 * captures would produce two documents that each fail validation, so a
 * capture is the whole document and every page is declared up front.
 */
export interface CreateCaptureRequest {
  /** 1..20, in page order. The whole document, not one photo of it. */
  pages: CapturePageInput[];
  /** Device clock at capture time; the server records its own receipt time too. */
  capturedAt?: IsoDateTime;
  /** On-device pre-flight score. Advisory only — the server re-checks. */
  legibilityScore?: number;
}

/** Where one page's bytes should go, and whether they need to. */
export interface CapturePageUpload {
  /** 1-based, matching the page's position in `CreateCaptureRequest.pages`. */
  pageNumber: number;
  /** Short-TTL presigned PUT. Ignore this when `alreadyStored` is true. */
  uploadUrl: string;
  /** These exact bytes are already held — do not upload them again. */
  alreadyStored: boolean;
}

export interface CreateCaptureResponse {
  captureId: string;
  /** One entry per requested page, in the same order. */
  uploads: CapturePageUpload[];
  uploadExpiresAt: IsoDateTime;
  /** True when the WHOLE document was already captured — every page, not just one. */
  duplicate: boolean;
  /** Set when quota is exhausted. The capture is still stored; extraction waits. */
  quotaExhausted?: boolean;
  /** @deprecated alias for `uploads[0].uploadUrl`, for a client mid-migration. */
  uploadUrl: string;
}

// ── Documents ─────────────────────────────────────────────────────────────

export interface DocumentSummary {
  id: string;
  captureId: string;
  docType: DocType;
  /** Whether the ATO's 7 elements are present. Gates GST credit claims. */
  isTaxInvoice: boolean;
  supplierName: string | null;
  supplierAbn: string | null;
  issueDate: IsoDate | null;
  currency: string;
  taxAmount: MoneyString | null;
  payableAmount: MoneyString | null;
  reviewStatus: ReviewStatus;
  confidenceOverall: number | null;
  /** Field paths a human has confirmed; the server will not overwrite these. */
  lockedFields: string[];
  thumbnailUrl: string | null;
}

/**
 * A line AS THE MODEL READ IT — every field nullable, because a creased
 * docket does not always have a legible quantity.
 *
 * Distinct from `DocumentView.lines` (further down), which is the same line
 * after validation and review: non-null, with GST resolved and a category.
 * The two were both called `DocumentLine` while they lived in separate
 * packages, and TypeScript merged them into one impossible interface the
 * moment they met. Naming them apart is the fix; they are not the same thing
 * and no code should be able to pass one where the other is meant.
 */
export interface ExtractedLine {
  lineNumber: number;
  description: string | null;
  quantity: string | null;
  unitCode: string | null;
  unitPrice: string | null;
  lineNetAmount: MoneyString | null;
  gstCategoryCode: string | null;
  gstAmount: MoneyString | null;
  categoryId: string | null;
}

export interface DocumentDetail extends DocumentSummary {
  lines: ExtractedLine[];
  taxSubtotals: Array<{
    categoryCode: string;
    rate: string;
    taxableAmount: MoneyString;
    taxAmount: MoneyString;
  }>;
  /** Per-field confidence and bounding boxes, for tap-to-source in review. */
  fieldProvenance: Record<
    string,
    { confidence?: number; bbox?: [number, number, number, number]; page?: number }
  >;
  /** Which of the ATO's required elements were found. */
  atoCompliance: Record<string, boolean>;
}

// ── Review ────────────────────────────────────────────────────────────────

/** `PATCH /v1/documents/:id` — editing a document is not the same as posting it. */
export interface UpdateDocumentRequest {
  /** Field path -> new value, e.g. `{"supplier.abn": "51824753556"}`. */
  edits: Record<string, string | number | null>;
  /** Confirming locks the edited fields against later re-extraction. */
  confirm?: boolean;
}

/**
 * `PATCH /v1/captures/:captureId/document` — `docs/ON-DEVICE.md` §7.2, §11 (OD-11).
 *
 * Addressed by CAPTURE rather than by document, because a Stage 2 correction
 * can be made — and queued in the offline outbox — before the server's
 * extraction has produced a document to edit at all. Until it has, the server
 * answers `409 document_not_ready` and the outbox is expected to retry with
 * its existing back-off, carrying the SAME `Idempotency-Key`: the point is
 * that the correction is not lost, only deferred.
 *
 * `edits` uses the same field-path vocabulary as `UpdateDocumentRequest.edits`
 * (`supplier.name`, `supplier.abn`, `header.issue_date`, `totals.payable`,
 * `totals.gst_free`) — this is the same correction, made possible earlier.
 */
export interface PatchCaptureDocumentRequest {
  edits: Record<string, string | number | null>;
  /** Which on-device engine produced the preview being corrected. Advisory —
   *  the server does not validate it — kept for OD-12's agreement findings,
   *  which compare a device engine's readings against the server's own. */
  previewEngine?: 'device-vision' | 'device-mlkit';
  /** Optimistic concurrency, once a document exists to carry a version. */
  version?: number;
}

/** `POST /v1/documents/:id/post` — the act that actually moves the books. */
export interface PostDocumentRequest {
  /** Splits must sum to exactly zero, or the database rejects the posting. */
  splits: Array<{
    accountId: string;
    amount: MoneyString;
    taxCodeId?: string | null;
    gstAmount?: MoneyString;
    categoryId?: string | null;
    description?: string | null;
  }>;
  txnDate: IsoDate;
  memo?: string;
}

// ── Extraction findings ───────────────────────────────────────────────────

/**
 * One deterministic observation about an extraction.
 *
 * Produced by the server's validators, consumed by the review screen. It lives
 * here rather than in either side because it IS the wire contract between
 * them: the server decides what is wrong, the app decides how to say it, and
 * neither should be guessing at the other's shape.
 *
 * `severity` drives behaviour, not just colour:
 *   error   — the extraction cannot be trusted; a human must look.
 *   warning — usable, but one field needs confirming.
 *   note    — worth stating, nothing to do.
 */
export interface ExtractionFinding {
  /** Stable identifier, e.g. 'gst_arithmetic'. Safe to branch on. */
  code: string;
  severity: 'error' | 'warning' | 'note';
  /** The field it concerns, so the UI can point at it instead of at the page. */
  field: string;
  /** What is wrong, in the user's language, with the numbers in it. */
  message: string;
  /** What to do about it. Absent when there is nothing to do. */
  fix?: string;
}

// ── Entitlement ───────────────────────────────────────────────────────────

/** What the app needs to know before offering a scan. */
export interface Entitlement {
  planCode: string;
  /** false => batch tier: results arrive within the hour, same accuracy. */
  realtime: boolean;
  scanQuota: number | null;
  scansUsed: number;
  scansRemaining: number | null;
  topupRemaining: number;
  seatLimit: number;
  seatsUsed: number;
  features: Record<string, unknown>;
}

// ── Errors ────────────────────────────────────────────────────────────────

export interface ApiError {
  /** Stable machine code, e.g. `quota_exhausted`, `duplicate_capture`. */
  code: string;
  /** Human-readable, safe to show: says what happened and what to do next. */
  message: string;
  details?: Record<string, unknown>;
  requestId: string;
}

// ── The seam's response shapes ────────────────────────────────────────────
//
// Moved here from the mobile app, where they were originally declared because
// the app existed first. Leaving them there meant the server was matching
// shapes BY HAND against a file it could not import — the exact arrangement
// that lets a field quietly change on one side. Declared once, in the package
// both sides already depend on, a mismatch is a compile error instead.
/**
 * THE SEAM.
 *
 * Every screen talks to this interface and nothing else. The demo is wired to
 * `MockApi`; the server implementation drops in behind the same shape without
 * touching a single screen. That is why the app can be built before the server
 * exists without becoming throwaway work.
 *
 * These types are declared explicitly rather than inferred from the demo
 * fixture. Deriving them from fixture data would type the app by its demo
 * content — every literal narrowed to exactly the values that happened to be in
 * it — so adding a receipt would break compilation. Instead the generated
 * fixture is annotated `DemoShape` and must conform to THIS, which turns a
 * generator change that breaks the app into a compile error.
 *
 * Money is always a decimal STRING. Never a number: a JSON float cannot hold
 * 110.10 exactly, and a BAS out by a cent is wrong.
 */

/**
 * Which side of a life a document belongs to.
 *
 * Not a filter bolted on top: it decides which questions the app asks. Business
 * spending is heading for a BAS and a tax return, so it must answer "can I
 * claim this?". Personal spending only has to answer "is this month going to
 * hold?" — so the personal UI never mentions GST, ABNs or tax invoices, even
 * though the same extraction produced the row.
 */
export type Workspace = 'business' | 'personal';

export type ReviewState = 'auto_accepted' | 'needs_review' | 'reviewed' | 'rejected';

export type ComplianceFailure =
  | 'supplier_abn_missing'
  | 'buyer_abn_required_over_1000'
  | 'not_marked_tax_invoice';

/**
 * One line off the receipt.
 *
 * The whole product is "keep what the paper said", so a document is not a
 * total — it is the total AND the lines that make it up. A Bunnings docket can
 * hold two categories and a Coles basket can be half GST-free; neither is
 * representable by a single amount, and an accountant asked to justify a claim
 * will want the line, not the sum.
 */
export interface DocumentLine {
  lineNumber: number;
  description: string;
  quantity: number;
  /** GST-inclusive price for one unit. */
  unitPrice: string;
  /** GST-inclusive line total. */
  amount: string;
  /** Fresh food, most health items: no GST in the line at all. */
  gstFree: boolean;
  /** Per-line category. A single receipt can legitimately span two. */
  category: string | null;
  confidence: number;
}

export interface DocumentView {
  id: string;
  supplierName: string;
  supplierAbn: string | null;
  supplierAbnValid: boolean;
  issueDate: string;
  currency: string;
  taxExclusiveAmount: string;
  taxAmount: string;
  payableAmount: string;
  gstFreeAmount: string | null;
  /**
   * Per-category tax split — Peppol BG-23, and the capability no competitor
   * has (`docs/MONETISATION.md` §2). Empty when the document carries a single
   * tax treatment, or when its lines do not reconcile to the payable: an
   * honest absence, never a guessed allocation.
   *
   * `taxableAmount` is the NET amount for the category (BT-116), matching what
   * the ledger posts as the expense split.
   */
  taxSubtotals: Array<{
    categoryCode: 'S' | 'Z';
    rate: string;
    taxableAmount: string;
    taxAmount: string;
    /** Net plus GST — what the docket printed. Sent, never added client-side. */
    inclusiveAmount: string;
  }>;
  isTaxInvoice: boolean;
  docType: 'tax_invoice' | 'receipt';
  category: string;
  engineRowId: string;
  reviewStatus: ReviewState;
  confidenceOverall: number;
  note: string | null;
  complianceFailures: ComplianceFailure[];
  /** GST that cannot be claimed as things stand. */
  gstAtRisk: string | null;
  /** Under $82.50 the ATO does not require a tax invoice at all. */
  belowTaxInvoiceThreshold: boolean;
  /**
   * Local file URI of the photo just taken, when this document came from a
   * capture on this device. Lets review show the actual image; in production the
   * server returns a signed thumbnail URL instead.
   */
  localImageUri?: string | null;
  /** True when the FIELDS are sample data even though the image is real. */
  demoExtraction?: boolean;
  workspace: Workspace;
  /**
   * Every line the extraction read, in the order they appeared on the paper.
   *
   * Editable, because extraction is a proposal and the human confirms it.
   */
  lines: DocumentLine[];
  /**
   * True when the lines add up to the payable amount.
   *
   * False means extraction missed or misread something, which is the single
   * most useful integrity check available without re-reading the photo — so
   * the review screen says so rather than quietly showing lines that disagree
   * with the total printed above them.
   */
  linesBalance: boolean;
  /**
   * The stored original, as captured.
   *
   * The ATO accepts an electronic copy of a receipt only if it is a true and
   * clear reproduction, so the image is the legal record and the extraction is
   * a derived convenience. Never regenerated, never "enhanced".
   */
  imageUrl: string | null;
  imageCapturedAt: string | null;
  /**
   * Every stored page, in page order — what makes paging through a document
   * still work after the session that captured it is long gone (§3.1 of the
   * multi-page capture contract). Before this, paging only worked off the
   * device's own local URIs, so reopening a document later showed page 1 and
   * nothing else.
   *
   * One entry for a single-page document too: a caller that has to special-case
   * "no pages array" vs "one implicit page" is a caller that will eventually
   * get it backwards.
   */
  pages: Array<{ pageNumber: number; imageUrl: string; source: PageSource }>;
  /**
   * Bumped by the database on every change.
   *
   * The client sends the version it last read with a correction; a write
   * against a stale one is refused with a 409 rather than silently applied.
   * In a shared workspace two people reviewing the same receipt is normal,
   * and last-write-wins would quietly discard one of them.
   */
  version: number;
  /**
   * What the validators found, in the order they should be read.
   *
   * The server checks arithmetic, dates and the ATO's tax-invoice elements
   * deterministically, because those are the things a vision model gets wrong
   * — one read a docket dated 06/09/26 as the year 2006. Each finding names
   * its field and what to do, so the review screen can be specific instead of
   * showing a confidence percentage and hoping.
   */
  findings: ExtractionFinding[];
  /** Which shared workspace owns this. Documents belong to it, not to a person. */
  workspaceId: string;
  /** Who captured it. Shown on every row once a workspace has more than one member. */
  capturedByName: string | null;
  /**
   * Private items are visible only to whoever captured them.
   *
   * They still COUNT toward the shared total — excluding them would make the
   * household budget wrong — but the merchant and category are hidden from
   * everyone else. Birthday presents are the reason this exists.
   */
  visibility: 'shared' | 'private';
  /**
   * How this receipt is CLEARED, from the bank's own record — `docs/STATEMENTS.md`
   * §5.3.1 Q2 ("Cleared 14 Aug via Visa ···4417"). `null` until R5c's merge
   * links a statement line to this document's transaction; present once it does,
   * whichever order the receipt and the statement arrived in.
   *
   * Optional, not merely nullable: `DocumentView` is built by
   * `documents.controller.ts`, outside this ticket's owned files, so an
   * existing object literal that has never heard of this field must still
   * typecheck. A future ticket that wires the read path can drop the `?`.
   *
   * D-S2 / Q6: carries NOTHING about tax, on purpose — no `gst*` member here
   * or anywhere else this file adds, not even a nullable one. `settlement` is
   * "the bank agrees this cleared", which is meaningful in EVERY workspace,
   * personal included.
   */
  settlement?: {
    statementLineId: string;
    postedDate: IsoDate;
    /** e.g. "Visa ···4417" or the account's own label — never a raw account number. */
    accountLabel: string;
    amountSigned: MoneyString;
  } | null;
}

export interface BasSummary {
  periodLabel: string;
  purchasesInclusive: string;
  gstClaimable: string;
  gstAtRisk: string;
  atRiskCount: number;
  thresholds: { taxInvoice: string; buyerAbn: string };
  note: string;
}

export interface DeductionSummary {
  estimateTotal: number;
  byLabel: Record<string, number>;
  caps: Record<string, number>;
}

export interface Overview {
  tenantName: string;
  /** null for a business that has not registered one yet — a real state. */
  tenantAbn: string | null;
  firmName: string | null;
  profileLabel: string;
  benchmarkCommon: number[] | null;
  benchmarkMax: number | null;
  ratesFy: string;
  ratesDetermination: string;
  bas: BasSummary;
  deductions: DeductionSummary;
  entitlement: Entitlement;
}

export type DocumentFilter = 'all' | 'needs_review' | 'at_risk';

/* ── Business side ──────────────────────────────────────────────────────── */

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue';

export interface InvoiceLine {
  lineNumber: number;
  itemId: string;
  description: string;
  unit: string;
  quantity: number;
  unitPrice: string;
  netAmount: string;
  gstAmount: string;
  totalAmount: string;
}

export interface Invoice {
  id: string;
  number: string;
  kind: 'invoice' | 'estimate';
  status: InvoiceStatus;
  partyId: string;
  partyName: string;
  issueDate: string;
  dueDate: string;
  lines: InvoiceLine[];
  netAmount: string;
  gstAmount: string;
  totalAmount: string;
  amountPaid: string;
  amountDue: string;
}

export interface Item {
  id: string;
  name: string;
  sku: string;
  unit: string;
  sellPrice: string;
  costPrice: string;
  /** null for services, which have no stock. */
  stockOnHand: number | null;
  lowStock: boolean;
  taxCode: string;
}

export interface Party {
  id: string;
  name: string;
  kind: 'customer' | 'supplier';
  abn: string | null;
  abnValid: boolean;
  email: string | null;
  phone: string | null;
  openBalance: string;
  invoiceCount: number;
}

export interface SalesSummary {
  outstanding: string;
  overdue: string;
  paidThisQuarter: string;
  gstOnSales: string;
}

/* ── Personal ───────────────────────────────────────────────────────────── */

export interface Budget {
  category: string;
  /** Monthly cap, as a decimal string. */
  monthly: string;
}

export interface CategorySpend {
  category: string;
  spent: string;
  /** null when this category has no budget set. */
  budget: string | null;
  /** Fraction of the budget used. >1 means over. null with no budget. */
  used: number | null;
}

export interface MerchantSpend {
  name: string;
  total: string;
  count: number;
}

/**
 * The personal tracker's whole answer, in one object.
 *
 * `safeToSpendPerDay` is the figure that makes a personal tracker useful rather
 * than merely accurate: a total spent tells you what happened, a daily
 * allowance tells you what to do next.
 */
export interface PersonalSummary {
  monthLabel: string;
  spentThisMonth: string;
  budgetTotal: string;
  /** Budget minus spend. Negative when over. */
  remaining: string;
  daysLeftInMonth: number;
  daysElapsed: number;
  safeToSpendPerDay: string;
  /** Spend by this same day last month, for an honest pace comparison. */
  lastMonthToDate: string;
  receiptCount: number;
  byCategory: CategorySpend[];
  topMerchants: MerchantSpend[];
}

/* ── Analytics ──────────────────────────────────────────────────────────── */

export type AnalyticsRange = 'month' | 'quarter' | 'year';

export interface SeriesPoint {
  /** Axis label: a date, a week, or a month depending on range. */
  label: string;
  value: string;
  /** Marks the bucket still in progress, which is not comparable to the rest. */
  partial?: boolean;
}

export interface AnalyticsSummary {
  range: AnalyticsRange;
  rangeLabel: string;
  total: string;
  /** The same length of time immediately before this one. */
  previousTotal: string;
  /** Change against the previous period, as a fraction. null if no history. */
  changePct: number | null;
  /** Mean per completed bucket in the series. */
  average: string;
  receiptCount: number;
  largest: { name: string; amount: string; date: string } | null;
  series: SeriesPoint[];
  byCategory: CategorySpend[];
  topMerchants: MerchantSpend[];
  /** Business only. null in the personal workspace, which never shows GST. */
  gstClaimable: string | null;
  gstAtRisk: string | null;
}

/* ── Collaboration ──────────────────────────────────────────────────────── */

/**
 * A workspace is a tenant, not a flag.
 *
 * This is the decision the whole collaboration feature rests on. If personal
 * and business were a boolean on each row inside one account, inviting your
 * partner to the household would hand them the company's books, because row
 * isolation is per tenant. Making each workspace its own tenant means sharing
 * one costs nothing to isolate — the existing row-level security does it.
 *
 * A family and a team are then the same mechanism with different labels.
 */
export type MemberRole = 'owner' | 'admin' | 'member' | 'readonly';

export interface WorkspaceSummary {
  id: string;
  name: string;
  kind: Workspace;
  /** The signed-in user's role HERE. The same person can be owner of one and readonly in another. */
  role: MemberRole;
  memberCount: number;
  abn: string | null;
}

export interface Member {
  userId: string;
  displayName: string;
  email: string | null;
  role: MemberRole;
  /** Two letters for the avatar, computed server-side so every client agrees. */
  initials: string;
  isYou: boolean;
  joinedAt: string;
  lastActiveAt: string | null;
  captureCount: number;
}

export interface Invitation {
  id: string;
  email: string;
  role: MemberRole;
  invitedByName: string;
  createdAt: string;
  expiresAt: string;
}

export interface MemberList {
  members: Member[];
  invitations: Invitation[];
  /** From the plan. Inviting past this needs an upgrade, not a bigger list. */
  seatLimit: number;
  seatsUsed: number;
}

/**
 * What the current member is allowed to do here.
 *
 * Resolved behind the seam rather than derived in each screen from a role
 * string: a permission check duplicated across fourteen screens is a
 * permission check that will disagree with itself.
 */
export interface Permissions {
  canCapture: boolean;
  canEdit: boolean;
  /** Posting to the ledger is an owner/admin act, even though anyone may scan. */
  canConfirm: boolean;
  canInvite: boolean;
  canManageBudgets: boolean;
  canBill: boolean;
}

/* ── Money out: bills and payments ──────────────────────────────────────── */

export type BillStatus = 'unpaid' | 'paid' | 'overdue';

export interface Bill {
  id: string;
  supplierName: string;
  reference: string;
  issueDate: string;
  dueDate: string;
  totalAmount: string;
  gstAmount: string;
  amountPaid: string;
  amountDue: string;
  status: BillStatus;
  category: string;
}

export type PaymentMethod = 'bank' | 'card' | 'cash' | 'other';

export interface Payment {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  partyName: string;
  date: string;
  amount: string;
  method: PaymentMethod;
  reference: string | null;
}

/* ── Mileage ────────────────────────────────────────────────────────────── */

export interface Trip {
  id: string;
  date: string;
  fromPlace: string;
  toPlace: string;
  km: number;
  purpose: string;
  workRelated: boolean;
}

export interface MileageSummary {
  trips: Trip[];
  workKm: number;
  totalKm: number;
  /** Cents-per-km claim at the current ATO rate, capped at 5,000 km. */
  centsPerKmRate: number;
  centsPerKmCapKm: number;
  claimAtCentsPerKm: string;
  /** True once the 5,000 km ceiling makes a logbook the better method. */
  overCentsPerKmCap: boolean;
  logbookPercent: number;
}

/* ── Stock ──────────────────────────────────────────────────────────────── */

export interface StockMovement {
  id: string;
  itemId: string;
  itemName: string;
  kind: 'count' | 'sale' | 'purchase' | 'adjustment';
  quantity: number;
  at: string;
  note: string | null;
  byName: string | null;
}

/* ── Recurring and goals ────────────────────────────────────────────────── */

/**
 * A subscription the app worked out for itself.
 *
 * Detected from the receipts rather than entered: a merchant seen in three or
 * more consecutive months at a stable amount is a recurring cost, and the
 * whole value of the feature is that nobody has to remember to declare it.
 */
export interface Recurring {
  merchant: string;
  category: string;
  typicalAmount: string;
  monthsSeen: number;
  lastSeen: string;
  /** One month on from the last sighting. */
  nextExpected: string;
  annualCost: string;
}

export interface Goal {
  id: string;
  name: string;
  target: string;
  /** DERIVED — the sum of this goal's GoalContribution rows, never a free-floating figure. */
  saved: string;
  /** null for an open-ended goal. */
  targetDate: string | null;
  /** What must go in each month to land it on time. null when open-ended. */
  perMonth: string | null;
  done: boolean;
}

/**
 * One recorded contribution to a savings goal.
 *
 * `saved` on the goal is the sum of these. Deleting one adjusts the total,
 * because the record is the total's evidence, not a byproduct of it.
 */
export interface GoalContribution {
  id: string;
  goalId: string;
  amount: string;
  /**
   * When the money actually went in, not when this row was typed. For a
   * `'statement_line'` row this is the line's OWN `posted_date` — the server
   * derives it; a client-supplied date is never accepted for a grounded
   * contribution (docs/STATEMENTS.md §12 R5f-2).
   */
  occurredOn: string;
  createdAt: string;
  /** Who recorded it, for a shared workspace. null if that person has since left. */
  createdByName: string | null;
  /**
   * What told the app this happened — never call a 'manual' row, or a
   * 'statement_line' one, "verified". The app OBSERVED a line on a bank
   * statement, which is a stronger claim than a typed number and a weaker
   * one than an audit — "verified" overclaims either way.
   *
   * 'manual' — the user typed a number in. A claim, not an observation: the
   * app has not seen this money move.
   *
   * 'opening_balance' — carried forward from before contributions were
   * tracked, so an old goal's total still reconciles instead of the gap being
   * papered over. Written once, by a migration, never by a user action.
   *
   * 'statement_line' — GROUNDED in a `statement_lines` row the app read from
   * a bank statement (docs/STATEMENTS.md §5.3.1, Lane R ticket R5f-1/R5f-2):
   * `statementLineDescription` names it. The server derives `amount`
   * (default: the whole line), `occurredOn` (the line's `posted_date`) and
   * this `source` — the client supplies only `statementLineId` and,
   * optionally, a smaller `amount`; a client-supplied date is ignored.
   */
  source: 'manual' | 'opening_balance' | 'statement_line';
  /**
   * The bank statement line's own description, present only for a
   * `source === 'statement_line'` row — this IS the provenance, carried
   * verbatim so the UI can say where the money was observed without
   * inventing a sentence server-side. Personal-language copy to match the
   * existing register (`apps/mobile/src/app/goals.tsx`'s "Added by {name}" /
   * "Starting balance, from before contributions were tracked"):
   * `From your statement, {shortDate(occurredOn)}` — e.g. "From your
   * statement, 14 Aug" — with this field available if a fuller sentence
   * naming what the line said is wanted (e.g. "From your statement —
   * Salary credit, 14 Aug"). D-S2 binds: never a tax word here, and never
   * "verified" (see `source` above). Optional, not merely nullable — additive
   * to this contract (docs/STATEMENTS.md §12 R5f-2): existing object literals
   * built before this field existed (fixtures, mock data) stay valid without
   * it, and a reader must treat an absent value the same as `null`.
   */
  statementLineDescription?: string | null;
}

/* ── Settings, plan, connections, export ────────────────────────────────── */

export interface BusinessSettings {
  workspaceId: string;
  name: string;
  abn: string | null;
  abnValid: boolean;
  gstRegistered: boolean;
  gstBasis: 'cash' | 'accrual';
  simplerBas: boolean;
  occupationProfileId: string | null;
  occupationLabel: string | null;
  financialYearStartMonth: number;
}

/* ── The installed tax engine (migration 0026, @snap/tax-rules) ──────────── */

/** A tax rule set this deployment can install. */
export interface AvailableTaxRules {
  rulesId: string;
  country: string;
  countryName: string;
  version: string;
  taxYear: string;
  scope: 'personal' | 'business';
  consumptionTaxName: string;
  currency: string;
}

/**
 * Which tax engine a workspace is running.
 *
 * Everything is nullable except `country`, `currency` and `available`, because
 * "no engine installed" is a real state rather than an error: there is
 * deliberately no default, and a workspace with no rule set refuses every tax
 * calculation instead of quietly using Australian rules. `problem` carries the
 * reason, for a person to read.
 */
export interface InstalledTaxRules {
  rulesId: string | null;
  rulesVersion: string | null;
  country: string;
  countryName: string | null;
  taxYear: string | null;
  /** What the consumption tax is called locally: `PPN`, `GST`. */
  consumptionTaxName: string | null;
  currency: string;
  /** What the annual return is called locally, e.g. `SPT Tahunan`. */
  annualReturnName: string | null;
  /**
   * `none` when this taxpayer has no filing obligation for the consumption
   * tax. A surface must not render a period or a "lodge" affordance then.
   */
  filingPeriod: 'monthly' | 'quarterly' | 'annual' | 'none' | null;
  /** False for a personal taxpayer: consumption tax is a cost, not a credit. */
  recoverable: boolean | null;
  problem: string | null;
  available: AvailableTaxRules[];
}

export interface ConsumptionTaxLine {
  code: string;
  name: string;
  /**
   * `other_tax` is a DIFFERENT levy that prints like the main one — Indonesia's
   * PB1, a regional tax of up to 10% on restaurant and hotel consumption. It is
   * never recoverable and is never included in `taxPaid`.
   */
  treatment: 'standard' | 'exempt' | 'other_tax' | 'out_of_scope';
  grossAmount: string;
  taxAmount: string;
  transactionCount: number;
}

export interface ConsumptionTaxReport {
  from: string;
  to: string;
  rulesId: string;
  rulesVersion: string;
  taxName: string;
  currency: string;
  grossSpend: string;
  taxPaid: string;
  exemptSpend: string;
  otherTaxPaid: string;
  recoverable: boolean;
  /**
   * What this figure IS, in one sentence, written by the tax engine.
   *
   * Render it verbatim. It is the difference between a spending analytic and an
   * implied claim, and a screen is not allowed to decide which one it shows.
   */
  disclosure: string;
  filingPeriod: 'monthly' | 'quarterly' | 'annual' | 'none';
  lines: ConsumptionTaxLine[];
}

export interface CategorySetting {
  name: string;
  /** Deduction label this maps to, e.g. D1. null in the personal workspace. */
  taxLabel: string | null;
  monthlyBudget: string | null;
  documentCount: number;
  totalSpend: string;
  /** False for a category the user has switched off; it stops being offered. */
  active: boolean;
  /**
   * True when nothing references this category — no receipts, no ledger
   * entries, no subcategories, no budget. Only then does DELETE succeed; the
   * server re-checks this independently of whatever the client shows.
   */
  deletable: boolean;
}

export interface PlanUsage {
  planCode: string;
  planName: string;
  priceCents: number;
  realtime: boolean;
  scanQuota: number | null;
  scansUsed: number;
  scansRemaining: number | null;
  seatLimit: number;
  seatsUsed: number;
  retentionMonths: number;
  periodEnds: string;
  firmName: string | null;
}

export type ConnectionStatus = 'disconnected' | 'connected' | 'error';

export interface Connection {
  id: 'xero' | 'myob' | 'quickbooks';
  name: string;
  status: ConnectionStatus;
  lastSyncAt: string | null;
  /** Documents waiting to be pushed. */
  queued: number;
  /** Organisation name at the far end, once connected. */
  organisation: string | null;
  note: string;
}

export interface TaxPackSection {
  label: string;
  detail: string;
  count: number;
  bytes: number;
  included: boolean;
}

/**
 * A pack that has actually been assembled.
 *
 * `TaxPack` above describes what one WOULD contain; this is the file. Kept
 * apart because describing is instant and assembling zips a financial year of
 * images — a screen that conflates them is a screen that lies about progress.
 */
export interface TaxPackFile {
  /** Where to fetch it. Authenticated, and valid only for a short window. */
  url: string;
  filename: string;
  bytes: number;
  documentCount: number;
  /** When the link stops working, so the UI can say so rather than 404 later. */
  expiresAt: string;
}

export interface TaxPack {
  periodLabel: string;
  fromDate: string;
  toDate: string;
  sections: TaxPackSection[];
  totalBytes: number;
  /** ATO: business records must be kept 5 years from the date they were prepared. */
  retentionNote: string;
}

/* ── Identity ───────────────────────────────────────────────────────────── */

/**
 * Who is using the app.
 *
 * Until now there was none: the app opened straight into one hardcoded person,
 * which made collaboration half-real — you could invite people and set their
 * roles, but never be anyone but the owner. Signing in as a different member
 * is what makes a role mean something.
 *
 * There is no password here and there never will be. The server delegates to
 * an identity provider and stores only the external subject; a finance app
 * that keeps its own password table is a breach waiting for a news cycle.
 */
export interface AuthUser {
  userId: string;
  displayName: string;
  email: string;
  /** Two letters for the avatar, so every client agrees on them. */
  initials: string;
}

export interface Session {
  user: AuthUser;
  /**
   * The workspaces this person belongs to.
   *
   * Empty means a brand-new account with nowhere to put a receipt, which is
   * the one state that requires onboarding before the app is usable.
   */
  workspaceIds: string[];
}

/** What a new account has to answer before it can file anything. */
export interface OnboardingInput {
  workspaceName: string;
  kind: Workspace;
  /** Business only. Checked against the ATO checksum before it is stored. */
  abn?: string | null;
  gstRegistered?: boolean;
  gstBasis?: 'cash' | 'accrual';
  /** A `@snap/tax-engine` profile id: decides which deduction rows apply. */
  occupationProfileId?: string | null;
  /** Personal only: what the household intends to spend each month. */
  monthlyBudget?: string | null;
  /**
   * The tax engine to install, e.g. `au-2026` or `id-2026` (migration 0026).
   *
   * Absent means "no engine", NOT "Australia": a workspace without one refuses
   * every tax calculation rather than computing plausible numbers under the
   * wrong law. The mobile client asks for the country at registration and
   * sends the answer through here.
   *
   * `OnboardingDto` on the server has accepted this since the engine landed;
   * it was simply missing from this contract, so no client could send it.
   */
  taxRulesId?: string | null;
}

// ── The platform admin plane (docs/WEB.md §6) ──────────────────────────────
//
// A second, deliberately narrow authorisation surface over every tenant's
// records — see `packages/db/migrations/0021_admin_plane.sql` for the whole
// design. Every shape below is a plain data type: capability enforcement,
// impersonation, and audit all happen in Postgres SECURITY DEFINER functions,
// never here. These types exist so the server's DTOs and the admin UI cannot
// silently disagree about what a route returns — see that migration's header
// and `apps/server/src/admin/*.controller.ts`, where each handler's return
// type is one of these, not an inferred shape.

/** Descriptive only — reporting label. Every gate tests a capability, never this. */
export type PlatformStaffRole = 'support' | 'billing' | 'operations' | 'super_admin';

/** Granular on purpose: no god flag. Checked in the database, not just here. */
export type PlatformCapability =
  | 'view_analytics'
  | 'view_tenant_metadata'
  | 'read_tenant_records'
  | 'impersonate'
  | 'manage_billing'
  | 'manage_platform_settings'
  | 'manage_ai_config'
  | 'manage_staff'
  | 'manage_operations'
  /**
   * 0023: reviewing who accessed whose records (`GET /v1/admin/audit-log`) is
   * its own capability, not folded into `view_tenant_metadata` or
   * `manage_staff` — see that migration's header for why. Reviewing access is
   * itself sensitive: granting it should never be a side effect of granting
   * something else.
   */
  | 'audit_review';

/** `GET /v1/admin/me` — what the signed-in caller may do on this plane. */
export interface AdminSession {
  staffId: string;
  role: PlatformStaffRole;
  capabilities: PlatformCapability[];
  /**
   * 0023: the signed-in staff member's own name/email, joined from `users`.
   * Previously absent, so the console could only show `role · staffId` — see
   * `apps/web/src/app/admin/_actions/impersonation.ts` for where that showed
   * up as a placeholder in the impersonation banner.
   */
  displayName: string | null;
  email: string | null;
}

/** `GET /v1/admin/analytics/overview` */
export interface AdminAnalyticsOverview {
  tenantCount: number;
  activeTenantCount: number;
  userCount: number;
  staffCount: number;
  documentCount: number;
  /** Fraction 0..1 over the trailing 30 days, or null with no runs to divide by. */
  extractionSuccessRate: number | null;
  costAud30d: MoneyString;
  revenueAud30d: MoneyString;
}

/** One row of `GET /v1/admin/operations/queue` — a queue `kind`'s health. */
export interface AdminQueueStat {
  kind: string;
  pending: number;
  locked: number;
  /** Hit max_attempts and will never be retried automatically. */
  stalledAtMax: number;
  /** Age of the oldest unlocked pending job, ISO 8601 duration, or null if none. */
  oldestPendingAge: string | null;
}

/** One row of `GET /v1/admin/tenants` */
export interface AdminTenantSummary {
  tenantId: string;
  name: string;
  kind: Workspace;
  planCode: string | null;
  memberCount: number;
  createdAt: IsoDateTime;
  deletedAt: IsoDateTime | null;
}

/** `GET /v1/admin/tenants/:tenantId` */
export interface AdminTenantDetail {
  tenantId: string;
  name: string;
  kind: Workspace;
  abn: string | null;
  country: string;
  planCode: string | null;
  memberCount: number;
  createdAt: IsoDateTime;
  deletedAt: IsoDateTime | null;
}

/** One row of `GET /v1/admin/users` */
export interface AdminUserSummary {
  userId: string;
  email: string | null;
  displayName: string | null;
  createdAt: IsoDateTime;
  tenantCount: number;
}

/** One workspace a user belongs to, as the admin console sees it. */
export interface AdminUserMembership {
  tenantId: string;
  tenantName: string;
  kind: Workspace;
  role: MemberRole;
  joinedAt: IsoDateTime;
}

/**
 * `GET /v1/admin/users/:userId` — one user by id, with their memberships.
 *
 * Exists because `admin_user_search` substring-matches name and email and
 * cannot fetch by id, which forced the console to page through the search
 * looking for one row — twenty round trips per page, and silently no result
 * once the platform outgrew the scan bound. Metadata only; a user's actual
 * records still require `read_tenant_records` and an audited reason.
 */
export interface AdminUserDetail {
  userId: string;
  email: string | null;
  displayName: string | null;
  createdAt: IsoDateTime;
  tenantCount: number;
  memberships: AdminUserMembership[];
}

/**
 * `GET /v1/admin/tenants/:tenantId/documents` — a staff read of one tenant's
 * actual records. `reason` is a required query parameter; the server
 * authorises and audits it BEFORE running the scoped read (see the migration
 * header, rule 5). Reuses `DocumentSummary` rather than inventing a second
 * shape for the same row.
 */
export interface AdminTenantDocumentsView {
  tenantId: string;
  documents: DocumentSummary[];
}

/** Request body of `POST /v1/admin/impersonation/start`. */
export interface AdminImpersonationStartRequest {
  subjectUserId: string;
  subjectTenantId: string;
  /** Required. Refused by the database if blank. */
  reason: string;
  /** Clamped server-side to at most one hour. */
  ttlSeconds?: number;
}

/** Response of `POST /v1/admin/impersonation/start`. `token` is shown once. */
export interface AdminImpersonationStartResponse {
  sessionId: string;
  /** The bearer credential for `X-Impersonation-Token`. Never stored by the client beyond the session. */
  token: string;
  expiresAt: IsoDateTime;
}

export type ImpersonationEndReason = 'expired' | 'stopped' | 'revoked';

/** Response of `POST /v1/admin/impersonation/:sessionId/stop`. */
export interface AdminImpersonationStopResponse {
  sessionId: string;
  endedReason: ImpersonationEndReason;
}

/** One row of `GET /v1/admin/plans` */
export interface AdminPlanSummary {
  planId: string;
  code: string;
  name: string;
  priceCents: number;
  scanQuota: number | null;
  seatLimit: number;
  isActive: boolean;
}

/** Request body of `POST /v1/admin/tenants/:tenantId/plan` */
export interface AdminSetPlanRequest {
  planId: string;
  reason: string;
}

/** Response of `POST /v1/admin/tenants/:tenantId/plan` */
export interface AdminSubscriptionRef {
  subscriptionId: string;
}

/** Request body of `POST /v1/admin/tenants/:tenantId/usage-grants` */
export interface AdminUsageGrantRequest {
  metric: string;
  amount: number;
  reason: string;
}

export interface AdminUsageGrantRef {
  usageGrantId: string;
}

/** One row of `GET /v1/admin/settings`, and the body/response of setting one. */
export interface AdminPlatformSetting {
  key: string;
  value: unknown;
  updatedAt: IsoDateTime;
}

/** Request body of `PUT /v1/admin/settings/:key` */
export interface AdminSetSettingRequest {
  value: unknown;
  reason: string;
}

/**
 * One row of `GET /v1/admin/ai/providers`. Never a plaintext key, never
 * ciphertext — only what is safe to show on a settings screen.
 */
export interface AdminAiProviderConfig {
  id: string;
  provider: string;
  label: string;
  defaultModel: string | null;
  isActive: boolean;
  hasLiveKey: boolean;
  /**
   * 0023: the live key's own row id, so `POST /v1/admin/ai/keys/:keyId/revoke`
   * is reachable from a fresh page load — previously only the id returned by
   * `setAiProviderKey` in the SAME session could ever be revoked. Never the
   * key value; an id is not secret material.
   */
  liveKeyId: string | null;
  keyPrefix: string | null;
  keyLast4: string | null;
}

/** Request body of `POST /v1/admin/ai/providers` */
export interface AdminUpsertAiProviderRequest {
  provider: string;
  label: string;
  defaultModel?: string | null;
  isActive?: boolean;
}

/**
 * Request body of `POST /v1/admin/ai/providers/:configId/key`.
 *
 * `apiKey` is the ONLY place a plaintext key ever appears on the wire, and it
 * travels exactly once, over TLS, from the admin UI to this endpoint. The
 * server encrypts it immediately (app-level AEAD, KMS-wrapped DEK) and never
 * returns it — see `AdminAiProviderConfig`, which carries only a prefix and
 * last 4 characters.
 */
export interface AdminSetAiKeyRequest {
  apiKey: string;
}

export interface AdminAiKeyRef {
  keyId: string;
  keyPrefix: string;
  keyLast4: string;
}

export interface AdminRevokeAiKeyRequest {
  reason: string;
}

/** One row of `GET /v1/admin/ai/usage` */
export interface AdminAiUsageStat {
  engine: string;
  modelId: string | null;
  runs: number;
  succeeded: number;
  failed: number;
  costAud: MoneyString;
  avgLatencyMs: number | null;
}

/** Request body of `POST /v1/admin/operations/reextraction` */
export interface AdminTriggerReextractionRequest {
  tenantId: string;
  captureId: string;
  reason: string;
}

export interface AdminJobRef {
  jobId: string;
}

/** One row of `GET /v1/admin/operations/retention` */
export interface AdminRetentionStatusRow {
  tenantId: string;
  name: string;
  oldestDocumentIssueDate: IsoDate | null;
  retentionMonths: number | null;
}

/** One row of `GET /v1/admin/staff` */
export interface AdminStaffSummary {
  staffId: string;
  userId: string;
  email: string | null;
  displayName: string | null;
  role: PlatformStaffRole;
  capabilities: PlatformCapability[];
  createdAt: IsoDateTime;
  revokedAt: IsoDateTime | null;
}

/** Request body of `POST /v1/admin/staff` */
export interface AdminAddStaffRequest {
  userId: string;
  role: PlatformStaffRole;
  capabilities: PlatformCapability[];
}

/** Request body of `PATCH /v1/admin/staff/:staffId/capabilities` */
export interface AdminSetStaffCapabilityRequest {
  capability: PlatformCapability;
  grant: boolean;
}

/**
 * One row of `GET /v1/admin/audit-log` (`admin_audit_log_search`, 0023).
 * Gated on `audit_review` — see that migration's header for why this is its
 * own capability rather than folded into `view_tenant_metadata`. `audit_log`
 * is append-only; there is no corresponding write type, and there must never
 * be one.
 */
export interface AdminAuditLogEntry {
  /** `audit_log.id` is `bigserial`; carried as a string, never a JS number. */
  id: string;
  tenantId: string | null;
  actorType: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  requestId: string | null;
  ip: string | null;
  occurredAt: IsoDateTime;
}

/**
 * Query parameters of `GET /v1/admin/audit-log`. Every field optional — an
 * empty query is "the most recent rows, unfiltered", capped server-side.
 */
export interface AdminAuditLogQuery {
  actorId?: string;
  tenantId?: string;
  action?: string;
  since?: IsoDateTime;
  until?: IsoDateTime;
  limit?: number;
  offset?: number;
}

/* ── Credits & points ──────────────────────────────────────────────────────
 *
 * `docs/ECOSYSTEM.md` D27: three balances that look alike and are not.
 *
 *   PLAN QUOTA — `PlanUsage` above. Tenant-scoped, resets monthly.
 *   CREDITS    — bought with money, or granted free at signup. Tenant-scoped
 *                (a credit buys a scan, and a scan happens inside a
 *                workspace) and never reset.
 *   POINTS     — earned by scanning, redeemed in a different ecosystem app
 *                (yourtal, unbuilt). USER-scoped: earned by a person, not a
 *                workspace, and redeemed somewhere a workspace means nothing.
 *
 * Conflating any two of these is exactly how a customer ends up billed for
 * scans they already had. They stay as separate types here for the same
 * reason they stay as separate tables in migration 0024.
 */

/** One row of `GET /v1/credit-packs` — the catalogue, active packs only, in
 *  display order. */
export interface CreditPack {
  code: string;
  credits: number;
  /** GST-inclusive AUD. A decimal STRING — see `MoneyString` above. Never
   *  parse this to a number; render it with `<Money>`. */
  priceAud: MoneyString;
  sortOrder: number;
}

/**
 * `GET /v1/credits` — the credits balance ALONE.
 *
 * Deliberately not folded together with the plan quota: `GET /v1/plan`'s
 * `scansRemaining` already answers "how many scans can I make right now" by
 * adding the two. This answers a different question — "what did I buy or
 * get for free, and what is left of just that, which never expires" — and a
 * screen that only ever showed the combined figure could not tell a customer
 * why their balance didn't reset on their renewal date.
 */
export interface CreditBalance {
  /** Sum of live `usage_grants.remaining` where `metric = 'scans'`. */
  creditsRemaining: number;
}

export type CreditPurchaseStatus = 'pending' | 'paid' | 'failed' | 'refunded';

/** `POST /v1/credits/purchases` request body. */
export interface StartCreditPurchaseRequest {
  packCode: string;
}

/**
 * One purchase record. `status` starts `pending`; it becomes `paid` only
 * once a grant exists (migration 0024's CHECK constraints make the reverse
 * unrepresentable). There is no payment processor yet — Stripe is phase 6.5
 * — so today `pending` is the honest, whole truth about a purchase started
 * from this screen: fulfilment is a manual step, not something this request
 * can promise.
 */
export interface CreditPurchase {
  id: string;
  packCode: string;
  credits: number;
  priceAud: MoneyString;
  status: CreditPurchaseStatus;
  /** 'manual' until a real processor is wired. */
  provider: string;
  createdAt: IsoDateTime;
  paidAt: IsoDateTime | null;
}

/**
 * Which rail a payment would go through.
 *
 * `'none'` is a real, expected value rather than an error state: no processor
 * has been chosen. The gateway question is genuinely open and it is not only
 * "which vendor" — charging through the phone means Apple's and Google's
 * in-app purchase rules, which are a different rail from a card processor at a
 * different rate (`docs/MONETISATION.md` §1 prices that difference at 15–30%
 * against roughly 2%). So the seam is drawn around the rail, not around Stripe.
 */
export type PaymentProviderId = 'none' | 'stripe' | 'apple' | 'google' | 'manual';

/**
 * What the client should do next about a pending purchase —
 * `POST /v1/credits/purchases/:id/checkout`.
 *
 * Deliberately a DESCRIPTOR rather than a redirect URL, because a URL cannot
 * express the state this product is actually in. Every processor hands back
 * something different (a hosted-page URL, a client secret, a StoreKit product
 * id) and there is currently no processor at all, so a `string` would have
 * forced either a lie or a sentinel value.
 *
 * `state: 'unavailable'` is the honest answer today: the purchase is recorded,
 * nothing has been charged, and `message` says so in words a person can read.
 * The UI renders that rather than a pay button that goes nowhere — see
 * `docs/WEB.md` §3.5, nothing says "soon".
 */
export interface CheckoutSession {
  purchaseId: string;
  provider: PaymentProviderId;
  /** `redirect` — send the customer to `url`. `unavailable` — nothing to pay with. */
  state: 'redirect' | 'unavailable';
  /** Present only when `state` is `redirect`. */
  url?: string;
  /** Present when `state` is `unavailable`; safe to show a customer. */
  message?: string;
}

/** `GET /v1/points` — USER-scoped; see the header above. */
export interface PointBalance {
  balance: number;
}

/**
 * One row of `GET /v1/points/ledger` — append-only history, most recent
 * first. There is no redemption type here: redemption happens in yourtal,
 * not in this product, and nothing in this contract should be read as
 * assuming otherwise.
 *
 * This held, was briefly contradicted on 2026-09-19 by a points-for-credits
 * trade added here, and holds again — the trade was removed once the yourtal
 * side was checked. Points leave the balance in yourtal; what comes back to
 * Snap Apps is a VOUCHER, redeemed through `RedeemVoucherRequest`. So every
 * `delta` written by this product is still positive.
 */
export interface PointLedgerEntry {
  id: string;
  /** Positive earns; a redemption (elsewhere) would be negative. */
  delta: number;
  reason: string;
  ref: string | null;
  app: string;
  createdAt: IsoDateTime;
}

/* ── Reconciliation (Lane R, R5c) ─────────────────────────────────────────────
 * `docs/STATEMENTS.md` §5.3.1 / §12. `event_observations` is FACTS: a row
 * exists iff a human (or the posting act itself) has established that this
 * evidence observes this event. `match_candidates` is HYPOTHESES and their
 * outcomes: `suggested -> accepted | rejected`, `accepted -> unlinked`.
 *
 * D-S2 / §5.3.1 Q6: NOTHING below carries a tax figure — no `gst*`/`ppn*`
 * member anywhere in this section, not even a nullable one. A personal
 * workspace never sees GST, and these types make that true by construction
 * rather than by the server remembering to omit a field.
 * ────────────────────────────────────────────────────────────────────────── */

export type MatchCandidateStatus = 'suggested' | 'accepted' | 'rejected' | 'unlinked';
export type MatchProposer = 'matcher' | 'user';
export type MatchVarianceKind = 'tip' | 'surcharge' | 'other';

/**
 * FACTS, never a score — §5.3.1 Q3, read literally: "the candidate generator
 * is a filter on facts... with no score." `amountExact` is always `true` for
 * a candidate the matcher itself proposed (the exact-amount filter runs
 * before a row exists at all); it stays a named fact rather than being
 * dropped because a manual link (`POST /v1/reconciliation/matches`) can
 * record one for a pair the matcher would never have suggested, and a false
 * value there is meaningful to R7.
 *
 * `dateGapDays` RANKS candidates for display; it never excludes one — there
 * is no date window (§5.3.1 Q3: "no date window").
 *
 * `withinPostingLag` is a LABEL from the tenant's installed tax rule set
 * (`@snap/tax-rules`'s `withinPostingLag`, S4's `statementRules.postingLagDays`).
 * `null` when the tenant has no rule set installed — an Australian tenant,
 * today, always — asserted as a real state, not skipped: a match suggestion
 * is not a statutory figure, so the "no rule set -> refuse" discipline that
 * binds a tax calculation does not bind this label.
 */
export interface MatchEvidence {
  amountExact: boolean;
  /** Whole days, signed: the line's `postedDate` minus the document's
   *  `issueDate`. `null` when the document has no `issueDate` to compare. */
  dateGapDays: number | null;
  /** `'equal'` — both sides carry a card, and they agree (the pair would not
   *  exist at all otherwise: both-present-and-different is an EXCLUSION, a
   *  fact checked before a candidate is generated, not a label on one).
   *  `'absent'` — either side carries no card to compare. */
  cardLast4: 'equal' | 'absent';
  /** `pg_trgm` `similarity()` of the line's and the document's normalised
   *  names, `0`..`1`. Recorded for ranking and for R7; never filtered on. */
  merchantSimilarity: number;
  withinPostingLag: boolean | null;
}

/**
 * A hypothesis — matcher-proposed or user-made — that one statement line and
 * one document observe the same economic event, and what became of it.
 *
 * The two display blocks are §5.3.1 Q2's "two columns... with the evidence
 * facts written as words": everything a reconciliation card needs to render
 * without a second fetch.
 */
export interface MatchCandidateView {
  id: string;
  statementLineId: string;
  documentId: string;
  status: MatchCandidateStatus;
  proposedBy: MatchProposer;
  evidence: MatchEvidence;
  /** A human's account of an amount disagreement, set only at accept or at a
   *  manual link — never derived by the matcher, which never proposes a
   *  variance (exact amount is part of the generation filter itself). */
  variance: { kind: MatchVarianceKind; amount: MoneyString } | null;
  decidedAt: IsoDateTime | null;
  statementLine: {
    postedDate: IsoDate;
    amountSigned: MoneyString;
    descriptionRaw: string;
    /** The bank/card account this line belongs to — a display label
     *  (`display_name` or `institution`), never a raw account number. */
    accountLabel: string;
  };
  document: {
    supplierName: string | null;
    issueDate: IsoDate | null;
    payableAmount: MoneyString;
    cardLast4: string | null;
  };
}

/** `POST /v1/reconciliation/candidates/:id/accept` and
 *  `POST /v1/reconciliation/matches`'s optional variance block — a human
 *  naming the reason for an amount disagreement (a tip, a surcharge), never
 *  the amount itself: the server derives that from the evidence at hand. */
export interface MatchVarianceRequest {
  kind: MatchVarianceKind;
}

export interface AcceptMatchCandidateRequest {
  variance?: MatchVarianceRequest;
}

/** `POST /v1/reconciliation/matches` — a manual link the matcher would not
 *  necessarily have proposed itself (it is not subject to the generator's
 *  card-mismatch exclusion, which governs what is SUGGESTED, not what a
 *  person may deliberately link). */
export interface ManualMatchRequest {
  statementLineId: string;
  documentId: string;
  variance?: MatchVarianceRequest;
}

/**
 * One piece of evidence established as observing a posted transaction —
 * `event_observations`, read-side. `summary` is the one-line sentence
 * §5.3.1 Q2 calls for (*"same card ending 4417 · cleared two days later"*),
 * rendered server-side from `evidence`/the underlying rows, never stored.
 */
export interface EventObservationView {
  id: string;
  kind: 'document' | 'statement_line';
  documentId: string | null;
  statementLineId: string | null;
  confirmedAt: IsoDateTime;
  summary: string;
}

/** One bank/card movement — `statement_lines`, read-side. `matchedTransactionId`
 *  is `null` until a document observes the same event (via `event_observations`),
 *  at which point it names the ONE posted transaction that merge produced. */
export interface StatementLineView {
  id: string;
  statementId: string;
  postedDate: IsoDate;
  valueDate: IsoDate | null;
  amountSigned: MoneyString;
  descriptionRaw: string;
  cardLast4: string | null;
  accountLabel: string;
  matchedTransactionId: string | null;
}

/**
 * `GET /v1/transactions` rows — §5.3.1 Q2: "rows gain `settledDate` and
 * `observations[]`... plus `supersededBy`." Not yet read from
 * `transactions.controller.ts` (outside this ticket's owned files); defined
 * here, complete, so the wiring ticket has a contract to build against
 * rather than inventing one under time pressure.
 */
export interface TransactionRow {
  id: string;
  txnDate: IsoDate;
  /** `null` when this event has no statement-line observation yet. */
  settledDate: IsoDate | null;
  status: 'draft' | 'posted' | 'void';
  source: 'scan' | 'import' | 'manual';
  memo: string | null;
  reference: string | null;
  currency: string;
  documentId: string | null;
  postedAt: IsoDateTime | null;
  voidReason: string | null;
  /** Every piece of evidence a human has confirmed observes this event —
   *  empty only for a transaction with neither a document nor a statement
   *  line, which today means a hand-typed one. */
  observations: EventObservationView[];
  /** The id of the transaction that replaced this one, when this row was
   *  voided by a supersede (`docs/STATEMENTS.md` §5.3.1 "Materialisation:
   *  supersede, never edit"). `null` for a live row and for a void row from
   *  any other cause. */
  supersededBy: string | null;
  /**
   * Deliberately NOT the full ledger split shape (accounts.ts's internal
   * `TransactionSplitRow` also carries `taxCodeId`/`taxCode`/`gstAmount`) —
   * per D-S2, nothing this ticket adds to `packages/api-contract` carries a
   * tax figure, and this type is new here. A future ticket that wires
   * `GET /v1/transactions` to this contract, for a screen that needs the tax
   * breakdown too, adds those fields there under its own review rather than
   * inheriting them from this one by accident.
   */
  splits: Array<{
    id: string;
    lineNumber: number;
    accountId: string;
    accountCode: string;
    accountName: string;
    accountType: string;
    amount: MoneyString;
    description: string | null;
  }>;
}

/* ── Wallet, usage, rewards & device preferences ──────────────────────────────
 * Added 2026-09-19 for the mobile redesign ("Snap Apps Prototype.dc.html").
 *
 * Everything here is CONSUMER-side and USER-scoped unless a member says
 * otherwise. Two boundaries are worth stating once rather than rediscovering:
 *
 *   1. No tax figure appears anywhere in this section, for the same reason it
 *      does not appear in reconciliation: a personal workspace never sees GST,
 *      and the types should make that true by construction.
 *   2. Card data is NOT held by this product. `SavedCard` is a reference to a
 *      card held by a processor, carrying only what a human needs to recognise
 *      which card they picked. See the note on `AddSavedCardRequest`.
 * ────────────────────────────────────────────────────────────────────────── */

export type CardBrand = 'visa' | 'mastercard' | 'amex' | 'other';

/** How a purchase is authorised. The two wallets settle on-device. */
export type WalletProvider = 'card' | 'apple-pay' | 'google-pay';

/**
 * A payment instrument the user has saved for buying credit packs.
 *
 * NOT `PaymentMethod` — that name is already taken by the invoicing side,
 * where it means how a customer paid a bill (`'bank' | 'card' | 'cash' |
 * 'other'`). The two are unrelated and must not be merged: one is a record of
 * money received, this one is a stored way to spend it.
 */
export interface SavedCard {
  id: string;
  provider: WalletProvider;
  brand: CardBrand;
  /** Exactly four digits. The only part of the PAN that exists here. */
  last4: string;
  expiryMonth: number;
  /** Four digits. */
  expiryYear: number;
  /** What the user called it, or a generated "Visa ending 4417". */
  label: string;
  isDefault: boolean;
  createdAt: IsoDateTime;
}

/**
 * `POST /v1/wallet/cards`.
 *
 * `number` and `cvc` are accepted, used to mint a processor token, and then
 * discarded — they are never persisted and never appear in a `SavedCard`. Any
 * implementation that writes either to a database, a log or an error report is
 * a PCI incident, not a bug to be fixed later. The fields are named plainly
 * rather than hidden behind a "token" abstraction so that reviewing this is
 * possible; the discipline is in the server, not in the shape.
 */
export interface AddSavedCardRequest {
  provider: WalletProvider;
  nameOnCard: string;
  number: string;
  expiryMonth: number;
  expiryYear: number;
  cvc: string;
  makeDefault?: boolean;
}

export type UsageKind = 'credits' | 'points';

/** One line of "where did they go?" for a month. */
export interface UsageItem {
  id: string;
  /** Merchant, pack or reward — whatever consumed or produced the units. */
  label: string;
  occurredAt: IsoDate;
  /**
   * Units moved, always POSITIVE. The sign is implied by `UsagePeriod.kind`
   * plus the endpoint: this is a spend report, not a ledger. The signed,
   * append-only truth for points lives in `PointLedgerEntry`.
   */
  amount: number;
}

/**
 * `GET /v1/usage?kind=&month=` — one month of itemised spend.
 *
 * A convenience projection, not a source of truth. It exists because the
 * Usage screen wants "September, 19 credits, these 11 lines" and deriving that
 * client-side from the ledger means paging the whole history onto a phone.
 */
export interface UsagePeriod {
  /** `YYYY-MM`. */
  month: string;
  kind: UsageKind;
  total: number;
  items: UsageItem[];
}

/**
 * A yourtal listing that Snap Apps users are likely to want, shown here so the
 * points they earn have a visible purpose.
 *
 * READ-ONLY, and deliberately so. Points are EARNED in Snap Apps and SPENT in
 * yourtal — `PointLedgerEntry` above says exactly that and it is correct. An
 * earlier pass of this file added a points-for-credits trade inside Snap Apps
 * and flagged the contradiction; the trade was wrong and has been removed.
 *
 * The real loop (yourtal docs/09 sections 7 and 8):
 *
 *     scan a receipt          earn 1 point
 *     spend points in yourtal a voucher is minted, with a code
 *     bring the code here     Snap Apps honours it and grants credits
 *
 * So Snap Apps is a REDEEMER in yourtal's settlement protocol, never a store.
 * `deepLink` hands the user to yourtal to do the spending.
 */
export interface Reward {
  id: string;
  name: string;
  description: string;
  /** Points yourtal charges for it. Display only — nothing here can buy it. */
  cost: number;
  /** Absolute URL, or `null` while the catalogue has no artwork. */
  imageUrl: string | null;
  /** Opens yourtal at this listing. */
  deepLink: string;
  available: boolean;
}

/**
 * `POST /v1/vouchers/redeem` — a yourtal voucher presented at Snap Apps.
 *
 * Snap Apps is the merchant here. The server authorises and captures against
 * yourtal's voucher service (`authorize` -> `capture`, docs/09 section 8.1,
 * idempotency key mandatory) and grants the credits the voucher paid for.
 * The client only ever submits a code; it must never talk to yourtal directly,
 * because a client that can authorise is a client that can drain a voucher.
 *
 * Two things are NOT settled and must be before this ships:
 *   - yourtal denominates a voucher in `faceValueIdr`, and its own minor unit
 *     is still open (their YT-0506). Snap's credit packs are priced in AUD.
 *     Nothing here converts between them yet.
 *   - partial redemption is a per-batch policy in yourtal (balance-carrying,
 *     single-use, minimum spend). Snap grants whole credit packs, so only
 *     single-use makes sense today; the others need a decision.
 */
export interface RedeemVoucherRequest {
  /** As printed in yourtal: 6–24 characters. Compared case-insensitively. */
  code: string;
}

export interface VoucherRedemption {
  code: string;
  /** What the voucher was for, in yourtal's words — e.g. "10 free scans". */
  title: string;
  creditsGranted: number;
  /** The credits balance AFTER the grant, so no second fetch is needed. */
  creditsBalance: number;
  redeemedAt: IsoDateTime;
}


/**
 * What the user wants to be told about. USER-scoped, not workspace-scoped: a
 * person who belongs to two households does not want two sets of switches.
 */
export interface NotificationPrefs {
  /** A category is close to its monthly allowance. */
  budgetTight: boolean;
  /** A capture came back with something worth a human's eye. */
  reviewNeeded: boolean;
  /** Credits are nearly out, so scanning is about to stop working. */
  lowCredits: boolean;
  /** A recurring charge is due. */
  recurringDue: boolean;
  /** Product news. Off by default, and stays off unless asked for. */
  productNews: boolean;
}

export type AlertKind = 'budget' | 'review' | 'credits' | 'recurring' | 'system';

/** One entry in the in-app alert feed. */
export interface AlertItem {
  id: string;
  kind: AlertKind;
  title: string;
  body: string;
  /** Where tapping it should land, as an app path. `null` for news. */
  href: string | null;
  createdAt: IsoDateTime;
  /** `null` until the user has seen it. */
  readAt: IsoDateTime | null;
}

/**
 * Privacy choices. Every one defaults to the private option; a field absent
 * from a stored row reads as `false`/minimum rather than as "not yet asked".
 */
export interface PrivacySettings {
  /** Anonymous product analytics. */
  analyticsOptIn: boolean;
  /** Crash and error reports. */
  crashReports: boolean;
  /** Letting the extractor's output improve the shared model. */
  contributeToModel: boolean;
  /**
   * How long an original image is kept after its document is deleted.
   * The ATO substantiation floor is five years, so the server clamps this to
   * at least 60 and the UI must not offer less.
   */
  retentionMonths: number;
}

/** Why a code was sent. Reused for the resend and the verify. */
export type OtpPurpose = 'register' | 'reset-password' | 'sign-in';

export interface RequestOtpRequest {
  email: string;
  purpose: OtpPurpose;
}

/**
 * `POST /v1/auth/otp/request` response.
 *
 * Deliberately says nothing about whether the address exists — an endpoint
 * that answers that is an account-enumeration oracle. It always reports
 * "sent", and `retryAfterSeconds` is the only thing that varies.
 */
export interface RequestOtpResponse {
  /** Seconds the client should disable "Resend" for. */
  retryAfterSeconds: number;
  /** Where the code went, masked: `k••••@example.com`. */
  maskedTarget: string;
}

export interface VerifyOtpRequest {
  email: string;
  /** Six digits, as typed. Compared server-side in constant time. */
  code: string;
  purpose: OtpPurpose;
}

export interface ResetPasswordRequest {
  email: string;
  code: string;
  newPassword: string;
}
