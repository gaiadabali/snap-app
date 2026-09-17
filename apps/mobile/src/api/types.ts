/**
 * THE SEAM.
 *
 * Every screen talks to this interface and nothing else. The demo is wired to
 * `MockApi`; the server implementation drops in behind the same shape without
 * touching a single screen. That is why the app can be built before the server
 * exists without becoming throwaway work.
 *
 * The response SHAPES live in `@snap/api-contract`, which the server imports
 * too — so the two sides cannot drift without failing to compile. What stays
 * here is the interface itself: a set of methods is a client-side concern, and
 * the server expresses the same contract as routes.
 *
 * Money is always a decimal STRING. Never a number: a JSON float cannot hold
 * 110.10 exactly, and a BAS out by a cent is wrong.
 */
export type * from '@snap/api-contract';

/**
 * The body of `POST /v1/captures/:id/device-reading` — ON-DEVICE.md §3.5.
 *
 * Declared here rather than in `@snap/api-contract` because the shape is the
 * device's, not the ledger's: it carries a DocDOM and timings that only the
 * phone can produce, and nothing on the web side ever sends one.
 */
export type DeviceReading = {
  engine: 'device-vision' | 'device-mlkit';
  engineVersion: string;
  docdom: unknown;
  preview: Record<string, unknown>;
  timings: { recogniseMs: number; structureMs: number };
  device: {
    platform: string;
    osVersion: string;
    model?: string;
    /** What the OS reports as total RAM. The only evidence §1.2's 4GB floor
     *  will ever have — see migration 0028. */
    totalMemoryMb?: number;
  };
};

import type {
  AnalyticsRange,
  AnalyticsSummary,
  AuthUser,
  BasSummary,
  Bill,
  BillStatus,
  Budget,
  BusinessSettings,
  CategorySetting,
  CategorySpend,
  ComplianceFailure,
  Connection,
  ConnectionStatus,
  DeductionSummary,
  DocumentFilter,
  DocumentLine,
  DocumentView,
  Goal,
  Invitation,
  Invoice,
  InvoiceLine,
  InvoiceStatus,
  Item,
  Member,
  MemberList,
  MemberRole,
  MerchantSpend,
  MileageSummary,
  OnboardingInput,
  Overview,
  Party,
  Payment,
  PaymentMethod,
  Permissions,
  PersonalSummary,
  PlanUsage,
  Recurring,
  ReviewState,
  SalesSummary,
  SeriesPoint,
  Session,
  StockMovement,
  TaxPack,
  TaxPackSection,
  Trip,
  Workspace,
  WorkspaceSummary,
  CreateCaptureRequest,
  CreateCaptureResponse,
  TaxPackFile,
  UpdateDocumentRequest,
  CreditBalance,
  CreditPack,
  CreditPurchase,
  PointBalance,
  PointLedgerEntry,
} from '@snap/api-contract';

/**
 * Credits and points (`docs/ECOSYSTEM.md` D27) — the real contract types,
 * from `@snap/api-contract`, the one workspace package this app may depend
 * on (`test/boundaries.test.ts`). No shape is re-declared here: an earlier
 * pass of this file invented `CreditsSummary`/`PointsSummary`/`CreditGrant`
 * against a guess at what the server would return, built in parallel with
 * this client, and the guess didn't match — the same class of bug as
 * `AuthUser.initials` shipping absent from every response. The fix is to
 * import the wire types and compose a view model in the screen, not in this
 * file.
 *
 * Three balances, never conflated (D27's whole point):
 *   - plan quota  — `PlanUsage.scanQuota`/`scansUsed`, tenant, resets monthly.
 *   - credits     — `CreditBalance`/`CreditPack`/`CreditPurchase`, tenant,
 *                    bought or granted, never reset.
 *   - points      — `PointBalance`/`PointLedgerEntry`, USER-scoped, earned by
 *                    scanning, never reset.
 *
 * There is no grant-level breakdown endpoint (e.g. "free-to-start: 7 of 10
 * left" as its own row) — only the aggregate `CreditBalance.creditsRemaining`
 * and the purchase list. The credits screen's copy says so as static text
 * rather than inventing a `grants` array to render.
 */

