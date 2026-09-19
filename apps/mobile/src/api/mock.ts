import type {
  CapturePageUpload,
  CreateCaptureRequest,
  CreateCaptureResponse,
  PatchCaptureDocumentRequest,
  UpdateDocumentRequest,
} from '@snap/api-contract';

import { DEMO } from '@/fixtures/demo';
import { gstFromInclusive } from '@/lib/money';

import { ApiError } from './http';
import { MUTATION } from './mutations';
import { clearPersisted, loadPersisted, persist, type Persisted } from './persist';
import {
  analyticsSummary,
  detectRecurring,
  personalSummary,
  startOfMonth,
  startOfQuarter,
} from '@/lib/analytics';

import type {
  AnalyticsRange,
  AuthUser,
  AnalyticsSummary,
  Bill,
  Budget,
  BusinessSettings,
  CategorySetting,
  Connection,
  CreditBalance,
  CreditPack,
  CreditPurchase,
  DocumentFilter,
  DocumentLine,
  DocumentView,
  Goal,
  GoalContribution,
  Invitation,
  Invoice,
  Item,
  Member,
  MemberList,
  MemberRole,
  MileageSummary,
  OnboardingInput,
  Overview,
  Party,
  Payment,
  PaymentMethod,
  Permissions,
  PersonalSummary,
  PlanUsage,
  PointBalance,
  PointLedgerEntry,
  Recurring,
  SalesSummary,
  Session,
  SnapApi,
  AvailableTaxRules,
  SavedCard,
  AddSavedCardRequest,
  CardBrand,
  UsageKind,
  UsageItem,
  UsagePeriod,
  Reward,
  RedeemVoucherRequest,
  VoucherRedemption,
  NotificationPrefs,
  AlertItem,
  PrivacySettings,
  OtpPurpose,
  RequestOtpRequest,
  RequestOtpResponse,
  VerifyOtpRequest,
  ResetPasswordRequest,
  StockMovement,
  TaxPack,
  Trip,
  Workspace,
  TaxPackFile,
  WorkspaceSummary,
} from './types';

/**
 * Demo implementation of `SnapApi`, backed by the generated fixtures.
 *
 * The fixtures are produced by `apps/server/scripts/gen-demo-fixtures.ts` from
 * the REAL tax engine — GST at exactly 1/11, deduction estimates at TD 2025/4
 * rates. Nothing here invents a figure, because a finance agency in the room
 * will check them.
 *
 * Latency is simulated so the demo feels like a real network rather than an
 * instant local read; extraction takes a beat, as it will in production.
 */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Mutable session state: edits and confirmations persist for the demo run. */
let docs: DocumentView[] = DEMO.documents.map((d) => ({ ...d }));

/**
 * The workspaces the signed-in person belongs to.
 *
 * Every read is scoped through this. Two were fixed when a test caught them —
 * the workspace list and the document list — and the other seven were left,
 * which is the usual way a leak survives: the case someone checked is closed
 * and the identical cases beside it are not. A brand-new business workspace
 * was still shown K. Marsh Transport's name, BAS position, trip log and plan.
 */
const myWorkspaceIds = (): Set<string> =>
  new Set(members.filter((m) => m.userId === WHO).map((m) => m.workspaceId));

/** True when the signed-in person is actually in the fixture's business. */
const inDemoBusiness = (): boolean => myWorkspaceIds().has(DEMO.workspaces[0]!.id);

const business = () => {
  const mine = myWorkspaceIds();
  return docs.filter((d) => d.workspace === 'business' && mine.has(d.workspaceId));
};

/** Budgets are session state too, so adjusting one moves the demo's figures. */
let budgets: Budget[] = DEMO.personal.budgets.map((b) => ({ ...b }));
const budgetTotal = () => sumDecimal(budgets.map((b) => b.monthly));

/**
 * Everything else the demo can change, held as session state.
 *
 * Copied out of the fixture rather than read through it, so recording a
 * payment or paying a bill visibly moves the figures on the screens that
 * depend on them — which is the whole point of demonstrating an action.
 */
/**
 * The signed-in user.
 *
 * This was a hardcoded constant, which is why collaboration only half worked:
 * roles existed but there was no way to BE anyone else, so `isYou` was always
 * Kate and a Staff member's inability to post to the ledger could not be
 * demonstrated. It is now session state, and everything downstream —
 * permissions, attribution on a capture, which workspaces are listed — follows
 * from it.
 *
 * Defaults to the owner so a cold start with no stored session still shows a
 * populated app rather than an empty one.
 */
let WHO = 'usr_kate';

/**
 * The demo accounts.
 *
 * Deliberately spans all four roles across two workspaces, because the point
 * of signing in as someone else is to see the app behave differently. Dan is
 * the interesting one: Staff, so he can scan and correct but cannot post.
 */
const ACCOUNTS: Array<AuthUser & { role: string; note: string }> = [
  {
    userId: 'usr_kate',
    displayName: 'Kate Marsh',
    email: 'kate@marshtransport.example',
    initials: 'KM',
    role: 'Owner of both workspaces',
    note: 'Sees the business and the household',
  },
  {
    userId: 'usr_sam',
    displayName: 'Sam Oyelaran',
    email: 'sam@marshtransport.example',
    initials: 'SO',
    role: 'Manager',
    note: 'Everything except billing',
  },
  {
    userId: 'usr_dan',
    displayName: 'Dan Whitby',
    email: 'dan@marshtransport.example',
    initials: 'DW',
    role: 'Staff',
    note: 'Scans and corrects; cannot post to the ledger',
  },
  {
    userId: 'usr_jem',
    displayName: 'Jem Marsh',
    email: 'jem@example.com',
    initials: 'JM',
    role: 'Partner, household only',
    note: 'Never sees the business',
  },
  {
    userId: 'usr_pri',
    displayName: 'Priya Nandan',
    email: 'priya@marshaccountants.example',
    initials: 'PN',
    role: 'Viewer, the accountant',
    note: 'Read only',
  },
];

/**
 * Occupation labels offered at onboarding.
 *
 * The authoritative list lives in `@snap/tax-engine`'s PROFILES, which the app
 * may not import — the boundary test enforces that. These are the four the
 * onboarding screen offers, and the server sends the real label once it exists.
 */
const OCCUPATION_LABELS: Record<string, string> = {
  truckie_long: 'Long-haul truck driver',
  tradie: 'Tradesperson',
  nurse: 'Nurse or carer',
  sole: 'Sole trader',
};

function initialsOfName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

function sessionFor(userId: string): Session | null {
  const known = ACCOUNTS.find((a) => a.userId === userId);
  const membership = members.find((m) => m.userId === userId);
  if (!known && !membership) return null;
  const displayName = known?.displayName ?? membership?.displayName ?? 'You';
  return {
    user: {
      userId,
      displayName,
      email: known?.email ?? membership?.email ?? '',
      initials: known?.initials ?? initialsOfName(displayName),
    },
    workspaceIds: members.filter((m) => m.userId === userId).map((m) => m.workspaceId),
  };
}
let invoices: Invoice[] = DEMO.invoices.map((i) => ({ ...i }));
let bills: Bill[] = DEMO.bills.map((b) => ({ ...b }));
let payments: Payment[] = DEMO.payments.map((x) => ({ ...x }));
let trips: Trip[] = DEMO.trips.map((t) => ({ ...t }));
let items: Item[] = DEMO.items.map((i) => ({ ...i }));
let movements: StockMovement[] = DEMO.stockMovements.map((m) => ({ ...m }));
let goals: Goal[] = DEMO.goals.map((g) => ({ ...g }));
/**
 * One 'opening_balance' contribution per demo goal that already has money in
 * it — mirroring migration 0030's real backfill honestly rather than
 * inventing per-transaction history the demo data never had.
 */
let goalContributions: GoalContribution[] = DEMO.goals
  .filter((g) => Number(g.saved) > 0)
  .map((g) => ({
    id: `gc_opening_${g.id}`,
    goalId: g.id,
    amount: g.saved,
    occurredOn: isoDaysAgo(180),
    createdAt: new Date(Date.now() - 180 * 86_400_000).toISOString(),
    createdByName: null,
    source: 'opening_balance' as const,
  }));
let connections: Connection[] = DEMO.connections.map((c) => ({ ...c }));
let settings: BusinessSettings = { ...DEMO.settings };
let members = DEMO.members.map((m) => ({ ...m }));
let invitations: Invitation[] = DEMO.invitations.map((i) => ({ ...i }));
let parties: Party[] = DEMO.parties.map((p) => ({ ...p }));
const inactiveCategories = new Set<string>();
/** Business categories the user added by hand, before anything is filed to them. */
const customCategories = new Set<string>();

/**
 * The six catalogue packs — `docs/ECOSYSTEM.md` D27's pricing table, verbatim,
 * in the `CreditPack` shape from `@snap/api-contract` (`code`/`credits`, not
 * the `id`/`scans` this file guessed at before the server's contract landed).
 * Not generated: this is a fixed price list, not derived from any document,
 * so it lives beside the other hand-authored demo constants (`ACCOUNTS`,
 * `OCCUPATION_LABELS`) rather than in the generated fixture.
 */
// MIRRORS migration 0027, which reprices every pack to credits x $0.033 —
// model cost x 3, measured in MONETISATION.md §5 at ~$0.011 a scan. The
// migration asserts that relationship in SQL, so these are not independent
// numbers to keep in step by hand: they are that arithmetic, written out.
//
// The old figures (0.15 / 0.70 / 1.30 / 2.40 / 5.50 / 10.00) survived here
// after the repricing landed, which would have demoed prices nobody will ever
// be charged. Caught by snap-apps-c3, who repriced the database and checked
// what else quoted the old numbers.
//
// The CODES were also wrong — `pack_10` here against `credits_10` in the
// database. A fixture may legitimately invent data, but not a different
// identifier for the same thing: a demo that shows `pack_10` and a support
// conversation about `credits_10` are about the same pack and do not look it.
const CREDIT_PACKS: CreditPack[] = [
  { code: 'credits_10', credits: 10, priceAud: '0.33', sortOrder: 10 },
  { code: 'credits_50', credits: 50, priceAud: '1.65', sortOrder: 20 },
  { code: 'credits_100', credits: 100, priceAud: '3.30', sortOrder: 30 },
  { code: 'credits_200', credits: 200, priceAud: '6.60', sortOrder: 40 },
  { code: 'credits_500', credits: 500, priceAud: '16.50', sortOrder: 50 },
  { code: 'credits_1000', credits: 1000, priceAud: '33.00', sortOrder: 60 },
];

/**
 * Credits (tenant-scoped) and points (user-scoped) — D27.
 *
 * Kept as session state exactly like `budgets`/`goals`: a purchase in the
 * demo has to move the balance on screen, or "buy a pack" would be a button
 * that does nothing.
 *
 * The server exposes only the AGGREGATE credits balance
 * (`GET /v1/credits` -> `{ creditsRemaining }`) — there is no grant-level
 * breakdown endpoint, so this mock does not invent one either. Internally it
 * still tracks a free signup grant and any paid purchases to derive that one
 * number, the same arithmetic `getCreditBalance` (migration 0024) does over
 * `usage_grants` — but nothing here is shaped like a `grants` API response,
 * because there isn't one.
 *
 * Seed functions rather than inline literals so `resetDemoData` can restore
 * exactly this starting state without repeating it.
 */
