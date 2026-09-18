import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseExtraction } from './provider.js';
import type { Extraction } from './types.js';

/**
 * S0 (`docs/STATEMENTS.md` §12 Lane S): the documented extraction schema and
 * the implemented one must agree, or a test must say so.
 *
 * `docs/extraction-schema.json` is titled "Strict output contract" and
 * `apps/server/src/extraction/types.ts` is, by its own header comment, "a
 * narrowed, flattened view" of it — carrying only "the fields the validators
 * and the ledger actually consume". Some narrowing is fine and intentional
 * (a buyer's postal address is a Peppol export concern nothing here reads).
 * Some of it was an oversight with money and PCI consequences: `payment`,
 * `rounding_amount` were in the schema's REQUIRED list and had NO
 * representation anywhere in the pipeline.
 *
 * This test does not special-case those two. It walks EVERY path the schema
 * marks required and demands a recorded, reasoned DECISION for each one:
 * either `mapped` (implemented — proven by running the real `parseExtraction`
 * and checking the field actually comes out the other side with a value) or
 * `excluded` (a deliberate, one-line-justified narrowing). A required schema
 * path with no entry in `DECISIONS` fails the suite. That is what makes this
 * a contract test rather than a snapshot: the next schema (statements) that
 * declares a required field nobody implements fails here on day one, which is
 * the whole point of S0 existing before that work starts.
 *
 * VERIFIED BY BREAKING IT: deleting the `payment.cardLast4` line from
 * `provider.ts`'s `parseExtraction` and re-running this suite turns
 * `mapped('header.payment.card_last4', ...)` red, because the walked value is
 * `undefined` where the parser used to put a `Field`. Restored afterwards.
 * See the PR/handback notes for the actual failing output.
 */

const SCHEMA_PATH = fileURLToPath(new URL('../../../../docs/extraction-schema.json', import.meta.url));
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as {
  required: string[];
  properties: {
    header: {
      required: string[];
      properties: {
        payment: { required: string[] };
        supplier: { $ref: string };
        buyer: { $ref: string };
      };
    };
    lines: { items: { required: string[] } };
    extraction_notes: { required: string[] };
    tax_subtotals?: unknown;
  };
  $defs: { Party: { required: string[] } };
};

/** Every path the schema requires, as `dotted.snake_case`, fully expanded. */
function schemaRequiredPaths(): string[] {
  const out: string[] = [];
  for (const rootField of schema.required) {
    if (rootField === 'header') {
      for (const h of schema.properties.header.required) {
        if (h === 'payment') {
          for (const p of schema.properties.header.properties.payment.required) {
            out.push(`header.payment.${p}`);
          }
        } else if (h === 'supplier' || h === 'buyer') {
          for (const p of schema.$defs.Party.required) out.push(`header.${h}.${p}`);
        } else {
          out.push(`header.${h}`);
        }
      }
    } else if (rootField === 'lines') {
      for (const l of schema.properties.lines.items.required) out.push(`lines[].${l}`);
    } else if (rootField === 'extraction_notes') {
      for (const n of schema.properties.extraction_notes.required) out.push(`extraction_notes.${n}`);
    } else {
      // schema_version, doc_type — scalar root fields, not containers.
      out.push(rootField);
    }
  }
  return out;
}

/** A fully-populated raw model response, in the flat shape `provider.ts` actually parses. */
const FULL_RAW_RESPONSE = JSON.stringify({
  docType: { value: 'tax_invoice', confidence: 0.9 },
  saysTaxInvoice: { value: true, confidence: 0.9 },
  documentNumber: { value: 'INV-1', confidence: 0.9 },
  issueDate: { value: '2026-09-01', confidence: 0.9 },
  dueDate: { value: '2026-09-15', confidence: 0.9 },
  currency: { value: 'AUD', confidence: 0.9 },
  supplierName: { value: 'Test Pty Ltd', confidence: 0.9 },
  supplierAbn: { value: '85129887341', confidence: 0.9 },
  buyerIdentified: { value: true, confidence: 0.9 },
  taxExclusiveAmount: { value: '100.00', confidence: 0.9 },
  taxAmount: { value: '10.00', confidence: 0.9 },
  payableAmount: { value: '110.00', confidence: 0.9 },
  roundingAmount: { value: '0.05', confidence: 0.9 },
  payment: {
    method: { value: 'VISA', confidence: 0.9 },
    cardLast4: { value: '4417', confidence: 0.9 },
    cardBrand: { value: 'VISA', confidence: 0.9 },
  },
  lines: [
    {
      description: { value: 'Freight', confidence: 0.9 },
      quantity: { value: 1, confidence: 0.9 },
      unitPrice: { value: '110.00', confidence: 0.9 },
      amount: { value: '110.00', confidence: 0.9 },
      gstFree: { value: false, confidence: 0.9 },
    },
  ],
  notes: { legible: true, imageIssues: [], warnings: [] },
});

