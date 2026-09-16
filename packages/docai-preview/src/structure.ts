import type { Box, Document, Line, Span } from '@snap/api-contract/docdom';

/**
 * Header fields from DocDOM spans, deterministically — no model involved.
 *
 * `docs/ON-DEVICE.md` §2.3 and §3.4. The conclusion that document reaches, after
 * costing every licence-clean small VLM, is that the header fields of an
 * Australian docket **do not need a model once you have text with positions**:
 *
 *   an ABN is eleven digits that pass mod-89; a total is money on a line
 *   carrying TOTAL / AMOUNT DUE / EFTPOS; GST is money on a line carrying GST;
 *   a date is a day-first pattern; "TAX INVOICE" is a keyword.
 *
 * A 0.5B structuring model would cost 400–700 MB and 8–20 s on the floor device
 * and hand back a value with no span. This costs ~50 ms and every field it
 * produces already points at pixels.
 *
 * ── Grounded by construction ────────────────────────────────────────────────
 *
 * Every field is selected FROM the spans, so it carries their ids, their union
 * box and their weakest confidence. A field can be **wrong** — it pointed at
 * the wrong span — but it cannot be **invented**, and wrong-by-pointing is
 * checkable by anyone with the overlay. That is D16 holding without a model
 * needing to cooperate.
 *
 * ── Where it runs ───────────────────────────────────────────────────────────
 *
 * Both sides. On the phone it fills the review screen before the upload
 * finishes (`docs/ON-DEVICE.md` §3.1). On the server it runs over the sidecar's
 * own layouts as a second, architecturally different reader — the disagreement
 * signal §4.5 calls the best hallucination detector available. Same code, so
 * the two cannot drift.
 *
 * Zero runtime dependencies, types only from `@snap/api-contract`. That is what
 * lets `test/boundaries.test.ts` admit it to the mobile app at all.
 */

/** `documents.locked_fields` vocabulary, so a preview edit locks the same path a review does. */
export type FieldPath =
  | 'header.supplier'
  | 'header.supplier_abn'
  | 'header.issue_date'
  | 'header.payable_amount'
  | 'header.tax_amount'
  | 'header.says_tax_invoice';

export type PreviewField = {
  /** As printed on the page. `null` when nothing qualified — an abstention. */
  value: string | null;
  /** ISO for a date; otherwise the same as `value`. `null` when unconvertible. */
  normalisedValue: string | null;
  spanIds: string[];
  box: Box | null;
  page: number | null;
  /** Weakest supporting span, never the mean — see `weakest`. */
  confidence: number;
  grounded: boolean;
  /** Set when the value is a real reading but its meaning is not settled. */
  note?: string;
};

export type PreviewFields = Partial<Record<FieldPath, PreviewField>>;

const ABSENT: PreviewField = {
  value: null, normalisedValue: null, spanIds: [], box: null,
  page: null, confidence: 0, grounded: false,
};

/* ── Small helpers, kept local because this package depends on nothing ────── */

function weakest(spans: Span[]): number {
  return spans.length === 0 ? 0 : Math.min(...spans.map((s) => s.provenance.confidence));
}

function unionBox(spans: Span[]): Box | null {
  const boxes = spans.map((s) => s.box).filter(Boolean) as Box[];
  if (boxes.length === 0) return null;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x, y, width: right - x, height: bottom - y };
}

type PositionedLine = { line: Line; page: number; text: string };

function linesOf(doc: Document): PositionedLine[] {
  const out: PositionedLine[] = [];
  for (const block of [...doc.blocks].sort((a, b) => a.page - b.page || a.order - b.order)) {
    for (const line of [...block.lines].sort((l, r) => l.order - r.order)) {
      out.push({
        line,
        page: block.page,
        text: line.spans.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim(),
      });
    }
  }
  return out;
}

function field(spans: Span[], page: number, value: string, normalised?: string | null): PreviewField {
  return {
    value,
    normalisedValue: normalised === undefined ? value : normalised,
    spanIds: spans.map((s) => s.id),
    box: unionBox(spans),
    page,
    confidence: weakest(spans),
    grounded: true,
  };
}

/* ── Money ───────────────────────────────────────────────────────────────── */

// Australian money as a docket prints it. Thousands separators optional,
// cents optional (a till may print `$8` or `$8.00`), currency symbol optional.
const MONEY = /^\$?\s?-?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?$|^\$?\s?-?\d+(?:\.\d{1,2})?$/;

