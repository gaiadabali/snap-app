import { readFileSync } from 'node:fs';

import { EXTRACTION_PROMPT, PROMPT_VERSION } from './prompt.js';
import type { Extraction, ExtractedLine, Field } from './types.js';

/**
 * Where the reading happens.
 *
 * An interface with two implementations, because the plan calls for Claude on
 * Bedrock in `ap-southeast-2` — inference in Sydney, so a receipt never
 * becomes a cross-border disclosure under APP 8 — while development needs
 * something that costs nothing today.
 *
 * The seam is the same idea as the mobile app's `SnapApi`: swapping the
 * provider must not touch the validators, the queue or the schema. What comes
 * back is checked in code either way, because no provider is trusted.
 */

export type ProviderResult = {
  extraction: Extraction;
  meta: {
    provider: string;
    model: string;
    promptVersion: string;
    /** Wall-clock, for the cost model and for spotting a degraded endpoint. */
    latencyMs: number;
    inputTokens: number | null;
    outputTokens: number | null;
    /** The raw text, stored so a parse failure can be diagnosed later. */
    raw: string;
  };
};

/** One page's bytes, ready to hand to a vision model. */
export type PageImage = { bytes: Buffer; mimeType: string };

/**
 * The model ran out of output budget, rather than failing to read.
 *
 * Distinguished from every other provider failure because the correct response
 * is the opposite one: escalation is right when a reader got it wrong, and
 * pointless when the limit belongs to us. A stronger model given the same cap
 * stops in the same place.
 */
export class TruncatedOutputError extends Error {
  readonly name = 'TruncatedOutputError';
}

export interface ExtractionProvider {
  readonly name: string;
  readonly model: string;
  /**
   * A single page, or every page of a multi-page capture, in page order.
   *
   * One call for the whole document, not one per page: a tax invoice's GST
   * summary routinely lands on its second page, and reading pages separately
   * would need to reconcile two partial, possibly contradictory readings of
   * one document instead of asking a model that can already look at several
   * images in one turn to read them together — the same way a person would
   * flip through the pages once rather than read each in isolation.
   */
  extract(pages: PageImage | PageImage[]): Promise<ProviderResult>;
}

/* ── Parsing ─────────────────────────────────────────────────────────────── */

const asField = <T>(raw: unknown, coerce: (v: unknown) => T | null): Field<T> => {
  if (raw == null || typeof raw !== 'object') return { value: null, confidence: 0 };
  const o = raw as { value?: unknown; confidence?: unknown };
  const confidence =
    typeof o.confidence === 'number' && o.confidence >= 0 && o.confidence <= 1
      ? o.confidence
      : 0;
  return { value: o.value == null ? null : coerce(o.value), confidence };
};