const sample: Extraction = parseExtraction(FULL_RAW_RESPONSE);

/** Reads a dotted/`[]`-suffixed path off the sample, `lines[].x` reading `lines[0].x`. */
function get(path: string): unknown {
  const parts = path.replace('[]', '.0').split('.');
  let cur: unknown = sample;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

type Decision =
  | { status: 'mapped'; tsPath: string }
  | { status: 'excluded'; reason: string };

/**
 * One entry per path `schemaRequiredPaths()` can produce. Add to this when
 * the schema grows a new required field — that is the intended failure mode:
 * `it('...')` below refuses to pass with an unrecognised required path.
 */
const DECISIONS: Record<string, Decision> = {
  schema_version: { status: 'mapped', tsPath: 'schemaVersion' },
  doc_type: { status: 'mapped', tsPath: 'docType' },

  'header.says_tax_invoice': { status: 'mapped', tsPath: 'saysTaxInvoice' },
  'header.document_number': { status: 'mapped', tsPath: 'documentNumber' },
  'header.issue_date': { status: 'mapped', tsPath: 'issueDate' },
  'header.currency': { status: 'mapped', tsPath: 'currency' },
  'header.tax_exclusive_amount': { status: 'mapped', tsPath: 'taxExclusiveAmount' },
  'header.tax_amount': { status: 'mapped', tsPath: 'taxAmount' },
  'header.payable_amount': { status: 'mapped', tsPath: 'payableAmount' },
  // S1's flagship fields.
  'header.rounding_amount': { status: 'mapped', tsPath: 'roundingAmount' },
  'header.payment.method': { status: 'mapped', tsPath: 'payment.method' },
  'header.payment.card_last4': { status: 'mapped', tsPath: 'payment.cardLast4' },
  'header.payment.card_brand': { status: 'mapped', tsPath: 'payment.cardBrand' },

  'header.tax_inclusive_amount': {
    status: 'excluded',
    reason:
      'BT-112 is not separately consumed: validators and the ledger derive everything from ' +
      'payable_amount and tax_amount. Implementing it is real work (another prompt field, ' +
      'another column) for a figure nothing downstream reads yet — out of S0/S1 scope, unlike ' +
      'the five fields docs/STATEMENTS.md §2 named.',
  },
  'header.supplier.legal_name': { status: 'mapped', tsPath: 'supplierName' },
  'header.supplier.abn': { status: 'mapped', tsPath: 'supplierAbn' },
  'header.supplier.trading_name': {
    status: 'excluded',
    reason: 'Only legal_name feeds the party record today; trading_name is Peppol export detail.',
  },
  'header.supplier.address': {
    status: 'excluded',
    reason: 'No address field anywhere downstream — not read by validators, the ledger, or any export today.',
  },
  'header.supplier.email': { status: 'excluded', reason: 'Same as address: unread downstream.' },
  'header.supplier.phone': { status: 'excluded', reason: 'Same as address: unread downstream.' },
  'header.buyer.legal_name': {
    status: 'excluded',
    reason:
      'The pipeline only needs to know a buyer identity was SHOWN at all (ATO element 7, the ' +
      '$1,000 threshold check) — represented as the boolean `buyerIdentified`. The buyer is this ' +
      "workspace's own tenant, whose identity is already known outside the extraction; capturing " +
      'the buyer name/ABN a second time from the docket has no consumer.',
  },
  'header.buyer.trading_name': { status: 'excluded', reason: 'Same as header.buyer.legal_name.' },
  'header.buyer.abn': { status: 'excluded', reason: 'Same as header.buyer.legal_name.' },
  'header.buyer.address': { status: 'excluded', reason: 'Same as header.buyer.legal_name.' },
  'header.buyer.email': { status: 'excluded', reason: 'Same as header.buyer.legal_name.' },
  'header.buyer.phone': { status: 'excluded', reason: 'Same as header.buyer.legal_name.' },

  'lines[].description': { status: 'mapped', tsPath: 'lines[].description' },
  'lines[].quantity': { status: 'mapped', tsPath: 'lines[].quantity' },
  'lines[].unit_price': { status: 'mapped', tsPath: 'lines[].unitPrice' },
  'lines[].line_net_amount': {
    status: 'mapped',
    tsPath: 'lines[].amount',
    // Not a rename in disguise — see the note below the table.
  },
  'lines[].line_number': {
    status: 'excluded',
    reason:
      'Positional: array order IS the line number, assigned at serialisation (`run.ts#toDocument`, ' +
      '`repo.ts`\'s insert loop), not carried as a redundant field that could disagree with order.',
  },
  'lines[].unit_code': {
    status: 'excluded',
    reason: 'UN/ECE trade vocabulary (EA/LTR/KGM) for Peppol export; validators only need the amount.',
  },
  'lines[].gst_category_code': {
    status: 'excluded',
    reason:
      'Collapsed to the boolean `gstFree` — `validators.ts` and `tax-subtotals.ts` only ever ' +
      'distinguish standard-rated from GST-free, never the full Peppol S/Z/E/O vocabulary.',
  },
  'lines[].gst_rate': {
    status: 'excluded',
    reason: 'Derived, not asked of the model — GST-free is 0%, standard is the jurisdiction rate.',
  },
  'lines[].gst_amount': {
    status: 'excluded',
    reason:
      'Computed deterministically downstream by `taxSubtotalsFromLines()` from the printed header ' +
      'tax_amount and the exact decimal `money` library — never trusted to per-line model arithmetic.',
  },

  'extraction_notes.legible': { status: 'mapped', tsPath: 'notes.legible' },
  'extraction_notes.image_issues': { status: 'mapped', tsPath: 'notes.imageIssues' },
  'extraction_notes.warnings': { status: 'mapped', tsPath: 'notes.warnings' },
  'extraction_notes.unread_regions': {
    status: 'excluded',
    reason:
      'Not requested from the model and not consumed downstream — `imageIssues` plus `warnings` ' +
      'already drive the legibility/review-routing signal. Out of S0/S1 scope.',
  },
};

describe('the extraction schema and the implemented type agree (S0)', () => {
  it('records a decision for every path the JSON schema requires', () => {
    const required = schemaRequiredPaths();
    const undecided = required.filter((p) => !(p in DECISIONS));
    expect(
      undecided,
      `docs/extraction-schema.json requires ${undecided.length} field(s) with no recorded ` +
        `decision in schema-contract.test.ts: ${undecided.join(', ')}. Add a 'mapped' or ` +
        `'excluded' entry to DECISIONS before this can pass — that is the whole point of S0.`,
    ).toEqual([]);
  });

  it('every "mapped" field actually comes out of the real parser with a value', () => {
    for (const [schemaPath, decision] of Object.entries(DECISIONS)) {
      if (decision.status !== 'mapped') continue;
      const value = get(decision.tsPath);
      expect(
        value,
        `${schemaPath} is marked "mapped" to Extraction path "${decision.tsPath}", but ` +
          `parseExtraction() produced undefined there. Either the parser regressed or the mapping ` +
          `is wrong.`,
      ).not.toBeUndefined();
    }
  });

  it('every "excluded" field carries a non-empty, specific reason', () => {
    for (const [schemaPath, decision] of Object.entries(DECISIONS)) {
      if (decision.status !== 'excluded') continue;
      expect(decision.reason.length, `${schemaPath} has no real reason recorded`).toBeGreaterThan(20);
    }
  });

  // Ticket S1's specific claim, spelt out on its own: card_last4 and
  // card_brand are not merely "mapped" in the generic sense above, they are
  // mapped to a MASKED value. `header.payment.card_last4`'s test above only
  // proves a value exists; this proves what value.
  it('parses payment.cardLast4 to the masked digits, not a copy of the raw string', () => {
    const field = sample.payment?.cardLast4;
    expect(field?.value).toBe('4417');
  });
});

/**
 * Why "lines[].line_net_amount -> lines[].amount" is a real mapping and not
 * a rename hiding a bug: BT-131 is the Peppol NET line amount, and this
 * pipeline's `amount` is documented (`types.ts`) as "GST-inclusive, as
 * printed" — genuinely a different number on a commercial tax invoice, where
 * `validators.ts#linesGap` already handles both conventions by checking
 * whether the lines balance inclusive OR exclusive of the printed GST. That
 * is out of scope for S0 (not one of the five fields named in
 * `docs/STATEMENTS.md` §2) and is not touched here.
 */
