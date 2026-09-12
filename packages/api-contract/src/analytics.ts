import type {
  AnalyticsRange,
  Recurring,
  AnalyticsSummary,
  Budget,
  CategorySpend,
  DocumentView,
  MerchantSpend,
  PersonalSummary,
  SeriesPoint,
  Workspace,
} from './index';

import { ZERO, add, subtract } from './money';

/**
 * Aggregation for the spending tracker and the analytics page.
 *
 * Pure functions over documents, deliberately free of React and of the mock,
 * for two reasons. They are the part most likely to be wrong in a way nobody
 * notices — a month boundary off by one, a period compared against the wrong
 * previous period — so they need unit tests. And in production the SERVER
 * computes these; keeping them pure means the mock and the server can agree,
 * and a phone never buckets a year of receipts to draw a chart.
 *
 * Money stays a decimal string throughout. The only place a float appears is a
 * share or a percentage change, which are display values and never money.
 */

/* ── Dates ─────────────────────────────────────────────────────────────── */

const iso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function startOfMonth(now: Date): string {
  return iso(new Date(now.getFullYear(), now.getMonth(), 1));
}

export function startOfQuarter(now: Date): string {
  return iso(new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1));
}

export function daysInMonth(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
}

/* ── Money over collections ────────────────────────────────────────────── */

export function total(docs: DocumentView[]): string {
  return docs.reduce((acc, d) => add(acc, d.payableAmount), ZERO);
}

/** Compares two decimal strings without going through a float. */
export function compare(a: string, b: string): number {
  const v = subtract(a, b);
  if (v.startsWith('-')) return -1;
  return Number(v.replace(/[.]/g, '')) === 0 ? 0 : 1;
}

/**
 * Divides a decimal string by a whole number, to the cent.
 *
 * Used only for averages and daily allowances — figures that are advice, not
 * ledger entries. Nothing posted is ever produced this way.
 */
export function divide(amount: string, by: number): string {
  if (by <= 0) return ZERO;
  const units = toUnits(amount);
  const q = units / BigInt(Math.round(by));
  const cents = (q / 100n) * 100n; // truncate to the cent, 4dp scale
  return fromUnits(cents);
}

function toUnits(value: string): bigint {
  const negative = value.trimStart().startsWith('-');
  const [whole = '0', frac = ''] = value.replace('-', '').split('.');
  const units = BigInt(whole) * 10_000n + BigInt((frac + '0000').slice(0, 4));
  return negative ? -units : units;
}

function fromUnits(units: bigint): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  return `${negative ? '-' : ''}${abs / 10_000n}.${(abs % 10_000n).toString().padStart(4, '0')}`;
}

/** Fraction of `part` against `whole`, for bars and shares. Never money. */
export function share(part: string, whole: string): number {
  const w = Number(whole);
  return w === 0 ? 0 : Number(part) / w;
}

/* ── Grouping ──────────────────────────────────────────────────────────── */

export function byCategory(docs: DocumentView[], budgets: Budget[] = []): CategorySpend[] {
  const caps = new Map(budgets.map((b) => [b.category, b.monthly]));
  const spend = new Map<string, string>();
  for (const d of docs) spend.set(d.category, add(spend.get(d.category) ?? ZERO, d.payableAmount));

  // Categories with a budget but no spend still belong in the list — "nothing
  // spent on Health this month" is information, not an empty row.
  for (const b of budgets) if (!spend.has(b.category)) spend.set(b.category, ZERO);

  return [...spend.entries()]
    .map(([category, spent]) => {
      const budget = caps.get(category) ?? null;
      return { category, spent, budget, used: budget ? share(spent, budget) : null };
    })
    .sort((a, b) => Number(b.spent) - Number(a.spent));
}

export function topMerchants(docs: DocumentView[], limit = 5): MerchantSpend[] {
  const m = new Map<string, { total: string; count: number }>();
  for (const d of docs) {
    const cur = m.get(d.supplierName) ?? { total: ZERO, count: 0 };
    m.set(d.supplierName, { total: add(cur.total, d.payableAmount), count: cur.count + 1 });
  }
  return [...m.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => Number(b.total) - Number(a.total))
    .slice(0, limit);
}

/* ── Series ────────────────────────────────────────────────────────────── */

type Bucket = { label: string; from: string; to: string; partial?: boolean };

/**
 * The buckets a range is drawn in, oldest first.
 *
 * A month is drawn in weeks rather than days: 30 bars on a phone are stripes,
 * and nobody reads a single Tuesday off a chart anyway.
 */
