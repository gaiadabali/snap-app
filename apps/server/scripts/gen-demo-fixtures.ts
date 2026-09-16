/**
 * Generates the mobile demo fixtures.
 *
 * The demo goes in front of investors AND a finance agency. Investors will not
 * check the arithmetic; a finance agency will. So every figure here is COMPUTED
 * — GST via exact 1/11 on scaled BigInt, deduction estimates from the real
 * `@snap/tax-engine` at TD 2025/4 rates — rather than typed in by hand. No
 * `as never` casts: the engine's own input types check this file.
 *
 * It also mirrors production: the server computes, the mobile app displays. The
 * app never imports the tax engine (see test/boundaries.test.ts).
 *
 *   pnpm --filter @snap/server gen:demo
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { money, type Money } from '@snap/db';
import {
  CURRENT_RATES,
  PROFILES,
  computeWorksheet,
  type WorksheetInputs,
} from '@snap/tax-engine';

import { taxSubtotalsFromLines } from '../src/extraction/tax-subtotals';

const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'mobile', 'src', 'fixtures', 'demo.ts',
);

const R = CURRENT_RATES;
const PROFILE_ID = 'truckie_long';
const profile = PROFILES[PROFILE_ID]!;
const M = (v: string) => money.money(v);

/** Workspace ids. A workspace is a tenant: see docs/PLAN.md §3. */
const WS_BIZ = 'ws_marsh_transport';
const WS_HOME = 'ws_marsh_household';

/** The ATO thresholds that decide whether a document is a valid tax invoice. */
const TAX_INVOICE_THRESHOLD = M('82.50');
const BUYER_ABN_THRESHOLD = M('1000.00');

/** Days before today. Keeps the demo timeline permanently fresh. */
const daysAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

type Seed = {
  id: string;
  supplier: string;
  /** null = the docket carries no supplier ABN at all. */
  abn: string | null;
  daysAgo: number;
  inclusive: string;
  /** Portion that is GST-free (fresh food, etc.). */
  gstFreePortion?: string;
  /** Did the supplier print the buyer's identity/ABN? Only matters ≥ $1,000. */
  buyerAbnShown?: boolean;
  category: string;
  engineRow: string;
  saysTaxInvoice: boolean;
  confidence: number;
  note?: string;
};

/** One quarter for a line-haul driver. Names and amounts are representative. */
const SEEDS: Seed[] = [
  { id: 'doc_01', supplier: 'Ampol Foodary Marulan',      abn: '51824753556', daysAgo: 0, inclusive: '187.43', category: 'Fuel',                      engineRow: 'D1.logbook.fuel',       saysTaxInvoice: true,  confidence: 0.99 },
  { id: 'doc_02', supplier: 'BP Truckstop Gundagai',       abn: '33051775556', daysAgo: 1, inclusive: '243.10', category: 'Fuel',                      engineRow: 'D1.logbook.fuel',       saysTaxInvoice: true,  confidence: 0.98 },
  { id: 'doc_03', supplier: 'Beaurepaires Orange',         abn: '51824753556', daysAgo: 2, inclusive: '1848.00', buyerAbnShown: false, category: 'Truck parts & maintenance', engineRow: 'D1.logbook.servicing', saysTaxInvoice: true, confidence: 0.94,
    note: 'Over $1,000 — the ATO also requires the buyer ABN on the invoice' },
  { id: 'doc_04', supplier: 'Repco Auto Parts Goulburn',   abn: '33051775556', daysAgo: 3, inclusive: '312.00', category: 'Truck parts & maintenance', engineRow: 'D1.logbook.servicing',  saysTaxInvoice: true,  confidence: 0.98 },
  { id: 'doc_05', supplier: 'Highway Motor Inn Dubbo',     abn: '33051775556', daysAgo: 3, inclusive: '145.00', category: 'Accommodation',             engineRow: 'D2.accommodation',      saysTaxInvoice: true,  confidence: 0.97 },
  { id: 'doc_06', supplier: 'Coles Express Yass',          abn: '51824753556', daysAgo: 4, inclusive: '84.20', gstFreePortion: '41.60', category: 'Meals on the road', engineRow: 'D2.meals.lunch', saysTaxInvoice: true, confidence: 0.96,
    note: 'Mixed basket — fresh food is GST-free, packaged goods are taxable' },
  { id: 'doc_07', supplier: 'Roadside Coffee Van',          abn: null,          daysAgo: 4, inclusive: '8.50',  category: 'Meals on the road',         engineRow: 'D2.meals.breakfast',    saysTaxInvoice: false, confidence: 0.72,
    note: 'No supplier ABN printed — GST credit cannot be claimed' },
  { id: 'doc_08', supplier: 'Coin Laundry Parkes',          abn: null,          daysAgo: 5, inclusive: '12.00', category: 'Laundry on the road',       engineRow: 'D3.laundromat',         saysTaxInvoice: false, confidence: 0.68,
    note: 'Cash docket, no ABN — GST credit cannot be claimed' },
  { id: 'doc_09', supplier: 'Shell Coles Express Dubbo',   abn: '33051775556', daysAgo: 6, inclusive: '211.85', category: 'Fuel',                      engineRow: 'D1.logbook.fuel',       saysTaxInvoice: true,  confidence: 0.99 },
  { id: 'doc_10', supplier: 'Bunnings Warehouse Wagga',    abn: '51824753556', daysAgo: 7, inclusive: '67.80', category: 'Truck cleaning supplies',   engineRow: 'D5.truckmaint',         saysTaxInvoice: true,  confidence: 0.98 },
  { id: 'doc_11', supplier: 'Linfox Weighbridge Cafe',     abn: null,          daysAgo: 8, inclusive: '28.40', category: 'Meals on the road',         engineRow: 'D2.meals.dinner',       saysTaxInvoice: false, confidence: 0.70,
    note: 'No supplier ABN printed — GST credit cannot be claimed' },
  { id: 'doc_12', supplier: 'NRMA Truck Insurance',        abn: '51824753556', daysAgo: 9, inclusive: '742.00', category: 'Insurance',                 engineRow: 'D1.logbook.insurance',  saysTaxInvoice: true,  confidence: 0.99 },
  { id: 'doc_13', supplier: 'Total Truck Wash Tamworth',   abn: null,          daysAgo: 10, inclusive: '35.00', category: 'Truck cleaning supplies',   engineRow: 'D5.truckmaint',         saysTaxInvoice: false, confidence: 0.66,
    note: 'Cash docket, no ABN — GST credit cannot be claimed' },
  { id: 'doc_14', supplier: 'Kmart Dubbo',                 abn: '33051775556', daysAgo: 11, inclusive: '119.90', category: 'Protective clothing',       engineRow: 'D3.clothing',           saysTaxInvoice: true,  confidence: 0.95 },
  { id: 'doc_15', supplier: 'Caltex Woolworths Forbes',    abn: '51824753556', daysAgo: 12, inclusive: '198.62', category: 'Fuel',                      engineRow: 'D1.logbook.fuel',       saysTaxInvoice: true,  confidence: 0.99 },
  { id: 'doc_16', supplier: 'Servo Pie Shop Narrandera',   abn: null,          daysAgo: 13, inclusive: '16.80', category: 'Meals on the road',         engineRow: 'D2.meals.lunch',        saysTaxInvoice: false, confidence: 0.71,
    note: 'No supplier ABN printed — GST credit cannot be claimed' },
  { id: 'doc_17', supplier: 'Mitchell Motor Inn Bathurst', abn: '33051775556', daysAgo: 14, inclusive: '158.00', category: 'Accommodation',             engineRow: 'D2.accommodation',      saysTaxInvoice: true,  confidence: 0.97 },
  { id: 'doc_18', supplier: 'Transurban Linkt Tolls',      abn: '51824753556', daysAgo: 15, inclusive: '412.55', category: 'Tolls',                     engineRow: 'D2.tolls',              saysTaxInvoice: true,  confidence: 0.99 },
  { id: 'doc_19', supplier: 'Telstra Mobile',              abn: '33051775556', daysAgo: 16, inclusive: '85.00', category: 'Phone & internet',          engineRow: 'D5.phone',              saysTaxInvoice: true,  confidence: 0.99 },
  { id: 'doc_20', supplier: 'Bridgestone Service Wagga',   abn: '51824753556', daysAgo: 17, inclusive: '624.50', category: 'Truck parts & maintenance', engineRow: 'D1.logbook.servicing',  saysTaxInvoice: true,  confidence: 0.97 },
];

