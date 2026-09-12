/**
 * The shape a vision model must return.
 *
 * A narrowed, flattened view of `docs/extraction-schema.json`: the fields the
 * validators and the ledger actually consume. The full schema carries Peppol
 * business terms for export; this is what the pipeline reasons about.
 *
 * Every field is wrapped with a confidence, and every one is nullable. That
 * pairing is the whole design: the model is required to say "I could not read
 * this" instead of producing a plausible value, because a confident wrong ABN
 * is far more expensive than a missing one — it produces a GST claim that the
 * ATO can disallow years later, with interest.
 */

export type Field<T> = {
  value: T | null;
  /** 0–1. The model's own estimate; treated as advisory, never as truth. */
  confidence: number;
};

export type ExtractedLine = {
  description: Field<string>;
  quantity: Field<number>;
  /** GST-inclusive, as printed. */
  unitPrice: Field<string>;
  amount: Field<string>;
  gstFree: Field<boolean>;
};

export type Extraction = {
  schemaVersion: string;
  docType: Field<'tax_invoice' | 'receipt' | 'invoice' | 'statement' | 'unknown'>;
  saysTaxInvoice: Field<boolean>;
  documentNumber: Field<string>;
  /** ISO. The model is told Australian receipts print day/month/year. */
  issueDate: Field<string>;
  currency: Field<string>;
  supplierName: Field<string>;
  supplierAbn: Field<string>;
  /** Whether the buyer's identity or ABN appears — required at $1,000+. */
  buyerIdentified: Field<boolean>;
  taxExclusiveAmount: Field<string>;
  taxAmount: Field<string>;
  payableAmount: Field<string>;
  lines: ExtractedLine[];
  notes: {
    legible: boolean;
    imageIssues: string[];
    warnings: string[];
  };
};

/** Why a document cannot support a GST credit as it stands. */
export type ComplianceFailure =
  | 'supplier_abn_missing'
  | 'supplier_abn_invalid'
  | 'buyer_abn_required_over_1000'
  | 'not_marked_tax_invoice'
  | 'no_gst_amount_shown';

/**
 * A deterministic finding about an extraction.
 *
 * The shape is `ExtractionFinding` from `@snap/api-contract`, not a local
 * copy: it crosses the wire to the review screen, and two declarations of a
 * wire type drift the moment one side adds a field.
 */
import type { ExtractionFinding } from '@snap/api-contract';

export type Finding = ExtractionFinding;

export type ValidatedExtraction = {
  extraction: Extraction;
  findings: Finding[];
  /** Empty when the document is a valid tax invoice. */
  complianceFailures: ComplianceFailure[];
  isTaxInvoice: boolean;
  /** Under $82.50 inclusive the ATO does not require a tax invoice at all. */
  belowTaxInvoiceThreshold: boolean;
  /** GST that cannot be claimed as things stand. */
  gstAtRisk: string | null;
  /**
   * What the app should do with it.
   *
   * `auto_accepted` only when nothing needs a human: no errors, no warnings,
   * and confidence above the bar on the fields that decide money.
   */
  reviewStatus: 'auto_accepted' | 'needs_review';
  /** Lowest confidence across the fields that matter, for the UI's dots. */
  confidenceOverall: number;
};
