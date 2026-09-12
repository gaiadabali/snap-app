/**
 * FIXTURE DATA — platform admin plane.
 *
 * Everything in this module is invented, deterministic, and clearly not real.
 * The admin backend (schema, capability model, cross-tenant read routes) is
 * being built in parallel and did not exist at the time this surface was
 * built, so this stands in for it: `packages/db/migrations/0011_firms.sql`
 * and `0015_identity_plane.sql` describe the real shape this should become.
 *
 * Every function in `../_data/*.ts` that reads this module is written so that
 * swapping the body for an `api()` call is a one-file change — the shapes
 * here already match `@snap/api-contract` where a real type exists (Workspace,
 * MemberRole, ConnectionStatus, PlanUsage, BasSummary) and invent a plausible
 * admin-only shape where none exists yet (tenant cost-vs-price, sign-in
 * history, audit log).
 *
 * A fixed reference "now" rather than `Date.now()` so relative timestamps
 * ("3 days ago") do not drift between one render and the next in the same
 * process — the point is a stable demo, not a live clock.
 */
import type { ConnectionStatus, MemberRole, Workspace } from '@snap/api-contract';

export const NOW = new Date('2026-09-12T09:00:00+10:00');

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString();
}
function hoursAgo(n: number): string {
  return new Date(NOW.getTime() - n * 3_600_000).toISOString();
}
function minutesAgo(n: number): string {
  return new Date(NOW.getTime() - n * 60_000).toISOString();
}

export type FirmSeed = {
  id: string;
  name: string;
  abn: string;
  plan: 'practice' | 'practice_plus';
  seatPriceCents: number;
};

export const FIRMS: FirmSeed[] = [
  { id: 'firm_bayview', name: 'Bayview Bookkeeping & BAS', abn: '54 118 322 907', plan: 'practice', seatPriceCents: 1900 },
  { id: 'firm_ironbark', name: 'Ironbark Tax Partners', abn: '71 604 481 233', plan: 'practice_plus', seatPriceCents: 2900 },
  { id: 'firm_northline', name: 'Northline Accounting Group', abn: '39 220 918 664', plan: 'practice', seatPriceCents: 1900 },
];

export type ConnectionSeed = {
  id: 'xero' | 'myob' | 'quickbooks';
  status: ConnectionStatus;
  organisation: string | null;
  lastSyncAt: string | null;
  queued: number;
};

export type TenantSeed = {
  id: string;
  name: string;
  abn: string;
  kind: Workspace;
  firmId: string | null;
  gstRegistered: boolean;
  gstBasis: 'cash' | 'accrual';
  createdAt: string;
  status: 'active' | 'dormant' | 'suspended';
  documents30d: number;
  autoAcceptRate: number;
  needsReviewRate: number;
  errorRate: number;
  storageBytes: number;
  retentionMonths: number;
  planCode: string;
  planName: string;
  priceCents: number;
  scanQuota: number | null;
  scansUsed: number;
  seatLimit: number;
  seatsUsed: number;
  aiCostCents30d: number;
  connections: ConnectionSeed[];
  gstAtRiskCents: number;
  gstClaimableCents: number;
};

