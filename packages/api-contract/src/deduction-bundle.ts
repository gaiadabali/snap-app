/**
 * Deduction bundle v1: the file SnapApp exports for one Australian financial
 * year and Free Tax Returns (FTR) imports into its worksheet.
 *
 * Format only. No route, no export job, no UI: later tickets build those.
 *
 * DUPLICATED ON PURPOSE, like `money.ts`. FTR validates the same shape with a
 * zod schema (`src/lib/import/deduction-bundle.ts` in the FTR repo). This
 * package carries no runtime dependencies and the mobile app may import it, so
 * the validator below is hand-written. What keeps the two honest:
 *   - `deduction-bundle-spec.ts` (constants, item catalogue, regexes) is
 *     byte-identical in both repos;
 *   - `fixtures/deduction-bundle-v1/` is byte-identical in both repos, with a
 *     manifest whose hash each repo's test pins;
 *   - both validators must report the same issue paths on every fixture.
 *
 * Spec: `../README.md`.
 */

import {
  AMOUNT_PATTERN,
  APP_VERSION_PATTERN,
  ATO_LABELS,
  BUNDLE_SCHEMA_VERSION,
  DESCRIPTION_PATTERN,
  ITEM_IDS,
  MAX_APP_VERSION_LENGTH,
  MAX_BUNDLE_BYTES,
  MAX_LINES,
  MAX_RECEIPT_COUNT,
  MAX_RECEIPT_REFS_PER_LINE,
  MAX_WORK_KILOMETRES,
  OCCUPATION_IDS,
  RECEIPT_REF_PATTERN,
  isFinancialYear,
  isUtcTimestamp,
  type AtoLabel,
  type OccupationId,
} from './deduction-bundle-spec';

export * from './deduction-bundle-spec';

/** One deduction line. `itemId` is checked against the catalogue of its own `label`. */
export type DeductionLine = {
  [L in AtoLabel]: {
    label: L;
    /** FTR worksheet item id for this label (see `ITEM_IDS`). */
    itemId: (typeof ITEM_IDS)[L][number];
    /** Item-level text, 1 to 200 characters, no control characters. Never a merchant or person. */
    description: string;
    /** Full outlay, AUD decimal string, positive, two decimals. Before any private-use apportionment. */
    amount: string;
    /** True when `amount` includes GST. */
    gstInclusive: boolean;
    /** Private share of the outlay, whole percent 1 to 99. Omitted when none. */
    privateUsePercent?: number;
    /** Receipts behind this line; never below `receiptRefs.length`. */
    receiptCount: number;
    /** SHA-256 (lowercase hex) of each receipt's original file bytes. At most 20; may be a subset of `receiptCount`. */
    receiptRefs: string[];
  };
}[AtoLabel];

export interface DeductionBundle {
  schemaVersion: typeof BUNDLE_SCHEMA_VERSION;
  /** `2025-26` is 1 July 2025 to 30 June 2026. */
  financialYear: string;
  /** UTC instant, `YYYY-MM-DDTHH:mm:ss[.sss]Z`. */
  generatedAt: string;
  source: { app: 'snapapp'; appVersion: string };
  /** One of FTR's worksheet profile ids except 'sole' (OCCUPATION_IDS). */
  occupation?: OccupationId;
  /** Business kilometres for the cents-per-km method (FTR caps the claim). Whole km. */
  workKilometres?: number;
  lines: DeductionLine[];
}

export interface BundleIssue {
  /** Dotted path to the offending value, `''` for the root. */
  path: string;
  message: string;
}
export type BundleResult = { ok: true; bundle: DeductionBundle } | { ok: false; errors: BundleIssue[] };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const has = (o: Obj, k: string): boolean => o[k] !== undefined;

/** 'type' for a non-number, 'range' for a non-integer or out-of-range number, null when fine. */
function intProblem(v: unknown, min: number, max: number): 'type' | 'range' | null {
  if (typeof v !== 'number') return 'type';
  return Number.isSafeInteger(v) && v >= min && v <= max ? null : 'range';
}

/** UTF-8 byte length without `TextEncoder` (this package's `lib` has no DOM). */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * `fatal` marks a wrong type, an unknown value or an unknown key. A failed
 * format, length or range check is not fatal. The cross-field rule below only
 * runs while every issue so far is non-fatal, which is what zod does with the
 * same rule in FTR, so both validators report the same paths.
 */
type Add = (path: string, message: string, fatal?: boolean) => void;

