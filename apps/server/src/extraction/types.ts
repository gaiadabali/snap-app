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

/**
 * `docs/extraction-schema.json`'s `header.payment`, BT-... none — this is not
 * a Peppol business term, it is `documents.card_last4` / `card_brand` /
 * `payment_method`, which existed in the schema and the database and were
 * wired to nothing (`docs/STATEMENTS.md` §2, ticket S1).
 *
 * `cardLast4` is masked at the ONE place raw model output becomes an
 * `Extraction` — `parseExtraction` in `provider.ts`, via `maskCardLast4`
 * below — so a full or partial PAN never exists inside this type at all, not
 * even transiently. `run.ts#toDocument` and `repo.ts#saveExtraction` apply
 * the same function again before it reaches storage, because "the model was
 * told not to" is not a control.
 */
export type Payment = {
  /** EFTPOS, VISA, CASH, AMEX, ACCOUNT — as printed. */
  method: Field<string>;
  /** ALWAYS ≤ 4 digits. See `maskCardLast4`. Never a full or partial PAN. */
  cardLast4: Field<string>;
  cardBrand: Field<string>;
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
  /**
   * BT-114. Australian cash sales round to 5c; this is the difference, not a
   * distortion of `payableAmount`. Optional so every existing fixture that
   * built an `Extraction` before this field existed still type-checks —
   * `schema-contract.test.ts` is what actually enforces this is populated by
   * the real parser, not the TS optionality flag.
   */
  roundingAmount?: Field<string>;
  /** BT-9. Rare on a retail receipt, present on an invoice with payment terms. */
  dueDate?: Field<string>;
  /** See `Payment` above. Optional for the same fixture-compatibility reason. */
  payment?: Payment;
  lines: ExtractedLine[];
  notes: {
    legible: boolean;
    imageIssues: string[];
    warnings: string[];
  };
};

/**
 * The one function every path that can produce a `card_last4` must call.
 *
 * Strips everything but digits, then keeps only the LAST four. Never a hash,
 * never a partial PAN beyond four digits, never the full number — "masked PAN
 * only" (`packages/db/src/schema/tables.ts` comment on `documents.card_last4`)
 * is a hard constraint, not a prompt instruction, so it is enforced here in
 * code that runs regardless of what the model actually returned.
 *
 * `''` and values with no digits at all become `null` rather than an empty
 * string, so a blank never gets stored where "no card was read" belongs.
 */
export function maskCardLast4(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const digitsOnly = raw.replace(/\D/g, '');
  if (digitsOnly === '') return null;
  return digitsOnly.slice(-4);
}

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