export interface SnapApi {
  // ── Identity ──
  /** The signed-in session, or null. Resolved from persisted local state. */
  getSession(): Promise<Session | null>;
  /**
   * Signs in by email alone.
   *
   * The demo has no identity provider, so this stands in for the round trip to
   * one: a known address returns that person's real memberships, and an
   * unknown one creates an account with none, which lands on onboarding.
   */
  /**
   * Record what the device's own recogniser read for a capture (OD-7).
   *
   * Advisory and fire-and-forget. It never blocks the capture, never gates the
   * review screen, and a failure is not shown to anybody — the server's read
   * is the record either way, and a person who has just photographed a receipt
   * does not need to hear that a shadow measurement did not upload.
   */
  recordDeviceReading(captureId: string, reading: DeviceReading): Promise<void>;
  signIn(email: string): Promise<Session>;
  /**
   * Create an account with a password, or sign in with one.
   *
   * Passwords exist because no mail transport is configured, so the magic link
   * is generated and never sent — see migration 0025. The same consequence
   * follows here: there is no reset method on this interface, because a reset
   * needs email too.
   */
  register(email: string, password: string, displayName?: string): Promise<Session>;
  signInWithPassword(email: string, password: string): Promise<Session>;
  signOut(): Promise<void>;
  /** Creates the first workspace for a new account and returns the session. */
  completeOnboarding(input: OnboardingInput): Promise<Session>;
  /** The demo accounts, so a presenter can switch person without typing. */
  listDemoAccounts(): Promise<AuthUser[]>;
  /**
   * Redeems an invitation token and joins the workspace.
   *
   * The one write a NON-member makes, so it cannot be scoped to a workspace
   * the caller is already in. Every rule — the token, the address it was sent
   * to, the seat limit — is checked server-side in one transaction.
   */
  acceptInvitation(token: string): Promise<{ workspace: WorkspaceSummary; role: MemberRole }>;

  getOverview(): Promise<Overview>;
  listDocuments(filter?: DocumentFilter, workspace?: Workspace): Promise<DocumentView[]>;
  getDocument(id: string): Promise<DocumentView | null>;
  /** Edits a document. Does NOT post it — editing and posting are separate acts. */
  updateDocument(id: string, body: UpdateDocumentRequest): Promise<DocumentView>;
  /** Confirms and posts to the ledger, locking the confirmed fields. */
  confirmDocument(id: string): Promise<DocumentView>;
  /**
   * Withdraws a mis-scan from every list.
   *
   * The capture is kept: the image is the legal record and must survive five
   * years. What is rejected is the extraction, not the evidence.
   */
  rejectDocument(id: string, reason: string): Promise<void>;
  /** Begins a capture; in production returns a presigned upload URL. */
  createCapture(body: CreateCaptureRequest): Promise<CreateCaptureResponse>;
  /**
   * PUTs the original bytes to the presigned URL from `createCapture`.
   * Separate from `createCapture` because the upload goes straight to object
   * storage, not through the API — the server never proxies the image.
   */
  uploadOriginal(uploadUrl: string, bytes: ArrayBuffer, mimeType: string): Promise<void>;
  /** Resolves once extraction has produced a document for the capture. */
  awaitExtraction(
    captureId: string,
    localImageUri?: string,
    workspace?: Workspace,
  ): Promise<DocumentView>;

  // ── Spending ──
  /** The personal tracker's month: spend, budget, and what is left per day. */
  getPersonal(): Promise<PersonalSummary>;
  /**
   * Sets one category's monthly budget and returns the recomputed month.
   *
   * Returns the whole summary rather than an acknowledgement: changing a
   * budget changes what is left, what is safe to spend today, and whether the
   * month is over — the screen would have to refetch all of it anyway.
   */
  setBudget(category: string, monthly: string): Promise<PersonalSummary>;
  /**
   * Spending analytics for one workspace over one range.
   *
   * Computed behind the seam, exactly as the server will compute it — a phone
   * should not be bucketing a year of receipts to draw a chart.
   */
  getAnalytics(workspace: Workspace, range: AnalyticsRange): Promise<AnalyticsSummary>;

