/**
 * The demo workspace every figure on the marketing site belongs to.
 *
 * ONE person, ONE month. A site that quotes four unrelated invented numbers
 * reads as invented; one household followed through October reads as a
 * product someone built. So nothing on a marketing page types a figure of its
 * own: it imports it from here, and every total below is the sum of the rows
 * beside it (checked by `demo.test.ts`).
 *
 * Kate Marsh is the seeded demo account the live app signs in as. The figures
 * are illustrative, and the site footer says so. Money is a decimal STRING,
 * end to end, the same rule as the product (docs/WEB.md §3.2).
 *
 * ── The docket ───────────────────────────────────────────────────────────
 *
 * Six lines, two tax treatments, one receipt. The earlier site listed a
 * "fresh sandwich" as GST-free, which it generally is not: a prepared
 * sandwich is taxable. Free-range eggs at the same price replace it, so the
 * subtotals did not move:
 *
 *   GST-free  4.50 + 3.80 + 8.50          = 16.80
 *   Taxable   6.20 + 3.20 + 6.00          = 15.40   GST = 15.40 / 11 = 1.40
 *   Total                                   32.20
 *
 * A reader that only sees the total has to assume all of it is taxable:
 * 32.20 / 11 = 2.93. That over-claims 1.53 of GST on one coffee stop, which
 * is the arithmetic the "read by line" comparison shows.
 *
 * The merchant is fictional on purpose. The ABN is 51 824 753 556 — the
 * ATO's own, and the checksum-valid example Australian software has always
 * used — so no real business is shown with a made-up number.
 */

export const DEMO_PERSON = {
  name: 'Kate Marsh',
  initials: 'KM',
  partner: 'Jem Marsh',
  partnerInitials: 'JM',
  occupation: 'Line-haul driver',
} as const;

export const DEMO_MONTH = {
  label: 'October 2026',
  short: 'Oct 2026',
  daysLeft: 13,
} as const;

export type DocketLine = {
  label: string;
  amount: string;
  taxable: boolean;
};

export const DOCKET = {
  merchant: 'Hume Hwy Roadhouse',
  place: 'Yass NSW',
  abn: '51 824 753 556',
  date: 'Sat 17 Oct 2026',
  time: '06:42',
  lines: [
    { label: 'Milk 2L', amount: '4.50', taxable: false },
    { label: 'Bread loaf', amount: '3.80', taxable: false },
    { label: 'Free-range eggs 12pk', amount: '8.50', taxable: false },
    { label: 'Hot pie', amount: '6.20', taxable: true },
    { label: 'Soft drink 1.25L', amount: '3.20', taxable: true },
    { label: 'Flat white', amount: '6.00', taxable: true },
  ] satisfies DocketLine[],
  gstFree: '16.80',
  taxable: '15.40',
  gst: '1.40',
  total: '32.20',
  /** What a total-only reader would claim: the whole docket divided by 11. */
  totalOnlyGst: '2.93',
  /** totalOnlyGst − gst. */
  overClaim: '1.53',
} as const;

export type Category = {
  name: string;
  spent: string;
  budget: string;
  /** budget − spent. */
  left: string;
  /** spent / budget, whole percent, for drawing only. */
  used: number;
  /** Share of the month's spending, whole percent, for drawing only. */
  share: number;
  hue: string;
};

/** October to date. Sums to SPENDING.total; budgets sum to BUDGET.total. */
export const CATEGORIES: Category[] = [
  { name: 'Fuel', spent: '612.40', budget: '1200.00', left: '587.60', used: 51, share: 43, hue: '#5B6EF5' },
  { name: 'Groceries', spent: '318.75', budget: '800.00', left: '481.25', used: 40, share: 22, hue: '#3BA55C' },
  { name: 'Eating out', spent: '186.20', budget: '400.00', left: '213.80', used: 47, share: 13, hue: '#F2994A' },
  { name: 'Tools & gear', spent: '164.00', budget: '400.00', left: '236.00', used: 41, share: 11, hue: '#1CA8DB' },
  { name: 'Phone & internet', spent: '89.00', budget: '120.00', left: '31.00', used: 74, share: 6, hue: '#6C8AE4' },
  { name: 'Other', spent: '67.25', budget: '280.00', left: '212.75', used: 24, share: 5, hue: '#9B6BF2' },
];

