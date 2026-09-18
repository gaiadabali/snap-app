import { randomBytes } from 'node:crypto';

import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TruncatedOutputError } from '../extraction/provider.js';
import type { StatementChunkProvider, StatementChunkResult } from '../extraction/statement-provider.js';
import type { StatementChunkExtraction } from '../extraction/statement-types.js';
import { createCapture } from '../repo.js';
import { provisionTenant, wipeTenant } from '../test-support/tenant.js';
import { installRulesFor } from '../taxrules/taxrules.repo.js';
import { importPdfStatement } from './pdf-statement-import.js';

/**
 * T2 end to end, against real Postgres, run as `snap_app` — never a bypass
 * role (`docs/STATEMENTS.md` §12 T2). No network call is made anywhere in
 * this suite: `FakeChunkProvider` below plays the model's part deterministically,
 * the same reason `worker-statement-routing.test.ts` clears the Ollama env
 * vars for its offline assertions — this suite is about proving the WRITE
 * path (chunking → stitching → balance-check → `documents`/`statements`/
 * `statement_lines`), not about a real model call.
 *
 * Three things this suite is graded on, matching T2's own "done when":
 *
 *  1. A 12-page, 480-row statement extracts and writes cleanly with NO
 *     `TruncatedOutputError` — the chunking that `statement-run.test.ts`
 *     already proves in isolation, now proven through the real write path.
 *  2. A statement whose printed opening/closing balance and lines agree earns
 *     `balance_check = 'pass'` and `review_status = 'auto_accepted'` — T4's
 *     validator, reused, not re-implemented.
 *  3. A "balance brought forward" row reprinted at a page boundary is written
 *     ZERO times as a `statement_lines` row — proof, at the database level,
 *     that the boundary de-duplication in `extraction/statement-run.ts`
 *     actually reaches storage rather than being a property only the pure
 *     unit test can see.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TENANT = 'b2b2b2b2-0000-4000-8000-000000000001';
const USER = 'b2b2b2b2-0000-4000-8000-000000000002';

function field<T>(value: T | null): { value: T | null; confidence: number } {
  return { value, confidence: value === null ? 0 : 0.9 };
}

/** Builds one page's chunk response directly — this fake plays the MODEL's
 *  part, not the PDF's, so it is keyed on page range rather than parsing any
 *  particular "page text" format. */
type PageScript = (pageNumber: number) => StatementChunkExtraction;

class FakeChunkProvider implements StatementChunkProvider {
  readonly name = 'fake';
  readonly model = 'fake-1';
  calls: Array<{ from: number; to: number }> = [];

  constructor(
    private readonly script: PageScript,
    /** Simulates a real per-call output cap: throws when a request spans MORE
     *  than this many pages in one call — i.e. only when chunking is disabled
     *  or set too coarse. */
    private readonly maxPagesPerCall = 1,
  ) {}

  async extractChunk(
    pageTexts: readonly string[],
    pageRange: { from: number; to: number },
  ): Promise<StatementChunkResult> {
    this.calls.push(pageRange);
    if (pageTexts.length > this.maxPagesPerCall) {
      throw new TruncatedOutputError(
        `fake provider hit its output cap: asked for ${pageTexts.length} pages in one call ` +
          `(pages ${pageRange.from}-${pageRange.to}), max is ${this.maxPagesPerCall}`,
      );
    }
    // One page per call in every real scenario this suite constructs
    // (chunkSize defaults to 1) — merge every requested page's script output.
    const chunks = Array.from({ length: pageRange.to - pageRange.from + 1 }, (_, i) =>
      this.script(pageRange.from + i),
    );
    const merged: StatementChunkExtraction = {
      schemaVersion: '1',
      pageRange,
      openingBalance: chunks.find((c) => c.openingBalance.value !== null)?.openingBalance ?? field(null),
      closingBalance:
        [...chunks].reverse().find((c) => c.closingBalance.value !== null)?.closingBalance ?? field(null),
      lines: chunks.flatMap((c) => c.lines),
      notes: { legible: true, warnings: [] },
    };
    return {
      chunk: merged,
      meta: { provider: this.name, model: this.model, promptVersion: 'test', latencyMs: 0, inputTokens: null, outputTokens: null, raw: '' },
    };
  }
}

