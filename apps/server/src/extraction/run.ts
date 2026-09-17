import { createHash } from 'node:crypto';

import type { TaxRules } from '@snap/tax-rules';

import { TruncatedOutputError } from './provider.js';
import type { ExtractionProvider, PageImage, ProviderResult } from './provider.js';
import type { ValidatedExtraction } from './types.js';
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

  const result = validate(provided.extraction, now, rules);

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