/**
 * How far apart two spans may sit and still be one printed figure.
 *
 * `$ 1 , 042.60` is four boxes separated by hairlines. A docket's payment line
 * is `VISA ****4417` on the left and the amount RIGHT-ALIGNED far away, and
 * without this rule the two fuse: the first measured run of this structurer
 * read `VISA ****4417   23.00` as `441723.00`, and did the same on every
 * document carrying a card number — 81.8% of tier S totals wrong-when-shown,
 * for this one reason.
 *
 * Expressed as a multiple of the span's own height, because that tracks type
 * size: a gap wider than roughly one character is a different column.
 */
const MAX_GAP_RATIO = 1.2;

function adjacent(a: Span, b: Span): boolean {
  if (!a.box || !b.box) return false;
  const gap = b.box.x - (a.box.x + a.box.width);
  return gap <= MAX_GAP_RATIO * Math.max(a.box.height, b.box.height);
}

/** Contiguous span runs on a line whose joined text reads as one money amount. */
function moneyRuns(line: Line): Array<{ spans: Span[]; text: string }> {
  const out: Array<{ spans: Span[]; text: string }> = [];
  const spans = line.spans;
  // Longest run first, so `$ 1 , 042.60` is preferred over the bare `042.60`
  // that sits inside it — a partial match on a split figure is the classic way
  // to read a total as a hundredth of itself.
  for (let len = Math.min(6, spans.length); len >= 1; len -= 1) {
    for (let i = 0; i + len <= spans.length; i += 1) {
      const run = spans.slice(i, i + len);
      // Typographically one figure, not merely consecutive in the span list.
      let contiguous = true;
      for (let k = 1; k < run.length; k += 1) {
        if (!adjacent(run[k - 1] as Span, run[k] as Span)) { contiguous = false; break; }
      }
      if (!contiguous) continue;

      const joined = run.map((s) => s.text).join('').replace(/\s+/g, '');
      if (MONEY.test(joined) && /\d/.test(joined)) {
        if (out.some((o) => o.spans.some((s) => run.includes(s)))) continue;
        out.push({ spans: run, text: joined.replace(/^\$\s?/, '') });
      }
    }
  }

  // Which of several money-shaped things on one line is the AMOUNT.
  //
  // Two signals, both from how a docket is typeset. It prints cents, and it
  // right-aligns the amount column. `VISA ****4417   23.00` offers `4417` and
  // `23.00`; the second has a decimal and sits further right, and it is the one
  // the customer paid. Without this the adjacency rule above stops the two
  // FUSING and then picks the card number on its own, which is not an
  // improvement.
  return out.sort((a, b) => {
    const cents = (r: typeof a) => (/\.\d{2}$/.test(r.text) ? 1 : 0);
    if (cents(b) !== cents(a)) return cents(b) - cents(a);
    const right = (r: typeof a) => {
      const last = r.spans[r.spans.length - 1];
      return last?.box ? last.box.x + last.box.width : 0;
    };
    return right(b) - right(a);
  });
}

/* ── Field rules (docs/ON-DEVICE.md §3.4) ────────────────────────────────── */

// The authority: a line that says what the sale came to.
const TOTAL_WORDS = /\b(TOTAL|AMOUNT\s*DUE|BALANCE\s*DUE|TO\s*PAY)\b/i;
// A weaker signal. The payment line usually REPEATS the total, but on a cash
// sale it shows what was HANDED OVER: `CASH 10.00` against a total of 8.50 is
// the tendered amount, and reporting it overstates the expense by the change.
// Consulted only when no explicit total line carries money.
const PAYMENT_WORDS = /\b(EFTPOS|VISA|MASTERCARD|AMEX|CASH|CREDIT|DEBIT)\b/i;
// Excluded on purpose: each of these sits on a line that also carries money,
// and picking one would produce a confidently wrong total.
const NOT_TOTAL = /\b(SUB\s*-?\s*TOTAL|GST|TAX|CHANGE|SAVINGS|DISCOUNT|TENDERED|ROUNDING)\b/i;
const GST_WORDS = /\b(GST|TAX)\b/i;
const TAX_INVOICE = /TAX\s*INVOICE/i;