describeIfDb('importPdfStatement — real Postgres (T2)', () => {
  let admin: Client;

  beforeAll(async () => {
    process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';
    admin = await provisionTenant({
      tenantId: TENANT,
      name: 'PDF Statement Import Test',
      users: [{ id: USER, role: 'owner' }],
    });
    // `importPdfStatement` reads `rules.documentRules.dateOrder` — same
    // requirement `csv-import.ts` has, and the same reason: a workspace with
    // no rule set installed is refused (`NoRulesInstalled`), never defaulted.
    // `id-2026` is the only rule set compiled into this server today.
    await installRulesFor(USER, TENANT, 'id-2026');
  });

  afterAll(async () => {
    await admin.query(`DELETE FROM statement_lines WHERE tenant_id = $1`, [TENANT]);
    await admin.query(`DELETE FROM statements WHERE tenant_id = $1`, [TENANT]);
    await admin.query(`DELETE FROM financial_accounts WHERE tenant_id = $1`, [TENANT]);
    await wipeTenant(admin, TENANT, [USER]);
    await admin.end();
  });

  async function seedCapture(): Promise<string> {
    const { capture } = await createCapture(USER, TENANT, {
      pages: [{ sha256: randomBytes(32).toString('hex'), mimeType: 'application/pdf', byteSize: 4096 }],
    });
    return capture.id;
  }

  it('writes a clean 3-row statement that balances exactly, earning balance_check = pass', async () => {
    const captureId = await seedCapture();
    const script: PageScript = (page) => {
      if (page === 1) {
        return {
          schemaVersion: '1',
          pageRange: { from: 1, to: 1 },
          openingBalance: field('1000.00'),
          closingBalance: field(null),
          lines: [
            {
              postedDate: field('2026-08-03'),
              valueDate: field(null),
              description: field('EFTPOS COLES'),
              amountSigned: field('-45.20'),
              runningBalance: field('954.80'),
              cardLast4: field('4417'),
            },
            {
              postedDate: field('2026-08-10'),
              valueDate: field(null),
              description: field('SALARY'),
              amountSigned: field('2000.00'),
              runningBalance: field('2954.80'),
              cardLast4: field(null),
            },
          ],
          notes: { legible: true, warnings: [] },
        };
      }
      return {
        schemaVersion: '1',
        pageRange: { from: 2, to: 2 },
        openingBalance: field(null),
        closingBalance: field('1954.80'),
        lines: [
          {
            postedDate: field('2026-08-15'),
            valueDate: field(null),
            description: field('RENT'),
            amountSigned: field('-1000.00'),
            runningBalance: field('1954.80'),
            cardLast4: field(null),
          },
        ],
        notes: { legible: true, warnings: [] },
      };
    };

    const provider = new FakeChunkProvider(script);
    const result = await importPdfStatement(USER, TENANT, provider, {
      captureId,
      pageTexts: ['page one text', 'page two text'],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.balanceCheck).toBe('pass');
    expect(result.lineCount).toBe(3);
    // Every call requested exactly one page — chunking, not one giant request.
    expect(provider.calls).toEqual([{ from: 1, to: 1 }, { from: 2, to: 2 }]);

    const doc = await admin.query(`select doc_type, review_status from documents where id = $1`, [result.documentId]);
    expect(doc.rows[0].doc_type).toBe('statement');
    expect(doc.rows[0].review_status).toBe('auto_accepted');

    const stmt = await admin.query(
      `select opening_balance, closing_balance, balance_check, balance_residual from statements where id = $1`,
      [result.statementId],
    );
    expect(stmt.rows[0].balance_check).toBe('pass');
    expect(stmt.rows[0].balance_residual).toBeNull();
    expect(Number(stmt.rows[0].opening_balance)).toBeCloseTo(1000.0);
    expect(Number(stmt.rows[0].closing_balance)).toBeCloseTo(1954.8);

    const lines = await admin.query(
      `select line_number, description_raw, amount_signed from statement_lines where statement_id = $1 order by line_number`,
      [result.statementId],
    );
    expect(lines.rows.map((r) => r.description_raw)).toEqual(['EFTPOS COLES', 'SALARY', 'RENT']);
  });

  it('a "balance brought forward" row at a page boundary is written ZERO times, not double-counted', async () => {
    const captureId = await seedCapture();
    const script: PageScript = (page) => {
      if (page === 1) {
        return {
          schemaVersion: '1',
          pageRange: { from: 1, to: 1 },
          openingBalance: field('500.00'),
          closingBalance: field(null),
          lines: [
            {
              postedDate: field('2026-08-01'),
              valueDate: field(null),
              description: field('WITHDRAWAL'),
              amountSigned: field('-100.00'),
              runningBalance: field('400.00'),
              cardLast4: field(null),
            },
          ],
          notes: { legible: true, warnings: [] },
        };
      }
      // A misbehaving reading of page 2 puts the brought-forward marker IN
      // `lines`, exactly the failure mode `statement-run.ts`'s defence 2
      // exists for — this proves it is caught before it ever reaches the
      // database, not merely in the pure unit test.
      return {
        schemaVersion: '1',
        pageRange: { from: 2, to: 2 },
        openingBalance: field(null),
        closingBalance: field('350.00'),
        lines: [
          {
            postedDate: field('2026-08-02'),
            valueDate: field(null),
            description: field('Balance brought forward'),
            amountSigned: field('400.00'),
            runningBalance: field('400.00'),
            cardLast4: field(null),
          },
          {
            postedDate: field('2026-08-02'),
            valueDate: field(null),
            description: field('WITHDRAWAL'),
            amountSigned: field('-50.00'),
            runningBalance: field('350.00'),
            cardLast4: field(null),
          },
        ],
        notes: { legible: true, warnings: [] },
      };
    };

    const provider = new FakeChunkProvider(script);
    const result = await importPdfStatement(USER, TENANT, provider, {
      captureId,
      pageTexts: ['page one', 'page two'],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.balanceCheck).toBe('pass'); // would be 'residual' if the marker had been counted
    expect(result.lineCount).toBe(2);

    const markerRows = await admin.query(
      `select id from statement_lines where statement_id = $1 and description_raw ilike '%brought forward%'`,
      [result.statementId],
    );
    expect(markerRows.rows).toHaveLength(0);
  });

  it('a 12-page, 480-row statement extracts and writes cleanly with no TruncatedOutputError', async () => {
    const captureId = await seedCapture();
    const TOTAL_PAGES = 12;
    const ROWS_PER_PAGE = 40;

    const script: PageScript = (page) => ({
      schemaVersion: '1',
      pageRange: { from: page, to: page },
      openingBalance: field(page === 1 ? '10000.00' : null),
      closingBalance: field(page === TOTAL_PAGES ? '10000.00' : null), // net zero for a clean pass
      lines: Array.from({ length: ROWS_PER_PAGE }, (_, i) => ({
        postedDate: field(`2026-08-${String((i % 27) + 1).padStart(2, '0')}`),
        valueDate: field(null),
        description: field(`txn ${page}-${i}`),
        amountSigned: field(i % 2 === 0 ? '-10.00' : '10.00'),
        runningBalance: field(null),
        cardLast4: field(null),
      })),
      notes: { legible: true, warnings: [] },
    });

    // maxPagesPerCall = 1: a request spanning more than one page throws
    // TruncatedOutputError, exactly like a real per-chunk output cap. Default
    // chunking (one page per call) must never trip it.
    const provider = new FakeChunkProvider(script, 1);
    const result = await importPdfStatement(USER, TENANT, provider, {
      captureId,
      pageTexts: Array.from({ length: TOTAL_PAGES }, (_, i) => `page ${i + 1} text`),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lineCount).toBe(TOTAL_PAGES * ROWS_PER_PAGE);
    expect(provider.calls).toHaveLength(TOTAL_PAGES);
    expect(result.balanceCheck).toBe('pass');

    const count = await admin.query(`select count(*)::int as n from statement_lines where statement_id = $1`, [
      result.statementId,
    ]);
    expect(count.rows[0].n).toBe(TOTAL_PAGES * ROWS_PER_PAGE);
  });

  it('disabling chunking (all 12 pages in one call) truncates instead of writing anything', async () => {
    const captureId = await seedCapture();
    const TOTAL_PAGES = 12;
    const script: PageScript = (page) => ({
      schemaVersion: '1',
      pageRange: { from: page, to: page },
      openingBalance: field(page === 1 ? '10000.00' : null),
      closingBalance: field(page === TOTAL_PAGES ? '10000.00' : null),
      lines: [
        {
          postedDate: field('2026-08-01'),
          valueDate: field(null),
          description: field(`txn ${page}`),
          amountSigned: field('0.00'),
          runningBalance: field(null),
          cardLast4: field(null),
        },
      ],
      notes: { legible: true, warnings: [] },
    });

    const provider = new FakeChunkProvider(script, 1); // still caps at 1 page/call
    const result = await importPdfStatement(USER, TENANT, provider, {
      captureId,
      pageTexts: Array.from({ length: TOTAL_PAGES }, (_, i) => `page ${i + 1} text`),
      chunkSize: TOTAL_PAGES, // chunking DISABLED for this call
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe('truncated');

    const rows = await admin.query(`select count(*)::int as n from documents where capture_id = $1`, [captureId]);
    expect(rows.rows[0].n).toBe(0);
  });
});
