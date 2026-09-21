import { createHash } from 'node:crypto';

import type { TaxRules } from '@snap/tax-rules';

import type { GroundingRow } from '../repo.js';

import { TruncatedOutputError } from './provider.js';
import type { ExtractionProvider, PageImage, ProviderResult } from './provider.js';
import { maskCardLast4, type Extraction, type ValidatedExtraction } from './types.js';
import { linesGap, validate } from './validators.js';

/**
 * One extraction run, start to finish.
 *
 * A run is a stored, versioned, replayable function of the image: same bytes
 * plus same prompt plus same model gives the same document. That is what makes
 * "re-run everything through a better model in six months" a command rather
 * than a migration, and it is why the meta below records the model and prompt
 * version alongside the result.
 *
 * The order matters and is not negotiable. The provider reads; the validators
 * judge. A provider is never allowed to declare its own output acceptable.
 */

export type ExtractionRun = {
  /**
   * The identity of the input actually read.
   *
   * For one page, its own hash — unchanged from before pages existed. For
   * several, the SAME rule `captures.original_sha256` uses for a multi-page
   * capture (`docs/contracts/phase0-multipage.md` §2): SHA-256 of the
   * per-page hashes, concatenated as lowercase hex TEXT in page order. Kept
   * consistent with that rule on purpose — a re-run over "the same input" six
   * months from now means the same thing here as it does at capture time.
   */
  sha256: string;
  /** Total bytes across every page read, not just the first. */
  byteSize: number;
  result: ValidatedExtraction;
  meta: ProviderResult['meta'] & {
    /** Total including validation, which is microseconds but recorded anyway. */
    totalMs: number;
  };
};

/** Mirrors `captures.original_sha256`'s rule — see `ExtractionRun.sha256`. */
function multiPageHash(pages: readonly PageImage[]): string {
  const hashes = pages.map((p) => createHash('sha256').update(p.bytes).digest('hex'));
  if (hashes.length === 1) return hashes[0]!;
  return createHash('sha256').update(hashes.join(''), 'utf8').digest('hex');
}

export type RunFailure = {
  sha256: string;
  byteSize: number;
  /**
   * `truncated` is deliberately separate from `parse`.
   *
   * A cut-off response is also unparseable, so without this distinction the
   * router escalates to a stronger model — which hits the same output cap,
   * because the cap is ours. The caller uses this to stop instead.
   */
  stage: 'provider' | 'parse' | 'truncated';
  error: string;
  /** Present when the provider answered but the answer was unusable. */
  raw?: string;
  meta: { provider: string; model: string; totalMs: number };
};

/**
 * The extraction fields the grounding gate refuses to accept on confidence
 * alone, each with the `document_field_grounding.field_path` the shadow
 * stage stores its verdict under.
 *
 * This is the intersection of two lists the codebase already keeps —
 * `validators.ts`'s `CRITICAL_FIELDS` (what a wrong value costs money on) and
 * `shadow.ts`'s `fieldsToGround` (what OCR can actually check) — keyed by the
 * grounding paths because that is the report we read. The plan for this task
 * named `gstAmount` and `taxCode`; the codebase calls the money field
 * `taxAmount` and has no `taxCode` field at all (the GST is checked by
 * arithmetic in `validators.ts`, not by a code the model returns), so the
 * gate covers what actually exists.
 */
const CRITICAL_GROUNDING_FIELDS = [
  { fieldPath: 'header.payable_amount', fieldName: 'payableAmount' },
  { fieldPath: 'header.tax_amount', fieldName: 'taxAmount' },
  { fieldPath: 'header.supplier', fieldName: 'supplierName' },
  { fieldPath: 'header.supplier_abn', fieldName: 'supplierAbn' },
  { fieldPath: 'header.issue_date', fieldName: 'issueDate' },
] as const;

function extractionValueFor(result: ValidatedExtraction, fieldName: string): string | null {
  // The extraction union mixes shaped fields (which carry their own `value`)
  // with plain strings, so the probe has to handle both. Non-plain objects
  // without a `value` (Payment blocks, extracted lines) are not single
  // comparable values — their grounding rows are checked via `row.value`,
  // and `null` here simply never matches, which is the fail-closed answer.
  const value = (result.extraction as Record<string, unknown>)[fieldName];
  if (value == null) return null;
  if (typeof value === 'object' && 'value' in (value as Record<string, unknown>)) {
    const inner = (value as Record<string, unknown>).value;
    return inner == null ? null : String(inner);
  }
  return String(value);
}

