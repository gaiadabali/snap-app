import { statementChunkPrompt, STATEMENT_PROMPT_VERSION } from './statement-prompt.js';
import { asField, decimal, readOllamaCloudKey, str, TruncatedOutputError } from './provider.js';
import { maskCardLast4 } from './types.js';
import type { StatementChunkExtraction } from './statement-types.js';

/**
 * Reading one statement CHUNK — the text-only sibling of `provider.ts`'s
 * `ExtractionProvider` (`docs/STATEMENTS.md` §12 T2).
 *
 * A separate interface, not a reuse of `ExtractionProvider`, because the two
 * genuinely take different input: a receipt page is PIXELS (a photograph or a
 * rendered PDF page, because Phase 0/1 has no reading stage that trusts a
 * text layer directly — `extraction/pdf.ts`'s header). A native-text
 * statement's whole cost argument (§5.2) is that it needs NEITHER
 * rasterisation nor a vision model — its own embedded text
 * (`extractPdfText`) goes straight to a TEXT chat completion. Forcing that
 * through `ExtractionProvider.extract(pages: PageImage[])` would mean
 * wrapping plain text back into a fake image just to satisfy a shape it never
 * needed, which is the opposite of the cost saving this ticket exists for.
 */
export interface StatementChunkResult {
  chunk: StatementChunkExtraction;
  meta: {
    provider: string;
    model: string;
    promptVersion: string;
    latencyMs: number;
    inputTokens: number | null;
    outputTokens: number | null;
    raw: string;
  };
}

export interface StatementChunkProvider {
  readonly name: string;
  readonly model: string;
  /**
   * `pageTexts` are the chunk's pages, in order, exactly as
   * `extractPdfText` returned them — no rasterisation, no images.
   * `pageRange` is 1-based and inclusive, addressing the WHOLE statement's
   * page numbering (so a caller can log/refuse against "page 7 of 12", not
   * "chunk 3 of the chunks we happened to make").
   */
  extractChunk(
    pageTexts: readonly string[],
    pageRange: { from: number; to: number },
    totalPages: number,
    dateOrder: 'day_first' | 'month_first',
    currency: string,
  ): Promise<StatementChunkResult>;
}

/**
 * Turns a model's text into a `StatementChunkExtraction`, or throws.
 *
 * Exported and tested separately from the network call, same reasoning as
 * `provider.ts#parseExtraction`: a malformed response is the likeliest
 * failure and the cheapest one to test. Reuses `asField`/`str`/`decimal` from
 * `provider.ts` rather than re-deriving them — the same coercion questions
 * ("is this a real number", "is this blank") apply to both schemas.
 */
export function parseStatementChunk(text: string, pageRange: { from: number; to: number }): StatementChunkExtraction {
  let body = text.trim();
  if (body.startsWith('```')) {
    const parts = body.split('```');
    body = parts[1] ?? body;
    if (body.startsWith('json')) body = body.slice(4);
  }
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('No JSON object in the statement chunk response.');

  const raw = JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
  const notes = (raw.notes ?? {}) as Record<string, unknown>;

  // The ONE place a model's answer becomes a `cardLast4` for a statement row
  // — the same discipline `provider.ts#parseExtraction` applies to the
  // receipt schema, so a full or partial PAN can never survive parsing
  // regardless of which schema produced it.
  const cardLast4 = (v: unknown): string | null => maskCardLast4(v == null ? null : String(v));

  const lines = Array.isArray(raw.lines)
    ? (raw.lines as unknown[]).map((l) => {
        const o = (l ?? {}) as Record<string, unknown>;
        return {
          postedDate: asField(o.postedDate, str),
          valueDate: asField(o.valueDate, str),
          description: asField(o.description, str),
          amountSigned: asField(o.amountSigned, decimal),
          runningBalance: asField(o.runningBalance, decimal),
          cardLast4: asField(o.cardLast4, cardLast4),
        };
      })
    : [];

  return {
    schemaVersion: '1',
    pageRange,
    openingBalance: asField(raw.openingBalance, decimal),
    closingBalance: asField(raw.closingBalance, decimal),
    lines,
    notes: {
      legible: notes.legible !== false,
      warnings: Array.isArray(notes.warnings) ? notes.warnings.map(String) : [],
    },
  };
}

/**
 * OpenAI-compatible TEXT chat completion against Ollama Cloud — the
 * development tier, same account and endpoint `provider.ts`'s
 * `OllamaCloudProvider` uses, but a `content` array of ONE text block instead
 * of a prompt plus N images. See this file's header for why that is not
 * merely an optimisation but the entire cost argument for statement intake.
 */
export class OllamaCloudStatementProvider implements StatementChunkProvider {
  readonly name = 'ollama-cloud';

  constructor(
    readonly model = 'gemma4:31b',
    private readonly apiKey = readOllamaCloudKey(),
    private readonly baseUrl = 'https://ollama.com/v1',
    /**
     * Output budget PER CHUNK. Deliberately much smaller than the receipt
     * path's 16,000 — a single page's worth of rows is the whole point of
     * chunking (`statement-run.ts`'s header), so a chunk response that still
     * hits this cap means the chunk itself (not the whole document) is too
     * big, and `runStatementExtraction` reports that chunk's page range
     * rather than escalating the entire statement to a stronger model for no
     * reason (the cap is ours, same reasoning `run.ts` already documents for
     * the receipt path).
     */
    private readonly maxTokens = 4000,
  ) {}

  async extractChunk(
    pageTexts: readonly string[],
    pageRange: { from: number; to: number },
    totalPages: number,
    dateOrder: 'day_first' | 'month_first',
    currency: string,
  ): Promise<StatementChunkResult> {
    if (pageTexts.length === 0) throw new Error(`${this.name} was given no pages to read.`);

    const prompt = statementChunkPrompt({
      pageFrom: pageRange.from,
      pageTo: pageRange.to,
      totalPages,
      dateOrder,
      currency,
    });

    const body =
      `${prompt}\n\n--- PAGE TEXT (pages ${pageRange.from}-${pageRange.to}) ---\n\n` +
      pageTexts.map((t, i) => `[page ${pageRange.from + i}]\n${t}`).join('\n\n');

    const started = Date.now();
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: body }],
        temperature: 0,
        max_tokens: this.maxTokens,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        `${this.name} ${this.model} returned ${response.status}: ${detail.slice(0, 300)}`,
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const raw = data.choices?.[0]?.message?.content ?? '';
    if (!raw) throw new Error(`${this.name} returned an empty response for pages ${pageRange.from}-${pageRange.to}.`);

    if (data.choices?.[0]?.finish_reason === 'length') {
      throw new TruncatedOutputError(
        `${this.name} ${this.model} hit the ${this.maxTokens}-token output cap reading pages ` +
          `${pageRange.from}-${pageRange.to} after ${data.usage?.completion_tokens ?? 'unknown'} tokens. ` +
          'This chunk is too big even on its own; raise the per-chunk cap or shrink the chunk size ' +
          '(fewer pages per call) rather than re-reading the whole statement.',
      );
    }

    return {
      chunk: parseStatementChunk(raw, pageRange),
      meta: {
        provider: this.name,
        model: this.model,
        promptVersion: STATEMENT_PROMPT_VERSION,
        latencyMs: Date.now() - started,
        inputTokens: data.usage?.prompt_tokens ?? null,
        outputTokens: data.usage?.completion_tokens ?? null,
        raw,
      },
    };
  }
}
