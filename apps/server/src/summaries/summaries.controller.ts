import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  analyticsSummary,
  detectRecurring,
  personalSummary,
} from '@snap/api-contract/analytics';
import type {
  AnalyticsRange,
  Entitlement,
  AnalyticsSummary,
  DocumentView,
  MileageSummary,
  Overview,
  PersonalSummary,
  Recurring,
  SalesSummary,
  Trip,
} from '@snap/api-contract';
import { CURRENT_RATES, PROFILES } from '@snap/tax-engine';

import {
  CurrentUser,
  MembershipGuard,
  SessionGuard,
  WorkspaceId,
  type AuthUser,
} from '../common/auth.guard.js';
import { listBudgets, listInvoices, listTrips } from '../business/business.repo.js';
import { toWire } from '../documents/documents.controller.js';
import { listDocuments, readPlan, readTenant, type PlanRow } from '../repo.js';
import { add, ZERO } from '@snap/api-contract/money';

/**
 * The summary screens: home, the personal tracker, analytics, mileage.
 *
 * Every figure here is DERIVED on read. None of it is stored, and none of it
 * is cached. A stored total and the documents it came from are two sources for
 * one fact, and the stored one is wrong from the first correction onwards —
 * which in this app means a BAS that disagrees with the receipts behind it.
 *
 * The aggregation itself is `@snap/api-contract/analytics`, the same module
 * the app runs. That is deliberate: the period comparison in it has been wrong
 * twice (a part month measured against a whole one, and a change against a
 * window that predated the data), and a second implementation in SQL would be
 * a third opportunity. One implementation, one set of tests.
 */
@ApiTags('summaries')
@Controller('v1')
@UseGuards(SessionGuard, MembershipGuard)
export class SummariesController {
  /** Everything in the workspace, as the app's own type. */
  private async views(user: AuthUser, tenantId: string): Promise<DocumentView[]> {
    const rows = await listDocuments(user.userId, tenantId, 'all');
    // Aggregation reads amounts and dates only; it never displays a document's
    // pages, so there is no reason to pay for `listCapturePages` per row here.
    return rows.map((r) => toWire(r, [], []));
  }

  @Get('overview')
  @ApiOperation({
    summary: 'The business home screen',
    description:
      'Scoped twice over: a BAS covers ONE quarter, and it never sees personal spending. Both scopings are load-bearing — a previous version reported a year of expenses against a quarter of income and showed a loss of $109,970.',
  })
  async overview(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
  ): Promise<Overview> {
    const [tenant, plan, documents] = await Promise.all([
      readTenant(user.userId, tenantId),
      readPlan(user.userId, tenantId),
      this.views(user, tenantId),
    ]);

    const quarter = documents.filter((d) => d.issueDate >= startOfQuarter());
    const atRisk = quarter.filter((d) => !d.isTaxInvoice);
    const profile = tenant?.occupation_profile_id
      ? PROFILES[tenant.occupation_profile_id]
      : undefined;

    return {
      tenantName: tenant?.name ?? 'Workspace',
      tenantAbn: tenant?.abn ?? null,
      firmName: plan.firm_name,
      profileLabel: profile?.label ?? 'No occupation set',
      // An occupation with no benchmark row (apprentice) and one with no fixed
      // maximum (rental) are different states, and both are null here rather
      // than a number the user would read as a limit.
      benchmarkCommon: profile?.benchmarks ? [...profile.benchmarks.common] : null,
      benchmarkMax: profile?.benchmarks?.max ?? null,
      ratesFy: CURRENT_RATES.fy,
      ratesDetermination: CURRENT_RATES.determination,
      bas: {
        periodLabel: quarterLabel(),
        purchasesInclusive: sum(quarter.map((d) => d.payableAmount)),
        // Claimable and at-risk are the SAME money seen two ways: GST we can
        // claim, and GST we cannot because the paperwork does not support it.
        // Kept apart so the headline number is honest about the difference.
        gstClaimable: sum(quarter.filter((d) => d.isTaxInvoice).map((d) => d.taxAmount)),
        gstAtRisk: sum(atRisk.map((d) => d.taxAmount)),
        atRiskCount: atRisk.length,
        thresholds: { taxInvoice: '82.50', buyerAbn: '1000.00' },
        note: 'GST on a purchase is 1/11 of the GST-inclusive amount, not 10% of it.',
      },
      deductions: {
        // Categorisation is a later phase, so the ESTIMATE is zero rather than
        // a plausible-looking guess: an invented deduction total is the one
        // number in this app a user might actually file.
        estimateTotal: 0,
        byLabel: {},
        // The caps are not estimates — they are this financial year's published
        // limits, and the screen shows them whether or not anything has been
        // categorised yet. Taken from the rate set rather than restated here,
        // so a new determination changes them in one place.
        caps: {
          centsPerKmCeiling:
            Math.round(CURRENT_RATES.centsPerKmCapKm * CURRENT_RATES.centsPerKmRate * 100) / 100,
          maxCarDeclinePerYear:
            Math.round(
              (CURRENT_RATES.carCostLimit / CURRENT_RATES.carEffectiveLifeYears) * 100,
            ) / 100,
          mealDailyLimit: CURRENT_RATES.mealDailyLimit,
          overtimeMealNoReceiptMax: CURRENT_RATES.overtimeMealNoReceiptMax,
          homeLaundryPerWeek: CURRENT_RATES.homeLaundryPerWeek,
          carCostLimit: CURRENT_RATES.carCostLimit,
        },
      },
      entitlement: entitlementFrom(plan),
    };
  }

