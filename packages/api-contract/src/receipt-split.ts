/**
 * Splitting one receipt between categories: some lines filed on their own (a work item on a
 * supermarket docket), the rest under the receipt's category. Shared by the server (the
 * deduction totals that go to Free Tax Returns) and both review screens (the running "marked
 * for work" total), so the figure a person sees is the figure that is sent. docs/DEDUCTIONS.md
 * has the model.
 *
 * The rule, in whole cents and integer arithmetic only:
 *
 * 1. What each line cost, GST included. `document_lines.line_net_amount` holds the amount AS
 *    PRINTED (the extractor's instruction; the column name is Peppol's). A retail docket prints
 *    lines with GST in them; a commercial tax invoice can print them before GST. The lines are
 *    read as printed before GST only when the receipt states its GST and the lines add up to
 *    the total less that GST more closely than to the total itself (the validators' own test,
 *    `linesGap`). Then each standard-rated line gets its share of the printed GST, in
 *    proportion to its amount, when the lines and the GST add up to the total (within 5c);
 *    otherwise 10% of its amount. GST-free lines (`gst_category_code` Z, E or O) get none.
 *    Otherwise every line is taken as printed.
 * 2. Lines filed in the same category are added together. A category whose lines add up to
 *    zero or less (a discount line filed on its own) is not split off: those lines stay with
 *    the rest of the receipt.
 * 3. The rest of the receipt is the total (`payable_amount`, what was paid) less the lines
 *    split off. When the split-off lines add up to more than the total (a misread line, or a
 *    discount printed only on the total), they are scaled down in proportion so that together
 *    they are exactly the total and the rest is nothing.
 * 4. To cents: the total is rounded half up to the cent, and the parts (the split-off
 *    categories and the rest) are rounded with the largest-remainder method so they add up to
 *    that total exactly. Ties go to the earlier part.
 *
 * Never floats. Amounts arrive as decimal strings (4 dp in the database) and are worked in
 * 1/10 000ths of a dollar.
 */

/** One receipt line, as stored. */
export interface SplitLineInput {
  lineNumber: number;
  /** The amount as printed (`line_net_amount`); null lines are left out. */
  amount: string | null;
  /** True for a GST-free line (Z, or E/O: no GST in it). */
  gstFree: boolean;
  /** The category this line is filed in on its own, or null (it goes with the receipt). */
  categoryId: string | null;
}

export interface SplitInput {
  /** What was paid, GST included (`payable_amount`). Null or zero: nothing to split. */
  payable: string | null;
  /** The GST the receipt states (`tax_amount`), or null. */
  taxAmount: string | null;
  /** The receipt's own category, which takes the rest. */
  categoryId: string | null;
  lines: readonly SplitLineInput[];
}

export interface SplitPart {
  /** The category, or null for the rest of a receipt that has no category (counted nowhere). */
  categoryId: string | null;
  /** GST included, whole cents. */
  cents: bigint;
  /** The lines filed in this category on their own (empty for the rest alone). */
  lineNumbers: number[];
  /** True when this part holds the rest of the receipt (the total less the lines split off). */
  rest: boolean;
}

export interface ReceiptSplit {
  /** How the lines were printed: with GST in them, or before GST. */
  linesPrinted: 'inclusive' | 'exclusive';
  /** Each line's own cost, GST included, rounded half up to the cent (for showing next to it). */
  lines: Array<{ lineNumber: number; paidCents: bigint }>;
  /**
   * The receipt in parts: one per category lines are filed in (in the order they first
   * appear), then the rest (left out when it is nothing). Adds up to `totalCents` exactly.
   */
  parts: SplitPart[];
  /** The receipt's total, rounded half up to the cent; 0 when it has none. */
  totalCents: bigint;
  /** Lines filed on their own that were not split off (their category added up to 0 or less). */
  ignoredLineNumbers: number[];
  /** True when the split-off lines added up to more than the total and were scaled down to it. */
  capped: boolean;
}