/* ── Line items ────────────────────────────────────────────────────────────
   A receipt is its lines, not its total. These are built so the lines sum to
   the payable amount EXACTLY: each line takes a fixed share and the last one
   absorbs the remainder, in scaled-integer arithmetic. A demo whose lines do
   not add up would be worse than no lines at all — the review screen checks
   precisely this and would flag every document in the fixture. */

type LineSpec = { description: string; qty: number; share: number; gstFree?: boolean };

/** What a receipt from each category actually itemises. */
const LINE_TEMPLATES: Record<string, LineSpec[]> = {
  Fuel: [
    { description: 'Diesel', qty: 1, share: 0.94 },
    { description: 'AdBlue 10L', qty: 1, share: 0.06 },
  ],
  'Truck parts & maintenance': [
    { description: 'Parts', qty: 1, share: 0.62 },
    { description: 'Labour', qty: 1, share: 0.32 },
    { description: 'Environmental levy', qty: 1, share: 0.06 },
  ],
  'Meals on the road': [
    { description: 'Hot food', qty: 1, share: 0.55 },
    { description: 'Coffee', qty: 1, share: 0.2 },
    { description: 'Fresh fruit', qty: 1, share: 0.25, gstFree: true },
  ],
  Accommodation: [
    { description: 'Room, 1 night', qty: 1, share: 0.88 },
    { description: 'Breakfast', qty: 1, share: 0.12 },
  ],
  Tolls: [{ description: 'Toll usage, statement period', qty: 1, share: 1 }],
  'Phone & internet': [
    { description: 'Mobile plan, monthly', qty: 1, share: 0.82 },
    { description: 'Data pack', qty: 1, share: 0.18 },
  ],
  'Protective clothing': [
    { description: 'Hi-vis shirt', qty: 2, share: 0.55 },
    { description: 'Steel-cap boots', qty: 1, share: 0.45 },
  ],
  'Truck cleaning supplies': [
    { description: 'Wash and degrease', qty: 1, share: 0.7 },
    { description: 'Microfibre cloths', qty: 1, share: 0.3 },
  ],
  Insurance: [
    { description: 'Heavy vehicle premium', qty: 1, share: 0.93 },
    { description: 'Policy fee', qty: 1, share: 0.07 },
  ],
  'Laundry on the road': [{ description: 'Washer and dryer', qty: 1, share: 1 }],
  Groceries: [
    { description: 'Fresh produce', qty: 1, share: 0.34, gstFree: true },
    { description: 'Meat and dairy', qty: 1, share: 0.28, gstFree: true },
    { description: 'Packaged goods', qty: 1, share: 0.26 },
    { description: 'Household', qty: 1, share: 0.12 },
  ],
  'Eating out': [
    { description: 'Meals', qty: 2, share: 0.78 },
    { description: 'Drinks', qty: 2, share: 0.22 },
  ],
  Transport: [{ description: 'Fare', qty: 1, share: 1 }],
  'Bills & utilities': [
    { description: 'Usage', qty: 1, share: 0.86 },
    { description: 'Supply charge', qty: 1, share: 0.14 },
  ],
  Health: [{ description: 'Consultation / dispensed items', qty: 1, share: 1, gstFree: true }],
  Shopping: [
    { description: 'Item', qty: 1, share: 0.68 },
    { description: 'Item', qty: 1, share: 0.32 },
  ],
  Home: [
    { description: 'Materials', qty: 1, share: 0.75 },
    { description: 'Consumables', qty: 1, share: 0.25 },
  ],
  Fun: [{ description: 'Admission / subscription', qty: 1, share: 1 }],
};

/** Scaled-integer split so the parts sum to the whole, to the last cent. */
/**
 * The per-category tax split for a demo document — Peppol BG-23.
 *
 * Calls the SAME function the server calls (`taxSubtotalsFromLines`), rather
 * than computing a demo-only variant. A fixture that disagrees with production
 * is a fixture that hides the bug production has, and the mobile app is built
 * against these figures.
 */
function subtotalsFor(
  lines: Array<{ amount: string; gstFree: boolean }>,
  taxAmount: string,
  payableAmount: string,
) {
  return taxSubtotalsFromLines(lines, taxAmount, payableAmount);
}

function splitExact(total: Money, shares: number[]): Money[] {
  const units = BigInt(Math.round(Number(total) * 10000));
  const out: bigint[] = [];
  let used = 0n;
  for (let i = 0; i < shares.length; i++) {
    if (i === shares.length - 1) {
      out.push(units - used);
    } else {
      // Round each share to a whole cent; the remainder lands on the last line
      // rather than being scattered as sub-cent dust.
      const part = (BigInt(Math.round(shares[i]! * Number(total) * 100)) * 100n);
      out.push(part);
      used += part;
    }
  }
  return out.map((u) => {
    const negative = u < 0n;
    const abs = negative ? -u : u;
    return money.money(`${negative ? '-' : ''}${abs / 10000n}.${(abs % 10000n).toString().padStart(4, '0')}`);
  });
}

/**
 * Lines for a demo document, made to AGREE with its own GST.
 *
 * `gstFreePortion` is the document's GST-free amount, which the seed states and
 * from which the document's GST is computed. The lines have to add up to the
 * same story, and they did not: `doc_06` is a $84.20 docket whose seed says
 * $41.60 is GST-free, while its line template marks 25% — $21.05 — so its
 * printed GST was one eleventh of $42.60 against lines claiming $63.15 was
 * taxable. Nothing looked broken, because both figures reconcile to the
 * payable independently.
 *
 * `docs/WEB.md` §2: worked examples must actually reconcile. This rescales the
 * template's shares so the GST-free lines sum to EXACTLY the stated portion,
 * leaving every document total — and therefore every figure on the marketing
 * site — unchanged. Where a template has no GST-free line but the document
 * claims a portion (the single-line historical documents), the line is split in
 * two, which is also a truer picture of a grocery shop.
 */
function linesFor(
  category: string,
  total: Money,
  confidence: number,
  detailed: boolean,
  gstFreePortion: Money = money.ZERO,
) {
  let template = detailed
    ? (LINE_TEMPLATES[category] ?? [{ description: category, qty: 1, share: 1 }])
    : [{ description: category, qty: 1, share: 1 }];

  const wantsFree = money.compare(gstFreePortion, money.ZERO) > 0;
  if (wantsFree) {
    const freeShare = Number(gstFreePortion) / Number(total);
    const templateFree = template.filter((t) => t.gstFree === true);
    if (templateFree.length === 0) {
      // No GST-free line to carry it: split the category in two rather than
      // leaving the document asserting a portion no line accounts for.
      template = [
        { description: `${category} (GST-free)`, qty: 1, share: freeShare, gstFree: true },
        { description: category, qty: 1, share: 1 - freeShare },
      ];
    } else {
      // Rescale: GST-free lines take exactly `freeShare` between them, the rest
      // share what remains, both in their original proportions.
      const freeTotal = templateFree.reduce((a, t) => a + t.share, 0);
      const taxedTotal = template.filter((t) => t.gstFree !== true).reduce((a, t) => a + t.share, 0);
      template = template.map((t) =>
        t.gstFree === true
          ? { ...t, share: (t.share / freeTotal) * freeShare }
          : { ...t, share: taxedTotal === 0 ? 0 : (t.share / taxedTotal) * (1 - freeShare) },
      );
    }
  }

  const amounts = splitExact(total, template.map((t) => t.share));
  return template.map((t, i) => {
    const amount = amounts[i]!;
    return {
      lineNumber: i + 1,
      description: t.description,
      quantity: t.qty,
      unitPrice: money.money((Number(amount) / t.qty).toFixed(4)),
      amount,
      gstFree: t.gstFree === true,
      category,
      // Individual lines read slightly less reliably than the total, which is
      // printed largest on every receipt.
      confidence: Math.max(0.5, Math.round((confidence - 0.03) * 100) / 100),
    };
  });
}

/* ── Findings ──────────────────────────────────────────────────────────────
   What the server's validators say about a document, in the words the review
   screen shows. Generated here from the same compliance failures so the demo
   carries real messages rather than a bare list of codes — and so the field
   is exercised before the API exists to populate it. */