  @Get('personal')
  @ApiOperation({ summary: 'The household tracker' })
  async personal(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
  ): Promise<PersonalSummary> {
    const [documents, budgets] = await Promise.all([
      this.views(user, tenantId),
      listBudgets(user.userId, tenantId),
    ]);
    // The budget total is the sum of the category budgets: a household that
    // has set three caps has budgeted the sum of those three, not a separate
    // headline figure that can silently disagree with them.
    return personalSummary(documents, budgets, sum(budgets.map((b) => b.monthly)));
  }

  @Get('analytics')
  @ApiOperation({
    summary: 'Charts for a period',
    description:
      'range is month, quarter or year. The previous-period comparison stops at the SAME DAY of the earlier period, and is withheld entirely when the earlier window predates the data.',
  })
  async analytics(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Query('range') range?: string,
  ): Promise<AnalyticsSummary> {
    const allowed: AnalyticsRange[] = ['month', 'quarter', 'year'];
    const chosen = allowed.includes(range as AnalyticsRange)
      ? (range as AnalyticsRange)
      : 'quarter';
    const [tenant, documents, budgets] = await Promise.all([
      readTenant(user.userId, tenantId),
      this.views(user, tenantId),
      listBudgets(user.userId, tenantId),
    ]);
    const workspace = tenant?.kind === 'personal' ? 'personal' : 'business';
    return analyticsSummary(documents, workspace, chosen, budgets);
  }

  @Get('recurring')
  @ApiOperation({
    summary: 'Subscriptions and repeat bills the spending implies',
    description: 'Inferred from what has actually been captured — never from a list a user has to maintain.',
  })
  async recurring(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
  ): Promise<Recurring[]> {
    return detectRecurring(await this.views(user, tenantId));
  }

  @Get('sales')
  @ApiOperation({
    summary: 'Receivables',
    description:
      'Derived from payments, never from a stored balance. A stored balance and a payment history are two sources for one fact and diverge the first time a payment is voided.',
  })
  async sales(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
  ): Promise<SalesSummary> {
    const rows = await listInvoices(user.userId, tenantId);
    const live = rows.filter((i) => i.kind === 'invoice');
    // A draft is excluded from everything: nobody has been asked to pay it, so
    // it is neither owed to us nor GST we have charged.
    const open = live.filter((i) => i.status !== 'paid' && i.status !== 'draft');
    return {
      outstanding: sum(open.map((i) => i.amount_due)),
      overdue: sum(open.filter((i) => i.status === 'overdue').map((i) => i.amount_due)),
      paidThisQuarter: sum(
        live.filter((i) => i.status === 'paid' && i.issue_date >= startOfQuarter())
          .map((i) => i.total_amount),
      ),
      gstOnSales: sum(live.filter((i) => i.status !== 'draft').map((i) => i.gst_amount)),
    };
  }