  // ── Business side ──
  getSales(): Promise<SalesSummary>;
  listInvoices(kind?: 'invoice' | 'estimate'): Promise<Invoice[]>;
  getInvoice(id: string): Promise<Invoice | null>;
  /**
   * Turns an accepted estimate into an invoice.
   *
   * A copy, not a conversion in place. The estimate is what the customer
   * agreed to and stays on file unchanged; the invoice is the tax document,
   * and its GST is recomputed rather than copied — a quote may be months old
   * and the amounts are what matter to the ATO, not what was pasted.
   */
  convertEstimate(estimateId: string): Promise<Invoice>;
  listItems(): Promise<Item[]>;
  createItem(item: Omit<Item, 'id' | 'lowStock'>): Promise<Item[]>;
  listParties(kind?: 'customer' | 'supplier'): Promise<Party[]>;
  createParty(party: {
    name: string;
    kind: 'customer' | 'supplier';
    abn?: string | null;
    email?: string | null;
    phone?: string | null;
  }): Promise<Party[]>;

  // ── Collaboration ──
  listWorkspaces(): Promise<WorkspaceSummary[]>;
  createWorkspace(name: string, kind: Workspace): Promise<WorkspaceSummary>;
  getPermissions(workspaceId: string): Promise<Permissions>;
  listMembers(workspaceId: string): Promise<MemberList>;
  inviteMember(workspaceId: string, email: string, role: MemberRole): Promise<MemberList>;
  revokeInvitation(workspaceId: string, invitationId: string): Promise<MemberList>;
  updateMemberRole(workspaceId: string, userId: string, role: MemberRole): Promise<MemberList>;
  removeMember(workspaceId: string, userId: string): Promise<MemberList>;
  /** Hides a personal receipt's detail from everyone but its owner. */
  setVisibility(documentId: string, visibility: 'shared' | 'private'): Promise<DocumentView>;
  /**
   * Replaces a document's lines after a human correction.
   *
   * Sent whole rather than as a patch per line: the lines have to be judged
   * against the total as a set, and a per-line PATCH would let the document
   * pass through states where it does not add up.
   */
  updateLines(documentId: string, lines: DocumentLine[]): Promise<DocumentView>;

  // ── Money out ──
  listBills(): Promise<Bill[]>;
  /**
   * Pays a bill, in full or in part.
   *
   * Part payments are ordinary in freight: a supplier disputes one line and
   * the rest is settled. Omitting `amount` pays the balance.
   */
  payBill(billId: string, amount?: string): Promise<Bill>;
  listPayments(): Promise<Payment[]>;
  /** Records money received against an invoice and re-derives what is owed. */
  recordPayment(
    invoiceId: string,
    amount: string,
    method: PaymentMethod,
    reference?: string,
  ): Promise<Payment>;

  // ── Mileage ──
  getMileage(): Promise<MileageSummary>;
  addTrip(trip: Omit<Trip, 'id'>): Promise<MileageSummary>;
  deleteTrip(tripId: string): Promise<MileageSummary>;

  // ── Stock ──
  listStockMovements(): Promise<StockMovement[]>;
  /** Sets an item's counted quantity and records the adjustment. */
  countStock(itemId: string, countedQuantity: number): Promise<Item[]>;

  // ── Personal extras ──
  listRecurring(): Promise<Recurring[]>;
  listGoals(): Promise<Goal[]>;
  createGoal(name: string, target: string, targetDate: string | null): Promise<Goal[]>;
  contributeToGoal(goalId: string, amount: string): Promise<Goal[]>;
  deleteGoal(goalId: string): Promise<Goal[]>;