// Trade-and-profession names deliberately grounded — this is a compliance
// product for Australian tradies, not a demo of purple gradient SaaS.
export const TENANTS: TenantSeed[] = [
  { id: 'ten_coastal_elec', name: 'Coastal Electrical Services', abn: '82 617 244 190', kind: 'business', firmId: 'firm_bayview', gstRegistered: true, gstBasis: 'cash', createdAt: daysAgo(410), status: 'active', documents30d: 214, autoAcceptRate: 0.81, needsReviewRate: 0.16, errorRate: 0.03, storageBytes: 1_240_000_000, retentionMonths: 60, planCode: 'practice', planName: 'Practice', priceCents: 1900, scanQuota: 200, scansUsed: 188, seatLimit: 3, seatsUsed: 2, aiCostCents30d: 235, connections: [{ id: 'xero', status: 'connected', organisation: 'Coastal Electrical Pty Ltd', lastSyncAt: hoursAgo(4), queued: 2 }], gstAtRiskCents: 4218, gstClaimableCents: 218430 },
  { id: 'ten_hunter_plumb', name: 'Hunter Valley Plumbing', abn: '15 903 271 448', kind: 'business', firmId: 'firm_bayview', gstRegistered: true, gstBasis: 'accrual', createdAt: daysAgo(802), status: 'active', documents30d: 96, autoAcceptRate: 0.74, needsReviewRate: 0.22, errorRate: 0.04, storageBytes: 612_000_000, retentionMonths: 60, planCode: 'practice', planName: 'Practice', priceCents: 1900, scanQuota: 200, scansUsed: 96, seatLimit: 3, seatsUsed: 1, aiCostCents30d: 106, connections: [{ id: 'xero', status: 'connected', organisation: 'Hunter Valley Plumbing', lastSyncAt: daysAgo(1), queued: 0 }], gstAtRiskCents: 1120, gstClaimableCents: 91200 },
  { id: 'ten_summit_carp', name: 'Summit Carpentry & Joinery', abn: '27 559 810 762', kind: 'business', firmId: 'firm_ironbark', gstRegistered: true, gstBasis: 'accrual', createdAt: daysAgo(240), status: 'active', documents30d: 341, autoAcceptRate: 0.62, needsReviewRate: 0.34, errorRate: 0.04, storageBytes: 2_010_000_000, retentionMonths: 60, planCode: 'practice_plus', planName: 'Practice Plus', priceCents: 2900, scanQuota: 600, scansUsed: 589, seatLimit: 8, seatsUsed: 5, aiCostCents30d: 1980, connections: [{ id: 'xero', status: 'error', organisation: 'Summit Carpentry Pty Ltd', lastSyncAt: daysAgo(6), queued: 41 }], gstAtRiskCents: 21840, gstClaimableCents: 340120 },
  { id: 'ten_redgum_landscape', name: 'Redgum Landscaping Co', abn: '63 442 118 905', kind: 'business', firmId: 'firm_ironbark', gstRegistered: true, gstBasis: 'cash', createdAt: daysAgo(90), status: 'active', documents30d: 152, autoAcceptRate: 0.58, needsReviewRate: 0.38, errorRate: 0.06, storageBytes: 402_000_000, retentionMonths: 60, planCode: 'practice_plus', planName: 'Practice Plus', priceCents: 2900, scanQuota: 600, scansUsed: 152, seatLimit: 8, seatsUsed: 2, aiCostCents30d: 3140, connections: [{ id: 'xero', status: 'connected', organisation: 'Redgum Landscaping', lastSyncAt: hoursAgo(1), queued: 0 }], gstAtRiskCents: 8420, gstClaimableCents: 152300 },
  { id: 'ten_bluetongue_paint', name: 'Bluetongue Painting & Decorating', abn: '19 771 340 552', kind: 'business', firmId: 'firm_northline', gstRegistered: false, gstBasis: 'cash', createdAt: daysAgo(58), status: 'active', documents30d: 41, autoAcceptRate: 0.88, needsReviewRate: 0.1, errorRate: 0.02, storageBytes: 88_000_000, retentionMonths: 60, planCode: 'practice', planName: 'Practice', priceCents: 1900, scanQuota: 200, scansUsed: 41, seatLimit: 3, seatsUsed: 1, aiCostCents30d: 47, connections: [{ id: 'xero', status: 'disconnected', organisation: null, lastSyncAt: null, queued: 0 }], gstAtRiskCents: 0, gstClaimableCents: 0 },
  { id: 'ten_ironbark_transport', name: 'Ironbark Freight & Transport', abn: '48 226 990 317', kind: 'business', firmId: 'firm_ironbark', gstRegistered: true, gstBasis: 'accrual', createdAt: daysAgo(1150), status: 'active', documents30d: 488, autoAcceptRate: 0.79, needsReviewRate: 0.18, errorRate: 0.03, storageBytes: 3_400_000_000, retentionMonths: 60, planCode: 'practice_plus', planName: 'Practice Plus', priceCents: 2900, scanQuota: 600, scansUsed: 574, seatLimit: 10, seatsUsed: 7, aiCostCents30d: 3860, connections: [{ id: 'xero', status: 'connected', organisation: 'Ironbark Freight Pty Ltd', lastSyncAt: minutesAgo(40), queued: 5 }], gstAtRiskCents: 34220, gstClaimableCents: 611400 },
  { id: 'ten_dunn_signwriting', name: 'Dunn Signwriting', abn: '92 337 552 118', kind: 'business', firmId: null, gstRegistered: true, gstBasis: 'cash', createdAt: daysAgo(21), status: 'active', documents30d: 12, autoAcceptRate: 0.9, needsReviewRate: 0.1, errorRate: 0.0, storageBytes: 22_000_000, retentionMonths: 60, planCode: 'sole_trader', planName: 'Sole Trader', priceCents: 2900, scanQuota: 150, scansUsed: 12, seatLimit: 1, seatsUsed: 1, aiCostCents30d: 14, connections: [{ id: 'xero', status: 'disconnected', organisation: null, lastSyncAt: null, queued: 0 }], gstAtRiskCents: 0, gstClaimableCents: 6100 },
  { id: 'ten_wattle_cafe', name: "Wattle St Espresso", abn: '36 118 774 220', kind: 'business', firmId: 'firm_northline', gstRegistered: true, gstBasis: 'cash', createdAt: daysAgo(670), status: 'dormant', documents30d: 3, autoAcceptRate: 0.7, needsReviewRate: 0.3, errorRate: 0.0, storageBytes: 540_000_000, retentionMonths: 60, planCode: 'practice', planName: 'Practice', priceCents: 1900, scanQuota: 200, scansUsed: 3, seatLimit: 3, seatsUsed: 1, aiCostCents30d: 4, connections: [{ id: 'xero', status: 'connected', organisation: 'Wattle St Espresso', lastSyncAt: daysAgo(52), queued: 0 }], gstAtRiskCents: 0, gstClaimableCents: 300 },
  { id: 'ten_solo_sparky_mv', name: 'M. Vella Electrical (Sole Trader)', abn: '77 204 880 116', kind: 'business', firmId: null, gstRegistered: true, gstBasis: 'cash', createdAt: daysAgo(140), status: 'active', documents30d: 58, autoAcceptRate: 0.83, needsReviewRate: 0.14, errorRate: 0.03, storageBytes: 118_000_000, retentionMonths: 60, planCode: 'sole_trader', planName: 'Sole Trader', priceCents: 2900, scanQuota: 150, scansUsed: 58, seatLimit: 1, seatsUsed: 1, aiCostCents30d: 62, connections: [{ id: 'xero', status: 'disconnected', organisation: null, lastSyncAt: null, queued: 0 }], gstAtRiskCents: 1980, gstClaimableCents: 58400 },
  { id: 'ten_free_trial_kb', name: 'K. Bishop Handyman', abn: '60 118 552 774', kind: 'business', firmId: null, gstRegistered: false, gstBasis: 'cash', createdAt: daysAgo(9), status: 'active', documents30d: 14, autoAcceptRate: 0.6, needsReviewRate: 0.4, errorRate: 0.0, storageBytes: 9_000_000, retentionMonths: 12, planCode: 'free', planName: 'Free', priceCents: 0, scanQuota: 20, scansUsed: 14, seatLimit: 1, seatsUsed: 1, aiCostCents30d: 16, connections: [{ id: 'xero', status: 'disconnected', organisation: null, lastSyncAt: null, queued: 0 }], gstAtRiskCents: 0, gstClaimableCents: 0 },
  { id: 'ten_northline_practice_own', name: 'Northline Accounting Group (Firm Ops)', abn: '39 220 918 664', kind: 'business', firmId: 'firm_northline', gstRegistered: true, gstBasis: 'accrual', createdAt: daysAgo(900), status: 'active', documents30d: 28, autoAcceptRate: 0.92, needsReviewRate: 0.08, errorRate: 0.0, storageBytes: 210_000_000, retentionMonths: 60, planCode: 'practice', planName: 'Practice', priceCents: 1900, scanQuota: 200, scansUsed: 28, seatLimit: 3, seatsUsed: 2, aiCostCents30d: 31, connections: [{ id: 'xero', status: 'connected', organisation: 'Northline Accounting Group', lastSyncAt: hoursAgo(9), queued: 0 }], gstAtRiskCents: 0, gstClaimableCents: 27200 },
  { id: 'ten_ridgeline_roofing', name: 'Ridgeline Roofing', abn: '11 447 902 335', kind: 'business', firmId: 'firm_bayview', gstRegistered: true, gstBasis: 'accrual', createdAt: daysAgo(500), status: 'active', documents30d: 601, autoAcceptRate: 0.55, needsReviewRate: 0.39, errorRate: 0.06, storageBytes: 4_100_000_000, retentionMonths: 60, planCode: 'practice_plus', planName: 'Practice Plus', priceCents: 2900, scanQuota: 600, scansUsed: 601, seatLimit: 10, seatsUsed: 9, aiCostCents30d: 6870, connections: [{ id: 'xero', status: 'connected', organisation: 'Ridgeline Roofing Pty Ltd', lastSyncAt: minutesAgo(12), queued: 18 }], gstAtRiskCents: 51200, gstClaimableCents: 601880 },
  { id: 'ten_paperbark_cleaning', name: 'Paperbark Commercial Cleaning', abn: '84 552 118 006', kind: 'business', firmId: null, gstRegistered: true, gstBasis: 'cash', createdAt: daysAgo(310), status: 'suspended', documents30d: 0, autoAcceptRate: 0, needsReviewRate: 0, errorRate: 0, storageBytes: 340_000_000, retentionMonths: 60, planCode: 'sole_trader', planName: 'Sole Trader', priceCents: 2900, scanQuota: 150, scansUsed: 0, seatLimit: 1, seatsUsed: 1, aiCostCents30d: 0, connections: [{ id: 'xero', status: 'disconnected', organisation: null, lastSyncAt: null, queued: 0 }], gstAtRiskCents: 0, gstClaimableCents: 0 },
  { id: 'ten_stringybark_fencing', name: 'Stringybark Fencing & Rural Supplies', abn: '29 660 118 442', kind: 'business', firmId: 'firm_ironbark', gstRegistered: true, gstBasis: 'accrual', createdAt: daysAgo(1400), status: 'active', documents30d: 267, autoAcceptRate: 0.7, needsReviewRate: 0.27, errorRate: 0.03, storageBytes: 1_880_000_000, retentionMonths: 60, planCode: 'practice_plus', planName: 'Practice Plus', priceCents: 2900, scanQuota: 600, scansUsed: 267, seatLimit: 8, seatsUsed: 4, aiCostCents30d: 2940, connections: [{ id: 'xero', status: 'connected', organisation: 'Stringybark Fencing Pty Ltd', lastSyncAt: hoursAgo(2), queued: 1 }], gstAtRiskCents: 6600, gstClaimableCents: 266100 },
  { id: 'ten_yarra_diesel', name: 'Yarra Diesel Mechanical', abn: '52 118 774 903', kind: 'business', firmId: 'firm_bayview', gstRegistered: true, gstBasis: 'accrual', createdAt: daysAgo(760), status: 'active', documents30d: 189, autoAcceptRate: 0.77, needsReviewRate: 0.2, errorRate: 0.03, storageBytes: 990_000_000, retentionMonths: 60, planCode: 'practice', planName: 'Practice', priceCents: 1900, scanQuota: 200, scansUsed: 189, seatLimit: 3, seatsUsed: 3, aiCostCents30d: 208, connections: [{ id: 'xero', status: 'connected', organisation: 'Yarra Diesel Mechanical', lastSyncAt: hoursAgo(7), queued: 0 }], gstAtRiskCents: 3980, gstClaimableCents: 188700 },
  { id: 'ten_solo_locksmith_rt', name: 'R. Tran Mobile Locksmith', abn: '40 118 220 774', kind: 'business', firmId: null, gstRegistered: false, gstBasis: 'cash', createdAt: daysAgo(3), status: 'active', documents30d: 4, autoAcceptRate: 1, needsReviewRate: 0, errorRate: 0, storageBytes: 4_000_000, retentionMonths: 12, planCode: 'free', planName: 'Free', priceCents: 0, scanQuota: 20, scansUsed: 4, seatLimit: 1, seatsUsed: 1, aiCostCents30d: 4, connections: [{ id: 'xero', status: 'disconnected', organisation: null, lastSyncAt: null, queued: 0 }], gstAtRiskCents: 0, gstClaimableCents: 0 },
  { id: 'ten_kalgoorlie_civil', name: 'Kalgoorlie Civil & Earthworks', abn: '68 220 447 118', kind: 'business', firmId: 'firm_ironbark', gstRegistered: true, gstBasis: 'accrual', createdAt: daysAgo(980), status: 'active', documents30d: 720, autoAcceptRate: 0.52, needsReviewRate: 0.41, errorRate: 0.07, storageBytes: 5_600_000_000, retentionMonths: 60, planCode: 'practice_plus', planName: 'Practice Plus', priceCents: 2900, scanQuota: 600, scansUsed: 601, seatLimit: 12, seatsUsed: 11, aiCostCents30d: 8420, connections: [{ id: 'xero', status: 'error', organisation: 'Kalgoorlie Civil Pty Ltd', lastSyncAt: daysAgo(11), queued: 96 }], gstAtRiskCents: 72400, gstClaimableCents: 719000 },
];