function checkLine(line: unknown, at: string, add: Add): void {
  if (!isObj(line)) return add(at, 'expected an object', true);
  const label = line.label;
  if (typeof label !== 'string' || !(ATO_LABELS as readonly string[]).includes(label)) {
    return add(`${at}.label`, 'unknown ATO label', true);
  }
  const itemIds = ITEM_IDS[label as AtoLabel] as readonly string[];
  if (typeof line.itemId !== 'string' || !itemIds.includes(line.itemId)) {
    add(`${at}.itemId`, `not an FTR item id for ${label}`, true);
  }
  if (typeof line.description !== 'string') add(`${at}.description`, 'expected a string', true);
  else if (!DESCRIPTION_PATTERN.test(line.description)) {
    add(`${at}.description`, 'expected 1 to 200 characters without control characters');
  }
  if (typeof line.amount !== 'string') add(`${at}.amount`, 'expected a string', true);
  else if (!AMOUNT_PATTERN.test(line.amount)) add(`${at}.amount`, 'expected a positive decimal string with two decimals');
  if (typeof line.gstInclusive !== 'boolean') add(`${at}.gstInclusive`, 'expected a boolean', true);
  if (has(line, 'privateUsePercent')) {
    const p = intProblem(line.privateUsePercent, 1, 99);
    if (p) add(`${at}.privateUsePercent`, 'expected a whole percent from 1 to 99', p === 'type');
  }
  const rc = intProblem(line.receiptCount, 0, MAX_RECEIPT_COUNT);
  if (rc) add(`${at}.receiptCount`, `expected a whole number from 0 to ${MAX_RECEIPT_COUNT}`, rc === 'type');
  const refs = line.receiptRefs;
  if (!Array.isArray(refs)) add(`${at}.receiptRefs`, 'expected an array', true);
  else {
    refs.forEach((r, i) => {
      if (typeof r !== 'string') add(`${at}.receiptRefs.${i}`, 'expected a string', true);
      else if (!RECEIPT_REF_PATTERN.test(r)) add(`${at}.receiptRefs.${i}`, 'expected a lowercase hex SHA-256');
    });
    if (refs.length > MAX_RECEIPT_REFS_PER_LINE) add(`${at}.receiptRefs`, `at most ${MAX_RECEIPT_REFS_PER_LINE} references`);
  }
  const allowed = ['label', 'itemId', 'description', 'amount', 'gstInclusive', 'privateUsePercent', 'receiptCount', 'receiptRefs'];
  const extra = Object.keys(line).filter((k) => !allowed.includes(k));
  if (extra.length) add(at, `unrecognized keys: ${extra.join(', ')}`, true);
}

/** Validate a parsed value. Same result shape as FTR's validator. */
export function validateDeductionBundle(value: unknown): BundleResult {
  const errors: BundleIssue[] = [];
  let fatal = false;
  const add: Add = (path, message, isFatal = false) => {
    errors.push({ path, message });
    if (isFatal) fatal = true;
  };
  if (!isObj(value)) return { ok: false, errors: [{ path: '', message: 'expected an object' }] };

  if (value.schemaVersion !== BUNDLE_SCHEMA_VERSION) add('schemaVersion', `expected ${BUNDLE_SCHEMA_VERSION}`, true);
  if (typeof value.financialYear !== 'string') add('financialYear', 'expected a string', true);
  else if (!isFinancialYear(value.financialYear)) {
    add('financialYear', 'expected YYYY-YY with the second part the year after the first, e.g. 2025-26');
  }
  if (typeof value.generatedAt !== 'string') add('generatedAt', 'expected a string', true);
  else if (!isUtcTimestamp(value.generatedAt)) add('generatedAt', 'expected a UTC timestamp ending in Z');

  const source = value.source;
  if (!isObj(source)) add('source', 'expected an object', true);
  else {
    if (source.app !== 'snapapp') add('source.app', "expected 'snapapp'", true);
    const v = source.appVersion;
    if (typeof v !== 'string') add('source.appVersion', 'expected a string', true);
    else {
      if (v.length > MAX_APP_VERSION_LENGTH) add('source.appVersion', `at most ${MAX_APP_VERSION_LENGTH} characters`);
      if (!APP_VERSION_PATTERN.test(v)) add('source.appVersion', 'expected a semantic version');
    }
    const extra = Object.keys(source).filter((k) => k !== 'app' && k !== 'appVersion');
    if (extra.length) add('source', `unrecognized keys: ${extra.join(', ')}`, true);
  }

  if (has(value, 'occupation') && !(OCCUPATION_IDS as readonly unknown[]).includes(value.occupation)) {
    add('occupation', 'not an accepted FTR occupation id (the 19 profiles minus sole)', true);
  }
  if (has(value, 'workKilometres')) {
    const p = intProblem(value.workKilometres, 0, MAX_WORK_KILOMETRES);
    if (p) add('workKilometres', `expected a whole number from 0 to ${MAX_WORK_KILOMETRES}`, p === 'type');
  }

  const lines = value.lines;
  if (!Array.isArray(lines)) add('lines', 'expected an array', true);
  else {
    lines.forEach((l, i) => checkLine(l, `lines.${i}`, add));
    if (lines.length > MAX_LINES) add('lines', `at most ${MAX_LINES} lines`);
  }

  const allowed = ['schemaVersion', 'financialYear', 'generatedAt', 'source', 'occupation', 'workKilometres', 'lines'];
  const extra = Object.keys(value).filter((k) => !allowed.includes(k));
  if (extra.length) add('', `unrecognized keys: ${extra.join(', ')}`, true);

  // Cross-field rule: a line cannot cite more receipts than it counts.
  if (!fatal) {
    (lines as { receiptRefs: unknown[]; receiptCount: number }[]).forEach((l, i) => {
      if (l.receiptRefs.length > l.receiptCount) add(`lines.${i}.receiptCount`, 'receiptCount is below the number of receiptRefs');
    });
  }

  return errors.length ? { ok: false, errors } : { ok: true, bundle: value as unknown as DeductionBundle };
}

/** Enforce the byte ceiling, parse, then validate. Run this on the raw upload text. */
export function validateDeductionBundleJson(text: string): BundleResult {
  if (utf8ByteLength(text) > MAX_BUNDLE_BYTES) {
    return { ok: false, errors: [{ path: '', message: `bundle exceeds ${MAX_BUNDLE_BYTES} bytes` }] };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, errors: [{ path: '', message: 'not valid JSON' }] };
  }
  return validateDeductionBundle(value);
}
