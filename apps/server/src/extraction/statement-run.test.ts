import { describe, expect, it } from 'vitest';

import { TruncatedOutputError } from './provider.js';
import { chunkPageTexts, runStatementExtraction, stitchChunks, STATEMENT_CHUNK_PAGES } from './statement-run.js';
import type { StatementChunkExtraction } from './statement-types.js';
import type { StatementChunkProvider, StatementChunkResult } from './statement-provider.js';

/**
 * T2's technical core (`docs/STATEMENTS.md` §12 T2): chunking per page is
 * what stops a long statement from ever reaching `TruncatedOutputError`, and
 * this suite proves it two ways —
 *
 *  1. A FAKE provider modelling a real output cap (any request asking for
 *     more than ~45 rows' worth of JSON in one response throws
 *     `TruncatedOutputError`, mirroring `OllamaCloudStatementProvider`'s own
 *     `finish_reason === 'length'` check). A 12-page, 480-row statement,
 *     read ONE PAGE (40 rows) PER CHUNK, never gets close to that cap.
 *  2. The SAME statement, read with chunking disabled (one giant chunk of
 *     all 12 pages, 480 rows in a single request), hits it every time — this
 *     is the "prove it actually truncates without chunking" half of the
 *     ticket's own verification demand.
 *
 * Neither test touches a network: the fake provider is a pure function of
 * its input, so this suite runs offline and deterministically.
 */

const ROWS_PER_PAGE = 40;
/** The fake provider's stand-in for a real per-call output-token cap. */
const FAKE_ROW_CAP = 45;

/** Builds one page's worth of synthetic statement text — a fixed, parseable
 *  shape a FAKE reader can turn back into rows without any real NLP: this is
 *  a test double for the MODEL, not for `extractPdfText`, so the "page text"
 *  format only needs to be something `FakeChunkProvider` itself understands. */
function syntheticPageText(pageNumber: number, rowsPerPage: number, startingBalance: number): string {
  const rows: string[] = [`STATEMENT PAGE ${pageNumber}`];
  for (let i = 0; i < rowsPerPage; i++) {
    const amount = i % 2 === 0 ? -12.5 : 5;
    rows.push(`ROW|2026-08-${String((i % 28) + 1).padStart(2, '0')}|txn ${pageNumber}-${i}|${amount}`);
  }
  void startingBalance;
  return rows.join('\n');
}

/**
 * A fake `StatementChunkProvider` that "reads" the synthetic text format
 * above by splitting on `ROW|`, and throws `TruncatedOutputError` — exactly
 * as the real Ollama provider does on `finish_reason === 'length'` — once a
 * single request is asked to produce more than `FAKE_ROW_CAP` rows' worth of
 * JSON. This is the deterministic stand-in for "a real model call has a
 * fixed output-token budget and a long enough response gets cut off".
 */
class FakeChunkProvider implements StatementChunkProvider {
  readonly name = 'fake';
  readonly model = 'fake-1';
  calls: Array<{ from: number; to: number; rowCount: number }> = [];

  async extractChunk(pageTexts: readonly string[]): Promise<StatementChunkResult> {
    const allRows = pageTexts.flatMap((t) =>
      t
        .split('\n')
        .filter((l) => l.startsWith('ROW|'))
        .map((l) => l.split('|')),
    );
    const from = Number(pageTexts[0]?.match(/PAGE (\d+)/)?.[1] ?? 1);
    const to = Number(pageTexts[pageTexts.length - 1]?.match(/PAGE (\d+)/)?.[1] ?? from);
    this.calls.push({ from, to, rowCount: allRows.length });

    if (allRows.length > FAKE_ROW_CAP) {
      throw new TruncatedOutputError(
        `fake provider hit its ${FAKE_ROW_CAP}-row output cap for pages ${from}-${to} ` +
          `(asked for ${allRows.length} rows in one response)`,
      );
    }

    const chunk: StatementChunkExtraction = {
      schemaVersion: '1',
      pageRange: { from, to },
      // Only the FIRST page of the whole statement carries an opening
      // balance in this fixture, and only the LAST carries a closing one —
      // the common real shape `stitchChunks` is written to expect.
      openingBalance: { value: from === 1 ? '1000.00' : null, confidence: from === 1 ? 0.9 : 0 },
      closingBalance: { value: null, confidence: 0 }, // set per-test where needed
      lines: allRows.map(([, date, desc, amount]) => ({
        postedDate: { value: date!, confidence: 0.9 },
        valueDate: { value: null, confidence: 0 },
        description: { value: desc!, confidence: 0.9 },
        amountSigned: { value: amount!, confidence: 0.9 },
        runningBalance: { value: null, confidence: 0 },
        cardLast4: { value: null, confidence: 0 },
      })),
      notes: { legible: true, warnings: [] },
    };

    return {
      chunk,
      meta: { provider: this.name, model: this.model, promptVersion: 'test', latencyMs: 0, inputTokens: null, outputTokens: null, raw: '' },
    };
  }
}

const TOTAL_PAGES = 12;
function buildStatementPageTexts(): string[] {
  return Array.from({ length: TOTAL_PAGES }, (_, i) => syntheticPageText(i + 1, ROWS_PER_PAGE, 1000));
}