function payableAmount(lines: PositionedLine[]): PreviewField {
  const collect = (pattern: RegExp) => {
    const found: Array<{ spans: Span[]; text: string; page: number; y: number }> = [];
    for (const { line, page, text } of lines) {
      if (!pattern.test(text) || NOT_TOTAL.test(text)) continue;
      // Best run on this line only — moneyRuns sorts by how much each looks
      // like an amount rather than merely like a number.
      const best = moneyRuns(line)[0];
      if (best) found.push({ ...best, page, y: line.box?.y ?? 0 });
    }
    return found;
  };
  // An explicit total wins outright. The payment line is consulted only when
  // there is no total line carrying money at all.
  const candidates = collect(TOTAL_WORDS).length > 0
    ? collect(TOTAL_WORDS)
    : collect(PAYMENT_WORDS);
  // No "largest number on the page" fallback. §3.4 is explicit that this
  // abstains when no keyword line carries an amount, because the largest
  // number on a docket is frequently a phone number or an item code.
  if (candidates.length === 0) return ABSENT;
  // Ties go to the LOWEST line: a docket prints subtotal, then GST, then the
  // total, and the payment line beneath repeats it.
  candidates.sort((a, b) => b.y - a.y);
  const best = candidates[0] as (typeof candidates)[number];
  return field(best.spans, best.page, best.text);
}

function taxAmount(lines: PositionedLine[]): PreviewField {
  for (const { line, page, text } of lines) {
    // "TAX INVOICE" is not a GST line, and matching it would read the invoice
    // number as the tax.
    if (!GST_WORDS.test(text) || TAX_INVOICE.test(text)) continue;
    const runs = moneyRuns(line);
    if (runs.length > 0) {
      const run = runs[0] as (typeof runs)[number];
      return field(run.spans, page, run.text);
    }
  }
  // NEVER computed as one eleventh. §3.4: the preview may not produce a figure
  // the paper does not carry, and on a mixed GST-free docket the arithmetic is
  // wrong exactly where nobody would notice.
  return ABSENT;
}

/** Eleven digits that pass the ATO's mod-89 checksum. */
export function abnIsValid(digits: string): boolean {
  if (!/^\d{11}$/.test(digits)) return false;
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const sum = digits
    .split('')
    .map(Number)
    .reduce((acc, n, i) => acc + (i === 0 ? n - 1 : n) * (weights[i] as number), 0);
  return sum % 89 === 0;
}