export type UserSeed = {
  id: string;
  displayName: string;
  email: string;
  initials: string;
  status: 'active' | 'dormant' | 'suspended';
  createdAt: string;
  lastSignInAt: string | null;
  signInCount: number;
  memberships: Array<{ tenantId: string; role: MemberRole }>;
};

export const USERS: UserSeed[] = [
  { id: 'usr_marlow', displayName: 'Dean Marlow', email: 'dean@coastalelectrical.com.au', initials: 'DM', status: 'active', createdAt: daysAgo(410), lastSignInAt: hoursAgo(3), signInCount: 812, memberships: [{ tenantId: 'ten_coastal_elec', role: 'owner' }] },
  { id: 'usr_hoc', displayName: 'Lina Hoc', email: 'lina@coastalelectrical.com.au', initials: 'LH', status: 'active', createdAt: daysAgo(380), lastSignInAt: daysAgo(2), signInCount: 240, memberships: [{ tenantId: 'ten_coastal_elec', role: 'member' }] },
  { id: 'usr_petrova', displayName: 'Ivana Petrova', email: 'ivana@bayviewbas.com.au', initials: 'IP', status: 'active', createdAt: daysAgo(900), lastSignInAt: hoursAgo(1), signInCount: 3040, memberships: [
    { tenantId: 'ten_coastal_elec', role: 'member' },
    { tenantId: 'ten_hunter_plumb', role: 'member' },
    { tenantId: 'ten_ridgeline_roofing', role: 'member' },
    { tenantId: 'ten_yarra_diesel', role: 'member' },
    { tenantId: 'ten_northline_practice_own', role: 'readonly' },
  ] },
  { id: 'usr_dawes', displayName: 'Callum Dawes', email: 'callum@huntervalleyplumbing.com.au', initials: 'CD', status: 'active', createdAt: daysAgo(802), lastSignInAt: daysAgo(1), signInCount: 690, memberships: [{ tenantId: 'ten_hunter_plumb', role: 'owner' }] },
  { id: 'usr_summit_1', displayName: 'Renee Ostrowski', email: 'renee@summitjoinery.com.au', initials: 'RO', status: 'active', createdAt: daysAgo(240), lastSignInAt: hoursAgo(6), signInCount: 210, memberships: [{ tenantId: 'ten_summit_carp', role: 'owner' }] },
  { id: 'usr_summit_2', displayName: 'Marcus Yun', email: 'marcus@summitjoinery.com.au', initials: 'MY', status: 'active', createdAt: daysAgo(220), lastSignInAt: daysAgo(4), signInCount: 88, memberships: [{ tenantId: 'ten_summit_carp', role: 'admin' }] },
  { id: 'usr_redgum_1', displayName: 'Grace Falkenberg', email: 'grace@redgumlandscaping.com.au', initials: 'GF', status: 'active', createdAt: daysAgo(90), lastSignInAt: hoursAgo(2), signInCount: 54, memberships: [{ tenantId: 'ten_redgum_landscape', role: 'owner' }] },
  { id: 'usr_bluetongue_1', displayName: 'Ashleigh Cho', email: 'ashleigh@bluetonguepainting.com.au', initials: 'AC', status: 'active', createdAt: daysAgo(58), lastSignInAt: daysAgo(14), signInCount: 22, memberships: [{ tenantId: 'ten_bluetongue_paint', role: 'owner' }] },
  { id: 'usr_ironbark_transport_1', displayName: 'Wes Talbot', email: 'wes@ironbarkfreight.com.au', initials: 'WT', status: 'active', createdAt: daysAgo(1150), lastSignInAt: minutesAgo(20), signInCount: 4110, memberships: [{ tenantId: 'ten_ironbark_transport', role: 'owner' }] },
  { id: 'usr_ironbark_transport_2', displayName: 'Priya Anand', email: 'priya@ironbarkfreight.com.au', initials: 'PA', status: 'active', createdAt: daysAgo(700), lastSignInAt: hoursAgo(5), signInCount: 1400, memberships: [{ tenantId: 'ten_ironbark_transport', role: 'admin' }] },
  { id: 'usr_dunn', displayName: 'Kayleb Dunn', email: 'kayleb@dunnsignwriting.com.au', initials: 'KD', status: 'active', createdAt: daysAgo(21), lastSignInAt: daysAgo(1), signInCount: 9, memberships: [{ tenantId: 'ten_dunn_signwriting', role: 'owner' }] },
  { id: 'usr_wattle', displayName: 'Sione Faleolo', email: 'sione@wattlestespresso.com.au', initials: 'SF', status: 'dormant', createdAt: daysAgo(670), lastSignInAt: daysAgo(58), signInCount: 340, memberships: [{ tenantId: 'ten_wattle_cafe', role: 'owner' }] },
  { id: 'usr_vella', displayName: 'Matteo Vella', email: 'matteo@mvellaelectrical.com.au', initials: 'MV', status: 'active', createdAt: daysAgo(140), lastSignInAt: hoursAgo(10), signInCount: 118, memberships: [{ tenantId: 'ten_solo_sparky_mv', role: 'owner' }] },
  { id: 'usr_bishop', displayName: 'Keeley Bishop', email: 'keeley@kbishophandyman.com.au', initials: 'KB', status: 'active', createdAt: daysAgo(9), lastSignInAt: daysAgo(1), signInCount: 5, memberships: [{ tenantId: 'ten_free_trial_kb', role: 'owner' }] },
  { id: 'usr_northline_1', displayName: 'Farrah Nasser', email: 'farrah@northlineaccounting.com.au', initials: 'FN', status: 'active', createdAt: daysAgo(900), lastSignInAt: hoursAgo(4), signInCount: 2210, memberships: [
    { tenantId: 'ten_northline_practice_own', role: 'owner' },
    { tenantId: 'ten_bluetongue_paint', role: 'member' },
    { tenantId: 'ten_wattle_cafe', role: 'member' },
  ] },
  { id: 'usr_ridgeline_1', displayName: 'Toby Marsh', email: 'toby@ridgelineroofing.com.au', initials: 'TM', status: 'active', createdAt: daysAgo(500), lastSignInAt: hoursAgo(1), signInCount: 1980, memberships: [{ tenantId: 'ten_ridgeline_roofing', role: 'owner' }] },
  { id: 'usr_ridgeline_2', displayName: 'Nadia Selimovic', email: 'nadia@ridgelineroofing.com.au', initials: 'NS', status: 'active', createdAt: daysAgo(480), lastSignInAt: daysAgo(3), signInCount: 640, memberships: [{ tenantId: 'ten_ridgeline_roofing', role: 'member' }] },
  { id: 'usr_paperbark', displayName: 'Ollie Standish', email: 'ollie@paperbarkcleaning.com.au', initials: 'OS', status: 'suspended', createdAt: daysAgo(310), lastSignInAt: daysAgo(120), signInCount: 88, memberships: [{ tenantId: 'ten_paperbark_cleaning', role: 'owner' }] },
  { id: 'usr_stringybark_1', displayName: 'Heath Gower', email: 'heath@stringybarkfencing.com.au', initials: 'HG', status: 'active', createdAt: daysAgo(1400), lastSignInAt: daysAgo(2), signInCount: 3300, memberships: [{ tenantId: 'ten_stringybark_fencing', role: 'owner' }] },
  { id: 'usr_yarra_1', displayName: 'Zoe Kalanidis', email: 'zoe@yarradiesel.com.au', initials: 'ZK', status: 'active', createdAt: daysAgo(760), lastSignInAt: hoursAgo(8), signInCount: 1510, memberships: [{ tenantId: 'ten_yarra_diesel', role: 'owner' }] },
  { id: 'usr_tran', displayName: 'Ronan Tran', email: 'ronan@rtranlocksmith.com.au', initials: 'RT', status: 'active', createdAt: daysAgo(3), lastSignInAt: daysAgo(1), signInCount: 3, memberships: [{ tenantId: 'ten_solo_locksmith_rt', role: 'owner' }] },
  { id: 'usr_kalgoorlie_1', displayName: 'Bree Considine', email: 'bree@kalgoorliecivil.com.au', initials: 'BC', status: 'active', createdAt: daysAgo(980), lastSignInAt: minutesAgo(55), signInCount: 5210, memberships: [{ tenantId: 'ten_kalgoorlie_civil', role: 'owner' }] },
  { id: 'usr_kalgoorlie_2', displayName: 'Dion Petrides', email: 'dion@kalgoorliecivil.com.au', initials: 'DP', status: 'active', createdAt: daysAgo(900), lastSignInAt: daysAgo(1), signInCount: 2050, memberships: [{ tenantId: 'ten_kalgoorlie_civil', role: 'admin' }] },
  { id: 'usr_ironbark_firm_1', displayName: 'Selina Marchetti', email: 'selina@ironbarktax.com.au', initials: 'SM', status: 'active', createdAt: daysAgo(1300), lastSignInAt: hoursAgo(2), signInCount: 6100, memberships: [
    { tenantId: 'ten_summit_carp', role: 'member' },
    { tenantId: 'ten_redgum_landscape', role: 'member' },
    { tenantId: 'ten_ironbark_transport', role: 'member' },
    { tenantId: 'ten_stringybark_fencing', role: 'member' },
    { tenantId: 'ten_kalgoorlie_civil', role: 'member' },
  ] },
];