export function buckets(range: AnalyticsRange, now = new Date()): Bucket[] {
  const out: Bucket[] = [];
  if (range === 'year') {
    for (let i = 11; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
      out.push({
        label: MONTHS[start.getMonth()]!,
        from: iso(start),
        to: iso(end),
        partial: i === 0,
      });
    }
    return out;
  }

  if (range === 'quarter') {
    for (let i = 2; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
      out.push({
        label: MONTHS[start.getMonth()]!,
        from: iso(start),
        to: iso(end),
        partial: i === 0,
      });
    }
    return out;
  }

  // Month, in weeks of the calendar month.
  const last = daysInMonth(now);
  const today = now.getDate();
  for (let w = 0; w < Math.ceil(last / 7); w++) {
    const from = w * 7 + 1;
    const to = Math.min(last, from + 6);
    out.push({
      label: `${from}–${to}`,
      from: iso(new Date(now.getFullYear(), now.getMonth(), from)),
      to: iso(new Date(now.getFullYear(), now.getMonth(), to)),
      partial: today >= from && today <= to,
    });
  }
  return out;
}

export function inRange(d: DocumentView, from: string, to: string): boolean {
  return d.issueDate >= from && d.issueDate <= to;
}

export function series(docs: DocumentView[], range: AnalyticsRange, now = new Date()): SeriesPoint[] {
  return buckets(range, now).map((b) => ({
    label: b.label,
    value: total(docs.filter((d) => inRange(d, b.from, b.to))),
    ...(b.partial ? { partial: true as const } : {}),
  }));
}

/* ── The two summaries ─────────────────────────────────────────────────── */