describe('runStatementExtraction — chunking is what prevents TruncatedOutputError', () => {
  it('a 12-page, 480-row statement extracts every row with default (per-page) chunking, with no TruncatedOutputError', async () => {
    const provider = new FakeChunkProvider();
    const pageTexts = buildStatementPageTexts();

    const outcome = await runStatementExtraction(provider, pageTexts, 'day_first', 'AUD');

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.chunkCount).toBe(TOTAL_PAGES);
    expect(outcome.stitched.lines).toHaveLength(TOTAL_PAGES * ROWS_PER_PAGE);
    // Every one of the 12 calls asked for exactly one page's worth of rows —
    // never anywhere near the fake cap.
    expect(provider.calls).toHaveLength(TOTAL_PAGES);
    for (const call of provider.calls) expect(call.rowCount).toBe(ROWS_PER_PAGE);
    // Row order preserved across chunk boundaries: line 41 is page 2's first row.
    expect(outcome.stitched.lines[0]!.descriptionRaw).toBe('txn 1-0');
    expect(outcome.stitched.lines[ROWS_PER_PAGE]!.descriptionRaw).toBe('txn 2-0');
  });

  it('the SAME statement, chunked as ONE request for every page, truncates — proving chunking is what avoided it above', async () => {
    const provider = new FakeChunkProvider();
    const pageTexts = buildStatementPageTexts();

    // Chunking disabled: every page goes into a single call.
    const outcome = await runStatementExtraction(provider, pageTexts, 'day_first', 'AUD', pageTexts.length);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.stage).toBe('truncated');
    expect(outcome.error).toMatch(/output cap/);
    expect(outcome.pageRange).toEqual({ from: 1, to: TOTAL_PAGES });
    // Exactly one call was made — the giant one — and it is what failed.
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]!.rowCount).toBe(TOTAL_PAGES * ROWS_PER_PAGE);
  });

  it('the exported default chunk size is 1 page — the "obvious unit", not a larger batch', () => {
    expect(STATEMENT_CHUNK_PAGES).toBe(1);
  });
});

describe('chunkPageTexts', () => {
  it('groups pages into runs of chunkSize, 1-based and inclusive', () => {
    expect(chunkPageTexts(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([
      { from: 1, to: 2, texts: ['a', 'b'] },
      { from: 3, to: 4, texts: ['c', 'd'] },
      { from: 5, to: 5, texts: ['e'] },
    ]);
  });

  it('defaults to one page per chunk', () => {
    expect(chunkPageTexts(['a', 'b', 'c'])).toEqual([
      { from: 1, to: 1, texts: ['a'] },
      { from: 2, to: 2, texts: ['b'] },
      { from: 3, to: 3, texts: ['c'] },
    ]);
  });
});

describe('stitchChunks — the boundary-marker de-duplication', () => {
  function field<T>(value: T | null): { value: T | null; confidence: number } {
    return { value, confidence: value === null ? 0 : 0.9 };
  }

  it('drops a "balance brought forward" row instead of counting it as a transaction', () => {
    const page1: StatementChunkExtraction = {
      schemaVersion: '1',
      pageRange: { from: 1, to: 1 },
      openingBalance: field('1000.00'),
      closingBalance: field(null),
      lines: [
        {
          postedDate: field('2026-08-01'),
          valueDate: field(null),
          description: field('EFTPOS COLES'),
          amountSigned: field('-50.00'),
          runningBalance: field('950.00'),
          cardLast4: field(null),
        },
      ],
      notes: { legible: true, warnings: [] },
    };
    // Page 2 restates the carried-forward balance — a MISBEHAVING model puts
    // it in `lines` despite the prompt's rule 3, exercising `stitchChunks`'s
    // second, defensive filter (defence 2 in `statement-run.ts`'s header).
    const page2: StatementChunkExtraction = {
      schemaVersion: '1',
      pageRange: { from: 2, to: 2 },
      openingBalance: field(null),
      closingBalance: field('900.00'),
      lines: [
        {
          postedDate: field('2026-08-02'),
          valueDate: field(null),
          description: field('Balance brought forward'),
          amountSigned: field('950.00'), // if kept, this alone would double the real balance
          runningBalance: field('950.00'),
          cardLast4: field(null),
        },
        {
          postedDate: field('2026-08-02'),
          valueDate: field(null),
          description: field('EFTPOS BUNNINGS'),
          amountSigned: field('-50.00'),
          runningBalance: field('900.00'),
          cardLast4: field(null),
        },
      ],
      notes: { legible: true, warnings: [] },
    };

    const result = stitchChunks([page1, page2]);

    expect(result.lines).toHaveLength(2); // NOT 3 — the marker row is excluded
    expect(result.lines.map((l) => l.descriptionRaw)).toEqual(['EFTPOS COLES', 'EFTPOS BUNNINGS']);
    expect(result.droppedBoundaryMarkers).toBe(1);
    expect(result.openingBalance).toBe('1000.00');
    expect(result.closingBalance).toBe('900.00');
    // Line numbers are a running count over KEPT rows only, in page order.
    expect(result.lines[0]!.lineNumber).toBe(1);
    expect(result.lines[1]!.lineNumber).toBe(2);
  });

  it('recognises the Indonesian "saldo awal"/"saldo akhir" phrasing too — same patterns classify.ts uses', () => {
    const chunk: StatementChunkExtraction = {
      schemaVersion: '1',
      pageRange: { from: 1, to: 1 },
      openingBalance: field('500000'),
      closingBalance: field(null),
      lines: [
        {
          postedDate: field('2026-08-01'),
          valueDate: field(null),
          description: field('Saldo awal'),
          amountSigned: field('500000'),
          runningBalance: field('500000'),
          cardLast4: field(null),
        },
        {
          postedDate: field('2026-08-01'),
          valueDate: field(null),
          description: field('Transfer masuk'),
          amountSigned: field('120000'),
          runningBalance: field('620000'),
          cardLast4: field(null),
        },
      ],
      notes: { legible: true, warnings: [] },
    };

    const result = stitchChunks([chunk]);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]!.descriptionRaw).toBe('Transfer masuk');
  });
});
