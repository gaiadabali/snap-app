import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ErrorsFilter } from '../common/errors.filter.js';
import type { StatementChunkProvider, StatementChunkResult } from '../extraction/statement-provider.js';
import type { StatementChunkExtraction } from '../extraction/statement-types.js';
import { createCapture } from '../repo.js';
import { provisionTenant, wipeTenant } from '../test-support/tenant.js';
import { installRulesFor } from '../taxrules/taxrules.repo.js';
import { importPdfStatement, MAX_STATEMENT_PAGES, StatementPageCapError } from './pdf-statement-import.js';

/**
 * The cost caps on statement extraction — Task 10 of the production-readiness
 * plan (audit item 20).
 *
 * `importPdfStatement` makes ONE paid model call per page (chunked,
 * `statement-run.ts`) and nothing above it had a ceiling that knew about
 * statements: the intake cap (`captures.controller.ts`'s
 * `MAX_CAPTURE_PAGES`) stops at 50 for the transport, and the worker fed
 * whatever page count a PDF demuxed to straight into the model loop. A
 * thousand-page statement was a thousand paid calls.
 *
 * Two caps, each proven here:
 *
 *  1. `MAX_STATEMENT_PAGES` — `importPdfStatement` refuses, with a typed
 *     `StatementPageCapError`, BEFORE a single provider call is made when the
 *     page text exceeds it. Refusal first
 *     (`taxrules.e2e.test.ts`'s own convention): a cap that has never
 *     rejected anything proves nothing, so the over-cap case is asserted
 *     against an empty `provider.calls` — proof no money was spent.
 *  2. A just-under-cap statement still imports, so the cap is a ceiling, not
 *     a cliff that fell on ordinary documents.
 *
 * The typed error's HTTP half — `ErrorsFilter` mapping it to 413 — is proven
 * below without a database, because the filter's job is only ever to look at
 * the error object it is handed.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TENANT = 'c4c4c4c4-0000-4000-8000-000000000001';
const USER = 'c4c4c4c4-0000-4000-8000-000000000002';

function field<T>(value: T | null): { value: T | null; confidence: number } {
  return { value, confidence: value === null ? 0 : 0.9 };
}

type PageScript = (pageNumber: number, totalPages: number) => StatementChunkExtraction;

/** One page per call, deterministic lines — the same fake the T2 suite uses,
 *  minus the TruncatedOutputError machinery this suite has no use for. */
class FakeChunkProvider implements StatementChunkProvider {
  readonly name = 'fake';
  readonly model = 'fake-1';
  calls: Array<{ from: number; to: number }> = [];

  constructor(private readonly script: PageScript) {}

  async extractChunk(
    pageTexts: readonly string[],
    pageRange: { from: number; to: number },
  ): Promise<StatementChunkResult> {
    this.calls.push(pageRange);
    const chunks = Array.from({ length: pageRange.to - pageRange.from + 1 }, (_, i) =>
      this.script(pageRange.from + i, pageTexts.length),
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

/** A statement whose every page reads cleanly: opening 10000, closing 10000,
 *  one 0.00 row per page — a guaranteed balance pass for any page count. */
const cleanScript: PageScript = (page, totalPages) => ({
  schemaVersion: '1',
  pageRange: { from: page, to: page },
  openingBalance: field(page === 1 ? '10000.00' : null),
  closingBalance: field(page === totalPages ? '10000.00' : null),
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

describeIfDb('the statement page cap (Task 10, item 20)', () => {
  let admin: Client;

  beforeAll(async () => {
    process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';
    admin = await provisionTenant({
      tenantId: TENANT,
      name: 'Page Cap Test Co',
      users: [{ id: USER, role: 'owner' }],
    });
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
    const { createHash } = await import('node:crypto');
    const { capture } = await createCapture(USER, TENANT, {
      pages: [{ sha256: createHash('sha256').update(String(Math.random())).digest('hex'), mimeType: 'application/pdf', byteSize: 4096 }],
    });
    return capture.id;
  }

  function pages(n: number): string[] {
    return Array.from({ length: n }, (_, i) => `page ${i + 1} text`);
  }

  it(`refuses a ${MAX_STATEMENT_PAGES + 1}-page import as a typed error, before a single model call`, async () => {
    const captureId = await seedCapture();
    const provider = new FakeChunkProvider(cleanScript);

    await expect(
      importPdfStatement(USER, TENANT, provider, {
        captureId,
        pageTexts: pages(MAX_STATEMENT_PAGES + 1),
      }),
    ).rejects.toBeInstanceOf(StatementPageCapError);

    // The whole point: no page was ever sent to the model.
    expect(provider.calls).toEqual([]);
  });

  it('imports a statement comfortably under the cap (30 pages)', async () => {
    const captureId = await seedCapture();
    const provider = new FakeChunkProvider(cleanScript);

    const result = await importPdfStatement(USER, TENANT, provider, {
      captureId,
      pageTexts: pages(30),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lineCount).toBe(30);
    expect(provider.calls).toHaveLength(30);
  });
});

describe('ErrorsFilter maps StatementPageCapError to 413', () => {
  it('answers 413 with an error code naming the cap, not a generic 500', () => {
    const sent: { status?: number; body?: unknown } = {};
    const reply = { status(code: number) { sent.status = code; return reply; }, send(body: unknown) { sent.body = body; } };
    const error = new StatementPageCapError(120, MAX_STATEMENT_PAGES);
    const host = {
      switchToHttp: () => ({
        getResponse: () => reply,
        getRequest: () => ({ method: 'PUT', url: '/v1/uploads/x' }),
      }),
    } as unknown as Parameters<ErrorsFilter['catch']>[1];

    new ErrorsFilter().catch(error, host);

    expect(sent.status).toBe(413);
    expect((sent.body as { error: string }).error).toBe('statement_page_cap');
    expect((sent.body as { message: string }).message).toMatch(/120 pages/);
    expect((sent.body as { message: string }).message).toMatch(/40-page/);
  });
});