let creditBalance = 7; // 10 free-to-start, 3 already used — see docs/ECOSYSTEM.md D27.
const seedCreditPurchases = (): CreditPurchase[] => [
  {
    id: 'cpu_1',
    packCode: 'credits_50',
    credits: 50,
    // Matches CREDIT_PACKS above, which matches migration 0027. A seeded
    // purchase showing a price no pack sells for is the same demo lie as a
    // stale catalogue, one row further down.
    priceAud: '1.65',
    status: 'paid',
    provider: 'manual',
    createdAt: '2026-06-02T01:15:00.000Z',
    paidAt: '2026-06-02T01:15:40.000Z',
  },
];
/** One point per scan (D27); a handful seeded against real fixture dates. */
const seedPointLedger = (): PointLedgerEntry[] =>
  DEMO.documents.slice(0, 6).map((d, i) => ({
    id: `pt_${i + 1}`,
    delta: 1,
    reason: 'scan',
    ref: d.id,
    app: 'snap-apps',
    createdAt: `${d.issueDate}T09:00:00.000Z`,
  }));

let creditPurchases: CreditPurchase[] = seedCreditPurchases();
let pointLedger: PointLedgerEntry[] = seedPointLedger();

/**
 * Hydration, run once before the first read.
 *
 * Every method starts with `await settle(...)` rather than `await sleep(...)`,
 * so hydration is awaited exactly where the simulated latency already was —
 * one seam instead of thirty, and no method can forget it.
 */
let hydration: Promise<void> | null = null;

/**
 * SHA-256 of every capture this session has seen, to its capture id.
 *
 * Photographing the same docket twice is common — you are not sure the first
 * one worked — and it must not produce two claims for one expense.
 */
const seenHashes = new Map<string, string>();

/**
 * Whether anyone has signed in on this device.
 *
 * Separate from WHO because the two answer different questions: WHO is which
 * person the app is acting as, and this is whether the sign-in screen has been
 * passed at all. Without it a cold start would look identical to a session.
 */
let signedIn = false;

/** Documents removed by a human: rejected or deleted. */
let removedDocIds = new Set<string>();
/** Workspaces created during the session, beyond the two in the fixture. */
let extraWorkspaces: Array<{ id: string; name: string; kind: 'business' | 'personal' }> = [];

function snapshot(): Persisted {
  // Documents are stored as a delta. The fixture is already in the bundle, so
  // writing all 919 of them back would cost a megabyte to record nothing.
  const fixtureById = new Map(DEMO.documents.map((d) => [d.id, d]));
  const docOverrides: Record<string, Partial<DocumentView>> = {};
  const newDocs: DocumentView[] = [];

  for (const d of docs) {
    const original = fixtureById.get(d.id);
    if (!original) {
      newDocs.push(d);
      continue;
    }
    const diff: Record<string, unknown> = {};
    for (const k of Object.keys(d) as Array<keyof DocumentView>) {
      if (JSON.stringify(d[k]) !== JSON.stringify(original[k])) diff[k as string] = d[k];
    }
    if (Object.keys(diff).length > 0) docOverrides[d.id] = diff as Partial<DocumentView>;
  }

  return {
    v: 1,
    docOverrides,
    newDocs,
    removedDocIds: [...removedDocIds],
    budgets,
    invoices,
    payments,
    bills,
    trips,
    items,
    movements,
    goals,
    connections,
    settings,
    members,
    invitations,
    signedInUserId: WHO,
    signedIn,
    inactiveCategories: [...inactiveCategories],
    customCategories: [...customCategories],
    extraWorkspaces,
    creditBalance,
    creditPurchases,
    pointLedger,
  };
}

/**
 * Every method whose name says it changes something.
 *
 * Placing `save()` by hand in each mutation is 27 chances to forget one, and a
 * forgotten one is a change that silently does not survive a reload. This
 * matches on the verb instead, so a method added later is covered the moment
 * it is named like the others. `mutations.test.ts` asserts that every mutating
 * method really is named like the others, and that no read is.
 */


/**
 * Wraps the API so that any mutation queues a write.
 *
 * Reads are deliberately NOT wrapped: building the document delta is real
 * work, and doing it after a list read would put a hitch into scrolling for
 * no benefit.
 */
export function createApi(): SnapApi {
  const target = new MockApi();
  return new Proxy(target, {
    get(t, prop, receiver) {
      const value = Reflect.get(t, prop, receiver);
      if (typeof value !== 'function' || typeof prop !== 'string') return value;
      if (!MUTATION.test(prop)) return value.bind(t);
      return async (...args: unknown[]) => {
        const out = await (value as (...a: unknown[]) => Promise<unknown>).apply(t, args);
        persist(snapshot);
        return out;
      };
    },
  }) as unknown as SnapApi;
}

/** Forgets every demo change and returns the app to the shipped fixture. */
export async function resetDemoData(): Promise<void> {
  await clearPersisted();
  docs = DEMO.documents.map((d) => ({ ...d }));
  removedDocIds = new Set();
  budgets = DEMO.personal.budgets.map((b) => ({ ...b }));
  invoices = DEMO.invoices.map((i) => ({ ...i }));
  bills = DEMO.bills.map((b) => ({ ...b }));
  payments = DEMO.payments.map((x) => ({ ...x }));
  trips = DEMO.trips.map((t) => ({ ...t }));
  items = DEMO.items.map((i) => ({ ...i }));
  movements = DEMO.stockMovements.map((m) => ({ ...m }));
  goals = DEMO.goals.map((g) => ({ ...g }));
  connections = DEMO.connections.map((c) => ({ ...c }));
  settings = { ...DEMO.settings };
  members = DEMO.members.map((m) => ({ ...m }));
  invitations = DEMO.invitations.map((i) => ({ ...i }));
  parties = DEMO.parties.map((x) => ({ ...x }));
  inactiveCategories.clear();
  customCategories.clear();
  extraWorkspaces = [];
  creditBalance = 7;
  creditPurchases = seedCreditPurchases();
  pointLedger = seedPointLedger();
  WHO = 'usr_kate';
  signedIn = false;
}

async function hydrate(): Promise<void> {
  const stored = await loadPersisted();
  if (!stored) return;

  removedDocIds = new Set(stored.removedDocIds ?? []);
  const overrides = stored.docOverrides ?? {};
  docs = [
    ...(stored.newDocs ?? []),
    ...DEMO.documents.map((d) => (overrides[d.id] ? { ...d, ...overrides[d.id] } : { ...d })),
  ]
    .filter((d) => !removedDocIds.has(d.id))
    .sort((a, b) => b.issueDate.localeCompare(a.issueDate));

  if (stored.budgets?.length) budgets = stored.budgets;
  if (stored.invoices?.length) invoices = stored.invoices;
  if (stored.payments) payments = stored.payments;
  if (stored.bills?.length) bills = stored.bills;
  if (stored.trips) trips = stored.trips;
  if (stored.items?.length) items = stored.items;
  if (stored.movements) movements = stored.movements;
  if (stored.goals) goals = stored.goals;
  if (stored.connections?.length) connections = stored.connections;
  if (stored.settings) settings = stored.settings;
  if (stored.members?.length) members = stored.members;
  if (stored.invitations) invitations = stored.invitations;
  for (const c of stored.inactiveCategories ?? []) inactiveCategories.add(c);
  for (const c of stored.customCategories ?? []) customCategories.add(c);
  extraWorkspaces = stored.extraWorkspaces ?? [];
  if (typeof stored.creditBalance === 'number') creditBalance = stored.creditBalance;
  if (stored.creditPurchases) creditPurchases = stored.creditPurchases;
  if (stored.pointLedger) pointLedger = stored.pointLedger;
  // Restored last, so the session lines up with the memberships just loaded.
  if (stored.signedInUserId) WHO = stored.signedInUserId;
  signedIn = stored.signedIn ?? false;
}

function hydrated(): Promise<void> {
  hydration ??= hydrate();
  return hydration;
}

