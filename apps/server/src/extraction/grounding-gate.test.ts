import { describe, expect, it } from 'vitest';

import type { ExtractionProvider, PageImage, ProviderResult } from './provider.js';
import { runExtraction } from './run.js';
import { validate } from './validators.js';
import type { Extraction, ValidatedExtraction } from './types.js';
import type { GroundingRow } from '../repo.js';

/**
 * The grounding gate — a confident total with nothing on the page behind it
 * is not a total to file a BAS from.
 *
 * Before this gate the accept decision read only the model's own confidence
 * (`validators.ts`'s CONFIDENCE_FLOOR): a model can report 0.99 on a value it
 * invented outright, because confidence is the model grading its own homework.
 * The OCR shadow stage already measures, per field, whether any span on the
 * page actually carries the value (`@snap/docai`'s `groundExtraction`, stored
 * by `shadow.ts` via `saveFieldGrounding`) — but the verdict was written with
 * `enforced: false` and never read back. These tests pin the new contract:
 *
 *   1. A critical field whose grounding report says NO span supports it is
 *      forced to `needs_review`, however confident the model claims to be.
 *   2. A capture with no grounding report at all (legacy rows, or the shadow
 *      stage never ran) is treated as ungrounded — fail-closed, per the repo
 *      rule that an unverified claim is never silently accepted.
 *
 * Pure unit tests: `runExtraction` takes the stored grounding rows as an
 * argument, so no database, sidecar or model is involved. The worker supplies
 * the rows it reads from `document_field_grounding`.
 */

const f = <T>(value: T | null, confidence = 0.99) => ({ value, confidence });

function line(description: string, amount: string) {
  return {
    description: f(description),
    quantity: f(1),
    unitPrice: f(amount),
    amount: f(amount),
    gstFree: f(false),
  };
}

/** A clean, compliant tax invoice the validators would auto-accept. */
function good(): Extraction {
  return {
    schemaVersion: '1',
    docType: f('tax_invoice' as const),
    saysTaxInvoice: f(true),
    documentNumber: f('88214'),
    issueDate: f('2026-08-24'),
    currency: f('AUD'),
    supplierName: f('BP Truckstop Gundagai'),
    supplierAbn: f('33051775556'),
    buyerIdentified: f(true),
    taxExclusiveAmount: f('242.65'),
    taxAmount: f('24.26'),
    payableAmount: f('266.91'),
    lines: [line('Diesel', '243.91'), line('AdBlue 10L', '18.50'), line('Coffee', '4.50')],
    notes: { legible: true, imageIssues: [], warnings: [] },
  };
}

/** A grounding report row as `document_field_grounding` stores it. */
function groundedRow(fieldPath: string, grounded: boolean, value: string) {
  return { fieldPath, grounded, value };
}

/** Every critical field grounded, matching the extraction's own values. */
function fullyGroundedReport() {
  return [
    groundedRow('header.supplier', true, 'BP Truckstop Gundagai'),
    groundedRow('header.supplier_abn', true, '33051775556'),
    groundedRow('header.issue_date', true, '2026-08-24'),
    groundedRow('header.payable_amount', true, '266.91'),
    groundedRow('header.tax_amount', true, '24.26'),
  ];
}

const FAKE_PROVIDER: ExtractionProvider = {
  name: 'fake',
  model: 'fake-1',
  async extract(): Promise<ProviderResult> {
    return {
      extraction: good(),
      meta: {
        provider: 'fake',
        model: 'fake-1',
        promptVersion: 'test',
        latencyMs: 1,
        inputTokens: null,
        outputTokens: null,
        raw: '',
      },
    };
  },
};

const PAGE: PageImage = { bytes: Buffer.from('fake-bytes'), mimeType: 'image/png' };

async function runWith(
  grounding?: Array<Partial<GroundingRow> & { fieldPath: string; grounded: boolean; value: string }> | null,
) {
  const outcome = await runExtraction(FAKE_PROVIDER, PAGE, new Date(), null, grounding);
  if (!outcome.ok) throw new Error(outcome.failure.error);
  return outcome.run.result as ValidatedExtraction;
}

describe('grounding gate', () => {
  it('sends an ungrounded payableAmount to review even at 0.99 confidence', async () => {
    // Before the gate this WAS the auto-accept: validate() reads only the
    // model's own confidence, and 0.99 clears the floor. Assert that the
    // un-gated verdict really is auto-accept, so the test fails honestly
    // rather than by accident if the validator changes.
    expect(validate(good(), new Date(), null).reviewStatus).toBe('auto_accepted');

    // Now the gate: every field grounded EXCEPT the total, which no span on
    // the page supports. The model still claims 0.99.
    const report = fullyGroundedReport();
    report[3] = groundedRow('header.payable_amount', false, '266.91');
    const result = await runWith(report);
    expect(result.reviewStatus).toBe('needs_review');
    expect(result.findings.some((x) => x.field === 'payableAmount')).toBe(true);
  });

  it('sends a capture with no grounding report to review (fail-closed)', async () => {
    const result = await runWith(null);
    expect(result.reviewStatus).toBe('needs_review');
  });

  it('still auto-accepts when every critical field is grounded', async () => {
    const result = await runWith(fullyGroundedReport());
    expect(result.reviewStatus).toBe('auto_accepted');
  });

  it('treats stored grounding of a DIFFERENT value as no grounding for this run', async () => {
    // The report was measured against a previous attempt's output; the new
    // run produced a different total, so the report says nothing about it.
    const report = fullyGroundedReport();
    report[3] = groundedRow('header.payable_amount', true, '999.99');
    const result = await runWith(report);
    expect(result.reviewStatus).toBe('needs_review');
  });
});