function supplierAbn(lines: PositionedLine[]): PreviewField {
  const scan = (only: boolean): PreviewField | null => {
    for (const { line, page, text } of lines) {
      if (only && !/\bABN\b/i.test(text)) continue;
      for (let len = 1; len <= Math.min(6, line.spans.length); len += 1) {
        for (let i = 0; i + len <= line.spans.length; i += 1) {
          const run = line.spans.slice(i, i + len);
          const digits = run.map((s) => s.text).join('').replace(/\D/g, '');
          // Mod-89 is what makes a hallucinated ABN UNREPRESENTABLE here: a
          // wrong eleven digits almost never passes, so the rule is not a
          // filter on top of a guess — it is the reason there is no guess.
          if (abnIsValid(digits)) return field(run, page, digits);
        }
      }
    }
    return null;
  };
  // Prefer a labelled line; fall back to anywhere, because plenty of dockets
  // print the number without the letters.
  return scan(true) ?? scan(false) ?? ABSENT;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Day-first Australian dates to ISO. `null` when it is not one.
 *
 * Day-first ONLY. A document printing `08/14/2026` is American, and guessing
 * would re-introduce the month/day ambiguity `validators.ts` exists to catch.
 */
export function toIsoDate(raw: string | null): string | null {
  if (!raw) return null;
  const text = raw.replace(/\s+/g, '').toLowerCase();
  const build = (y: number, m: number, d: number): string | null => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const probe = new Date(Date.UTC(y, m - 1, d));
    if (probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };
  const yearOf = (y: string): number => (y.length === 2 ? 2000 + Number(y) : Number(y));

  const numeric = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(text);
  if (numeric) return build(yearOf(numeric[3] as string), Number(numeric[2]), Number(numeric[1]));

  const named = /^(\d{1,2})([a-z]{3,})(\d{2}|\d{4})$/.exec(text);
  if (named) {
    const m = MONTHS.indexOf((named[2] as string).slice(0, 3)) + 1;
    return m === 0 ? null : build(yearOf(named[3] as string), m, Number(named[1]));
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return null;
}

/** How far outside today a printed date may sit before it is not this document's. */
const MAX_YEARS_PAST = 7;
const MAX_DAYS_FUTURE = 2;

function issueDate(lines: PositionedLine[], now: Date): PreviewField {
  for (const { line, page } of lines) {
    for (let len = 1; len <= Math.min(5, line.spans.length); len += 1) {
      for (let i = 0; i + len <= line.spans.length; i += 1) {
        const run = line.spans.slice(i, i + len);
        const joined = run.map((s) => s.text).join(' ').trim();
        const iso = toIsoDate(joined);
        if (!iso) continue;

        // The plausibility window `validators.ts` already applies. A receipt
        // dated 2006 is a misread century, not a seven-year-old expense claim.
        const parsed = new Date(`${iso}T00:00:00Z`);
        const ageDays = (now.getTime() - parsed.getTime()) / 86_400_000;
        if (ageDays < -MAX_DAYS_FUTURE || ageDays > MAX_YEARS_PAST * 365.25) continue;

        const out = field(run, page, joined, iso);
        // Ambiguity is FLAGGED, never resolved. `06/09/26` is a different BAS
        // quarter depending on which half is the month, and picking one
        // silently is how a return goes in wrong.
        const numeric = /^(\d{1,2})[\s/.-]+(\d{1,2})[\s/.-]+(\d{2,4})$/.exec(joined.replace(/\s+/g, ''));
        if (numeric && Number(numeric[1]) <= 12 && Number(numeric[2]) <= 12) {
          out.note = 'day and month are both plausible — confirm before this decides a BAS quarter';
        }
        return out;
      }
    }
  }
  return ABSENT;
}

function saysTaxInvoice(lines: PositionedLine[]): PreviewField {
  for (const { line, page, text } of lines) {
    if (!TAX_INVOICE.test(text)) continue;
    return field(line.spans, page, 'true', 'true');
  }
  // false is a REAL answer here, not an abstention: the words are either on the
  // document or they are not, and a receipt without them is a receipt.
  return { ...ABSENT, value: 'false', normalisedValue: 'false' };
}

const ADDRESSY = /\b(ST|STREET|RD|ROAD|HWY|HIGHWAY|AVE|AVENUE|PO\s*BOX|NSW|VIC|QLD|WA|SA|TAS|NT|ACT)\b|\d{4}$/i;
const CONTACTY = /\b(PH|PHONE|FAX|EMAIL|WWW|HTTP|ABN|ACN)\b|@|\.com|\.au/i;

function supplier(lines: PositionedLine[]): PreviewField {
  const withHeight = lines
    .map((l) => ({ ...l, height: l.line.box?.height ?? 0 }))
    .filter((l) => l.text.length >= 3);
  if (withHeight.length === 0) return ABSENT;

  // Top of the CONTENT, not the top of the coordinate space.
  //
  // This measured `y <= maxY * 0.2`, which assumes the paper starts at y = 0.
  // A photographed docket starts wherever it sits in frame, so on a short
  // receipt the header fell outside the window, the filter emptied, the code
  // fell back to every line — and the tallest line on a docket is the TOTAL.
  // Every short receipt in the corpus reported its supplier as `TOTAL $ 23.00`.
  const ys = withHeight.map((l) => l.line.box?.y ?? 0);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const cutoff = minY + Math.max(1, (maxY - minY) * 0.25);
  const top = withHeight.filter((l) => (l.line.box?.y ?? 0) <= cutoff);
  const pool = top.length > 0 ? top : withHeight;

  const named = pool
    .filter((l) => !ADDRESSY.test(l.text) && !CONTACTY.test(l.text))
    // Not mostly digits — that is a receipt number, not a business.
    .filter((l) => (l.text.replace(/\D/g, '').length / l.text.length) < 0.4)
    // And not a totals line that happens to be set large.
    .filter((l) => !TOTAL_WORDS.test(l.text) && !PAYMENT_WORDS.test(l.text) && !GST_WORDS.test(l.text))
    .sort((a, b) => b.height - a.height);

  const best = named[0];
  if (!best) return ABSENT;
  return field(best.line.spans, best.page, best.text);
}

/* ── Entry point ─────────────────────────────────────────────────────────── */

/**
 * Structure a read document into header fields.
 *
 * `now` is injected so the date window is testable and does not change
 * behaviour on the first of the month — the same rule the analytics suite
 * follows.
 */
export function structure(doc: Document, now: Date = new Date()): PreviewFields {
  const lines = linesOf(doc);
  return {
    'header.supplier': supplier(lines),
    'header.supplier_abn': supplierAbn(lines),
    'header.issue_date': issueDate(lines, now),
    'header.payable_amount': payableAmount(lines),
    'header.tax_amount': taxAmount(lines),
    'header.says_tax_invoice': saysTaxInvoice(lines),
  };
}