/**
 * The slice of a stored grounding row the gate reads. Structural on purpose:
 * the worker passes `GroundingRow[]` straight off the query, and the tests
 * build minimal rows — neither needs the whole shape.
 */
export type GroundingEvidence =
  | Array<Pick<GroundingRow, 'fieldPath' | 'grounded' | 'value'>>
  | null
  | undefined;

/**
 * Applies the grounding gate to a validator's verdict.
 *
 * A model's confidence is the model grading its own homework; the grounding
 * report is an independent engine saying which fields the page actually
 * carries. Where the two disagree, the page wins: a critical field with no
 * supporting span is sent to review no matter what the model claimed, and a
 * capture with no report at all (legacy rows, or the shadow stage having
 * never run) is treated as ungrounded — fail-closed.
 *
 * A stored row also counts as ungrounded when its `value` differs from what
 * this run produced: the report was measured against a previous attempt's
 * output, and a verdict about someone else's total is not a verdict about
 * this one. Pure — the rows are READ here, never re-run, and nothing is
 * written; `shadow.ts` remains the only writer of the report.
 */
export function applyGroundingGate(
  result: ValidatedExtraction,
  grounding: GroundingEvidence,
): ValidatedExtraction {
  if (!grounding || grounding.length === 0) {
    // Fail-closed: no report is not a pass, it is an unknown.
    return {
      ...result,
      reviewStatus: 'needs_review',
      findings: [
        ...result.findings,
        {
          code: 'grounding_report_missing',
          severity: 'warning',
          field: 'payableAmount',
          message: 'No grounding report exists for this capture, so the model’s values cannot be checked against the page.',
          fix: 'Check the values against the image.',
        },
      ],
    };
  }

  const byField = new Map(grounding.map((row) => [row.fieldPath, row]));
  const findings = [...result.findings];
  for (const { fieldPath, fieldName } of CRITICAL_GROUNDING_FIELDS) {
    const row = byField.get(fieldPath);
    const expected = extractionValueFor(result, fieldName);
    const covered = !!row && row.grounded && row.value === (expected ?? '');
    if (!covered) {
      findings.push({
        code: 'ungrounded_field',
        severity: 'warning',
        field: fieldName,
        message:
          row == null || !row.grounded
            ? 'Nothing on the page supports this value; the model may have invented it.'
            : 'The grounding report was measured against a different value, so it does not cover this one.',
        fix: 'Check it against the image.',
      });
    }
  }

  // reviewStatus only moves one way: grounding can hold a document for
  // review, never release one the validators flagged.
  const reviewStatus =
    result.reviewStatus === 'needs_review' ? 'needs_review' : findings.length > result.findings.length ? 'needs_review' : result.reviewStatus;

  return { ...result, findings, reviewStatus };
}

export async function runExtraction(
  provider: ExtractionProvider,
  image: PageImage | PageImage[],
  now = new Date(),
  /**
   * The workspace's tax rule set, or null for Australia.
   *
   * Passed in rather than resolved here so this function stays PURE in the way
   * that matters: same image, same rules, same verdict. A replay against a
   * stored image has to be able to supply the rule set the original run used,
   * and a function that looked one up from the database could not be replayed
   * at all.
   */
  rules?: TaxRules | null,
  /**
   * The stored grounding report for this capture, if any.
   *
   * READ, never re-run — `shadow.ts` is the only writer, and this function
   * stays pure by taking the already-stored rows rather than querying. Null
   * or empty means no report exists, which the gate treats as ungrounded.
   */
  grounding?: GroundingEvidence,
): Promise<{ ok: true; run: ExtractionRun } | { ok: false; failure: RunFailure }> {
  const pages = Array.isArray(image) ? image : [image];
  const started = Date.now();
  // Hashed from the bytes actually read, not from what the client claimed. The
  // client's hash is advisory; this one is the record.
  const sha256 = multiPageHash(pages);
  const byteSize = pages.reduce((acc, p) => acc + p.bytes.byteLength, 0);

  let provided: ProviderResult;
  try {
    provided = await provider.extract(image);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      failure: {
        sha256,
        byteSize,
        // A parse error surfaces from the provider as well, because parsing
        // happens there; the distinction is kept because the two need
        // different responses — one is retried, the other is escalated.
        stage:
          error instanceof TruncatedOutputError
            ? 'truncated'
            : /JSON|json|parse/.test(message)
              ? 'parse'
              : 'provider',
        error: message,
        meta: {
          provider: provider.name,
          model: provider.model,
          totalMs: Date.now() - started,
        },
      },
    };
  }

  const result = applyGroundingGate(validate(provided.extraction, now, rules), grounding);

  return {
    ok: true,
    run: {
      sha256,
      byteSize,
      result,
      meta: { ...provided.meta, totalMs: Date.now() - started },
    },
  };
}

