import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseStatementChunk } from './statement-provider.js';
import type { StatementChunkExtraction } from './statement-types.js';

/**
 * S0's note (`docs/STATEMENTS.md` §12 Lane S) named this exactly:
 * "`docs/statement-schema.json` is the SECOND contract in this file and must
 * not inherit the defect." — the defect being a documented JSON schema and an
 * implemented TypeScript type that quietly disagree, with nothing testing
 * the agreement between them. This is `schema-contract.test.ts`'s same
 * GENERAL walk — every path the JSON schema marks required demands a
 * recorded, reasoned decision (`mapped`, proven against the real
 * `parseStatementChunk`, or `excluded` with a reason) — applied to the
 * statement schema instead of a bespoke, statement-shaped copy of the idea.
 *
 * VERIFIED BY BREAKING IT: deleting the `amountSigned` line from
 * `parseStatementChunk` in `statement-provider.ts` turns
 * `mapped('lines[].amount_signed', ...)` red, because the walked value comes
 * back `undefined` where the parser used to put a `StatementField`. See the
 * T2 handback for the pasted failing output. Restored afterwards.
 */

const SCHEMA_PATH = fileURLToPath(new URL('../../../../docs/statement-schema.json', import.meta.url));
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as {
  required: string[];
  properties: {
    page_range: { required: string[] };
    lines: { items: { required: string[] } };
    extraction_notes: { required: string[] };
  };
};

/** Every path the schema requires, as `dotted.snake_case`, fully expanded. */
function schemaRequiredPaths(): string[] {
  const out: string[] = [];
  for (const rootField of schema.required) {
    if (rootField === 'page_range') {
      for (const p of schema.properties.page_range.required) out.push(`page_range.${p}`);
    } else if (rootField === 'lines') {
      for (const l of schema.properties.lines.items.required) out.push(`lines[].${l}`);
    } else if (rootField === 'extraction_notes') {
      for (const n of schema.properties.extraction_notes.required) out.push(`extraction_notes.${n}`);
    } else {
      // schema_version, opening_balance, closing_balance — scalar/field root properties.
      out.push(rootField);
    }
  }
  return out;
}

/** A fully-populated raw model response, in the flat shape `statement-provider.ts` actually parses. */
const FULL_RAW_RESPONSE = JSON.stringify({
  schemaVersion: '1.0.0',
  openingBalance: { value: '1204.50', confidence: 0.95, nullReason: null },
  closingBalance: { value: '984.12', confidence: 0.9, nullReason: null },
  lines: [
    {
      postedDate: { value: '2026-08-03', confidence: 0.95, nullReason: null },
      valueDate: { value: '2026-08-04', confidence: 0.9, nullReason: null },
      description: { value: 'EFTPOS PURCHASE COLES', confidence: 0.9, nullReason: null },
      amountSigned: { value: '-45.20', confidence: 0.9, nullReason: null },
      runningBalance: { value: '1159.30', confidence: 0.9, nullReason: null },
      cardLast4: { value: '4417', confidence: 0.9, nullReason: null },
    },
  ],
  notes: { legible: true, warnings: [] },
});

const sample: StatementChunkExtraction = parseStatementChunk(FULL_RAW_RESPONSE, { from: 1, to: 1 });

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

const DECISIONS: Record<string, Decision> = {
  schema_version: { status: 'mapped', tsPath: 'schemaVersion' },
  opening_balance: { status: 'mapped', tsPath: 'openingBalance' },
  closing_balance: { status: 'mapped', tsPath: 'closingBalance' },

  'page_range.from': { status: 'mapped', tsPath: 'pageRange.from' },
  'page_range.to': { status: 'mapped', tsPath: 'pageRange.to' },

  'lines[].posted_date': { status: 'mapped', tsPath: 'lines[].postedDate' },
  'lines[].value_date': { status: 'mapped', tsPath: 'lines[].valueDate' },
  'lines[].description': { status: 'mapped', tsPath: 'lines[].description' },
  'lines[].amount_signed': { status: 'mapped', tsPath: 'lines[].amountSigned' },
  'lines[].running_balance': { status: 'mapped', tsPath: 'lines[].runningBalance' },
  'lines[].card_last4': { status: 'mapped', tsPath: 'lines[].cardLast4' },

  'extraction_notes.legible': { status: 'mapped', tsPath: 'notes.legible' },
  'extraction_notes.warnings': { status: 'mapped', tsPath: 'notes.warnings' },
};

describe('the statement schema and the implemented type agree (T2, following S0)', () => {
  it('records a decision for every path the JSON schema requires', () => {
    const required = schemaRequiredPaths();
    const undecided = required.filter((p) => !(p in DECISIONS));
    expect(
      undecided,
      `docs/statement-schema.json requires ${undecided.length} field(s) with no recorded ` +
        `decision in statement-schema-contract.test.ts: ${undecided.join(', ')}. Add a 'mapped' ` +
        `or 'excluded' entry to DECISIONS before this can pass.`,
    ).toEqual([]);
  });

  it('every "mapped" field actually comes out of the real parser with a value', () => {
    for (const [schemaPath, decision] of Object.entries(DECISIONS)) {
      if (decision.status !== 'mapped') continue;
      const value = get(decision.tsPath);
      expect(
        value,
        `${schemaPath} is marked "mapped" to StatementChunkExtraction path "${decision.tsPath}", ` +
          `but parseStatementChunk() produced undefined there. Either the parser regressed or the ` +
          `mapping is wrong.`,
      ).not.toBeUndefined();
    }
  });

  it('every "excluded" field carries a non-empty, specific reason', () => {
    for (const [schemaPath, decision] of Object.entries(DECISIONS)) {
      if (decision.status !== 'excluded') continue;
      expect(decision.reason.length, `${schemaPath} has no real reason recorded`).toBeGreaterThan(20);
    }
  });

  // T2's own flagship claim, spelt out separately from the generic "a value
  // exists" check above: card_last4 is not merely present, it is MASKED.
  it('parses lines[].cardLast4 to the masked digits, not a copy of the raw string', () => {
    expect(sample.lines[0]!.cardLast4.value).toBe('4417');
  });

  it('a full PAN offered by the model is masked down to its last 4 digits, same as the receipt schema', () => {
    const raw = JSON.stringify({
      schemaVersion: '1.0.0',
      openingBalance: { value: null, confidence: 0, nullReason: 'not_present' },
      closingBalance: { value: null, confidence: 0, nullReason: 'not_present' },
      lines: [
        {
          postedDate: { value: '2026-08-03', confidence: 0.9, nullReason: null },
          valueDate: { value: null, confidence: 0, nullReason: 'not_present' },
          description: { value: 'CARD PURCHASE', confidence: 0.9, nullReason: null },
          amountSigned: { value: '-10.00', confidence: 0.9, nullReason: null },
          runningBalance: { value: null, confidence: 0, nullReason: 'not_present' },
          cardLast4: { value: '4111 1111 1111 1111', confidence: 0.9, nullReason: null },
        },
      ],
      notes: { legible: true, warnings: [] },
    });
    const parsed = parseStatementChunk(raw, { from: 1, to: 1 });
    expect(parsed.lines[0]!.cardLast4.value).toBe('1111');
  });
});