const str = (v: unknown): string | null => {
  const s = String(v).trim();
  return s === '' ? null : s;
};
const digits = (v: unknown): string | null => {
  const d = String(v).replace(/\D/g, '');
  return d === '' ? null : d;
};
const decimal = (v: unknown): string | null => {
  // Tolerates "$1,848.00" and "1 848,00" — models produce both, and the
  // alternative to accepting them is discarding a correct reading over
  // punctuation.
  const cleaned = String(v).replace(/[^0-9.,-]/g, '');
  const normalised =
    cleaned.includes(',') && !cleaned.includes('.')
      ? cleaned.replace(',', '.')
      : cleaned.replace(/,/g, '');
  const n = Number(normalised);
  return Number.isFinite(n) ? n.toFixed(4) : null;
};
const bool = (v: unknown): boolean | null => {
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  if (s === 'true' || s === 'yes') return true;
  if (s === 'false' || s === 'no') return false;
  return null;
};
const int = (v: unknown): number | null => {
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/**
 * Turns a model's text into an `Extraction`, or throws.
 *
 * Exported and tested separately from the network call: a malformed response
 * is the most likely failure in the whole pipeline and the easiest to test
 * without spending money.
 */
export function parseExtraction(text: string): Extraction {
  let body = text.trim();
  // Models wrap JSON in fences despite being told not to.
  if (body.startsWith('```')) {
    const parts = body.split('```');
    body = parts[1] ?? body;
    if (body.startsWith('json')) body = body.slice(4);
  }
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('No JSON object in the response.');

  const raw = JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
  const notes = (raw.notes ?? {}) as Record<string, unknown>;

  const lines: ExtractedLine[] = Array.isArray(raw.lines)
    ? (raw.lines as unknown[]).map((l) => {
        const o = (l ?? {}) as Record<string, unknown>;
        return {
          description: asField(o.description, str),
          quantity: asField(o.quantity, int),
          unitPrice: asField(o.unitPrice, decimal),
          amount: asField(o.amount, decimal),
          gstFree: asField(o.gstFree, bool),
        };
      })
    : [];

  return {
    schemaVersion: '1',
    docType: asField(raw.docType, (v) => {
      const s = String(v);
      return (['tax_invoice', 'receipt', 'invoice', 'statement', 'unknown'] as const).includes(
        s as never,
      )
        ? (s as Extraction['docType']['value'])
        : 'unknown';
    }),
    saysTaxInvoice: asField(raw.saysTaxInvoice, bool),
    documentNumber: asField(raw.documentNumber, str),
    issueDate: asField(raw.issueDate, str),
    currency: asField(raw.currency, str),
    supplierName: asField(raw.supplierName, str),
    supplierAbn: asField(raw.supplierAbn, digits),
    buyerIdentified: asField(raw.buyerIdentified, bool),
    taxExclusiveAmount: asField(raw.taxExclusiveAmount, decimal),
    taxAmount: asField(raw.taxAmount, decimal),
    payableAmount: asField(raw.payableAmount, decimal),
    lines,
    notes: {
      legible: notes.legible !== false,
      imageIssues: Array.isArray(notes.imageIssues) ? notes.imageIssues.map(String) : [],
      warnings: Array.isArray(notes.warnings) ? notes.warnings.map(String) : [],
    },
  };
}

/* ── Ollama Cloud, the development tier ─────────────────────────────────── */

/**
 * OpenAI-compatible vision call against Ollama Cloud.
 *
 * For development only, and deliberately not the production path: the account
 * is shared and weekly-rate-limited, and inference location is not guaranteed
 * to be in Australia — which matters, because sending a receipt offshore is a
 * cross-border disclosure under APP 8.
 *
 * Measured on a photographed, creased, glare-covered docket: `gemma4:31b`
 * extracted all eight checked fields correctly in ~3s for ~600 tokens.
 */
export class OllamaCloudProvider implements ExtractionProvider {
  readonly name = 'ollama-cloud';

  constructor(
    readonly model = 'gemma4:31b',
    private readonly apiKey = readKeyFromEnvFile(),
    private readonly baseUrl = 'https://ollama.com/v1',
    /**
     * The prompt to send, when the workspace is not Australian.
     *
     * Defaults to `EXTRACTION_PROMPT`, which names Australia in ten places and
     * tells the model that tax is one eleventh and an ABN has eleven digits.
     * Sending that to a model reading an Indonesian docket does not merely
     * waste tokens — it instructs it to look for things that are not there.
     */
    private readonly prompt: string = EXTRACTION_PROMPT,
  ) {}

  async extract(pages: PageImage | PageImage[]): Promise<ProviderResult> {
    const images = Array.isArray(pages) ? pages : [pages];
    if (images.length === 0) throw new Error(`${this.name} was given no pages to read.`);

    const started = Date.now();
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: 'user',
            content: [
              // One prompt, then every page in order: the OpenAI content-array
              // shape lets several images ride one user turn, which is what
              // lets the model read a two-page invoice as one document
              // instead of two independent guesses that then have to be
              // reconciled.
              { type: 'text', text: this.prompt },
              ...images.map((image) => ({
                type: 'image_url' as const,
                image_url: {
                  url: `data:${image.mimeType};base64,${image.bytes.toString('base64')}`,
                },
              })),
            ],
          },
        ],
        // Zero, because extraction is a reading task and not a creative one:
        // the same image must produce the same answer, or a replay proves
        // nothing.
        temperature: 0,
        // Sized for the document, not for a corner-shop docket. A two-page
        // invoice with 40 line items produced ~7,000 characters of JSON and
        // was cut off mid-value at the old 2,000-token cap — which surfaced
        // as a *parse* error, so the router escalated through all four models,
        // each one truncating at exactly the same place. See the truncation
        // check below: the cap is now generous, and running into it is
        // reported as what it is.
        max_tokens: 16000,
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
    if (!raw) throw new Error(`${this.name} returned an empty response.`);

    // Truncation is not a reading failure, and must not be treated as one.
    // A cut-off response is unparseable, so it used to arrive as a JSON error
    // and send the router escalating to a stronger model — which truncates
    // identically, because the cap is ours and not the model's. Named as its
    // own failure so the worker can stop rather than spend four model calls
    // proving the same thing.
    if (data.choices?.[0]?.finish_reason === 'length') {
      throw new TruncatedOutputError(
        `${this.name} ${this.model} hit the ${16000}-token output cap after ` +
          `${data.usage?.completion_tokens ?? 'unknown'} tokens. The document is longer than ` +
          'the cap allows; raise it or split the document rather than re-reading it.',
      );
    }

    return {
      extraction: parseExtraction(raw),
      meta: {
        provider: this.name,
        model: this.model,
        promptVersion: PROMPT_VERSION,
        latencyMs: Date.now() - started,
        inputTokens: data.usage?.prompt_tokens ?? null,
        outputTokens: data.usage?.completion_tokens ?? null,
        raw,
      },
    };
  }
}