/** Sign-in history — invented, admin-only, no server route yet. */
export function signInHistoryFor(userId: string): Array<{ at: string; ip: string; device: string; outcome: 'success' | 'failed' }> {
  const user = USERS.find((u) => u.id === userId);
  if (!user || !user.lastSignInAt) return [];
  const base = new Date(user.lastSignInAt).getTime();
  return [
    { at: new Date(base).toISOString(), ip: '124.187.44.12', device: 'iOS · Snap Apps 2.4.1', outcome: 'success' },
    { at: new Date(base - 3 * 86_400_000).toISOString(), ip: '124.187.44.12', device: 'iOS · Snap Apps 2.4.1', outcome: 'success' },
    { at: new Date(base - 9 * 86_400_000).toISOString(), ip: '203.221.10.90', device: 'Chrome 129 · Windows', outcome: 'success' },
    { at: new Date(base - 9 * 86_400_000 - 60_000).toISOString(), ip: '203.221.10.90', device: 'Chrome 129 · Windows', outcome: 'failed' },
  ];
}

/** Activity feed — invented, admin-only. */
export function activityFor(userId: string): Array<{ at: string; action: string; detail: string }> {
  const user = USERS.find((u) => u.id === userId);
  if (!user) return [];
  return [
    { at: hoursAgo(3), action: 'capture.created', detail: 'Uploaded a receipt (Bunnings Warehouse)' },
    { at: hoursAgo(20), action: 'document.confirmed', detail: 'Posted a $412.60 tax invoice to the ledger' },
    { at: daysAgo(2), action: 'bas.viewed', detail: 'Opened the BAS pack for Q1 FY27' },
  ];
}