/** Money as a person reads it: grouped, two decimals. */
const aud = (v: Money | string): string =>
  `$${Number(v).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Finding = {
  code: string;
  severity: 'error' | 'warning' | 'note';
  field: string;
  message: string;
  fix?: string;
};

function findingsFor(
  failures: string[],
  inclusive: Money,
  belowThreshold: boolean,
): Finding[] {
  const out: Finding[] = [];
  // Below $82.50 the ATO does not require a tax invoice, so the same facts
  // are worth stating but are not the user's problem to fix.
  const severity = belowThreshold ? ('note' as const) : ('warning' as const);

  if (failures.includes('supplier_abn_missing')) {
    out.push({
      code: 'supplier_abn_missing',
      severity,
      field: 'supplierAbn',
      message: 'The document shows no supplier ABN.',
      fix: 'Add it from the docket, or ask the supplier for a compliant tax invoice.',
    });
  }
  if (failures.includes('buyer_abn_required_over_1000')) {
    out.push({
      code: 'buyer_abn_required_over_1000',
      severity: 'warning',
      field: 'buyerIdentified',
      message: `At ${aud(inclusive)} the invoice must also show your identity or ABN.`,
      fix: 'Ask the supplier to reissue it showing your business name or ABN.',
    });
  }
  if (failures.includes('not_marked_tax_invoice')) {
    out.push({
      code: 'not_marked_tax_invoice',
      severity,
      field: 'saysTaxInvoice',
      message: 'The words “tax invoice” do not appear on the document.',
      fix: 'Request a tax invoice from the supplier.',
    });
  }
  return out;
}

/** ABN mod-89 checksum — the same algorithm the database enforces. */
function abnIsValid(abn: string | null): boolean {
  if (!abn) return false;
  const d = abn.replace(/\D/g, '');
  if (d.length !== 11) return false;
  const w = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const sum = d
    .split('')
    .map(Number)
    .reduce((acc, n, i) => acc + (i === 0 ? n - 1 : n) * w[i]!, 0);
  return sum % 89 === 0;
}

const docs = SEEDS.map((s, i) => {
  const inclusive = M(s.inclusive);
  const gstFree = s.gstFreePortion ? M(s.gstFreePortion) : money.ZERO;
  const gst = money.gstFromInclusive(money.subtract(inclusive, gstFree));
  const exclusive = money.subtract(inclusive, gst);

  const abnValid = abnIsValid(s.abn);
  const overBuyerThreshold = money.compare(inclusive, BUYER_ABN_THRESHOLD) >= 0;
  const needsBuyerAbn = overBuyerThreshold && s.buyerAbnShown !== true;
  const belowThreshold = money.compare(inclusive, TAX_INVOICE_THRESHOLD) < 0;

  // ATO validity: the words "tax invoice", supplier identity AND ABN, the date,
  // a description, the GST amount -- plus the buyer's identity/ABN at $1,000+.
  const isTaxInvoice = s.saysTaxInvoice && abnValid && !needsBuyerAbn;

  const failures: string[] = [];
  if (!abnValid) failures.push('supplier_abn_missing');
  if (needsBuyerAbn) failures.push('buyer_abn_required_over_1000');
  if (!s.saysTaxInvoice) failures.push('not_marked_tax_invoice');

  return {
    id: s.id,
    supplierName: s.supplier,
    supplierAbn: s.abn,
    supplierAbnValid: abnValid,
    issueDate: daysAgo(s.daysAgo),
    currency: 'AUD',
    taxExclusiveAmount: exclusive,
    taxAmount: gst,
    payableAmount: inclusive,
    gstFreeAmount: s.gstFreePortion ? gstFree : null,
    isTaxInvoice,
    docType: isTaxInvoice ? ('tax_invoice' as const) : ('receipt' as const),
    category: s.category,
    engineRowId: s.engineRow,
    reviewStatus: isTaxInvoice ? ('auto_accepted' as const) : ('needs_review' as const),
    confidenceOverall: s.confidence,
    note: s.note ?? null,
    /** Non-empty only when a credit is genuinely at risk. */
    complianceFailures: failures,
    /** GST that cannot be claimed as things stand. */
    gstAtRisk: isTaxInvoice ? null : gst,
    /** Under $82.50 the ATO does not require a tax invoice at all. */
    belowTaxInvoiceThreshold: belowThreshold,
    findings: findingsFor(failures, inclusive, belowThreshold),
    lines: linesFor(s.category, inclusive, s.confidence, true, gstFree),
    taxSubtotals: subtotalsFor(
      linesFor(s.category, inclusive, s.confidence, true, gstFree), gst, inclusive,
    ),
    linesBalance: true,
    // No photographs ship in the repo, so the demo has no stored original for
    // a seeded document; the review screen renders a facsimile from the
    // extraction and says so. A capture taken on the device has a real one.
    //
    // `pages` still carries one entry, because the wire type guarantees at
    // least one, and a fixture that breaks that guarantee teaches callers to
    // handle an empty case that cannot occur. Its imageUrl is the empty
    // string rather than null: the field is non-nullable, and empty is falsy
    // in exactly the place `imageUrl: null` already was, so the facsimile
    // path is unchanged.
    imageUrl: null,
    pages: [{ pageNumber: 1, imageUrl: '', source: 'capture' as const }],
    imageCapturedAt: daysAgo(s.daysAgo),
    workspace: 'business' as const,
    workspaceId: WS_BIZ,
    // Rotated across the crew so the demo shows a shared workspace rather than
    // one person's phone. Deterministic, not random.
    capturedByName: ['Kate Marsh', 'Sam Oyelaran', 'Dan Whitby'][i % 3]!,
    visibility: 'shared' as const,
    // Every document starts at version 1; a correction bumps it. The app sends
    // the version it read back with an edit, so a stale write is refused.
    version: 1,
  };
});

// ── History, and the personal workspace ───────────────────────────────────
//
// Two things the curated quarter above cannot give us: a year of history to
// chart, and a second workspace. Personal spending is the same capture
// pipeline pointed at a different question — not "can I claim this?" but "is
// this month going to hold?" — so it shares DocumentView and drops everything
// tax: no ABN, no BAS, no credit at risk.
//
// The history is generated, not typed, but it is generated DETERMINISTICALLY:
// a seeded linear congruential generator, so the same fixture comes out on
// every run and a chart does not reshuffle itself between demos. Every amount
// still goes through the exact-decimal helpers.

/** Deterministic 0..1. Same seed, same demo, every time. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** ISO date `m` whole months back from today, on day-of-month `day`. */
function monthsAgo(m: number, day: number): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type Template = {
  category: string;
  merchants: string[];
  /** Inclusive amount range, in dollars. */
  min: number;
  max: number;
  /** Roughly how many of these land in a month. */
  perMonth: number;
  /** Share of the total that carries no GST (fresh food, health). */
  gstFreeShare?: number;
  engineRow?: string;
};

/** Personal life, as a household actually spends it. */
const PERSONAL: Template[] = [
  { category: 'Groceries',         merchants: ['Woolworths Metro', 'Coles Broadway', 'ALDI Marrickville', 'IGA Local'], min: 24, max: 186, perMonth: 9, gstFreeShare: 0.55 },
  { category: 'Eating out',        merchants: ['Guzman y Gomez', 'Cafe Ambrosia', 'Thai Riffic', "Domino's Pizza"],     min: 12, max: 88,  perMonth: 7 },
  { category: 'Transport',         merchants: ['Opal top-up', 'Uber', 'Linkt Tolls'],                                   min: 8,  max: 62,  perMonth: 5 },
  { category: 'Fuel',              merchants: ['Ampol Alexandria', 'BP Rosebery', '7-Eleven Redfern'],                  min: 48, max: 112, perMonth: 3 },
  { category: 'Bills & utilities', merchants: ['Sydney Water', 'AGL top-up'],                                            min: 18, max: 340, perMonth: 2 },
  { category: 'Health',            merchants: ['Chemist Warehouse', 'Newtown Dental', 'GP gap payment'],                min: 22, max: 210, perMonth: 2, gstFreeShare: 1 },
  { category: 'Shopping',          merchants: ['Kmart', 'Uniqlo', 'JB Hi-Fi', 'Big W'],                                 min: 19, max: 240, perMonth: 3 },
  { category: 'Home',              merchants: ['Bunnings Warehouse', 'IKEA Tempe'],                                     min: 26, max: 195, perMonth: 2 },
  { category: 'Fun',               merchants: ['Event Cinemas', 'Marrickville Bowlo'],                                  min: 14, max: 96,  perMonth: 2 },
];

/** What last year looked like on the truck. Same categories as the quarter. */
const BUSINESS_HISTORY: Template[] = [
  { category: 'Fuel',                      merchants: ['Ampol Foodary Marulan', 'BP Truckstop Gundagai', 'Shell Coles Express Dubbo', 'Caltex Woolworths Forbes'], min: 142, max: 268, perMonth: 11, engineRow: 'D1.logbook.fuel' },
  { category: 'Truck parts & maintenance', merchants: ['Repco Auto Parts Goulburn', 'Beaurepaires Orange', 'Bridgestone Service Wagga'], min: 84, max: 1420, perMonth: 3, engineRow: 'D1.logbook.servicing' },
  { category: 'Meals on the road',         merchants: ['Linfox Weighbridge Cafe', 'Servo Pie Shop Narrandera', 'Coles Express Yass'], min: 9, max: 46, perMonth: 9, engineRow: 'D2.meals.lunch', gstFreeShare: 0.3 },
  { category: 'Accommodation',             merchants: ['Highway Motor Inn Dubbo', 'Mitchell Motor Inn Bathurst'], min: 132, max: 178, perMonth: 4, engineRow: 'D2.accommodation' },
  { category: 'Tolls',                     merchants: ['Transurban Linkt Tolls'], min: 288, max: 465, perMonth: 1, engineRow: 'D2.tolls' },
  { category: 'Phone & internet',          merchants: ['Telstra Mobile'], min: 85, max: 85, perMonth: 1, engineRow: 'D5.phone' },
  { category: 'Insurance',                 merchants: ['NRMA Truck Insurance'], min: 742, max: 742, perMonth: 1, engineRow: 'D1.logbook.insurance' },
  { category: 'Truck cleaning supplies',   merchants: ['Total Truck Wash Tamworth', 'Bunnings Warehouse Wagga'], min: 28, max: 96, perMonth: 2, engineRow: 'D5.truckmaint' },
];

const HISTORY_ABN = '51824753556';

// The curated docs narrow `workspace` and `visibility` to literals, so both
// have to be widened here or a personal, private document will not type.
type GenDoc = Omit<(typeof docs)[number], 'workspace' | 'visibility' | 'findings'> & {
  findings: Finding[];
  workspace: 'business' | 'personal';
  visibility: 'shared' | 'private';
};

/**
 * Builds one workspace's documents across `months` months back from today.
 * `fromMonth` of 0 includes the current month-to-date.
 */
function generate(
  templates: Template[],
  workspace: 'business' | 'personal',
  seed: number,
  fromMonth: number,
  months: number,
): GenDoc[] {
  const rand = lcg(seed);
  const out: GenDoc[] = [];
  const today = new Date().getDate();
  let n = 0;

  for (let m = fromMonth; m <= months; m++) {
    // Seasonality: a gentle sine so a year of bars has shape rather than noise.
    const season = 1 + 0.16 * Math.sin((m / 12) * Math.PI * 2);
    for (const t of templates) {
      // The current month is only part-way through, so it gets a pro-rata count.
      const share = m === 0 ? today / 30 : 1;
      const count = Math.max(0, Math.round(t.perMonth * share * (0.8 + rand() * 0.4)));
      for (let i = 0; i < count; i++) {
        const dollars = (t.min + rand() * (t.max - t.min)) * season;
        const inclusive = money.money(dollars.toFixed(2));
        const gstFree = t.gstFreeShare
          ? money.money((Number(inclusive) * t.gstFreeShare).toFixed(2))
          : money.ZERO;
        const gst = money.gstFromInclusive(money.subtract(inclusive, gstFree));
        const day = m === 0 ? 1 + Math.floor(rand() * Math.max(1, today - 1)) : 1 + Math.floor(rand() * 28);
        const merchant = t.merchants[Math.floor(rand() * t.merchants.length)]!;
        const business = workspace === 'business';
        n += 1;
        out.push({
          id: `${workspace === 'business' ? 'bh' : 'pd'}_${String(n).padStart(4, '0')}`,
          supplierName: merchant,
          supplierAbn: business ? HISTORY_ABN : null,
          supplierAbnValid: business,
          issueDate: monthsAgo(m, day),
          currency: 'AUD',
          taxExclusiveAmount: money.subtract(inclusive, gst),
          taxAmount: gst,
          payableAmount: inclusive,
          gstFreeAmount: t.gstFreeShare ? gstFree : null,
          // Personal spending is never claimed, so it is never a tax invoice
          // and never carries a credit at risk. The personal UI says nothing
          // about GST at all.
          isTaxInvoice: business,
          docType: business ? ('tax_invoice' as const) : ('receipt' as const),
          category: t.category,
          engineRowId: t.engineRow ?? 'personal',
          reviewStatus: 'auto_accepted' as const,
          confidenceOverall: 0.96,
          note: null,
          complianceFailures: [],
          gstAtRisk: null,
          belowTaxInvoiceThreshold: money.compare(inclusive, TAX_INVOICE_THRESHOLD) < 0,
          // One line for a historical docket: enough to be a real document,
          // small enough that a year of them does not bloat the bundle.
          findings: [],
          lines: linesFor(t.category, inclusive, 0.96, false, gstFree),
          taxSubtotals: subtotalsFor(
            linesFor(t.category, inclusive, 0.96, false, gstFree), gst, inclusive,
          ),
          linesBalance: true,
          imageUrl: null,
          pages: [{ pageNumber: 1, imageUrl: '', source: 'capture' as const }],
          imageCapturedAt: monthsAgo(m, day),
          workspace,
          workspaceId: business ? WS_BIZ : WS_HOME,
          capturedByName: business
            ? ['Kate Marsh', 'Sam Oyelaran', 'Dan Whitby'][n % 3]!
            : ['Kate Marsh', 'Jem Marsh'][n % 2]!,
          // One household receipt in twenty is private — enough to show the
          // behaviour without making the shared view useless.
          visibility: !business && n % 20 === 7 ? ('private' as const) : ('shared' as const),
          version: 1,
        });
      }
    }
  }
  return out;
}

// Business history starts one month back: the curated quarter above already
// owns the recent weeks, and duplicating them would double the BAS.
const businessHistory = generate(BUSINESS_HISTORY, 'business', 20260910, 1, 12);
const personalDocs = generate(PERSONAL, 'personal', 424242, 0, 12);

// ── Subscriptions ─────────────────────────────────────────────────────────
// The defining property of a subscription is that it charges the SAME amount
// on roughly the same day, every month. Generating these from the random
// templates above produced merchants whose "monthly" charge ranged from $18 to
// $340, and the recurring detector rightly refused to call that a
// subscription. So they are generated deterministically instead — which is
// also what makes them detectable, exactly as real ones would be.

type Sub = { merchant: string; category: string; amount: string; day: number; gstFree?: boolean };
const SUBSCRIPTIONS: Sub[] = [
  { merchant: 'Netflix',             category: 'Fun',               amount: '18.99',  day: 4 },
  { merchant: 'Spotify Premium',     category: 'Fun',               amount: '13.99',  day: 12 },
  { merchant: 'Telstra',             category: 'Bills & utilities', amount: '85.00',  day: 8 },
  { merchant: 'Origin Energy',       category: 'Bills & utilities', amount: '142.80', day: 18 },
  { merchant: 'NRMA Car Insurance',  category: 'Bills & utilities', amount: '94.60',  day: 22 },
  { merchant: 'Anytime Fitness',     category: 'Health',            amount: '69.00',  day: 2 },
];

const subscriptionDocs: GenDoc[] = [];
{
  const todayDate = new Date().getDate();
  let n = 0;
  for (let m = 0; m <= 12; m++) {
    for (const sub of SUBSCRIPTIONS) {
      // The current month only has the charges that have already fallen due.
      if (m === 0 && sub.day > todayDate) continue;
      const inclusive = M(sub.amount);
      const gstFree = sub.gstFree ? inclusive : money.ZERO;
      const gst = money.gstFromInclusive(money.subtract(inclusive, gstFree));
      const issueDate = monthsAgo(m, sub.day);
      n += 1;
      subscriptionDocs.push({
        id: `sub_${String(n).padStart(4, '0')}`,
        supplierName: sub.merchant,
        supplierAbn: null,
        supplierAbnValid: false,
        issueDate,
        currency: 'AUD',
        taxExclusiveAmount: money.subtract(inclusive, gst),
        taxAmount: gst,
        payableAmount: inclusive,
        gstFreeAmount: sub.gstFree ? gstFree : null,
        isTaxInvoice: false,
        docType: 'receipt' as const,
        category: sub.category,
        engineRowId: 'personal',
        reviewStatus: 'auto_accepted' as const,
        confidenceOverall: 0.98,
        note: null,
        complianceFailures: [],
        gstAtRisk: null,
        belowTaxInvoiceThreshold: money.compare(inclusive, TAX_INVOICE_THRESHOLD) < 0,
        findings: [],
        lines: linesFor(sub.category, inclusive, 0.98, false, gstFree),
        taxSubtotals: subtotalsFor(
          linesFor(sub.category, inclusive, 0.98, false, gstFree), gst, inclusive,
        ),
        linesBalance: true,
        imageUrl: null,
        pages: [{ pageNumber: 1, imageUrl: '', source: 'capture' as const }],
        imageCapturedAt: issueDate,
        workspace: 'personal' as const,
        workspaceId: WS_HOME,
        capturedByName: 'Kate Marsh',
        visibility: 'shared' as const,
        version: 1,
      });
    }
  }
}

/** What the household has decided each category is worth per month. */
const BUDGETS: Array<{ category: string; monthly: string }> = [
  { category: 'Groceries',         monthly: '950.00' },
  { category: 'Eating out',        monthly: '320.00' },
  { category: 'Transport',         monthly: '180.00' },
  { category: 'Fuel',              monthly: '260.00' },
  { category: 'Bills & utilities', monthly: '640.00' },
  { category: 'Health',            monthly: '200.00' },
  { category: 'Shopping',          monthly: '300.00' },
  { category: 'Home',              monthly: '220.00' },
  { category: 'Fun',               monthly: '180.00' },
];

const budgets = BUDGETS.map((b) => ({ category: b.category, monthly: money.money(b.monthly) }));
const budgetTotal = budgets.reduce((a, b) => money.add(a, b.monthly), money.ZERO);

// ── Business side: parties, inventory, invoices ────────────────────────────
// Sales GST in Australia is 10% ADDED to the ex-GST price. That is the inverse
// of a purchase receipt, where GST is 1/11 of the inclusive total. Getting the
// direction wrong is the classic bug, so the two are computed separately and
// both go through the exact-decimal helpers.

const mul = (amount: Money, qty: number): Money => {
  // qty is a small integer or 1-decimal quantity in this data set; scale by 10
  // to keep the multiply exact rather than trusting a float.
  const q = Math.round(qty * 10);
  const cents = Math.round(Number(amount) * 10000);
  return money.money((BigInt(cents) * BigInt(q) / 10n).toString().padStart(5, '0').replace(
    /(\d+)(\d{4})$/, '$1.$2'));
};
const gstOnSale = (exGst: Money): Money => money.money((Number(exGst) * 0.1).toFixed(4));

type PartyKind = 'customer' | 'supplier';
const PARTIES: Array<{ id: string; name: string; kind: PartyKind; abn: string | null; email: string; phone: string }> = [
  { id: 'pty_northfreight', name: 'Northline Freight Co',      kind: 'customer', abn: '51824753556', email: 'ap@northline.example',   phone: '02 6931 4412' },
  { id: 'pty_riverina',     name: 'Riverina Produce Transport', kind: 'customer', abn: '33051775556', email: 'accounts@riverina.example', phone: '02 6921 7788' },
  { id: 'pty_gundagai',     name: 'Gundagai Cold Storage',      kind: 'customer', abn: '51824753556', email: 'admin@gcs.example',      phone: '02 6944 2210' },
  { id: 'pty_hay',          name: 'Hay Plains Grain',           kind: 'customer', abn: null,          email: 'office@hayplains.example', phone: '03 5033 1120' },
  { id: 'pty_ampol',        name: 'Ampol Foodary Marulan',      kind: 'supplier', abn: '51824753556', email: '',                        phone: '' },
  { id: 'pty_repco',        name: 'Repco Auto Parts Goulburn',  kind: 'supplier', abn: '33051775556', email: '',                        phone: '' },
  { id: 'pty_beaurepaires', name: 'Beaurepaires Orange',        kind: 'supplier', abn: '51824753556', email: '',                        phone: '' },
];

const ITEMS = [
  { id: 'itm_linehaul',  name: 'Line-haul freight',        sku: 'FRT-LH',  unit: 'km',   price: '2.9500',  cost: '1.8200',  stock: null, taxCode: 'GSTONINCOME' },
  { id: 'itm_local',     name: 'Local delivery',           sku: 'FRT-LOC', unit: 'trip', price: '185.0000', cost: '96.0000', stock: null, taxCode: 'GSTONINCOME' },
  { id: 'itm_pallet',    name: 'Pallet handling',          sku: 'HND-PAL', unit: 'ea',   price: '14.5000',  cost: '6.2000',  stock: null, taxCode: 'GSTONINCOME' },
  { id: 'itm_wait',      name: 'Waiting time',             sku: 'SVC-WAIT', unit: 'hr',  price: '95.0000',  cost: '0.0000',  stock: null, taxCode: 'GSTONINCOME' },
  { id: 'itm_refrig',    name: 'Refrigerated surcharge',   sku: 'FRT-REF', unit: 'trip', price: '240.0000', cost: '150.0000', stock: null, taxCode: 'GSTONINCOME' },
  { id: 'itm_strap',     name: 'Load restraint straps',    sku: 'EQP-STR', unit: 'ea',   price: '38.0000',  cost: '21.5000', stock: 42,   taxCode: 'GSTONINCOME' },
  { id: 'itm_corner',    name: 'Corner protectors',        sku: 'EQP-CNR', unit: 'ea',   price: '6.5000',   cost: '2.8000',  stock: 6,    taxCode: 'GSTONINCOME' },
  { id: 'itm_tarp',      name: 'Heavy-duty tarp',          sku: 'EQP-TRP', unit: 'ea',   price: '410.0000', cost: '268.0000', stock: 0,   taxCode: 'GSTONINCOME' },
];

type InvSeed = {
  id: string; number: string; party: string; daysAgo: number; dueDays: number;
  status: 'draft' | 'sent' | 'paid' | 'overdue'; kind: 'invoice' | 'estimate';
  lines: Array<{ item: string; qty: number }>;
  paid?: string;
};

const INVOICES: InvSeed[] = [
  { id: 'inv_1042', number: 'INV-1042', party: 'pty_northfreight', daysAgo: 2,  dueDays: 14, status: 'sent',    kind: 'invoice',  lines: [{ item: 'itm_linehaul', qty: 640 }, { item: 'itm_pallet', qty: 18 }] },
  { id: 'inv_1041', number: 'INV-1041', party: 'pty_riverina',     daysAgo: 6,  dueDays: 14, status: 'paid',    kind: 'invoice',  lines: [{ item: 'itm_local', qty: 4 }, { item: 'itm_wait', qty: 2 }], paid: 'full' },
  { id: 'inv_1040', number: 'INV-1040', party: 'pty_gundagai',     daysAgo: 21, dueDays: 14, status: 'overdue', kind: 'invoice',  lines: [{ item: 'itm_refrig', qty: 3 }, { item: 'itm_pallet', qty: 26 }] },
  { id: 'inv_1039', number: 'INV-1039', party: 'pty_northfreight', daysAgo: 28, dueDays: 14, status: 'paid',    kind: 'invoice',  lines: [{ item: 'itm_linehaul', qty: 980 }], paid: 'full' },
  { id: 'inv_1043', number: 'INV-1043', party: 'pty_hay',          daysAgo: 0,  dueDays: 14, status: 'draft',   kind: 'invoice',  lines: [{ item: 'itm_local', qty: 2 }] },
  { id: 'est_0208', number: 'EST-0208', party: 'pty_hay',          daysAgo: 3,  dueDays: 30, status: 'sent',    kind: 'estimate', lines: [{ item: 'itm_linehaul', qty: 1200 }, { item: 'itm_refrig', qty: 2 }] },
];

const itemById = new Map(ITEMS.map((i) => [i.id, i]));

const invoices = INVOICES.map((v) => {
  const lines = v.lines.map((l, idx) => {
    const item = itemById.get(l.item)!;
    const unitPrice = money.money(item.price);
    const net = mul(unitPrice, l.qty);
    const gst = gstOnSale(net);
    return {
      lineNumber: idx + 1,
      itemId: item.id,
      description: item.name,
      unit: item.unit,
      quantity: l.qty,
      unitPrice,
      netAmount: net,
      gstAmount: gst,
      totalAmount: money.add(net, gst),
    };
  });
  const net = lines.reduce((a, l) => money.add(a, l.netAmount), money.ZERO);
  const gst = lines.reduce((a, l) => money.add(a, l.gstAmount), money.ZERO);
  const total = money.add(net, gst);
  const party = PARTIES.find((x) => x.id === v.party)!;
  return {
    id: v.id,
    number: v.number,
    kind: v.kind,
    status: v.status,
    partyId: party.id,
    partyName: party.name,
    issueDate: daysAgo(v.daysAgo),
    dueDate: daysAgo(v.daysAgo - v.dueDays),
    lines,
    netAmount: net,
    gstAmount: gst,
    totalAmount: total,
    amountPaid: v.paid === 'full' ? total : money.ZERO,
    amountDue: v.paid === 'full' ? money.ZERO : total,
  };
});

// ── Invoice history ───────────────────────────────────────────────────────
// The six invoices above are the recent, detailed ones a demo actually opens.
// On their own they made the business look like it lost $9,000 a quarter,
// because the fixture carries a full year of REAL expenses against a handful
// of sales. A haulage firm spending $18k a quarter invoices far more than six
// times, so the rest of the year's revenue is generated here — deterministic,
// exact-decimal, and all settled, so it never disturbs "owed to you".

/** The BAS quarter, needed here because `sales` is built before the BAS is. */
const quarterStartForSales = (() => {
  const now = new Date();
  const m = Math.floor(now.getMonth() / 3) * 3;
  return `${now.getFullYear()}-${String(m + 1).padStart(2, '0')}-01`;
})();

const revenueRand = lcg(70414);
const invoiceHistory = (() => {
  const out: typeof invoices = [];
  let n = 0;
  const customers = PARTIES.filter((x) => x.kind === 'customer');
  const lineItems = ITEMS.filter((i) => i.stock === null);

  // Month 0 is partly done; the curated invoices already cover recent weeks,
  // so history starts at month 1 and runs back a year.
  for (let m = 1; m <= 12; m++) {
    const perMonth = 4 + Math.floor(revenueRand() * 3); // 4–6 invoices a month
    for (let k = 0; k < perMonth; k++) {
      n += 1;
      const item = lineItems[Math.floor(revenueRand() * lineItems.length)]!;
      const party = customers[Math.floor(revenueRand() * customers.length)]!;
      const qty =
        item.unit === 'km'
          ? 400 + Math.round(revenueRand() * 900)
          : 1 + Math.round(revenueRand() * 12);
      const unitPrice = money.money(item.price);
      const net = mul(unitPrice, qty);
      const gst = gstOnSale(net);
      const total = money.add(net, gst);
      const issueDate = monthsAgo(m, 2 + Math.floor(revenueRand() * 26));

      out.push({
        id: `inv_h${String(n).padStart(4, '0')}`,
        number: `INV-0${900 + n}`,
        kind: 'invoice' as const,
        status: 'paid' as const,
        partyId: party.id,
        partyName: party.name,
        issueDate,
        dueDate: issueDate,
        lines: [
          {
            lineNumber: 1,
            itemId: item.id,
            description: item.name,
            unit: item.unit,
            quantity: qty,
            unitPrice,
            netAmount: net,
            gstAmount: gst,
            totalAmount: total,
          },
        ],
        netAmount: net,
        gstAmount: gst,
        totalAmount: total,
        amountPaid: total,
        amountDue: money.ZERO,
      });
    }
  }
  return out;
})();

const allInvoices = [...invoices, ...invoiceHistory];

const sales = {
  outstanding: allInvoices
    .filter((i) => i.kind === 'invoice' && i.status !== 'paid' && i.status !== 'draft')
    .reduce((a, i) => money.add(a, i.amountDue), money.ZERO),
  overdue: allInvoices
    .filter((i) => i.status === 'overdue')
    .reduce((a, i) => money.add(a, i.amountDue), money.ZERO),
  paidThisQuarter: allInvoices
    .filter((i) => i.status === 'paid' && i.issueDate >= quarterStartForSales)
    .reduce((a, i) => money.add(a, i.totalAmount), money.ZERO),
  gstOnSales: allInvoices
    .filter(
      (i) =>
        i.kind === 'invoice' && i.status !== 'draft' && i.issueDate >= quarterStartForSales,
    )
    .reduce((a, i) => money.add(a, i.gstAmount), money.ZERO),
};

const items = ITEMS.map((i) => ({
  id: i.id,
  name: i.name,
  sku: i.sku,
  unit: i.unit,
  sellPrice: money.money(i.price),
  costPrice: money.money(i.cost),
  stockOnHand: i.stock,
  lowStock: i.stock !== null && i.stock <= 6,
  taxCode: i.taxCode,
}));

const parties = PARTIES.map((x) => {
  const theirs = allInvoices.filter((i) => i.partyId === x.id && i.kind === 'invoice');
  return {
    id: x.id,
    name: x.name,
    kind: x.kind,
    abn: x.abn,
    abnValid: abnIsValid(x.abn),
    email: x.email || null,
    phone: x.phone || null,
    openBalance: theirs.reduce((a, i) => money.add(a, i.amountDue), money.ZERO),
    invoiceCount: theirs.length,
  };
});

// ── BAS position (Simpler BAS: G1, 1A, 1B) ────────────────────────────────
const sum = (xs: Money[]) => xs.reduce((a, b) => money.add(a, b), money.ZERO);

/** First day of the current BAS quarter. */
const quarterStart = (() => {
  const now = new Date();
  const m = Math.floor(now.getMonth() / 3) * 3;
  return `${now.getFullYear()}-${String(m + 1).padStart(2, '0')}-01`;
})();

// The BAS is a quarterly return, so it counts the quarter — not the whole
// history now in the fixture, and never the personal workspace.
const basDocs = [...docs, ...businessHistory].filter((d) => d.issueDate >= quarterStart);

const purchasesInclusive = sum(basDocs.map((d) => d.payableAmount));
const claimable = basDocs.filter((d) => d.isTaxInvoice);
const atRisk = basDocs.filter((d) => !d.isTaxInvoice);
const gstClaimable = sum(claimable.map((d) => d.taxAmount));
const gstAtRisk = sum(atRisk.map((d) => d.taxAmount));

// ── Deduction estimate, computed by the engine ────────────────────────────
// A representative line-haul year. Every cap applied (5,000 km, $69,674/8,
// $165/day, $3/week laundry) comes from the RateSet, so these figures move
// automatically when the rates do.
const worksheet: WorksheetInputs = {
  d1: {
    cars: [
      {
        method: 'Logbook',
        logbook: { itemisedTotal: 9840, carCost: 82000, workKm: 41000, totalKm: 46000 },
      },
    ],
  },
  d2: {
    meals: {
      // A 14-day loop, 12 of them worked away from home.
      days: Array.from({ length: 12 }, () => ({
        breakfast: 22,
        lunch: 34,
        dinner: 58,
        incidentals: 18,
      })),
      daysWorked: 12,
      numberOfFortnights: 18,
      highIncome: false,
      perTripExtras: 45,
    },
    accommodation: { nights: 12, ratePerNight: 145 },
    tolls: { tollToWork: 18.4, tollHome: 16.2, roundTrips: 36 },
  },
  d3: {
    items: [
      { qty: 4, costPerItem: 89.95 }, // hi-vis shirts
      { qty: 2, costPerItem: 165 },   // steel-capped boots
    ],
    laundryWeeksWorked: 46,
    travelRows: [{ qty: 36, costPerUse: 8 }], // laundromat on the road
  },
  d5: {
    phone: { costPerMonth: 85, months: 12, workHours: 55, allHours: 112 },
    equipmentRows: [67.8, 35],
  },
};

const sheet = computeWorksheet(profile, worksheet, R);
const round2 = (n: number) => Math.round(n * 100) / 100;

// ── Collaboration ─────────────────────────────────────────────────────────
// Two workspaces, four people, overlapping membership. Kate is in both — she
// runs the business and the household — which is exactly the case that proves
// a workspace has to be a tenant rather than a flag: Jem can see the household
// and must never see the company.

const WORKSPACES = [
  { id: WS_BIZ,  name: 'K. Marsh Transport', kind: 'business' as const, role: 'owner' as const, abn: '51824753556' },
  { id: WS_HOME, name: 'Marsh Household',    kind: 'personal' as const, role: 'owner' as const, abn: null },
];

const MEMBERS = [
  { workspaceId: WS_BIZ,  userId: 'usr_kate', displayName: 'Kate Marsh',    email: 'kate@marshtransport.example', role: 'owner' as const,    joinedAt: daysAgo(420), lastActiveAt: daysAgo(0) },
  { workspaceId: WS_BIZ,  userId: 'usr_sam',  displayName: 'Sam Oyelaran',  email: 'sam@marshtransport.example',  role: 'admin' as const,    joinedAt: daysAgo(300), lastActiveAt: daysAgo(1) },
  { workspaceId: WS_BIZ,  userId: 'usr_dan',  displayName: 'Dan Whitby',    email: 'dan@marshtransport.example',  role: 'member' as const,   joinedAt: daysAgo(96),  lastActiveAt: daysAgo(2) },
  { workspaceId: WS_BIZ,  userId: 'usr_pri',  displayName: 'Priya Nandan',  email: 'priya@marshaccountants.example', role: 'readonly' as const, joinedAt: daysAgo(64), lastActiveAt: daysAgo(9) },
  { workspaceId: WS_HOME, userId: 'usr_kate', displayName: 'Kate Marsh',    email: 'kate@marshtransport.example', role: 'owner' as const,    joinedAt: daysAgo(400), lastActiveAt: daysAgo(0) },
  { workspaceId: WS_HOME, userId: 'usr_jem',  displayName: 'Jem Marsh',     email: 'jem@example.com',             role: 'admin' as const,    joinedAt: daysAgo(380), lastActiveAt: daysAgo(1) },
];

const INVITATIONS = [
  {
    id: 'inv_pending_1',
    email: 'noah@marshtransport.example',
    role: 'member' as const,
    invitedByName: 'Kate Marsh',
    createdAt: daysAgo(2),
    // Invitations expire. A join link that works forever is a credential.
    expiresAt: daysAgo(-5),
  },
];

// ── Bills: purchase invoices with a due date ──────────────────────────────
// Distinct from a receipt. A receipt is proof you already paid; a bill is money
// you still owe, and the only question it asks is "when".

type BillSeed = { id: string; supplier: string; ref: string; daysAgo: number; dueDays: number; inclusive: string; category: string; paid?: boolean };
const BILL_SEEDS: BillSeed[] = [
  { id: 'bill_01', supplier: 'Shell Card Australia',     ref: 'SC-88412',  daysAgo: 6,  dueDays: 30, inclusive: '3184.60', category: 'Fuel' },
  { id: 'bill_02', supplier: 'Bridgestone Service Wagga', ref: 'BSW-2201',  daysAgo: 12, dueDays: 14, inclusive: '1980.00', category: 'Truck parts & maintenance' },
  { id: 'bill_03', supplier: 'NRMA Truck Insurance',     ref: 'POL-449021', daysAgo: 40, dueDays: 14, inclusive: '742.00',  category: 'Insurance' },
  { id: 'bill_04', supplier: 'Transurban Linkt',         ref: 'LNK-77120',  daysAgo: 3,  dueDays: 21, inclusive: '412.55',  category: 'Tolls' },
  { id: 'bill_05', supplier: 'Telstra Business',         ref: 'TB-30918',   daysAgo: 21, dueDays: 14, inclusive: '185.00',  category: 'Phone & internet', paid: true },
];

const today = daysAgo(0);
const bills = BILL_SEEDS.map((b) => {
  const total = M(b.inclusive);
  const gst = money.gstFromInclusive(total);
  const dueDate = daysAgo(b.daysAgo - b.dueDays);
  const paid = b.paid === true;
  return {
    id: b.id,
    supplierName: b.supplier,
    reference: b.ref,
    issueDate: daysAgo(b.daysAgo),
    dueDate,
    totalAmount: total,
    gstAmount: gst,
    amountPaid: paid ? total : money.ZERO,
    amountDue: paid ? money.ZERO : total,
    status: paid ? ('paid' as const) : dueDate < today ? ('overdue' as const) : ('unpaid' as const),
    category: b.category,
  };
});

// ── Payments received, derived from the invoices above ────────────────────
// EVERY paid invoice gets one. An invoice marked paid with no payment behind
// it is not a record of anything, and the app re-derives what is owed from
// the payments — so a missing one reappears as a phantom overdue debt.
const payments = allInvoices
  .filter((i) => i.status === 'paid')
  .map((i, idx) => ({
    id: `pay_${String(idx + 1).padStart(3, '0')}`,
    invoiceId: i.id,
    invoiceNumber: i.number,
    partyName: i.partyName,
    // Paid a few days after issue, which is what a 14-day term looks like when
    // the customer is reliable.
    date: i.issueDate,
    amount: i.totalAmount,
    method: 'bank' as const,
    reference: `EFT ${i.number}`,
  }));

// ── Mileage ───────────────────────────────────────────────────────────────
// The rate and the 5,000 km ceiling come from the RateSet, so this moves when
// the ATO moves rather than when someone remembers to edit a constant.

type TripSeed = { daysAgo: number; from: string; to: string; km: number; purpose: string; work?: boolean };
const TRIP_SEEDS: TripSeed[] = [
  { daysAgo: 0,  from: 'Goulburn depot',  to: 'Sydney markets',   km: 196, purpose: 'Line-haul delivery' },
  { daysAgo: 1,  from: 'Sydney markets',  to: 'Goulburn depot',   km: 196, purpose: 'Return run' },
  { daysAgo: 3,  from: 'Goulburn depot',  to: 'Wagga Wagga',      km: 248, purpose: 'Pallet delivery' },
  { daysAgo: 4,  from: 'Wagga Wagga',     to: 'Dubbo',            km: 322, purpose: 'Refrigerated freight' },
  { daysAgo: 6,  from: 'Dubbo',           to: 'Goulburn depot',   km: 412, purpose: 'Return run' },
  { daysAgo: 9,  from: 'Goulburn depot',  to: 'Bathurst',         km: 168, purpose: 'Parts collection' },
  { daysAgo: 11, from: 'Home',            to: 'Goulburn depot',   km: 14,  purpose: 'Commute', work: false },
  { daysAgo: 14, from: 'Goulburn depot',  to: 'Orange',           km: 214, purpose: 'Grain cartage' },
  { daysAgo: 18, from: 'Orange',          to: 'Goulburn depot',   km: 214, purpose: 'Return run' },
  { daysAgo: 23, from: 'Goulburn depot',  to: 'Canberra',         km: 92,  purpose: 'Customer meeting' },
];

const trips = TRIP_SEEDS.map((t, i) => ({
  id: `trip_${String(i + 1).padStart(3, '0')}`,
  date: daysAgo(t.daysAgo),
  fromPlace: t.from,
  toPlace: t.to,
  km: t.km,
  purpose: t.purpose,
  workRelated: t.work !== false,
}));

// ── Stock movements, reconciled against the item counts ───────────────────
const stockedItems = ITEMS.filter((i) => i.stock !== null);
const stockMovements = stockedItems.flatMap((item, i) => [
  {
    id: `mv_${item.id}_count`,
    itemId: item.id,
    itemName: item.name,
    kind: 'count' as const,
    quantity: item.stock as number,
    at: daysAgo(30 + i),
    note: 'Opening count',
    byName: 'Sam Oyelaran',
  },
  {
    id: `mv_${item.id}_sale`,
    itemId: item.id,
    itemName: item.name,
    kind: 'sale' as const,
    quantity: -Math.max(1, Math.round((item.stock as number) / 6)),
    at: daysAgo(6 + i),
    note: 'Fitted to trailer',
    byName: 'Dan Whitby',
  },
]);

// ── Savings goals ─────────────────────────────────────────────────────────
type GoalSeed = { id: string; name: string; target: string; saved: string; inMonths: number | null };
const GOAL_SEEDS: GoalSeed[] = [
  { id: 'goal_holiday', name: 'Queensland trip',    target: '4800.00', saved: '2150.00', inMonths: 7 },
  { id: 'goal_buffer',  name: 'Emergency buffer',   target: '10000.00', saved: '6400.00', inMonths: null },
  { id: 'goal_bike',    name: "Jem's bike",         target: '900.00',  saved: '900.00',  inMonths: 2 },
];

const monthsOn = (n: number): string => {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
};

const goals = GOAL_SEEDS.map((g) => {
  const target = M(g.target);
  const saved = M(g.saved);
  const remaining = money.subtract(target, saved);
  const done = money.compare(saved, target) >= 0;
  return {
    id: g.id,
    name: g.name,
    target,
    saved,
    targetDate: g.inMonths === null ? null : monthsOn(g.inMonths),
    // What has to go in each month to land it on time. Truncated to the cent.
    perMonth:
      g.inMonths === null || done
        ? null
        : money.money((Number(remaining) / g.inMonths).toFixed(2)),
    done,
  };
});

// ── Connections, plan, settings ───────────────────────────────────────────
const connections = [
  {
    id: 'xero' as const,
    name: 'Xero',
    status: 'disconnected' as const,
    lastSyncAt: null,
    queued: docs.filter((d) => d.reviewStatus === 'auto_accepted').length,
    organisation: null,
    note: 'Pushes confirmed documents with their original image attached.',
  },
  {
    id: 'myob' as const,
    name: 'MYOB',
    status: 'disconnected' as const,
    lastSyncAt: null,
    queued: 0,
    organisation: null,
    note: 'Planned for the same outbound queue as Xero.',
  },
  {
    id: 'quickbooks' as const,
    name: 'QuickBooks',
    status: 'disconnected' as const,
    lastSyncAt: null,
    queued: 0,
    organisation: null,
    note: 'Planned for the same outbound queue as Xero.',
  },
];

/** Quota is monthly, so only this month's captures count against it. */
const monthStart = (() => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
})();
const scansThisMonth = [...docs, ...businessHistory, ...personalDocs, ...subscriptionDocs].filter(
  (d) => d.issueDate >= monthStart,
).length;

const payload = {
  generatedAt: new Date().toISOString(),
  rates: { fy: R.fy, determination: R.determination },
  profile: {
    id: PROFILE_ID,
    label: profile.label,
    benchmarkMax: profile.benchmarks?.max ?? null,
    benchmarkCommon: profile.benchmarks?.common ?? null,
  },
  tenant: {
    name: 'K. Marsh Transport',
    abn: '51824753556',
    gstRegistered: true,
    gstBasis: 'cash' as const,
    simplerBas: true,
  },
  documents: [...docs, ...businessHistory, ...personalDocs, ...subscriptionDocs].sort((a, b) =>
    b.issueDate.localeCompare(a.issueDate),
  ),
  workspaces: WORKSPACES,
  members: MEMBERS,
  invitations: INVITATIONS,
  bills,
  payments,
  trips,
  mileage: {
    centsPerKmRate: R.centsPerKmRate,
    centsPerKmCapKm: R.centsPerKmCapKm,
    // From the logbook in the worksheet above: 41,000 work km of 46,000.
    logbookPercent: Math.round((41000 / 46000) * 1000) / 10,
  },
  stockMovements,
  goals,
  connections,
  plan: {
    planCode: 'practice',
    planName: 'Practice',
    priceCents: 4900,
    realtime: true,
    scanQuota: 200,
    scansUsed: scansThisMonth,
    scansRemaining: 200 - scansThisMonth,
    seatLimit: 5,
    seatsUsed: MEMBERS.filter((m) => m.workspaceId === WS_BIZ).length,
    retentionMonths: 84,
    periodEnds: monthsOn(1),
    firmName: 'Marsh & Co Accountants',
  },
  settings: {
    workspaceId: WS_BIZ,
    name: 'K. Marsh Transport',
    abn: '51824753556',
    abnValid: abnIsValid('51824753556'),
    gstRegistered: true,
    gstBasis: 'cash' as const,
    simplerBas: true,
    occupationProfileId: PROFILE_ID,
    occupationLabel: profile.label,
    financialYearStartMonth: 7,
  },
  personal: {
    name: 'Personal',
    budgetTotal,
    budgets,
  },
  bas: {
    periodLabel: 'This quarter',
    purchasesInclusive,
    gstClaimable,
    gstAtRisk,
    atRiskCount: atRisk.length,
    thresholds: { taxInvoice: TAX_INVOICE_THRESHOLD, buyerAbn: BUYER_ABN_THRESHOLD },
    note: 'Australian GST is exactly 1/11 of a GST-inclusive amount.',
  },
  deductions: {
    estimateTotal: round2(sheet.grandTotal),
    byLabel: Object.fromEntries(
      Object.entries(sheet.byLabel).map(([k, v]) => [k, round2(v as number)]),
    ),
    caps: {
      centsPerKmCeiling: round2(R.centsPerKmCapKm * R.centsPerKmRate),
      maxCarDeclinePerYear: round2(R.carCostLimit / R.carEffectiveLifeYears),
      mealDailyLimit: R.mealDailyLimit,
      overtimeMealNoReceiptMax: R.overtimeMealNoReceiptMax,
      homeLaundryPerWeek: R.homeLaundryPerWeek,
      carCostLimit: R.carCostLimit,
    },
  },
  sales,
  invoices: allInvoices.sort((a, b) => b.issueDate.localeCompare(a.issueDate)),
  items,
  parties,
  entitlement: {
    planCode: 'practice',
    realtime: true,
    scanQuota: 200,
    scansUsed: scansThisMonth,
    scansRemaining: 200 - scansThisMonth,
    firmName: 'Marsh & Co Accountants',
  },
};

const banner = `/* GENERATED FILE — do not edit by hand.
 *
 * Produced by apps/server/scripts/gen-demo-fixtures.ts:
 *   pnpm --filter @snap/server gen:demo
 *
 * Every monetary figure is computed, not typed: GST via exact 1/11 on scaled
 * BigInt, deduction estimates from @snap/tax-engine at ${R.determination}
 * (FY ${R.fy}). Regenerate after any rate change.
 */`;

writeFileSync(
  OUT,
  `${banner}