const SCALE = 10_000n;
const CENT = 100n;
/** Within this, lines printed before GST plus the printed GST are taken to be the total (cash rounding is 2c). */
const RECONCILE = 500n;
/** Australian GST on a standard-rated line printed before GST. */
const GST_NUM = 1n;
const GST_DEN = 10n;

export function toUnits(value: string): bigint {
  // Trimmed first: whitespace in the pattern around the optional parts is polynomial (CodeQL).
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(value.trim());
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) throw new Error(`not a decimal amount: ${JSON.stringify(value)}`);
  const frac = (m[3] ?? '').padEnd(4, '0');
  // Beyond 4 dp (the database's scale) is rounded half away from zero, never truncated.
  let units = BigInt(m[2] || '0') * SCALE + BigInt(frac.slice(0, 4));
  if (frac.length > 4 && Number(frac[4]) >= 5) units += 1n;
  return m[1] === '-' ? -units : units;
}

const floorDiv = (a: bigint, b: bigint): bigint => {
  const q = a / b;
  return (a % b !== 0n) && ((a < 0n) !== (b < 0n)) ? q - 1n : q;
};

/** Half away from zero, `a / b`, b > 0. */
const roundDiv = (a: bigint, b: bigint): bigint => (a < 0n ? -((-a * 2n + b) / (2n * b)) : (a * 2n + b) / (2n * b));

/**
 * `total` shared in proportion to `weights` (their sum must be positive), largest remainder,
 * ties to the earlier weight. The shares add up to `total` exactly.
 */
export function allocate(total: bigint, weights: readonly bigint[]): bigint[] {
  const sum = weights.reduce((a, w) => a + w, 0n);
  if (sum <= 0n) throw new Error('allocate: the weights must add up to more than zero');
  const shares = weights.map((w) => floorDiv(total * w, sum));
  const rems = weights.map((w, i) => total * w - shares[i]! * sum);
  let left = total - shares.reduce((a, s) => a + s, 0n);
  const order = rems.map((r, i) => ({ r, i })).sort((a, b) => (b.r > a.r ? 1 : b.r < a.r ? -1 : a.i - b.i));
  for (const { i } of order) {
    if (left <= 0n) break;
    shares[i]! += 1n;
    left -= 1n;
  }
  return shares;
}

/** Parts in 1/10 000ths that add up to `units`, to whole cents that add up to `units` rounded half up. */
function toCents(parts: readonly bigint[], units: bigint): bigint[] {
  const target = floorDiv(units + CENT / 2n, CENT);
  const cents = parts.map((p) => floorDiv(p, CENT));
  const rems = parts.map((p, i) => p - cents[i]! * CENT);
  let left = target - cents.reduce((a, c) => a + c, 0n);
  const order = rems.map((r, i) => ({ r, i })).sort((a, b) => (b.r > a.r ? 1 : b.r < a.r ? -1 : a.i - b.i));
  for (const { i } of order) {
    if (left <= 0n) break;
    cents[i]! += 1n;
    left -= 1n;
  }
  return cents;
}

/** Each usable line's cost with GST in it, in 1/10 000ths. */
function grossUnits(input: SplitInput, payableUnits: bigint): { exclusive: boolean; gross: Map<number, bigint> } {
  const lines = input.lines.filter((l) => l.amount != null);
  const amounts = new Map(lines.map((l) => [l.lineNumber, toUnits(l.amount!)]));
  const sum = [...amounts.values()].reduce((a, v) => a + v, 0n);
  const tax = input.taxAmount != null && input.taxAmount.trim() !== '' ? toUnits(input.taxAmount) : 0n;
  const abs = (v: bigint) => (v < 0n ? -v : v);
  const exclusive = lines.length > 0 && tax > 0n && abs(payableUnits - tax - sum) < abs(payableUnits - sum);
  if (!exclusive) return { exclusive, gross: amounts };

  const standard = lines.filter((l) => !l.gstFree);
  const standardNet = standard.reduce((a, l) => a + amounts.get(l.lineNumber)!, 0n);
  const gross = new Map(amounts);
  if (standard.length > 0 && standardNet > 0n && abs(payableUnits - tax - sum) <= RECONCILE) {
    // The printed GST is the fact; shared over the standard-rated lines by their amount.
    const shares = allocate(tax, standard.map((l) => amounts.get(l.lineNumber)!));
    standard.forEach((l, i) => gross.set(l.lineNumber, amounts.get(l.lineNumber)! + shares[i]!));
  } else {
    for (const l of standard) {
      const net = amounts.get(l.lineNumber)!;
      gross.set(l.lineNumber, net + roundDiv(net * GST_NUM, GST_DEN));
    }
  }
  return { exclusive, gross };
}