export const SPENDING = {
  total: '1437.60',
  receipts: 23,
  /** Weekly bars for the analytics card. Sums to `total`; `pct` is of the tallest week. */
  weeks: [
    { label: '1–7', amount: '402.10', pct: 66 },
    { label: '8–14', amount: '611.30', pct: 100 },
    { label: '15–18', amount: '424.20', pct: 69 },
  ],
} as const;

export const BUDGET = {
  total: '3200.00',
  spent: '1437.60',
  left: '1762.40',
  /** left / daysLeft, rounded to the cent. */
  perDay: '135.57',
} as const;

export type Receipt = {
  merchant: string;
  category: string;
  date: string;
  amount: string;
  hue: string;
};

export const RECEIPTS: Receipt[] = [
  { merchant: 'Hume Hwy Roadhouse', category: 'Groceries', date: 'Sat 17 Oct', amount: '32.20', hue: '#3BA55C' },
  { merchant: 'Gundagai Fuel Stop', category: 'Fuel', date: 'Fri 16 Oct', amount: '148.60', hue: '#5B6EF5' },
  { merchant: 'Wagga Trade Supplies', category: 'Tools & gear', date: 'Wed 14 Oct', amount: '64.00', hue: '#1CA8DB' },
  { merchant: 'Holbrook Bakery', category: 'Eating out', date: 'Tue 13 Oct', amount: '18.40', hue: '#F2994A' },
  { merchant: 'Albury Fresh Market', category: 'Groceries', date: 'Sun 11 Oct', amount: '96.35', hue: '#3BA55C' },
];

export type Goal = { name: string; saved: string; target: string; pct: number };

export const GOALS: Goal[] = [
  { name: 'New tyres for the ute', saved: '1240.00', target: '1800.00', pct: 69 },
  { name: 'Christmas in Byron', saved: '950.00', target: '3000.00', pct: 32 },
  { name: 'Tax-time buffer', saved: '3600.00', target: '5000.00', pct: 72 },
];

export const GOALS_TOTAL = { saved: '5790.00', target: '9800.00' } as const;

export type Recurring = { name: string; cadence: string; amount: string; next: string };

export const RECURRING: Recurring[] = [
  { name: 'Phone plan', cadence: 'Monthly', amount: '89.00', next: '12 Nov' },
  { name: 'Truck insurance', cadence: 'Monthly', amount: '214.50', next: '3 Nov' },
  { name: 'Music streaming', cadence: 'Monthly', amount: '12.99', next: '28 Oct' },
];

/** The checks shown on a read receipt. Each is something the app really does. */
export const CHECKS = [
  { label: 'Marked as a tax invoice', ok: true },
  { label: 'Supplier ABN passes the ATO checksum', ok: true },
  { label: 'GST is exactly 1/11 of the taxable lines', ok: true },
  { label: 'Lines add up to the total', ok: true },
] as const;

/** What the app tells you when a docket is not a valid tax invoice. */
export const FINDINGS = [
  {
    merchant: 'Roadside Coffee Van',
    amount: '8.50',
    title: 'ABN fails the checksum',
    body: 'The number printed is not a valid ABN, so the GST on it cannot be claimed.',
  },
  {
    merchant: 'Coin Laundry Parkes',
    amount: '12.00',
    title: 'Not a tax invoice',
    body: 'No GST breakdown on the docket. Ask for a tax invoice while they still remember you.',
  },
  {
    merchant: 'Tyre & Wheel Orange',
    amount: '1848.00',
    title: 'No supplier ABN',
    body: 'A tax invoice has to show the seller’s ABN. Ask the supplier to reissue it.',
  },
] as const;

export const CREDITS_LEFT = 48;

/** Who scanned the month's receipts. Sums to SPENDING.receipts. */
export const HOUSEHOLD_SCANS = [
  { initials: 'KM', name: 'Kate Marsh', scans: 15 },
  { initials: 'JM', name: 'Jem Marsh', scans: 8 },
] as const;