export function personalSummary(
  all: DocumentView[],
  budgets: Budget[],
  budgetTotal: string,
  now = new Date(),
): PersonalSummary {
  const monthStart = startOfMonth(now);
  const today = iso(now);
  const docs = all.filter((d) => d.workspace === 'personal' && d.issueDate >= monthStart);
  const spent = total(docs);

  const days = daysInMonth(now);
  const elapsed = now.getDate();
  // Today still counts as a day you can spend on, so it is never zero.
  const daysLeft = Math.max(1, days - elapsed + 1);
  const remaining = subtract(budgetTotal, spent);

  // Same day, previous month — comparing a part-month against a whole one is
  // the most common way a tracker lies to its user.
  const prevStart = iso(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const prevSameDay = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevDays = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
  prevSameDay.setDate(Math.min(elapsed, prevDays));
  const lastMonthToDate = total(
    all.filter(
      (d) => d.workspace === 'personal' && d.issueDate >= prevStart && d.issueDate <= iso(prevSameDay),
    ),
  );

  return {
    monthLabel: `${MONTHS[now.getMonth()]} ${now.getFullYear()}`,
    spentThisMonth: spent,
    budgetTotal,
    remaining,
    daysLeftInMonth: daysLeft,
    daysElapsed: elapsed,
    safeToSpendPerDay: compare(remaining, ZERO) > 0 ? divide(remaining, daysLeft) : ZERO,
    lastMonthToDate,
    receiptCount: docs.filter((d) => d.issueDate <= today).length,
    byCategory: byCategory(docs, budgets),
    topMerchants: topMerchants(docs, 5),
  };
}

const RANGE_LABEL: Record<AnalyticsRange, string> = {
  month: 'This month',
  quarter: 'Last 3 months',
  year: 'Last 12 months',
};

export function analyticsSummary(
  all: DocumentView[],
  workspace: Workspace,
  range: AnalyticsRange,
  budgets: Budget[] = [],
  now = new Date(),
): AnalyticsSummary {
  const mine = all.filter((d) => d.workspace === workspace);
  const bs = buckets(range, now);
  const from = bs[0]!.from;
  const to = bs[bs.length - 1]!.to;
  const inside = mine.filter((d) => inRange(d, from, to));

  // The previous period is the same number of buckets immediately before this
  // one, so "up 12%" always compares like with like.
  //
  // And it stops at the same POINT in that period, not at its end. The current
  // period is always part-way through, so measuring it against a complete
  // previous one reports a fall every time — the chart would have claimed
  // spending was down 62% on the 10th of the month while it was in fact
  // running 23% ahead.
  const spanMonths = range === 'year' ? 12 : range === 'quarter' ? 3 : 1;
  const prevFrom = iso(new Date(now.getFullYear(), now.getMonth() - spanMonths * 2 + 1, 1));
  const prevEndMonth = new Date(now.getFullYear(), now.getMonth() - spanMonths + 1, 0);
  const prevTo = iso(
    new Date(
      prevEndMonth.getFullYear(),
      prevEndMonth.getMonth(),
      Math.min(now.getDate(), prevEndMonth.getDate()),
    ),
  );
  const previous = mine.filter((d) => inRange(d, prevFrom, prevTo));

  const t = total(inside);
  const prev = total(previous);

  // A comparison is only offered when the previous window is fully covered by
  // data. Otherwise the first month of history sits alone in a twelve-month
  // window and the page reports "up 2354%", which is arithmetically true and
  // completely false. A new user sees no comparison until they have one.
  const earliest = mine.reduce<string | null>(
    (a, d) => (a === null || d.issueDate < a ? d.issueDate : a),
    null,
  );
  // Compared by month, not by day: a previous month whose first receipt landed
  // on the 6th is still a month you were using the app, and requiring one
  // dated the 1st would silently drop most valid comparisons.
  const covered = earliest !== null && earliest.slice(0, 7) <= prevFrom.slice(0, 7);
  const changePct = !covered || Number(prev) === 0 ? null : (Number(t) - Number(prev)) / Number(prev);

  const points = series(mine, range, now);
  const completed = points.filter((pt) => !pt.partial);

  const biggest = [...inside].sort((a, b) => Number(b.payableAmount) - Number(a.payableAmount))[0];
  const business = workspace === 'business';

  return {
    range,
    rangeLabel: RANGE_LABEL[range],
    total: t,
    previousTotal: prev,
    changePct,
    average: divide(total(inside), Math.max(1, completed.length)),
    receiptCount: inside.length,
    largest: biggest
      ? { name: biggest.supplierName, amount: biggest.payableAmount, date: biggest.issueDate }
      : null,
    series: points,
    byCategory: byCategory(inside, range === 'month' ? budgets : []),
    topMerchants: topMerchants(inside, 6),
    // GST, not spend: the tax on the claimable documents, never their totals.
    gstClaimable: business
      ? inside.filter((d) => d.isTaxInvoice).reduce((a, d) => add(a, d.taxAmount), ZERO)
      : null,
    gstAtRisk: business
      ? inside.filter((d) => !d.isTaxInvoice).reduce((a, d) => add(a, d.taxAmount), ZERO)
      : null,
  };
}

/* ── Recurring costs ───────────────────────────────────────────────────── */

/**
 * Subscriptions and standing bills, worked out from the receipts.
 *
 * Detected rather than declared: the value of the feature is that nobody has
 * to remember to enter their streaming service. A merchant counts as recurring
 * when it appears in three or more of the last six months at a stable amount —
 * three months rules out a coincidence, and the stability test stops a
 * supermarket visited weekly from being called a subscription.
 */
export function detectRecurring(docs: DocumentView[], now = new Date()): Recurring[] {
  const since = iso(new Date(now.getFullYear(), now.getMonth() - 5, 1));
  const recent = docs.filter((d) => d.issueDate >= since);

  const byMerchant = new Map<string, DocumentView[]>();
  for (const d of recent) {
    const list = byMerchant.get(d.supplierName) ?? [];
    list.push(d);
    byMerchant.set(d.supplierName, list);
  }

  const out: Recurring[] = [];
  for (const [merchant, rows] of byMerchant) {
    const months = new Set(rows.map((r) => r.issueDate.slice(0, 7)));
    if (months.size < 3) continue;

    // At most one charge a month, or it is shopping rather than a subscription.
    if (rows.length > months.size * 1.5) continue;

    const amounts = rows.map((r) => Number(r.payableAmount));
    const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    if (mean === 0) continue;
    const spread = Math.max(...amounts) - Math.min(...amounts);
    // Within a quarter of the typical charge: utility bills move a little,
    // a supermarket shop moves a lot.
    if (spread / mean > 0.25) continue;

    const sorted = [...rows].sort((a, b) => b.issueDate.localeCompare(a.issueDate));
    const last = sorted[0]!;
    const next = new Date(`${last.issueDate}T00:00:00`);
    next.setMonth(next.getMonth() + 1);

    const typical = (Math.round(mean * 100) / 100).toFixed(4);
    out.push({
      merchant,
      category: last.category,
      typicalAmount: typical,
      monthsSeen: months.size,
      lastSeen: last.issueDate,
      nextExpected: iso(next),
      annualCost: (Math.round(mean * 12 * 100) / 100).toFixed(4),
    });
  }

  return out.sort((a, b) => Number(b.annualCost) - Number(a.annualCost));
}
