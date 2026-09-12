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
 *  capture contract). */
export type PageSource = 'capture' | 'pdf_native' | 'pdf_render';

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
  saved: string;
  /** null for an open-ended goal. */
  targetDate: string | null;
  /** What must go in each month to land it on time. null when open-ended. */
  perMonth: string | null;
  done: boolean;
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

export interface CategorySetting {
  name: string;
  /** Deduction label this maps to, e.g. D1. null in the personal workspace. */
  taxLabel: string | null;
  monthlyBudget: string | null;
  documentCount: number;
  totalSpend: string;
  /** False for a category the user has switched off; it stops being offered. */
  active: boolean;
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
  | 'manage_operations';

/** `GET /v1/admin/me` — what the signed-in caller may do on this plane. */
export interface AdminSession {
  staffId: string;
  role: PlatformStaffRole;
  capabilities: PlatformCapability[];
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
