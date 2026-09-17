import 'server-only';

import type {
  AnalyticsRange,
  AnalyticsSummary,
  Bill,
  BusinessSettings,
  CategorySetting,
  Connection,
  CreditBalance,
  CreditPack,
  CreditPurchase,
  DocumentFilter,
  DocumentView,
  Goal,
  Invoice,
  Item,
  MemberList,
  MileageSummary,
  Overview,
  Party,
  Payment,
  PersonalSummary,
  PlanUsage,
  PointBalance,
  PointLedgerEntry,
  Recurring,
  SalesSummary,
  StockMovement,
  TaxPack,
  Trip,
} from '@snap/api-contract';
import type { ConsumptionTaxReport, InstalledTaxRules } from '@snap/api-contract';

import { api, ApiError } from '@/lib/api/server';

/**
 * Typed reads over the routes `docs/WEB.md` points at.
 *
 * One thin wrapper per endpoint rather than each page building its own path
 * string: the individual and business panels both read documents, plan,
 * connections and settings, and a URL or query-param typo belongs in exactly
 * one place to get wrong.
 */

export const getOverview = (workspaceId: string) => api<Overview>('/v1/overview', { workspaceId });

export const getPersonal = (workspaceId: string) => api<PersonalSummary>('/v1/personal', { workspaceId });

export const listDocuments = (workspaceId: string, filter: DocumentFilter = 'all') =>
  api<DocumentView[]>(`/v1/documents?filter=${filter}`, { workspaceId });

export const getDocument = (workspaceId: string, id: string) =>
  api<DocumentView>(`/v1/documents/${id}`, { workspaceId });

export const getAnalytics = (workspaceId: string, range: AnalyticsRange) =>
  api<AnalyticsSummary>(`/v1/analytics?range=${range}`, { workspaceId });

export const listRecurring = (workspaceId: string) => api<Recurring[]>('/v1/recurring', { workspaceId });

export const getMileage = (workspaceId: string) => api<MileageSummary>('/v1/mileage', { workspaceId });

export const listGoals = (workspaceId: string) => api<Goal[]>('/v1/goals', { workspaceId });

export const listCategorySettings = (workspaceId: string) =>
  api<CategorySetting[]>('/v1/settings/categories', { workspaceId });

export const getBusinessSettings = (workspaceId: string) =>
  api<BusinessSettings>('/v1/settings/business', { workspaceId });

export const listOccupations = (workspaceId: string) =>
  api<Array<{ group: string; profiles: Array<{ id: string; label: string }> }>>('/v1/settings/occupations', {
    workspaceId,
  });

export const getPlanUsage = (workspaceId: string) => api<PlanUsage>('/v1/plan', { workspaceId });

export const listConnections = (workspaceId: string) => api<Connection[]>('/v1/connections', { workspaceId });

export const getTaxPack = (workspaceId: string) => api<TaxPack>('/v1/tax-pack', { workspaceId });

export const listInvoices = (workspaceId: string, kind?: 'invoice' | 'estimate') =>
  api<Invoice[]>(`/v1/invoices${kind ? `?kind=${kind}` : ''}`, { workspaceId });

export const getInvoice = (workspaceId: string, id: string) =>
  api<Invoice & { lines: unknown[] }>(`/v1/invoices/${id}`, { workspaceId });

export const getSales = (workspaceId: string) => api<SalesSummary>('/v1/sales', { workspaceId });

export const listPayments = (workspaceId: string) => api<Payment[]>('/v1/payments', { workspaceId });

export const listBills = (workspaceId: string) => api<Bill[]>('/v1/bills', { workspaceId });

export const listItems = (workspaceId: string) => api<Item[]>('/v1/items', { workspaceId });

export const listStockMovements = (workspaceId: string) =>
  api<StockMovement[]>('/v1/stock-movements', { workspaceId });

export const listParties = (workspaceId: string, kind?: 'customer' | 'supplier') =>
  api<Party[]>(`/v1/parties${kind ? `?kind=${kind}` : ''}`, { workspaceId });

export const listMembers = (workspaceId: string) =>
  api<MemberList>(`/v1/workspaces/${workspaceId}/members`, { workspaceId });

/* ── Credits & points — docs/ECOSYSTEM.md D27 ─────────────────────────────
 *
 * Credits are tenant-scoped, like everything above. Points are USER-scoped —
 * a point is earned by a person, not a workspace — so those two calls take
 * no `workspaceId` at all; the server's `PointsController` uses
 * `SessionGuard` alone and never reads `X-Workspace-Id`.
 */

export const listCreditPacks = (workspaceId: string) => api<CreditPack[]>('/v1/credit-packs', { workspaceId });

export const getCreditBalance = (workspaceId: string) => api<CreditBalance>('/v1/credits', { workspaceId });

export const listCreditPurchases = (workspaceId: string) =>
  api<CreditPurchase[]>('/v1/credits/purchases', { workspaceId });

export const getPointBalance = () => api<PointBalance>('/v1/points');

export const listPointLedger = (limit?: number) =>
  api<PointLedgerEntry[]>(`/v1/points/ledger${limit ? `?limit=${limit}` : ''}`);

/* ── The ledger — not part of the mobile seam, called directly ───────────── */

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
  status: 'draft' | 'posted' | 'void';
  source: string;
  memo: string | null;
  reference: string | null;
  currency: string;
  documentId: string | null;
  postedAt: string | null;
  voidReason: string | null;
  splits: TransactionSplitRow[];
};

export const listTransactions = (workspaceId: string, status?: 'draft' | 'posted' | 'void') =>
  api<TransactionRow[]>(`/v1/transactions${status ? `?status=${status}` : ''}`, { workspaceId });

/* ── The installed tax engine (0026) ──────────────────────────────────────── */

/**
 * Which tax rule set this workspace runs, and what it can install.
 *
 * Never throws for "no engine installed" — that is a 200 carrying a `problem`,
 * because a settings screen has to render the state and offer the list.
 */
export const getInstalledTaxRules = (workspaceId: string) =>
  api<InstalledTaxRules>('/v1/tax-rules', { workspaceId });

/**
 * Consumption tax over a period, from the ledger.
 *
 * Returns `null` when the workspace has no engine installed — the API answers
 * 422 there rather than zeros, because a confident nothing is indistinguishable
 * from a workspace that genuinely spent nothing, and the caller needs to tell
 * those apart to render the right screen.
 */
export const getConsumptionTax = async (workspaceId: string, from: string, to: string) => {
  try {
    return await api<ConsumptionTaxReport>(
      `/v1/tax-rules/consumption-tax?from=${from}&to=${to}`,
      { workspaceId },
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 422) return null;
    throw error;
  }
};
