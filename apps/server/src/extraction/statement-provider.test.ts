import { describe, expect, it } from 'vitest';

import { parseStatementChunk } from './statement-provider.js';

/**
 * `parseStatementChunk` in isolation — the malformed-response cases, same
 * reasoning `provider.test.ts`-style suites always give: a bad model
 * response is the likeliest failure in the whole pipeline and the cheapest
 * to test without a network call. `statement-schema-contract.test.ts` covers
 * the "every required field maps to something" contract; this file covers
 * the parser's own defensive behaviour.
 */
describe('parseStatementChunk', () => {
  it('throws when the response has no JSON object at all', () => {
    expect(() => parseStatementChunk('sorry, I cannot read this page', { from: 1, to: 1 })).toThrow(
      /No JSON object/,
    );
  });

  it('strips a code fence the model was told not to add', () => {
    const fenced = '```json\n' + JSON.stringify({ lines: [], notes: { legible: true, warnings: [] } }) + '\n```';
    const result = parseStatementChunk(fenced, { from: 1, to: 1 });
    expect(result.lines).toEqual([]);
  });

  it('treats a missing openingBalance/closingBalance as null, not a crash', () => {
    const result = parseStatementChunk(JSON.stringify({ lines: [], notes: { legible: true, warnings: [] } }), {
      from: 3,
      to: 3,
    });
    expect(result.openingBalance.value).toBeNull();
    expect(result.closingBalance.value).toBeNull();
    expect(result.pageRange).toEqual({ from: 3, to: 3 });
  });

  it('defaults notes.legible to true and warnings to [] when the model omits notes entirely', () => {
    const result = parseStatementChunk(JSON.stringify({ lines: [] }), { from: 1, to: 1 });
    expect(result.notes.legible).toBe(true);
    expect(result.notes.warnings).toEqual([]);
  });

  it('tolerates a comma-formatted amount, same coercion the receipt schema already tolerates', () => {
    const result = parseStatementChunk(
      JSON.stringify({
        lines: [
          {
            postedDate: { value: '2026-08-01', confidence: 0.9 },
            description: { value: 'Salary', confidence: 0.9 },
            amountSigned: { value: '$1,204.50', confidence: 0.9 },
          },
        ],
        notes: { legible: true, warnings: [] },
      }),
      { from: 1, to: 1 },
    );
    expect(result.lines[0]!.amountSigned.value).toBe('1204.5000');
  });

  it('preserves a negative amount through the decimal coercion', () => {
    const result = parseStatementChunk(
      JSON.stringify({
        lines: [
          {
            postedDate: { value: '2026-08-01', confidence: 0.9 },
            description: { value: 'EFTPOS', confidence: 0.9 },
            amountSigned: { value: '-45.20', confidence: 0.9 },
          },
        ],
        notes: { legible: true, warnings: [] },
      }),
      { from: 1, to: 1 },
    );
    expect(result.lines[0]!.amountSigned.value).toBe('-45.2000');
  });

  it('a row with no lines key at all parses to an empty array, not a throw', () => {
    const result = parseStatementChunk(JSON.stringify({ notes: { legible: true, warnings: [] } }), {
      from: 1,
      to: 1,
    });
    expect(result.lines).toEqual([]);
  });
});