/**
 * The document a run produces, in the shape the app already consumes.
 *
 * Deliberately the mobile app's `DocumentView` field names: the app has been
 * built against them for weeks, and translating here — once, in one function —
 * is cheaper than changing fourteen screens to match whatever the model
 * happens to call things.
 */
export function toDocument(run: ExtractionRun): {
  supplierName: string | null;
  supplierAbn: string | null;
  supplierAbnValid: boolean;
  issueDate: string | null;
  currency: string;
  taxExclusiveAmount: string | null;
  taxAmount: string | null;
  payableAmount: string | null;
  /** BT-114. '0' rather than null: `documents.rounding_amount` is NOT NULL. */
  roundingAmount: string;
  dueDate: string | null;
  paymentMethod: string | null;
  /**
   * ALWAYS ≤ 4 digits or null — `maskCardLast4` applied again here, not just
   * trusted from the parse step, because `ValidatedExtraction` is a public
   * type and nothing stops a future caller building one by hand (three of the
   * test fixtures in this codebase already do exactly that).
   */
  cardLast4: string | null;
  cardBrand: string | null;
  gstFreeAmount: string | null;
  isTaxInvoice: boolean;
  docType: 'tax_invoice' | 'receipt';
  reviewStatus: 'auto_accepted' | 'needs_review';
  confidenceOverall: number;
  complianceFailures: string[];
  gstAtRisk: string | null;
  belowTaxInvoiceThreshold: boolean;
  lines: Array<{
    lineNumber: number;
    description: string;
    quantity: number;
    unitPrice: string;
    amount: string;
    gstFree: boolean;
  }>;
  linesBalance: boolean;
  findings: ValidatedExtraction['findings'];
} {
  const { extraction: e, ...v } = run.result;

  const gstFreeTotal = e.lines
    .filter((l) => l.gstFree.value === true)
    .reduce((acc, l) => acc + Number(l.amount.value ?? 0), 0);

  const lines = e.lines
    .filter((l) => l.amount.value != null)
    .map((l, i) => ({
      lineNumber: i + 1,
      description: l.description.value ?? 'Item',
      quantity: l.quantity.value ?? 1,
      unitPrice: l.unitPrice.value ?? l.amount.value!,
      amount: l.amount.value!,
      gstFree: l.gstFree.value === true,
    }));

  const lineSum = lines.reduce((acc, l) => acc + Number(l.amount), 0);
  const payable = Number(e.payableAmount.value ?? 0);

  return {
    supplierName: e.supplierName.value,
    supplierAbn: e.supplierAbn.value,
    supplierAbnValid: !v.complianceFailures.includes('supplier_abn_invalid') && !!e.supplierAbn.value,
    issueDate: e.issueDate.value,
    currency: e.currency.value ?? 'AUD',
    taxExclusiveAmount: e.taxExclusiveAmount.value,
    taxAmount: e.taxAmount.value,
    payableAmount: e.payableAmount.value,
    roundingAmount: e.roundingAmount?.value ?? '0',
    dueDate: e.dueDate?.value ?? null,
    paymentMethod: e.payment?.method.value ?? null,
    cardLast4: maskCardLast4(e.payment?.cardLast4.value ?? null),
    cardBrand: e.payment?.cardBrand.value ?? null,
    gstFreeAmount: gstFreeTotal > 0 ? gstFreeTotal.toFixed(4) : null,
    isTaxInvoice: v.isTaxInvoice,
    docType: v.isTaxInvoice ? 'tax_invoice' : 'receipt',
    reviewStatus: v.reviewStatus,
    confidenceOverall: v.confidenceOverall,
    complianceFailures: v.complianceFailures,
    gstAtRisk: v.gstAtRisk,
    belowTaxInvoiceThreshold: v.belowTaxInvoiceThreshold,
    lines,
    // Via the validator's own rule, not a second copy of it: lines may be
    // GST-inclusive (a retail docket) or ex-GST (a commercial tax invoice),
    // and a naive comparison calls every invoice of the second kind broken.
    linesBalance:
      lines.length > 0 &&
      Math.abs(linesGap(lineSum, e.payableAmount.value, e.taxAmount.value)) < 0.005,
    findings: v.findings,
  };
}