/**
 * Reads the key from the environment, or from the operator's env file.
 *
 * Never logged, never returned, never included in an error message — an error
 * that helpfully prints the credential it failed with is how keys end up in
 * log aggregators.
 */
function readKeyFromEnvFile(): string {
  const fromEnv = process.env.OLLAMA_API_KEY ?? process.env.OLLAMA_CLOUD_API_KEY;
  if (fromEnv) return fromEnv;

  const path = process.env.OLLAMA_ENV_FILE;
  if (path) {
    try {
      for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq < 0) continue;
        const key = trimmed.slice(0, eq);
        if (/KEY|TOKEN/i.test(key)) {
          return trimmed
            .slice(eq + 1)
            .trim()
            .replace(/^["']|["']$/g, '');
        }
      }
    } catch {
      /* fall through to the error below */
    }
  }
  throw new Error(
    'No extraction provider key. Set OLLAMA_API_KEY, or OLLAMA_ENV_FILE to a file containing it.',
  );
}

/* ── Production, not yet wired ──────────────────────────────────────────── */

/**
 * Claude on Bedrock in ap-southeast-2 — the production path.
 *
 * Deliberately a stub that throws rather than a silent fallback to the
 * development provider. A pipeline that quietly sends Australian tax records
 * offshore because a credential was missing is exactly the failure APP 8
 * exists to prevent, so it fails loudly instead.
 */
export class BedrockClaudeProvider implements ExtractionProvider {
  readonly name = 'bedrock-claude';

  constructor(readonly model = 'anthropic.claude-haiku-4-5', readonly region = 'ap-southeast-2') {}

  extract(): Promise<ProviderResult> {
    return Promise.reject(
      new Error(
        `${this.name} is not wired up yet. It needs AWS credentials and a Bedrock model grant in ${this.region}; ` +
          'until then run extraction with the development provider explicitly.',
      ),
    );
  }
}