` +
    `import type { DemoShape } from '@/api/types';

` +
    `export const DEMO: DemoShape = ${JSON.stringify(payload, null, 2)};
`,
  'utf8',
);

console.log(`wrote ${OUT}\n`);
console.log(`  documents            ${docs.length}`);
console.log(`  purchases incl GST   $${purchasesInclusive}`);
console.log(`  GST claimable  (1B)  $${gstClaimable}`);
console.log(`  GST AT RISK          $${gstAtRisk}   across ${atRisk.length} documents`);
for (const d of atRisk) {
  console.log(`      ${d.supplierName.padEnd(30)} $${d.taxAmount.padStart(10)}  ${d.complianceFailures.join(', ')}`);
}
console.log(`\n  deduction estimate   $${round2(sheet.grandTotal).toLocaleString('en-AU')}`);
console.log(`  by label             ${JSON.stringify(payload.deductions.byLabel)}`);
console.log(`  profile benchmark    common $${profile.benchmarks?.common ?? 'n/a'} / max $${profile.benchmarks?.max ?? 'n/a'}`);
console.log(`\n  invoices             ${allInvoices.length}  (outstanding $${sales.outstanding}, overdue $${sales.overdue})`);
console.log(`  GST on sales   (1A)  $${sales.gstOnSales}   (quarter)`);
console.log(`  revenue history      ${invoiceHistory.length} settled invoices`);
console.log(`  paid this quarter    $${sales.paidThisQuarter}`);
console.log(`  inventory items      ${items.length}  (${items.filter((i) => i.lowStock).length} low/out of stock)`);
console.log(`\n  business history     ${businessHistory.length} documents`);
console.log(`  subscriptions        ${SUBSCRIPTIONS.length} merchants, ${subscriptionDocs.length} charges`);
console.log(`  personal documents   ${personalDocs.length}  (budget $${budgetTotal}/month)`);
console.log(`  total in fixture     ${payload.documents.length}`);
console.log(`  workspaces           ${WORKSPACES.length}  (${MEMBERS.length} memberships, ${INVITATIONS.length} pending invite)`);
console.log(`  bills                ${bills.length}  (${bills.filter((b) => b.status === 'overdue').length} overdue)`);
console.log(`  payments             ${payments.length}`);
console.log(`  trips                ${trips.length}  (${trips.filter((t) => t.workRelated).reduce((a, t) => a + t.km, 0)} work km)`);
console.log(`  goals                ${goals.length}`);
console.log(`  parties              ${parties.length}  (${parties.filter((p) => p.kind === 'customer').length} customers)`);