/** The receipt in parts: see the module comment for the rule. */
export function splitReceipt(input: SplitInput): ReceiptSplit {
  const payableUnits = input.payable != null && input.payable.trim() !== '' ? toUnits(input.payable) : 0n;
  const { exclusive, gross } = grossUnits(input, payableUnits);
  const lines = input.lines
    .filter((l) => gross.has(l.lineNumber))
    .map((l) => ({ lineNumber: l.lineNumber, paidCents: roundDiv(gross.get(l.lineNumber)!, CENT) }));
  const base = { linesPrinted: exclusive ? ('exclusive' as const) : ('inclusive' as const), lines };

  // Lines filed on their own, by category, in the order the categories first appear.
  const byCategory = new Map<string, { units: bigint; lineNumbers: number[] }>();
  for (const l of input.lines) {
    if (!l.categoryId || !gross.has(l.lineNumber)) continue;
    const e = byCategory.get(l.categoryId) ?? { units: 0n, lineNumbers: [] };
    e.units += gross.get(l.lineNumber)!;
    e.lineNumbers.push(l.lineNumber);
    byCategory.set(l.categoryId, e);
  }
  const ignoredLineNumbers: number[] = [];
  const split: Array<{ categoryId: string; units: bigint; lineNumbers: number[] }> = [];
  for (const [categoryId, e] of byCategory) {
    if (e.units > 0n) split.push({ categoryId, ...e });
    else ignoredLineNumbers.push(...e.lineNumbers);
  }
  ignoredLineNumbers.sort((a, b) => a - b);

  if (payableUnits <= 0n) {
    return { ...base, parts: [], totalCents: 0n, ignoredLineNumbers, capped: false };
  }

  let splitTotal = split.reduce((a, s) => a + s.units, 0n);
  const capped = splitTotal > payableUnits;
  if (capped) {
    const scaled = allocate(payableUnits, split.map((s) => s.units));
    split.forEach((s, i) => (s.units = scaled[i]!));
    splitTotal = payableUnits;
  }
  const restUnits = payableUnits - splitTotal;

  // The rest is always its own part, last, even when a line is filed in the receipt's own
  // category: the screens show the two apart, and the server adds them up by category.
  const units: bigint[] = [...split.map((s) => s.units), restUnits];
  const parts: SplitPart[] = [
    ...split.map((s) => ({ categoryId: s.categoryId as string | null, cents: 0n, lineNumbers: s.lineNumbers, rest: false })),
    { categoryId: input.categoryId, cents: 0n, lineNumbers: [], rest: true },
  ];
  const cents = toCents(units, payableUnits);
  parts.forEach((p, i) => (p.cents = cents[i]!));
  return {
    ...base,
    parts: parts.filter((p) => !p.rest || p.cents !== 0n),
    totalCents: floorDiv(payableUnits + CENT / 2n, CENT),
    ignoredLineNumbers,
    capped,
  };
}

/** The cents of the lines filed in categories of their own (the rest of the receipt left out). */
export function splitLinesCents(split: ReceiptSplit): bigint {
  return split.parts.filter((p) => !p.rest).reduce((a, p) => a + p.cents, 0n);
}

/** The cents of the rest of the receipt (the total less the lines split off). */
export function splitRestCents(split: ReceiptSplit): bigint {
  return split.parts.filter((p) => p.rest).reduce((a, p) => a + p.cents, 0n);
}

/** Whole cents as Australian dollars, like `$1,234.50` or `-$5.00`. */
export function formatAud(cents: bigint): string {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const dollars = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}$${dollars}.${(abs % 100n).toString().padStart(2, '0')}`;
}