  @Get('mileage')
  @ApiOperation({
    summary: 'Trips and what they are worth',
    description:
      'The cents-per-km method is capped at 5,000 business kilometres BY LAW. Past that the claim stops growing and a logbook becomes the better method, which is said rather than silently implied.',
  })
  async mileage(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
  ): Promise<MileageSummary> {
    const rows = await listTrips(user.userId, tenantId);
    const trips: Trip[] = rows.map((t) => ({
      id: t.id,
      date: t.trip_date,
      fromPlace: t.from_place,
      toPlace: t.to_place,
      km: Number(t.km),
      purpose: t.purpose ?? '',
      workRelated: t.work_related,
    }));

    const workKm = trips.filter((t) => t.workRelated).reduce((a, t) => a + t.km, 0);
    const totalKm = trips.reduce((a, t) => a + t.km, 0);
    const claimableKm = Math.min(workKm, CURRENT_RATES.centsPerKmCapKm);

    return {
      trips,
      workKm: round1(workKm),
      totalKm: round1(totalKm),
      centsPerKmRate: CURRENT_RATES.centsPerKmRate,
      centsPerKmCapKm: CURRENT_RATES.centsPerKmCapKm,
      claimAtCentsPerKm: (claimableKm * CURRENT_RATES.centsPerKmRate).toFixed(4),
      overCentsPerKmCap: workKm > CURRENT_RATES.centsPerKmCapKm,
      // The share of driving that is work, which is what a logbook establishes.
      // Zero km driven is 0%, not a division by zero dressed up as NaN.
      logbookPercent: totalKm === 0 ? 0 : Math.round((workKm / totalKm) * 100),
    };
  }
}

/* ── Small helpers ───────────────────────────────────────────────────────── */

/**
 * What the app needs to know before offering a scan.
 *
 * `scansRemaining` is null for an unmetered plan rather than a large number:
 * the app must show "unlimited", and any sentinel would eventually be counted
 * down. A top-up is added on top of the plan's quota, which is what a top-up is.
 */
export function entitlementFrom(plan: PlanRow): Entitlement {
  const remaining =
    plan.scan_quota === null
      ? null
      : Math.max(0, plan.scan_quota - plan.scans_used) + plan.topup_remaining;
  return {
    planCode: plan.plan_code,
    realtime: plan.realtime,
    scanQuota: plan.scan_quota,
    scansUsed: plan.scans_used,
    scansRemaining: remaining,
    topupRemaining: plan.topup_remaining,
    seatLimit: plan.seat_limit,
    seatsUsed: plan.seats_used,
    features: plan.features,
  };
}


const sum = (values: Array<string | null>): string =>
  values.reduce<string>((acc, v) => add(acc, v ?? ZERO), ZERO);

/** One decimal place, matching how a trip distance is recorded. */
const round1 = (km: number): number => Math.round(km * 10) / 10;

function startOfQuarter(now = new Date()): string {
  const month = Math.floor(now.getMonth() / 3) * 3;
  return new Date(now.getFullYear(), month, 1).toISOString().slice(0, 10);
}

function quarterLabel(now = new Date()): string {
  // Australian financial year: Q1 is Jul-Sep. A calendar quarter label on a
  // BAS would name the wrong period to anyone reading it.
  const q = [3, 3, 3, 4, 4, 4, 1, 1, 1, 2, 2, 2][now.getMonth()];
  const fyEnd = now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear();
  return `Q${q} FY${String(fyEnd).slice(2)}`;
}