  // ── Settings ──
  getBusinessSettings(): Promise<BusinessSettings>;
  updateBusinessSettings(patch: Partial<BusinessSettings>): Promise<BusinessSettings>;
  listCategorySettings(workspace: Workspace): Promise<CategorySetting[]>;
  setCategoryActive(name: string, active: boolean): Promise<CategorySetting[]>;
  /** Adds a category the user names themselves, with an optional budget. */
  createCategory(
    name: string,
    workspace: Workspace,
    monthlyBudget?: string | null,
  ): Promise<CategorySetting[]>;
  getPlanUsage(): Promise<PlanUsage>;
  listConnections(): Promise<Connection[]>;
  /**
   * Begins the OAuth round trip, which LEAVES the app.
   *
   * Returns the URL to open in a browser, not a connected state: the app
   * cannot know whether the user completed the consent screen, and reporting
   * success before they have is how a sync that never happens gets promised.
   * The connection appears in `listConnections` after the callback lands.
   */
  connectAccounting(id: Connection['id']): Promise<{ authorizeUrl: string }>;
  disconnectAccounting(id: Connection['id']): Promise<Connection[]>;
  getTaxPack(): Promise<TaxPack>;
  /**
   * Assembles the pack and returns where to fetch it.
   *
   * Separate from `getTaxPack`, which only DESCRIBES what a pack would hold.
   * Assembling one means zipping a financial year of original images, which is
   * a server job measured in seconds, not a screen that can pretend.
   */
  prepareTaxPack(): Promise<TaxPackFile>;

  // ── Credits & points (D27) ──
  /** `GET /v1/credit-packs` — the catalogue, active packs only. */
  listCreditPacks(): Promise<CreditPack[]>;
  /** `GET /v1/credits` — the balance ALONE, never folded with plan quota. */
  getCreditBalance(): Promise<CreditBalance>;
  /** `GET /v1/credits/purchases` — this workspace's purchase history. */
  listCreditPurchases(): Promise<CreditPurchase[]>;
  /**
   * `POST /v1/credits/purchases` — records intent to buy a pack. Returns it
   * `pending`; nothing is granted yet. There is no payment processor (Stripe
   * is phase 6.5), so a real checkout does not exist for this to redirect to.
   */
  startCreditPurchase(packCode: string): Promise<CreditPurchase>;
  /**
   * `POST /v1/credits/purchases/:id/fulfil` — the manual stand-in for a
   * payment processor's webhook: marks the purchase `paid` and grants the
   * credits, atomically. Idempotent — fulfilling an already-paid purchase
   * returns it unchanged rather than granting twice.
   */
  fulfilCreditPurchase(purchaseId: string): Promise<CreditPurchase>;

  /** `GET /v1/points` — USER-scoped, not workspace-scoped. */
  getPointBalance(): Promise<PointBalance>;
  /** `GET /v1/points/ledger` — most recent first, how the balance was earned. */
  listPointLedger(limit?: number): Promise<PointLedgerEntry[]>;
}

/**
 * The contract the generated fixture must satisfy.
 * See apps/server/scripts/gen-demo-fixtures.ts.
 */
export interface DemoShape {
  generatedAt: string;
  rates: { fy: string; determination: string };
  profile: {
    id: string;
    label: string;
    benchmarkMax: number | null;
    benchmarkCommon: number[] | null;
  };
  tenant: {
    name: string;
    abn: string;
    gstRegistered: boolean;
    gstBasis: 'cash' | 'accrual';
    simplerBas: boolean;
  };
  documents: DocumentView[];
  workspaces: Array<{
    id: string;
    name: string;
    kind: Workspace;
    role: MemberRole;
    abn: string | null;
  }>;
  members: Array<{
    workspaceId: string;
    userId: string;
    displayName: string;
    email: string | null;
    role: MemberRole;
    joinedAt: string;
    lastActiveAt: string | null;
  }>;
  invitations: Invitation[];
  bills: Bill[];
  payments: Payment[];
  trips: Trip[];
  mileage: {
    centsPerKmRate: number;
    centsPerKmCapKm: number;
    logbookPercent: number;
  };
  stockMovements: StockMovement[];
  goals: Goal[];
  connections: Connection[];
  plan: PlanUsage;
  settings: BusinessSettings;
  personal: {
    name: string;
    budgetTotal: string;
    budgets: Budget[];
  };
  bas: BasSummary;
  deductions: DeductionSummary;
  sales: SalesSummary;
  invoices: Invoice[];
  items: Item[];
  parties: Party[];
  entitlement: {
    planCode: string;
    realtime: boolean;
    scanQuota: number;
    scansUsed: number;
    scansRemaining: number;
    firmName: string;
  };
}