/** Simulated latency, with hydration folded in. */
const settle = async (ms: number): Promise<void> => {
  await hydrated();
  await sleep(ms);
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const todayIso = () => iso(new Date());

/** Two letters for an avatar. Computed once here so every screen agrees. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

/**
 * What a role may do.
 *
 * The line that matters is `canConfirm`. Anyone in a workspace may photograph
 * a receipt — that is the point of sharing one — but posting it to the ledger
 * is an owner/admin act, because that is the entry an accountant and the ATO
 * will later hold someone to.
 */
function permissionsFor(role: MemberRole): Permissions {
  const admin = role === 'owner' || role === 'admin';
  const canWrite = admin || role === 'member';
  return {
    canCapture: canWrite,
    canEdit: canWrite,
    canConfirm: admin,
    canInvite: admin,
    canManageBudgets: admin,
    canBill: admin,
  };
}

function memberList(workspaceId: string): MemberList {
  const mine = members.filter((m) => m.workspaceId === workspaceId);
  return {
    members: mine.map<Member>((m) => ({
      userId: m.userId,
      displayName: m.displayName,
      email: m.email,
      role: m.role,
      initials: initialsOf(m.displayName),
      isYou: m.userId === WHO,
      joinedAt: m.joinedAt,
      lastActiveAt: m.lastActiveAt,
      captureCount: docs.filter(
        (d) => d.workspaceId === workspaceId && d.capturedByName === m.displayName,
      ).length,
    })),
    invitations: [...invitations],
    seatLimit: DEMO.plan.seatLimit,
    seatsUsed: mine.length + invitations.length,
  };
}

/** Re-derives an invoice's paid/due amounts and status from its payments. */
function reprice(invoice: Invoice): Invoice {
  const paid = sumDecimal(
    payments.filter((x) => x.invoiceId === invoice.id).map((x) => x.amount),
  );
  const due = subtractDecimal(invoice.totalAmount, paid);
  const settled = Number(due) <= 0;

  // A DRAFT stays a draft. This used to recompute every invoice as sent,
  // paid or overdue, which meant a newly created draft — including one just
  // converted from an estimate — read as "sent" the moment it was loaded
  // back. Telling someone an invoice went to their customer when it did not
  // is worse than any arithmetic error on this screen.
  const status: Invoice['status'] =
    invoice.status === 'draft'
      ? 'draft'
      : settled
        ? 'paid'
        : invoice.dueDate < todayIso()
          ? 'overdue'
          : 'sent';

  return {
    ...invoice,
    amountPaid: paid,
    // A draft is not owed yet either: nobody has been asked to pay it.
    amountDue: status === 'draft' ? invoice.totalAmount : settled ? '0.0000' : due,
    status,
  };
}

/* ── Wallet / preferences state (2026-09-19 redesign) ─────────────────────── */

let savedCards: SavedCard[] = [
  {
    id: 'card_seed_4417',
    provider: 'card',
    brand: 'visa',
    last4: '4417',
    expiryMonth: 8,
    expiryYear: 2029,
    label: 'Visa ending 4417',
    isDefault: true,
    createdAt: '2026-09-02T04:10:00.000Z',
  },
];

function brandOf(digits: string): CardBrand {
  if (/^4/.test(digits)) return 'visa';
  if (/^(5[1-5]|2[2-7])/.test(digits)) return 'mastercard';
  if (/^3[47]/.test(digits)) return 'amex';
  return 'other';
}

function labelOf(brand: CardBrand): string {
  return { visa: 'Visa', mastercard: 'Mastercard', amex: 'Amex', other: 'Card' }[brand];
}

function maskEmail(email: string): string {
  const [user = '', domain = ''] = email.split('@');
  return `${user.slice(0, 1)}${'•'.repeat(Math.max(1, user.length - 1))}@${domain}`;
}

/** Itemised spend, mirroring the prototype's own demo months. */
const usageByMonth: Record<UsageKind, Record<string, UsageItem[]>> = {
  credits: {
    '2026-09': [
      { id: 'u1', label: 'Woolworths Metro', occurredAt: '2026-09-16', amount: 1 },
      { id: 'u2', label: 'Shell Coles Express', occurredAt: '2026-09-16', amount: 1 },
      { id: 'u3', label: 'Chemist Warehouse', occurredAt: '2026-09-15', amount: 1 },
      { id: 'u4', label: 'Sushi Hub Bourke St', occurredAt: '2026-09-15', amount: 1 },
      { id: 'u5', label: 'Mr Wong', occurredAt: '2026-09-12', amount: 1 },
      { id: 'u6', label: 'Kmart Broadway', occurredAt: '2026-09-12', amount: 1 },
      { id: 'u7', label: 'Origin Energy, two pages', occurredAt: '2026-09-11', amount: 2 },
      { id: 'u8', label: 'Coles Newtown', occurredAt: '2026-09-11', amount: 1 },
      { id: 'u9', label: 'Telstra', occurredAt: '2026-09-07', amount: 1 },
      { id: 'u10', label: 'Bulk import, eight receipts', occurredAt: '2026-09-05', amount: 8 },
      { id: 'u11', label: 'Officeworks', occurredAt: '2026-09-02', amount: 1 },
    ],
    '2026-08': [
      { id: 'u12', label: 'Ampol Alexandria', occurredAt: '2026-08-30', amount: 1 },
      { id: 'u13', label: 'Woolworths Metro', occurredAt: '2026-08-28', amount: 1 },
      { id: 'u14', label: 'Bunnings Warehouse', occurredAt: '2026-08-24', amount: 1 },
      { id: 'u15', label: 'Sydney Water, two pages', occurredAt: '2026-08-18', amount: 2 },
      { id: 'u16', label: 'Bulk import, six receipts', occurredAt: '2026-08-12', amount: 6 },
      { id: 'u17', label: 'IGA Marrickville', occurredAt: '2026-08-05', amount: 1 },
    ],
    '2026-07': [
      { id: 'u18', label: 'Coles Newtown', occurredAt: '2026-07-28', amount: 1 },
      { id: 'u19', label: "Dan Murphy's", occurredAt: '2026-07-21', amount: 1 },
      { id: 'u20', label: 'Officeworks', occurredAt: '2026-07-14', amount: 1 },
      { id: 'u21', label: 'Origin Energy', occurredAt: '2026-07-07', amount: 1 },
      { id: 'u22', label: 'Bulk import, four receipts', occurredAt: '2026-07-02', amount: 4 },
    ],
  },
  points: {
    '2026-09': [
      { id: 'p1', label: 'yourtal, Priority listing', occurredAt: '2026-09-14', amount: 250 },
      { id: 'p2', label: 'yourtal, Extra photo slots', occurredAt: '2026-09-09', amount: 120 },
      { id: 'p3', label: 'yourtal, Featured for a week', occurredAt: '2026-09-02', amount: 400 },
    ],
    '2026-08': [
      { id: 'p4', label: 'yourtal, Priority listing', occurredAt: '2026-08-21', amount: 250 },
      { id: 'p5', label: 'yourtal, Extra photo slots', occurredAt: '2026-08-12', amount: 120 },
      { id: 'p6', label: 'yourtal, Listing boost', occurredAt: '2026-08-04', amount: 300 },
    ],
    '2026-07': [
      { id: 'p7', label: 'yourtal, Featured for a week', occurredAt: '2026-07-23', amount: 400 },
      { id: 'p8', label: 'yourtal, Extra photo slots', occurredAt: '2026-07-09', amount: 120 },
    ],
  },
};

/** yourtal listings. Spending happens there; only the voucher comes back. */
const REWARDS: Reward[] = [
  { id: 'yt-scan-10', name: '10 free scans', description: 'A Snap Apps voucher for ten receipts.', cost: 200, imageUrl: null, deepLink: 'https://yourtal.com.au/store/yt-scan-10', available: true },
  { id: 'yt-scan-25', name: '25 free scans', description: 'A Snap Apps voucher for a month of shopping.', cost: 450, imageUrl: null, deepLink: 'https://yourtal.com.au/store/yt-scan-25', available: true },
  { id: 'yt-cafe', name: 'Cafe Giro, $10', description: 'Coffee on the way to the next job.', cost: 300, imageUrl: null, deepLink: 'https://yourtal.com.au/store/yt-cafe', available: true },
  { id: 'yt-fuel', name: 'Ampol, $25 fuel', description: 'Redeemed at the pump, not here.', cost: 900, imageUrl: null, deepLink: 'https://yourtal.com.au/store/yt-fuel', available: true },
];

/** Vouchers a demo user is holding, as if minted in yourtal. */
const DEMO_VOUCHERS: Record<string, { title: string; credits: number }> = {
  SNAP10: { title: '10 free scans', credits: 10 },
  SNAP25: { title: '25 free scans', credits: 25 },
};
const spentVouchers = new Set<string>();

let alerts: AlertItem[] = [
  {
    id: 'al1',
    kind: 'budget',
    title: 'Eating out is close',
    body: '$185.36 of $320 with 12 days to go.',
    href: '/budgets',
    createdAt: '2026-09-15T07:20:00.000Z',
    readAt: null,
  },
  {
    id: 'al2',
    kind: 'review',
    title: 'One receipt to check',
    body: 'Chemist Warehouse came back at 71% confidence.',
    href: '/receipts',
    createdAt: '2026-09-15T06:05:00.000Z',
    readAt: null,
  },
  {
    id: 'al3',
    kind: 'credits',
    title: 'Credits running low',
    body: 'Seven scans left. Scanning stops when they run out.',
    href: '/credits',
    createdAt: '2026-09-14T22:40:00.000Z',
    readAt: '2026-09-15T01:00:00.000Z',
  },
];

let notificationPrefs: NotificationPrefs = {
  budgetTight: true,
  reviewNeeded: true,
  lowCredits: false,
  recurringDue: true,
  productNews: false,
};

let privacySettings: PrivacySettings = {
  analyticsOptIn: false,
  crashReports: true,
  contributeToModel: false,
  retentionMonths: 84,
};

/** The last code issued. A real server would not keep this in memory. */
let lastOtp: { email: string; code: string; purpose: OtpPurpose } | null = null;

export class MockApi implements SnapApi {
  // ── Identity ──

  async getSession(): Promise<Session | null> {
    await settle(90);
    return signedIn ? sessionFor(WHO) : null;
  }

  async listDemoAccounts(): Promise<AuthUser[]> {
    await settle(60);
    return ACCOUNTS.map(({ userId, displayName, email, initials }) => ({
      userId,
      displayName,
      email,
      initials,
    }));
  }

  /**
   * Register, in the fixture world.
   *
   * The password is checked for length and then DISCARDED — this backend has
   * no credential store and inventing one would be a second implementation of
   * something security-critical that nobody runs. The length check stays
   * because the screen's disabled-button rule mirrors it, and a mock that
   * accepts what the server rejects teaches the wrong thing in a demo.
   */
  async register(email: string, password: string, displayName?: string): Promise<Session> {
    if ([...password].length < 10) {
      throw new Error('password must be at least 10 characters');
    }
    const session = await this.signIn(email);
    if (displayName?.trim()) session.user.displayName = displayName.trim();
    return session;
  }

  async signInWithPassword(email: string, password: string): Promise<Session> {
    if ([...password].length < 10) {
      // Same single message the server gives, for the same reason: a fixture
      // that distinguishes "no such account" from "wrong password" would show
      // a flow the real one does not have.
      throw new Error('Email or password is incorrect.');
    }
    return this.signIn(email);
  }

  /**
   * Accepted and dropped.
   *
   * The fixture world has no layouts table and inventing one would be a second
   * implementation of something the server already owns. What matters for a
   * demo is that calling this never throws and never slows anything down,
   * which is exactly what the real one promises.
   */
  async recordDeviceReading(): Promise<void> {
    return;
  }

  async signIn(email: string): Promise<Session> {
    // Long on purpose: the real one is a round trip to an identity provider
    // and a link in an inbox, and a demo that returns instantly teaches the
    // audience the wrong thing about the flow.
    await settle(700);
    const clean = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) {
      throw new Error('That does not look like an email address.');
    }

    const known = ACCOUNTS.find((a) => a.email.toLowerCase() === clean);
    if (known) {
      WHO = known.userId;
      signedIn = true;
      return sessionFor(WHO)!;
    }

    // An address nobody recognises is a new account, and a new account has no
    // workspace — which is exactly the state onboarding exists to resolve.
    WHO = `usr_${clean.replace(/[^a-z0-9]/g, '').slice(0, 12)}_${Date.now().toString(36)}`;
    signedIn = true;
    const name = clean.split('@')[0]!.replace(/[._-]+/g, ' ');
    return {
      user: {
        userId: WHO,
        displayName: name.replace(/\b\w/g, (c) => c.toUpperCase()),
        email: clean,
        initials: initialsOfName(name),
      },
      workspaceIds: [],
    };
  }

  async signOut(): Promise<void> {
    await settle(180);
    signedIn = false;
    // WHO is deliberately left alone: nothing should be readable while signed
    // out, and the next sign-in sets it anyway.
  }

  async completeOnboarding(input: OnboardingInput): Promise<Session> {
    await settle(520);
    const name = input.workspaceName.trim();
    if (!name) throw new Error('Give the workspace a name.');
    const abn = input.abn?.replace(/\D/g, '') || null;
    if (input.kind === 'business' && abn && !abnIsValid(abn)) {
      throw new Error('That ABN fails the ATO modulus-89 checksum.');
    }
    if (input.kind === 'personal' && abn) {
      // The database enforces this too (migration 0012): a household has no
      // ABN and cannot be registered for GST.
      throw new Error('A personal workspace does not have an ABN.');
    }

    const id = `ws_${Date.now()}`;
    extraWorkspaces = [...extraWorkspaces, { id, name, kind: input.kind }];
    const session = sessionFor(WHO);
    members = [
      ...members,
      {
        workspaceId: id,
        userId: WHO,
        displayName: session?.user.displayName ?? 'You',
        email: session?.user.email ?? null,
        role: 'owner',
        joinedAt: todayIso(),
        lastActiveAt: todayIso(),
      },
    ];

    if (input.kind === 'business') {
      settings = {
        ...settings,
        workspaceId: id,
        name,
        abn,
        abnValid: abnIsValid(abn),
        gstRegistered: input.gstRegistered ?? false,
        gstBasis: input.gstBasis ?? 'cash',
        occupationProfileId: input.occupationProfileId ?? null,
        // Was `settings.occupationLabel`, which kept the PREVIOUS workspace's
        // label: a nurse signing up was shown "Long-haul truck driver".
        occupationLabel: OCCUPATION_LABELS[input.occupationProfileId ?? ''] ?? null,
      };
    } else if (input.monthlyBudget && Number(input.monthlyBudget) > 0) {
      // One starting budget rather than a category breakdown: asking a new
      // user to divide a number they have not thought about yet is how
      // onboarding gets abandoned.
      budgets = [{ category: 'Everything else', monthly: input.monthlyBudget }];
    }

    return sessionFor(WHO)!;
  }

  async getOverview(): Promise<Overview> {
    await settle(180);
    // Recompute the at-risk figures from live state, so confirming or fixing a
    // document during the demo visibly moves the headline number.
    // Scoped twice over: a BAS covers one quarter, and it never sees personal
    // spending. The fixture now holds a year of both.
    const quarter = business().filter((d) => d.issueDate >= startOfQuarter(new Date()));
    const atRisk = quarter.filter((d) => !d.isTaxInvoice);
    const gstAtRisk = sumDecimal(atRisk.map((d) => d.taxAmount));
    const claimable = sumDecimal(
      quarter.filter((d) => d.isTaxInvoice).map((d) => d.taxAmount),
    );
    const purchases = sumDecimal(quarter.map((d) => d.payableAmount));
    const scansThisMonth = docs.filter((d) => d.issueDate >= startOfMonth(new Date())).length;

    // The fixture's tenant identity belongs to the fixture's tenant. Anyone
    // else gets their own workspace's name, and figures computed from the
    // documents they can actually see (which `business()` has already scoped).
    const own = DEMO.workspaces
      .concat(extraWorkspaces.map((w) => ({ ...w, role: 'owner' as const, abn: null })))
      .find((w) => w.kind === 'business' && myWorkspaceIds().has(w.id));

    return {
      tenantName: own?.name ?? settings.name,
      tenantAbn: own?.abn ?? null,
      firmName: DEMO.entitlement.firmName,
      profileLabel: DEMO.profile.label,
      benchmarkCommon: DEMO.profile.benchmarkCommon,
      benchmarkMax: DEMO.profile.benchmarkMax,
      ratesFy: DEMO.rates.fy,
      ratesDetermination: DEMO.rates.determination,
      bas: {
        ...DEMO.bas,
        purchasesInclusive: purchases,
        gstAtRisk,
        gstClaimable: claimable,
        atRiskCount: atRisk.length,
      },
      deductions: {
        estimateTotal: DEMO.deductions.estimateTotal,
        byLabel: { ...DEMO.deductions.byLabel },
        caps: { ...DEMO.deductions.caps },
      },
      entitlement: {
        planCode: DEMO.entitlement.planCode,
        realtime: DEMO.entitlement.realtime,
        scanQuota: DEMO.entitlement.scanQuota,
        scansUsed: scansThisMonth,
        scansRemaining: DEMO.entitlement.scanQuota - scansThisMonth,
        topupRemaining: 0,
        seatLimit: 1,
        seatsUsed: 1,
        features: {},
      },
    };
  }

  async listDocuments(
    filter: DocumentFilter = 'all',
    workspace?: Workspace,
  ): Promise<DocumentView[]> {
    await settle(140);
    // Scoped by MEMBERSHIP first, then by the requested kind. The kind filter
    // alone was enough while every user belonged to everything; it is not a
    // security boundary, and the mock should not be looser than the row-level
    // security the server applies.
    const mine = new Set(members.filter((m) => m.userId === WHO).map((m) => m.workspaceId));
    const live = docs.filter((d) => !removedDocIds.has(d.id) && mine.has(d.workspaceId));
    const scoped = workspace ? live.filter((d) => d.workspace === workspace) : live;
    const sorted = [...scoped].sort((a, b) => b.issueDate.localeCompare(a.issueDate));
    if (filter === 'needs_review') return sorted.filter((d) => d.reviewStatus === 'needs_review');
    if (filter === 'at_risk') return sorted.filter((d) => !d.isTaxInvoice);
    return sorted;
  }

  async getDocument(id: string): Promise<DocumentView | null> {
    await settle(90);
    return docs.find((d) => d.id === id) ?? null;
  }

  async updateDocument(id: string, body: UpdateDocumentRequest): Promise<DocumentView> {
    await settle(220);
    const idx = docs.findIndex((d) => d.id === id);
    if (idx < 0) throw new Error(`No document ${id}`);
    const current = docs[idx]!;

    const next: DocumentView = { ...current };
    for (const [path, value] of Object.entries(body.edits)) {
      if (path === 'supplier.abn') {
        const abn = value == null ? null : String(value).replace(/\D/g, '');
        const valid = abnIsValid(abn);
        Object.assign(next, {
          supplierAbn: abn,
          supplierAbnValid: valid,
          // Supplying a valid ABN is exactly what rescues the GST credit — the
          // single most important interaction in the product.
          complianceFailures: valid
            ? current.complianceFailures.filter((f) => f !== 'supplier_abn_missing')
            : current.complianceFailures,
        });
      }
      if (path === 'supplier.name') Object.assign(next, { supplierName: String(value ?? '') });
      if (path === 'header.issue_date') Object.assign(next, { issueDate: String(value ?? '') });
      if (path === 'header.category') Object.assign(next, { category: String(value ?? '') });

      // Correcting the total re-derives every dependent figure. GST is never
      // taken from the human: it is exactly 1/11 of the taxable part, and
      // letting someone type both invites the two to disagree.
      if (path === 'totals.payable' || path === 'totals.gst_free') {
        const payable =
          path === 'totals.payable' ? String(value ?? '0') : next.payableAmount;
        const gstFreeRaw = path === 'totals.gst_free' ? value : next.gstFreeAmount;
        const gstFree = gstFreeRaw == null ? null : String(gstFreeRaw);
        const taxable = subtractDecimal(payable, gstFree ?? '0');
        // Australia-specific: this mock/demo edit flow is AU-only (the 82.50
        // tax-invoice threshold below is an ATO figure). Will need the
        // tenant's installed tax rule set's inclusiveFraction once this
        // surface goes multi-jurisdiction.
        const gst = gstFromInclusive(taxable, { n: 1, d: 11 });
        Object.assign(next, {
          payableAmount: payable,
          gstFreeAmount: gstFree,
          taxAmount: gst,
          taxExclusiveAmount: subtractDecimal(payable, gst),
          // A corrected total changes what is at stake if the document is not
          // a valid tax invoice.
          gstAtRisk: next.isTaxInvoice ? null : gst,
          belowTaxInvoiceThreshold: Number(payable) < 82.5,
        });
      }
    }

    // If the total moved and the lines no longer add up, say so rather than
    // silently rescaling someone's itemisation.
    const lineSum = sumDecimal(next.lines.map((l) => l.amount));
    Object.assign(next, {
      linesBalance: Math.abs(Number(lineSum) - Number(next.payableAmount)) < 0.005,
    });

    const stillFailing = (next.complianceFailures ?? []).length > 0;
    Object.assign(next, {
      isTaxInvoice: !stillFailing,
      docType: stillFailing ? 'receipt' : 'tax_invoice',
      gstAtRisk: stillFailing ? next.taxAmount : null,
      reviewStatus: body.confirm ? 'reviewed' : next.reviewStatus,
    });

    docs = docs.map((d, i) => (i === idx ? next : d));
    return next;
  }

  /**
   * OD-11's capture-addressed correction. `DocumentView` carries no separate
   * capture id (unlike the server's `documents.capture_id`) — the demo's own
   * `awaitExtraction` mints a document's id AS `doc_${captureId}`, which is
   * the only place in this fixture world a capture and its document are
   * linked, so that is the convention this looks the document up by. The
   * fixture has no "extraction still running" state — every capture in it
   * already has a document — so the only new behaviour to model is the miss:
   * an id matching nothing answers the same `409 document_not_ready` the real
   * server does, so the app cannot tell the demo and the real API apart by
   * how this fails. A hit just applies the same edit `updateDocument` does.
   */
  async correctCaptureDocument(
    captureId: string,
    body: PatchCaptureDocumentRequest,
  ): Promise<DocumentView> {
    const doc = docs.find((d) => d.id === `doc_${captureId}`);
    if (!doc) {
      throw new ApiError(409, "This receipt hasn't been read yet.", 'document_not_ready');
    }
    return this.updateDocument(doc.id, body);
  }

  async confirmDocument(id: string): Promise<DocumentView> {
    await settle(260);
    const idx = docs.findIndex((d) => d.id === id);
    if (idx < 0) throw new Error(`No document ${id}`);
    const next: DocumentView = { ...docs[idx]!, reviewStatus: 'reviewed' };
    docs = docs.map((d, i) => (i === idx ? next : d));
    return next;
  }

  /**
   * Rejects a mis-scan — a photo of the wrong thing, or an unusable one.
   *
   * The document is withdrawn from every list, but the CAPTURE is untouched:
   * the image is the ATO record and a business must keep it for five years.
   * What is rejected is the reading, not the evidence.
   */
  async rejectDocument(id: string, reason: string): Promise<void> {
    await settle(220);
    const idx = docs.findIndex((d) => d.id === id);
    if (idx < 0) throw new Error(`No document ${id}`);
    const next: DocumentView = {
      ...docs[idx]!,
      reviewStatus: 'rejected',
      note: reason.trim() || 'Rejected during review',
    };
    docs = docs.map((d, i) => (i === idx ? next : d));
    removedDocIds.add(id);
  }

  async createCapture(body: CreateCaptureRequest): Promise<CreateCaptureResponse> {
    await settle(320);
    // Re-uploading the same bytes is idempotent, not an error: the database
    // has a UNIQUE (tenant_id, original_sha256) for exactly this. The client
    // hash is advisory — the server recomputes it — but answering here lets
    // the capture screen say "you already have this one" instead of silently
    // creating a second copy of the same docket.
    //
    // Mirrors the server's capture-level dedup key (contract §2): the lone
    // page's hash for a single page, or its page hashes concatenated in page
    // order for a multi-page document. Only the key's STABILITY matters for
    // this in-memory map, not its cryptographic property, so nothing here
    // re-hashes the concatenation the way the real column does.
    const dedupeKey =
      body.pages.length === 1
        ? body.pages[0]!.sha256
        : body.pages.map((page) => page.sha256.toLowerCase()).join('');

    const uploadsFor = (alreadyStored: boolean): CapturePageUpload[] =>
      body.pages.map((_, i) => ({
        pageNumber: i + 1,
        uploadUrl: `https://example.invalid/presigned/${i + 1}`,
        alreadyStored,
      }));

    const seen = seenHashes.get(dedupeKey);
    if (seen) {
      const uploads = uploadsFor(true);
      return {
        captureId: seen,
        uploads,
        uploadExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        duplicate: true,
        // @deprecated alias, kept only for a caller still on the old shape.
        uploadUrl: uploads[0]!.uploadUrl,
      };
    }
    const captureId = `cap_${Date.now()}`;
    seenHashes.set(dedupeKey, captureId);
    const uploads = uploadsFor(false);
    return {
      captureId,
      uploads,
      uploadExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      duplicate: false,
      uploadUrl: uploads[0]!.uploadUrl,
    };
  }

  async uploadOriginal(uploadUrl: string, bytes: ArrayBuffer, mimeType: string): Promise<void> {
    // The demo has no object store, so the bytes stop here. The timing is kept
    // realistic (roughly 2 MB/s) so the progress the presenter sees is honest.
    await settle(Math.min(1500, 200 + bytes.byteLength / 2000));
    if (__DEV__) {
      console.log(`[demo] would PUT ${bytes.byteLength} bytes of ${mimeType} to ${uploadUrl}`);
    }
  }

  async awaitExtraction(
    captureId: string,
    localImageUri?: string,
    workspace: Workspace = 'business',
  ): Promise<DocumentView> {
    // Deliberately a beat, not instant: extraction is a real round trip and the
    // demo should not imply otherwise.
    await settle(2100);
    const personal = workspace === 'personal';
    const template = docs.find((d) => d.workspace === workspace) ?? docs[0]!;
    const created: DocumentView = {
      ...template,
      id: `doc_${captureId}`,
      supplierName: personal ? 'Woolworths Metro' : 'Ampol Foodary Marulan',
      category: personal ? 'Groceries' : 'Fuel',
      workspace,
      capturedByName: sessionFor(WHO)?.user.displayName ?? 'You',
      visibility: 'shared',
      // Until the real worker is wired in there is nothing to report; the
      // banner on the review screen says why the fields are sample data.
      findings: [],
      // The photograph just taken IS the record. Everything else on this
      // screen is derived from it and can be corrected; the image cannot.
      imageUrl: localImageUri ?? null,
      imageCapturedAt: new Date().toISOString(),
      issueDate: new Date().toISOString().slice(0, 10),
      reviewStatus: 'needs_review',
      confidenceOverall: 0.93,
      note: 'Just captured — check the highlighted fields before confirming',
      localImageUri: localImageUri ?? null,
      // Keep page 1 in step with `imageUrl` above rather than leaving the
      // template's own (empty) page — the capture screen already falls back
      // to its own on-device `localPages` for a just-finished multi-page
      // shoot, but a single-page capture, or this same document reopened
      // later within the demo session, reads this array instead.
      pages: [{ pageNumber: 1, imageUrl: localImageUri ?? '', source: 'capture' }],
      // The photo is real; the FIELDS are sample data until the extraction
      // service exists. The review screen says so rather than implying it read
      // this particular receipt.
      demoExtraction: true,
    };
    docs = [created, ...docs];
    return created;
  }

  // ── Spending ──

  async getPersonal(): Promise<PersonalSummary> {
    await settle(160);
    return personalSummary(docs, budgets, budgetTotal());
  }

  async setBudget(category: string, monthly: string): Promise<PersonalSummary> {
    await settle(140);
    budgets = budgets.some((b) => b.category === category)
      ? budgets.map((b) => (b.category === category ? { ...b, monthly } : b))
      : [...budgets, { category, monthly }];
    return personalSummary(docs, budgets, budgetTotal());
  }

  async getAnalytics(workspace: Workspace, range: AnalyticsRange): Promise<AnalyticsSummary> {
    // Slower than the other reads on purpose: in production this is a real
    // aggregation over a year of documents, not a local array scan.
    await settle(240);
    return analyticsSummary(docs, workspace, range, budgets);
  }

  // ── Business side ──

  async getSales(): Promise<SalesSummary> {
    await settle(120);
    // Invoices belong to the fixture's business. A new workspace has none,
    // and showing it someone else's receivables would be worse than showing
    // it nothing.
    if (!inDemoBusiness()) {
      return {
        outstanding: '0.0000',
        overdue: '0.0000',
        paidThisQuarter: '0.0000',
        gstOnSales: '0.0000',
      };
    }
    // Derived, not stored: recording a payment has to move these or the demo
    // would show a receipt for money that is still outstanding.
    const live = invoices.map(reprice);
    const open = live.filter((i) => i.kind === 'invoice' && i.status !== 'paid' && i.status !== 'draft');
    return {
      outstanding: sumDecimal(open.map((i) => i.amountDue)),
      overdue: sumDecimal(open.filter((i) => i.status === 'overdue').map((i) => i.amountDue)),
      paidThisQuarter: sumDecimal(
        live.filter((i) => i.status === 'paid').map((i) => i.totalAmount),
      ),
      gstOnSales: sumDecimal(
        live.filter((i) => i.kind === 'invoice' && i.status !== 'draft').map((i) => i.gstAmount),
      ),
    };
  }

  async listInvoices(kind?: 'invoice' | 'estimate'): Promise<Invoice[]> {
    await settle(140);
    if (!inDemoBusiness()) return [];
    const all = invoices.map(reprice).sort((a, b) => b.issueDate.localeCompare(a.issueDate));
    return kind ? all.filter((i) => i.kind === kind) : all;
  }

  async getInvoice(id: string): Promise<Invoice | null> {
    const found = invoices.find((i) => i.id === id);
    await settle(90);
    return found ? reprice(found) : null;
  }

  async convertEstimate(estimateId: string): Promise<Invoice> {
    await settle(360);
    const estimate = invoices.find((i) => i.id === estimateId);
    if (!estimate) throw new Error(`No estimate ${estimateId}`);
    if (estimate.kind !== 'estimate') throw new Error('That is already an invoice.');
    if (invoices.some((i) => i.id === `inv_from_${estimateId}`)) {
      throw new Error('This estimate has already been invoiced.');
    }

    // Numbering continues the invoice sequence, not the estimate one: a
    // customer's accounts department reconciles against INV-, and a gap or a
    // duplicate in that series is a question you have to answer.
    const highest = invoices
      .filter((i) => i.kind === 'invoice' && /^INV-(\d+)$/.test(i.number))
      .map((i) => Number(/^INV-(\d+)$/.exec(i.number)![1]))
      .reduce((a, b) => Math.max(a, b), 1000);

    // GST is recomputed from the lines rather than copied off the estimate.
    const lines = estimate.lines.map((l) => {
      const gst = gstOnSaleExact(l.netAmount);
      return { ...l, gstAmount: gst, totalAmount: addDecimal(l.netAmount, gst) };
    });
    const net = sumDecimal(lines.map((l) => l.netAmount));
    const gst = sumDecimal(lines.map((l) => l.gstAmount));
    const total = addDecimal(net, gst);

    const today = new Date();
    const due = new Date(today);
    due.setDate(due.getDate() + 14);

    const invoice: Invoice = {
      id: `inv_from_${estimateId}`,
      number: `INV-${highest + 1}`,
      kind: 'invoice',
      status: 'draft',
      partyId: estimate.partyId,
      partyName: estimate.partyName,
      issueDate: todayIso(),
      dueDate: iso(due),
      lines,
      netAmount: net,
      gstAmount: gst,
      totalAmount: total,
      amountPaid: '0.0000',
      amountDue: total,
    };

    // Drafts, deliberately: converting an estimate should not issue a tax
    // invoice to a customer without the user seeing it first.
    invoices = [invoice, ...invoices];
    return invoice;
  }

  async listItems(): Promise<Item[]> {
    await settle(120);
    // Items created in this session are kept: a new workspace that adds one
    // must see it. Only the fixture's own inventory is withheld.
    return inDemoBusiness() ? [...items] : items.filter((i) => i.id.startsWith('itm_1'));
  }

  async createItem(item: Omit<Item, 'id' | 'lowStock'>): Promise<Item[]> {
    await settle(260);
    if (!item.name.trim()) throw new Error('Give the item a name.');
    if (items.some((i) => i.sku && i.sku === item.sku)) {
      throw new Error(`SKU ${item.sku} is already used by another item.`);
    }
    items = [
      ...items,
      {
        ...item,
        id: `itm_${Date.now()}`,
        name: item.name.trim(),
        lowStock: item.stockOnHand !== null && item.stockOnHand <= 6,
      },
    ];
    return [...items];
  }

  async listParties(kind?: 'customer' | 'supplier'): Promise<Party[]> {
    await settle(120);
    const visible = inDemoBusiness()
      ? parties
      : parties.filter((x) => x.id.startsWith('pty_1'));
    const all = [...visible].sort((a, b) => a.name.localeCompare(b.name));
    return kind ? all.filter((p) => p.kind === kind) : all;
  }

  async createParty(party: {
    name: string;
    kind: 'customer' | 'supplier';
    abn?: string | null;
    email?: string | null;
    phone?: string | null;
  }): Promise<Party[]> {
    await settle(260);
    if (!party.name.trim()) throw new Error('Give the contact a name.');
    const abn = party.abn?.replace(/\D/g, '') || null;
    if (abn && !abnIsValid(abn)) throw new Error('That ABN fails its checksum.');
    parties = [
      ...parties,
      {
        id: `pty_${Date.now()}`,
        name: party.name.trim(),
        kind: party.kind,
        abn,
        abnValid: abnIsValid(abn),
        email: party.email?.trim() || null,
        phone: party.phone?.trim() || null,
        openBalance: '0.0000',
        invoiceCount: 0,
      },
    ];
    return [...parties];
  }

  // ── Collaboration ──

  async listWorkspaces(): Promise<WorkspaceSummary[]> {
    await settle(110);
    const all = [
      ...DEMO.workspaces,
      ...extraWorkspaces.map((w) => ({ ...w, role: 'owner' as const, abn: null })),
    ];

    // MEMBERSHIP DECIDES. This previously returned every workspace in the
    // fixture to whoever asked, which meant signing in as a household member
    // still showed the company's books — the exact leak that making a
    // workspace a tenant was supposed to make impossible. The server enforces
    // this in row-level security (migration 0012); the mock has to agree, or
    // the app is developed against a promise the database does not make.
    const mine = new Set(
      members.filter((m) => m.userId === WHO).map((m) => m.workspaceId),
    );

    return all
      .filter((w) => mine.has(w.id))
      .map((w) => ({
        id: w.id,
        name: w.name,
        kind: w.kind,
        role: members.find((m) => m.workspaceId === w.id && m.userId === WHO)?.role ?? w.role,
        memberCount: members.filter((m) => m.workspaceId === w.id).length,
        abn: w.abn,
      }));
  }

  async createWorkspace(name: string, kind: Workspace): Promise<WorkspaceSummary> {
    await settle(260);
    const id = `ws_${Date.now()}`;
    extraWorkspaces = [...extraWorkspaces, { id, name, kind }];
    // Whoever creates a workspace owns it. There is no unowned workspace: one
    // with nobody who can pay for it or delete it is a support ticket.
    members = [
      ...members,
      {
        workspaceId: id,
        userId: WHO,
        displayName: sessionFor(WHO)?.user.displayName ?? 'You',
        email: sessionFor(WHO)?.user.email ?? null,
        role: 'owner',
        joinedAt: todayIso(),
        lastActiveAt: todayIso(),
      },
    ];
    return { id, name, kind, role: 'owner', memberCount: 1, abn: null };
  }

  async getPermissions(workspaceId: string): Promise<Permissions> {
    await settle(60);
    const role = members.find((m) => m.workspaceId === workspaceId && m.userId === WHO)?.role;
    // No membership means no access at all, not read-only access.
    return permissionsFor(role ?? 'readonly');
  }

  async listMembers(workspaceId: string): Promise<MemberList> {
    await settle(150);
    return memberList(workspaceId);
  }

  async inviteMember(workspaceId: string, email: string, role: MemberRole): Promise<MemberList> {
    await settle(320);
    const current = memberList(workspaceId);
    if (current.seatsUsed >= current.seatLimit) {
      throw new Error(`This workspace has ${current.seatLimit} seats and they are all in use.`);
    }
    if (current.members.some((m) => m.email?.toLowerCase() === email.toLowerCase())) {
      throw new Error(`${email} is already in this workspace.`);
    }
    if (invitations.some((i) => i.email.toLowerCase() === email.toLowerCase())) {
      throw new Error(`${email} has already been invited.`);
    }
    const expires = new Date();
    // Seven days. A join link that never expires is a credential lying around.
    expires.setDate(expires.getDate() + 7);
    invitations = [
      ...invitations,
      {
        id: `inv_${Date.now()}`,
        email,
        role,
        invitedByName: sessionFor(WHO)?.user.displayName ?? 'You',
        createdAt: todayIso(),
        expiresAt: iso(expires),
      },
    ];
    return memberList(workspaceId);
  }

  async revokeInvitation(workspaceId: string, invitationId: string): Promise<MemberList> {
    await settle(180);
    invitations = invitations.filter((i) => i.id !== invitationId);
    return memberList(workspaceId);
  }

  async updateMemberRole(
    workspaceId: string,
    userId: string,
    role: MemberRole,
  ): Promise<MemberList> {
    await settle(220);
    const owners = members.filter((m) => m.workspaceId === workspaceId && m.role === 'owner');
    if (owners.length === 1 && owners[0]!.userId === userId && role !== 'owner') {
      throw new Error('A workspace must keep at least one owner.');
    }
    members = members.map((m) =>
      m.workspaceId === workspaceId && m.userId === userId ? { ...m, role } : m,
    );
    return memberList(workspaceId);
  }

  async removeMember(workspaceId: string, userId: string): Promise<MemberList> {
    await settle(240);
    const owners = members.filter((m) => m.workspaceId === workspaceId && m.role === 'owner');
    if (owners.length === 1 && owners[0]!.userId === userId) {
      throw new Error('A workspace must keep at least one owner.');
    }
    // Their documents stay. They belong to the workspace, which is legally
    // required to keep them — what is removed is the person's access.
    members = members.filter((m) => !(m.workspaceId === workspaceId && m.userId === userId));
    return memberList(workspaceId);
  }

  async setVisibility(
    documentId: string,
    visibility: 'shared' | 'private',
  ): Promise<DocumentView> {
    await settle(160);
    const idx = docs.findIndex((d) => d.id === documentId);
    if (idx < 0) throw new Error(`No document ${documentId}`);
    const next: DocumentView = { ...docs[idx]!, visibility };
    docs = docs.map((d, i) => (i === idx ? next : d));
    return next;
  }

  async updateLines(documentId: string, lines: DocumentLine[]): Promise<DocumentView> {
    await settle(240);
    const idx = docs.findIndex((d) => d.id === documentId);
    if (idx < 0) throw new Error(`No document ${documentId}`);
    const current = docs[idx]!;

    // Renumber on the way in so a deleted line does not leave a gap, and
    // recheck the sum against the total the human is looking at.
    const renumbered = lines.map((l, i) => ({ ...l, lineNumber: i + 1 }));
    const sum = sumDecimal(renumbered.map((l) => l.amount));
    const next: DocumentView = {
      ...current,
      lines: renumbered,
      linesBalance: Math.abs(Number(sum) - Number(current.payableAmount)) < 0.005,
    };
    docs = docs.map((d, i) => (i === idx ? next : d));
    return next;
  }

  // ── Money out ──

  async listBills(): Promise<Bill[]> {
    await settle(140);
    if (!inDemoBusiness()) return [];
    return [...bills].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }

  async payBill(billId: string, amount?: string): Promise<Bill> {
    await settle(280);
    const idx = bills.findIndex((b) => b.id === billId);
    if (idx < 0) throw new Error(`No bill ${billId}`);
    const bill = bills[idx]!;
    const pay = amount ?? bill.amountDue;
    if (Number(pay) <= 0) throw new Error('A payment must be more than nothing.');
    if (Number(pay) > Number(bill.amountDue) + 0.005) {
      throw new Error(`That is more than the ${Number(bill.amountDue).toFixed(2)} still owing.`);
    }
    const paid = addDecimal(bill.amountPaid, pay);
    const due = subtractDecimal(bill.totalAmount, paid);
    const settled = Number(due) <= 0.004;
    const next: Bill = {
      ...bill,
      amountPaid: paid,
      amountDue: settled ? '0.0000' : due,
      // A part payment does not clear an overdue bill: it is still late.
      status: settled ? 'paid' : bill.dueDate < todayIso() ? 'overdue' : 'unpaid',
    };
    bills = bills.map((b, i) => (i === idx ? next : b));
    return next;
  }

  async listPayments(): Promise<Payment[]> {
    await settle(130);
    if (!inDemoBusiness()) return [];
    return [...payments].sort((a, b) => b.date.localeCompare(a.date));
  }

  async recordPayment(
    invoiceId: string,
    amount: string,
    method: PaymentMethod,
    reference?: string,
  ): Promise<Payment> {
    await settle(300);
    const invoice = invoices.find((i) => i.id === invoiceId);
    if (!invoice) throw new Error(`No invoice ${invoiceId}`);
    const due = reprice(invoice).amountDue;
    if (Number(amount) <= 0) throw new Error('A payment must be more than nothing.');
    if (Number(amount) > Number(due) + 0.005) {
      throw new Error(`That is more than the ${formatDue(due)} still owing.`);
    }
    const payment: Payment = {
      id: `pay_${Date.now()}`,
      invoiceId,
      invoiceNumber: invoice.number,
      partyName: invoice.partyName,
      date: todayIso(),
      amount,
      method,
      reference: reference?.trim() ? reference.trim() : null,
    };
    payments = [payment, ...payments];
    return payment;
  }

  // ── Mileage ──

  async getMileage(): Promise<MileageSummary> {
    await settle(150);
    return inDemoBusiness() ? mileage() : emptyMileage();
  }

  async addTrip(trip: Omit<Trip, 'id'>): Promise<MileageSummary> {
    await settle(240);
    trips = [{ ...trip, id: `trip_${Date.now()}` }, ...trips];
    return mileage();
  }

  async deleteTrip(tripId: string): Promise<MileageSummary> {
    await settle(180);
    trips = trips.filter((t) => t.id !== tripId);
    return mileage();
  }

  // ── Stock ──

  async listStockMovements(): Promise<StockMovement[]> {
    await settle(140);
    return [...movements].sort((a, b) => b.at.localeCompare(a.at));
  }

  async countStock(itemId: string, countedQuantity: number): Promise<Item[]> {
    await settle(260);
    const item = items.find((i) => i.id === itemId);
    if (!item) throw new Error(`No item ${itemId}`);
    if (item.stockOnHand === null) throw new Error(`${item.name} is a service — it has no stock.`);
    if (!Number.isFinite(countedQuantity) || countedQuantity < 0) {
      throw new Error('A stock count cannot be negative.');
    }
    const difference = countedQuantity - item.stockOnHand;
    items = items.map((i) =>
      i.id === itemId
        ? { ...i, stockOnHand: countedQuantity, lowStock: countedQuantity <= 6 }
        : i,
    );
    // The count is recorded as a movement, not as a silent overwrite: a stock
    // figure that changed with no trace is the one nobody can reconcile.
    movements = [
      {
        id: `mv_${Date.now()}`,
        itemId,
        itemName: item.name,
        kind: 'count',
        quantity: difference,
        at: todayIso(),
        note: difference === 0 ? 'Counted, no change' : 'Stock take',
        byName: sessionFor(WHO)?.user.displayName ?? 'You',
      },
      ...movements,
    ];
    return [...items];
  }

  // ── Personal extras ──

  async listRecurring(): Promise<Recurring[]> {
    await settle(200);
    return detectRecurring(docs.filter((d) => d.workspace === 'personal'));
  }

  async listGoals(): Promise<Goal[]> {
    await settle(130);
    return [...goals];
  }

  async createGoal(name: string, target: string, targetDate: string | null): Promise<Goal[]> {
    await settle(240);
    if (!name.trim()) throw new Error('Give the goal a name.');
    if (Number(target) <= 0) throw new Error('Set a target above zero.');
    goals = [
      ...goals,
      {
        id: `goal_${Date.now()}`,
        name: name.trim(),
        target,
        saved: '0.0000',
        targetDate,
        perMonth: targetDate ? perMonthFor(target, '0.0000', targetDate) : null,
        done: false,
      },
    ];
    return [...goals];
  }

  async contributeToGoal(goalId: string, amount: string, occurredOn?: string): Promise<Goal[]> {
    await settle(220);
    if (Number(amount) <= 0) throw new Error('Enter an amount above zero.');
    goalContributions = [
      ...goalContributions,
      {
        id: `gc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        goalId,
        amount,
        occurredOn: occurredOn ?? new Date().toISOString().slice(0, 10),
        createdAt: new Date().toISOString(),
        createdByName: sessionFor(WHO)?.user.displayName ?? 'You',
        source: 'manual',
      },
    ];
    recomputeGoalSaved(goalId);
    return [...goals];
  }

  async listGoalContributions(goalId: string): Promise<GoalContribution[]> {
    await settle(140);
    return goalContributions
      .filter((c) => c.goalId === goalId)
      .sort((a, b) =>
        a.occurredOn !== b.occurredOn
          ? b.occurredOn.localeCompare(a.occurredOn)
          : b.createdAt.localeCompare(a.createdAt),
      );
  }

  async removeGoalContribution(goalId: string, contributionId: string): Promise<Goal[]> {
    await settle(180);
    goalContributions = goalContributions.filter((c) => c.id !== contributionId);
    recomputeGoalSaved(goalId);
    return [...goals];
  }

  async deleteGoal(goalId: string): Promise<Goal[]> {
    await settle(170);
    goals = goals.filter((g) => g.id !== goalId);
    goalContributions = goalContributions.filter((c) => c.goalId !== goalId);
    return [...goals];
  }

  // ── Settings ──

  async getBusinessSettings(): Promise<BusinessSettings> {
    await settle(120);
    return { ...settings };
  }

  /** An empty trip log, for a workspace with no history of its own. */

  async updateBusinessSettings(patch: Partial<BusinessSettings>): Promise<BusinessSettings> {
    await settle(240);
    const abn = patch.abn === undefined ? settings.abn : patch.abn;
    settings = { ...settings, ...patch, abn, abnValid: abnIsValid(abn) };
    return { ...settings };
  }

  async listCategorySettings(workspace: Workspace): Promise<CategorySetting[]> {
    await settle(160);
    const mine = docs.filter((d) => d.workspace === workspace);
    const names = new Set(mine.map((d) => d.category));
    if (workspace === 'personal') for (const b of budgets) names.add(b.category);
    else for (const c of customCategories) names.add(c);

    return [...names]
      .map((name) => {
        const rows = mine.filter((d) => d.category === name);
        const hasBudget = budgets.some((b) => b.category === name);
        return {
          name,
          taxLabel:
            workspace === 'business'
              ? (rows[0]?.engineRowId.split('.')[0] ?? null)
              : null,
          monthlyBudget: budgets.find((b) => b.category === name)?.monthly ?? null,
          documentCount: rows.length,
          totalSpend: sumDecimal(rows.map((d) => d.payableAmount)),
          active: !inactiveCategories.has(name),
          // Mirrors the server's rule: nothing filed against it and no budget.
          // There is no ledger or subcategory concept in this mock.
          deletable: rows.length === 0 && !hasBudget,
        };
      })
      .sort((a, b) => Number(b.totalSpend) - Number(a.totalSpend));
  }

  async setCategoryActive(name: string, active: boolean): Promise<CategorySetting[]> {
    await settle(140);
    if (active) inactiveCategories.delete(name);
    else inactiveCategories.add(name);
    const workspace = docs.find((d) => d.category === name)?.workspace ?? 'business';
    return this.listCategorySettings(workspace);
  }

  async createCategory(
    name: string,
    workspace: Workspace,
    monthlyBudget?: string | null,
  ): Promise<CategorySetting[]> {
    await settle(220);
    const clean = name.trim();
    if (!clean) throw new Error('Give the category a name.');
    const existing = await this.listCategorySettings(workspace);
    if (existing.some((c) => c.name.toLowerCase() === clean.toLowerCase())) {
      throw new Error(`${clean} already exists.`);
    }
    // A new category with no spend yet exists only as a budget line, which is
    // also the only way to make it visible before anything is filed against it.
    if (workspace === 'personal') {
      budgets = [...budgets, { category: clean, monthly: monthlyBudget || '0.0000' }];
    } else {
      customCategories.add(clean);
    }
    return this.listCategorySettings(workspace);
  }

  async deleteCategory(name: string): Promise<CategorySetting[]> {
    await settle(140);
    const workspace = docs.find((d) => d.category === name)?.workspace ?? 'business';
    const current = await this.listCategorySettings(workspace);
    const row = current.find((c) => c.name === name);
    if (!row) throw new Error(`No category called ${name}.`);
    if (!row.deletable) {
      const reasons: string[] = [];
      if (row.documentCount > 0) {
        reasons.push(`${row.documentCount} receipt${row.documentCount === 1 ? '' : 's'}`);
      }
      if (row.monthlyBudget) reasons.push('a monthly budget');
      throw new Error(`"${name}" cannot be deleted — it has ${reasons.join(' and ')}. Switch it off instead.`);
    }
    budgets = budgets.filter((b) => b.category !== name);
    customCategories.delete(name);
    inactiveCategories.delete(name);
    return this.listCategorySettings(workspace);
  }

  async getPlanUsage(): Promise<PlanUsage> {
    await settle(130);
    const scansUsed = docs.filter((d) => d.issueDate >= startOfMonth(new Date())).length;
    return {
      ...DEMO.plan,
      scansUsed,
      scansRemaining:
        DEMO.plan.scanQuota === null ? null : Math.max(0, DEMO.plan.scanQuota - scansUsed),
      seatsUsed: members.filter((m) => m.workspaceId === DEMO.workspaces[0]!.id).length,
    };
  }

  async listConnections(): Promise<Connection[]> {
    await settle(140);
    return [...connections];
  }

  async connectAccounting(id: Connection['id']): Promise<{ authorizeUrl: string }> {
    await settle(400);
    // The real server hands back a provider's authorise URL and the app opens
    // it in a browser; the connection appears only after the callback lands.
    // The demo returns the same SHAPE rather than flipping straight to
    // connected, so the screen is built against the flow that actually exists.
    return { authorizeUrl: `https://login.example.com/oauth/authorize?demo=${id}` };
  }

  async acceptInvitation(
    token: string,
  ): Promise<{ workspace: WorkspaceSummary; role: MemberRole }> {
    await settle(700);
    // The demo has no invitation store, so any non-empty token joins the
    // household — which is the flow the screen has to handle. An empty one
    // fails, because a screen that cannot fail has not been designed.
    if (!token.trim()) throw new Error('This invitation is no longer valid.');
    const workspace = DEMO.workspaces.find((w) => w.kind === 'personal') ?? DEMO.workspaces[0]!;

    // Joining adds a MEMBERSHIP, which is what makes the workspace appear in
    // the switcher and its documents become readable — the same mechanism the
    // server uses. Faking it by returning a workspace summary alone would give
    // a screen that says "joined" and a switcher that disagrees.
    const me = sessionFor(WHO)?.user;
    if (!members.some((m) => m.userId === WHO && m.workspaceId === workspace.id)) {
      members = [
        ...members,
        {
          userId: WHO,
          workspaceId: workspace.id,
          displayName: me?.displayName ?? 'You',
          email: me?.email ?? '',
          role: 'member',
          joinedAt: todayIso(),
          lastActiveAt: null,
        },
      ];
    }
    const count = members.filter((m) => m.workspaceId === workspace.id).length;
    return {
      workspace: { ...workspace, memberCount: count, role: 'member' },
      role: 'member',
    };
  }

  async prepareTaxPack(): Promise<TaxPackFile> {
    // Long on purpose: the real one zips a financial year of photographs, and
    // a progress state that finishes instantly teaches the wrong expectation.
    await settle(1600);
    const pack = await this.getTaxPack();
    const included = pack.sections.filter((s) => s.included);
    return {
      url: 'demo://tax-pack.zip',
      filename: `snap-apps-${pack.periodLabel.replace(/[^\w]+/g, '-')}.zip`,
      bytes: included.reduce((a, s) => a + s.bytes, 0),
      documentCount: included.reduce((a, s) => a + s.count, 0),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    };
  }

  async disconnectAccounting(id: Connection['id']): Promise<Connection[]> {
    await settle(400);
    connections = connections.map((c) =>
      c.id === id ? { ...c, status: 'disconnected', organisation: null, lastSyncAt: null } : c,
    );
    return [...connections];
  }

  async getTaxPack(): Promise<TaxPack> {
    await settle(320);
    const from = startOfQuarter(new Date());
    const to = todayIso();
    const inPeriod = docs.filter(
      (d) => d.workspace === 'business' && d.issueDate >= from && d.issueDate <= to,
    );
    const claimable = inPeriod.filter((d) => d.isTaxInvoice);
    const atRisk = inPeriod.filter((d) => !d.isTaxInvoice);

    const sections = [
      {
        label: 'Original images',
        // The ATO accepts an electronic copy only if it is a true and clear
        // reproduction, so the pack carries the originals, not the extractions.
        detail: 'True and clear reproductions, as captured',
        count: inPeriod.length,
        bytes: inPeriod.length * 420_000,
        included: true,
      },
      {
        label: 'Tax invoices',
        detail: 'Every element the ATO requires, verified',
        count: claimable.length,
        bytes: claimable.length * 9_000,
        included: true,
      },
      {
        label: 'Documents needing attention',
        detail: 'GST credits at risk, with the reason for each',
        count: atRisk.length,
        bytes: atRisk.length * 9_000,
        included: true,
      },
      {
        label: 'BAS worksheet',
        detail: 'G1, G10, G11, 1A and 1B with their workings',
        count: 1,
        bytes: 48_000,
        included: true,
      },
      {
        label: 'Deduction worksheet',
        detail: `Every claim at ${DEMO.rates.determination} rates`,
        count: 1,
        bytes: 62_000,
        included: true,
      },
      {
        label: 'Mileage log',
        detail: `${trips.filter((t) => t.workRelated).length} work trips`,
        count: trips.filter((t) => t.workRelated).length,
        bytes: 14_000,
        included: true,
      },
      {
        label: 'Sales invoices',
        detail: 'Issued this period, with payments received',
        count: invoices.filter((i) => i.kind === 'invoice' && i.issueDate >= from).length,
        bytes: 26_000,
        included: true,
      },
    ];

    return {
      periodLabel: 'This quarter',
      fromDate: from,
      toDate: to,
      sections,
      totalBytes: sections.filter((x) => x.included).reduce((a, x) => a + x.bytes, 0),
      retentionNote:
        'Australian business records must be kept for five years from the date they are prepared, obtained or the transaction is complete — whichever is latest.',
    };
  }

  // ── Credits & points (D27) ──

  async listCreditPacks(): Promise<CreditPack[]> {
    await settle(120);
    return [...CREDIT_PACKS].sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async getCreditBalance(): Promise<CreditBalance> {
    await settle(120);
    return { creditsRemaining: creditBalance };
  }

  async listCreditPurchases(): Promise<CreditPurchase[]> {
    await settle(140);
    return [...creditPurchases].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async startCreditPurchase(packCode: string): Promise<CreditPurchase> {
    await settle(400);
    const pack = CREDIT_PACKS.find((x) => x.code === packCode);
    if (!pack) throw new Error(`No such credit pack: ${packCode}.`);
    // Mirrors the server exactly: this records INTENT only. Nothing is
    // granted until `fulfilCreditPurchase` runs — there is no payment
    // processor yet (Stripe is phase 6.5), so `pending` is the whole honest
    // truth about a purchase started from this screen.
    const purchase: CreditPurchase = {
      id: `cpu_${Date.now()}`,
      packCode: pack.code,
      credits: pack.credits,
      priceAud: pack.priceAud,
      status: 'pending',
      provider: 'manual',
      createdAt: new Date().toISOString(),
      paidAt: null,
    };
    creditPurchases = [purchase, ...creditPurchases];
    return purchase;
  }

  async fulfilCreditPurchase(purchaseId: string): Promise<CreditPurchase> {
    await settle(400);
    const purchase = creditPurchases.find((x) => x.id === purchaseId);
    if (!purchase) throw new Error('No such purchase.');
    // Idempotent, exactly like the server: fulfilling an already-paid
    // purchase returns it unchanged rather than granting the credits twice.
    if (purchase.status === 'paid') return purchase;
    if (purchase.status !== 'pending') {
      throw new Error(
        `This purchase is ${purchase.status}, not pending — it cannot be fulfilled.`,
      );
    }
    const paid: CreditPurchase = { ...purchase, status: 'paid', paidAt: new Date().toISOString() };
    creditPurchases = creditPurchases.map((x) => (x.id === purchaseId ? paid : x));
    creditBalance += paid.credits;
    return paid;
  }

  async getPointBalance(): Promise<PointBalance> {
    await settle(120);
    return { balance: pointLedger.reduce((a, e) => a + e.delta, 0) };
  }

  async listPointLedger(limit = 50): Promise<PointLedgerEntry[]> {
    await settle(130);
    return [...pointLedger].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }

  /* ── Wallet, usage, rewards & preferences (2026-09-19 redesign) ──────────
     Backed by module-level state so the demo BEHAVES: adding a card makes it
     selectable at checkout, spending credits shows up in usage, and marking
     alerts read stays read for the session. A mock that only returns fixtures
     lets a broken write path pass review. */

  async listAvailableTaxRules(): Promise<AvailableTaxRules[]> {
    await settle(120);
    /* Indonesia ONLY, because that is the truth: `BUILTIN` in
       apps/server/src/taxrules/taxrules.repo.ts is `[ID_2026]` and
       packages/tax-rules/src/rules/ contains one file. There is no Australian
       rule set in the registry — `au-2026` appears only in a test of the
       id-derivation helper.

       An earlier version of this mock returned Australia as well. That was
       fiction, and it is the reason the empty-list bug on the registration
       screen looked fine in every local check: the mock answered a question
       the real deployment cannot. A mock that is more capable than the server
       does not de-risk anything, it just moves the discovery to production. */
    return [
      {
        rulesId: 'id-2026', country: 'ID', countryName: 'Indonesia',
        version: '2026.1.0', taxYear: '2026', scope: 'personal',
        consumptionTaxName: 'PPN', currency: 'IDR',
      },
    ];
  }

  async listSavedCards(): Promise<SavedCard[]> {
    await settle(120);
    return [...savedCards].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  }

  async addSavedCard(input: AddSavedCardRequest): Promise<SavedCard> {
    await settle(420);
    const digits = input.number.replace(/\D/g, '');
    if (digits.length < 12) throw new Error('That card number is too short.');
    if (!/^\d{3,4}$/.test(input.cvc)) throw new Error('Check the security code.');

    // The PAN never lands in state — only the last four, as the contract says.
    const card: SavedCard = {
      id: `card_${Date.now().toString(36)}`,
      provider: input.provider,
      brand: brandOf(digits),
      last4: digits.slice(-4),
      expiryMonth: input.expiryMonth,
      expiryYear: input.expiryYear,
      label: `${labelOf(brandOf(digits))} ending ${digits.slice(-4)}`,
      isDefault: input.makeDefault ?? savedCards.length === 0,
      createdAt: new Date().toISOString(),
    };
    savedCards = card.isDefault
      ? [...savedCards.map((c) => ({ ...c, isDefault: false })), card]
      : [...savedCards, card];
    return card;
  }

  async removeSavedCard(cardId: string): Promise<void> {
    await settle(200);
    const gone = savedCards.find((c) => c.id === cardId);
    savedCards = savedCards.filter((c) => c.id !== cardId);
    // Removing the default promotes the next one, or there is no default.
    if (gone?.isDefault && savedCards.length > 0) {
      savedCards = savedCards.map((c, i) => ({ ...c, isDefault: i === 0 }));
    }
  }

  async setDefaultCard(cardId: string): Promise<SavedCard> {
    await settle(160);
    savedCards = savedCards.map((c) => ({ ...c, isDefault: c.id === cardId }));
    const card = savedCards.find((c) => c.id === cardId);
    if (!card) throw new Error('That card is no longer saved.');
    return card;
  }

  async getUsage(kind: UsageKind, month: string): Promise<UsagePeriod> {
    await settle(180);
    const items = (usageByMonth[kind] ?? {})[month] ?? [];
    return { month, kind, total: items.reduce((a, i) => a + i.amount, 0), items };
  }

  async listUsageMonths(kind: UsageKind): Promise<string[]> {
    await settle(90);
    return Object.keys(usageByMonth[kind] ?? {}).sort().reverse();
  }

  async listRewards(): Promise<Reward[]> {
    await settle(200);
    /* `available` is yourtal's stock flag, NOT affordability. Greying a
       listing out because this user cannot afford it would be this app
       deciding something the store owns. */
    return REWARDS;
  }

  async redeemVoucher(input: RedeemVoucherRequest): Promise<VoucherRedemption> {
    await settle(520);
    const code = input.code.trim().toUpperCase();
    if (code.length < 6) throw new Error('A voucher code is at least six characters.');

    const voucher = DEMO_VOUCHERS[code];
    if (!voucher) throw new Error('That code is not a voucher we recognise.');
    // Single-use: the only partial-redemption policy that makes sense while
    // Snap grants whole credit packs. See `RedeemVoucherRequest`.
    if (spentVouchers.has(code)) throw new Error('That voucher has already been used.');

    spentVouchers.add(code);
    creditBalance += voucher.credits;
    /* No point ledger entry. The points were spent in yourtal when the
       voucher was minted; nothing leaves this balance here. */
    return {
      code,
      title: voucher.title,
      creditsGranted: voucher.credits,
      creditsBalance: creditBalance,
      redeemedAt: new Date().toISOString(),
    };
  }

  async listAlerts(): Promise<AlertItem[]> {
    await settle(160);
    return [...alerts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async markAlertsRead(): Promise<void> {
    await settle(120);
    const now = new Date().toISOString();
    alerts = alerts.map((a) => (a.readAt ? a : { ...a, readAt: now }));
  }

  async getNotificationPrefs(): Promise<NotificationPrefs> {
    await settle(100);
    return notificationPrefs;
  }

  async updateNotificationPrefs(patch: Partial<NotificationPrefs>): Promise<NotificationPrefs> {
    await settle(160);
    notificationPrefs = { ...notificationPrefs, ...patch };
    return notificationPrefs;
  }

  async getPrivacySettings(): Promise<PrivacySettings> {
    await settle(100);
    return privacySettings;
  }

  async updatePrivacySettings(patch: Partial<PrivacySettings>): Promise<PrivacySettings> {
    await settle(160);
    const next = { ...privacySettings, ...patch };
    // The substantiation floor is not negotiable from the client.
    next.retentionMonths = Math.max(60, next.retentionMonths);
    privacySettings = next;
    return privacySettings;
  }

  async requestOtp(input: RequestOtpRequest): Promise<RequestOtpResponse> {
    await settle(400);
    lastOtp = { email: input.email.toLowerCase(), code: '424242', purpose: input.purpose };
    return { retryAfterSeconds: 30, maskedTarget: maskEmail(input.email) };
  }

  async verifyOtp(input: VerifyOtpRequest): Promise<Session | null> {
    await settle(400);
    const ok =
      lastOtp !== null &&
      lastOtp.email === input.email.toLowerCase() &&
      lastOtp.purpose === input.purpose &&
      lastOtp.code === input.code.trim();
    if (!ok) throw new Error('That code is not right. Check the last text and try again.');
    lastOtp = null;
    // A reset still has to set a password before there is a session.
    if (input.purpose === 'reset-password') return null;
    return this.signIn(input.email);
  }

  async resetPassword(input: ResetPasswordRequest): Promise<Session> {
    await settle(450);
    if (input.newPassword.length < 8) throw new Error('Use at least eight characters.');
    return this.signIn(input.email);
  }
}


/** The same shape with nothing in it, so a new workspace has a real answer. */
function emptyMileage(): MileageSummary {
  const { centsPerKmRate, centsPerKmCapKm } = DEMO.mileage;
  return {
    trips: [],
    workKm: 0,
    totalKm: 0,
    centsPerKmRate,
    centsPerKmCapKm,
    claimAtCentsPerKm: '0.0000',
    overCentsPerKmCap: false,
    logbookPercent: 0,
  };
}

/** Mileage, recomputed from the trip log at the current ATO rate. */
function mileage(): MileageSummary {
  const workKm = trips.filter((t) => t.workRelated).reduce((a, t) => a + t.km, 0);
  const totalKm = trips.reduce((a, t) => a + t.km, 0);
  const { centsPerKmRate, centsPerKmCapKm, logbookPercent } = DEMO.mileage;
  // The cents-per-km method is capped at 5,000 business kilometres per car per
  // year. Past that a logbook claims more, and the app should say so.
  const claimable = Math.min(workKm, centsPerKmCapKm);
  return {
    trips: [...trips].sort((a, b) => b.date.localeCompare(a.date)),
    workKm,
    totalKm,
    centsPerKmRate,
    centsPerKmCapKm,
    claimAtCentsPerKm: (claimable * centsPerKmRate).toFixed(4),
    overCentsPerKmCap: workKm > centsPerKmCapKm,
    logbookPercent,
  };
}

/** What must go in each month to reach a goal by its date. */
function perMonthFor(target: string, saved: string, targetDate: string): string {
  const now = new Date();
  const then = new Date(`${targetDate}T00:00:00`);
  const months = Math.max(
    1,
    (then.getFullYear() - now.getFullYear()) * 12 + (then.getMonth() - now.getMonth()),
  );
  const remaining = Math.max(0, Number(target) - Number(saved));
  return (remaining / months).toFixed(4);
}

function formatDue(v: string): string {
  return `$${Number(v).toFixed(2)}`;
}

// ── helpers ────────────────────────────────────────────────────────────────

/** Sum decimal strings without touching a float. Scaled to 4dp, like the DB. */
function sumDecimal(values: string[]): string {
  const total = values.reduce((acc, v) => acc + toUnits(v), 0n);
  const negative = total < 0n;
  const abs = negative ? -total : total;
  const whole = abs / 10_000n;
  const frac = (abs % 10_000n).toString().padStart(4, '0');
  return `${negative ? '-' : ''}${whole}.${frac}`;
}

/**
 * GST on a sale: 10% ADDED to the ex-GST amount, rounded to the cent.
 *
 * The inverse of a purchase, where GST is 1/11 of the inclusive total. Getting
 * the direction wrong is the classic Australian error, so the two live under
 * different names and neither is a default.
 */
function gstOnSaleExact(exGst: string): string {
  const units = toUnits(exGst);
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const tenth = (abs * 2n + 10n) / 20n;
  const cents = ((tenth + 50n) / 100n) * 100n;
  const whole = cents / 10_000n;
  const frac = (cents % 10_000n).toString().padStart(4, '0');
  return `${negative ? '-' : ''}${whole}.${frac}`;
}

function subtractDecimal(a: string, b: string): string {
  return sumDecimal([a, `-${b.replace('-', '')}`]);
}

function addDecimal(a: string, b: string): string {
  return sumDecimal([a, b]);
}

function isoDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Mirrors the server's trigger-maintained guarantee (migration 0030):
 * `saved` is never written directly, only recomputed from the contribution
 * rows behind it, so the mock cannot drift from its own evidence any more
 * than the real API can.
 */
function recomputeGoalSaved(goalId: string): void {
  const total = goalContributions
    .filter((c) => c.goalId === goalId)
    .reduce((sum, c) => addDecimal(sum, c.amount), '0.0000');
  goals = goals.map((g) => {
    if (g.id !== goalId) return g;
    const done = Number(total) >= Number(g.target);
    return {
      ...g,
      saved: total,
      done,
      perMonth: done || !g.targetDate ? null : perMonthFor(g.target, total, g.targetDate),
    };
  });
}

function toUnits(value: string): bigint {
  const [whole = '0', frac = ''] = value.replace('-', '').split('.');
  const units = BigInt(whole) * 10_000n + BigInt((frac + '0000').slice(0, 4));
  return value.trimStart().startsWith('-') ? -units : units;
}

/** ABN mod-89 checksum. Same algorithm as the database's generated column. */
export function abnIsValid(abn: string | null): boolean {
  if (!abn) return false;
  const d = abn.replace(/\D/g, '');
  if (d.length !== 11) return false;
  const w = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const sum = d
    .split('')
    .map(Number)
    .reduce((acc, n, i) => acc + (i === 0 ? n - 1 : n) * (w[i] ?? 0), 0);
  return sum % 89 === 0;
}
