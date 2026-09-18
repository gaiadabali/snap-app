import { OPENING_BALANCE_PATTERNS, CLOSING_BALANCE_PATTERNS } from './classify.js';
import { TruncatedOutputError } from './provider.js';
import type { StatementChunkExtraction } from './statement-types.js';
import type { StatementChunkProvider } from './statement-provider.js';

/**
 * Chunking a statement across pages, and stitching the chunks back into one
 * ordered set of rows (`docs/STATEMENTS.md` §12 T2 — the technical core of
 * this ticket).
 *
 * ── Why per page, and why that is "chunking" and not an arbitrary choice ──
 *
 * `docs/STATEMENTS.md` §5.2: "A 12-page statement with 300 rows will hit
 * [the output cap]. The statement path must therefore extract per page..."
 * `extraction/pdf.ts#extractPdfText` already hands back one string PER PAGE,
 * in page order, with no rasterisation — so a page is not merely a convenient
 * boundary, it is the unit the upstream reader already produces. Chunking at
 * any coarser grain (say, three pages per call) would mean re-joining page
 * texts here just to re-split them by an arbitrary token estimate; chunking
 * at a finer grain than one page is not possible without re-parsing the PDF
 * with a sub-page granularity `pdf.ts` does not offer. `STATEMENT_CHUNK_PAGES`
 * is exported (rather than hard-coded inline) so a future statement with an
 * unusually sparse page (a cover sheet, a disclosures page) COULD batch
 * several pages per call without changing this module's shape — but the
 * shipped default is 1, because that is the size that is *always* safe
 * regardless of how dense any given page turns out to be.
 *
 * ── The double-counting hazard, and how this file closes it ────────────────
 *
 * A statement's own layout creates exactly one way to double-count a row
 * across a chunk boundary: a "balance brought forward" / "balance carried
 * forward" line reprinted at the top of every page after the first. It is
 * not a movement — it is the SAME money as the previous page's closing
 * running balance, restated. If a per-page reader treated it as an ordinary
 * transaction row, the stitched statement would include that balance twice:
 * once as the implicit total of everything before it, and once again as an
 * explicit line, and `balance-check.ts`'s identity
 * (`opening + Σlines = closing`) would fail on every multi-page statement
 * that carries a balance forward — which is most of them.
 *
 * Two independent defences, not one, because a model instruction alone is a
 * SHOULD, not a WON'T:
 *
 *  1. The schema and prompt (`statement-schema.json`, `statement-prompt.ts`)
 *     give a brought-forward figure its OWN field — `openingBalance` /
 *     `closingBalance` on the chunk — and explicitly forbid putting it in
 *     `lines`. A well-behaved model never emits the row as a line at all, so
 *     there is nothing to de-duplicate.
 *  2. `stitchChunks` below filters `lines` a second time regardless, dropping
 *     any row whose description matches the SAME balance-marker patterns
 *     `classify.ts` already uses to spot a statement in the first place
 *     (`OPENING_BALANCE_PATTERNS` / `CLOSING_BALANCE_PATTERNS`, both AU and ID
 *     phrasing). A misbehaving model that ignores rule 3 of the prompt still
 *     cannot make it into `statement_lines` as a phantom transaction.
 *
 * Failure mode if this is ever wrong in the OTHER direction — a genuine
 * transaction happens to be worded like "balance transfer" and gets
 * misclassified as a marker and dropped — is not silent: dropping a real row
 * changes the line sum, `balance-check.ts#computeBalanceCheck` reports a
 * non-zero residual, and `findRunningBalanceGap` names the exact row range
 * where the running balance first stops agreeing with the previous row plus
 * its amount. The check that proves the stitch worked (`docs/STATEMENTS.md`
 * §5.2's own framing) is the same check that would catch this file getting
 * it wrong.
 *
 * ── Row ordering across chunks ──────────────────────────────────────────
 *
 * Chunks are requested and stitched STRICTLY in page order — `runStatement
 * Extraction` never issues chunk N+1 before chunk N has returned, and never
 * reorders results. `line_number` (assigned in `stitchChunks`) is therefore a
 * running counter over "every non-marker row, in the order its chunk was
 * processed, in the order the model printed it within that chunk" — the same
 * guarantee `docs/extraction-schema.json`'s `lines[].line_number` gives via
 * array position (S0's contract test note on that field applies here too:
 * position IS the line number, not a value that could disagree with it).
 */

export const STATEMENT_CHUNK_PAGES = 1;

export interface PageChunk {
  from: number;
  to: number;
  texts: string[];
}

/** Groups consecutive 1-based pages into runs of `chunkSize`. */
export function chunkPageTexts(pageTexts: readonly string[], chunkSize: number = STATEMENT_CHUNK_PAGES): PageChunk[] {
  if (chunkSize < 1) throw new Error(`chunkSize must be at least 1, got ${chunkSize}.`);
  const chunks: PageChunk[] = [];
  for (let i = 0; i < pageTexts.length; i += chunkSize) {
    const texts = pageTexts.slice(i, i + chunkSize);
    chunks.push({ from: i + 1, to: i + texts.length, texts });
  }
  return chunks;
}

export interface StitchedStatementLine {
  /** Position across the WHOLE stitched statement — see the header note. */
  lineNumber: number;
  postedDate: string | null;
  valueDate: string | null;
  descriptionRaw: string | null;
  /** Decimal string, the page's own arithmetic sign (see `statement-types.ts`). Never null for a kept row. */
  amountSigned: string;
  runningBalance: string | null;
  cardLast4: string | null;
  /** Which chunk (by page range) this row came from — for a refusal message that can name a page. */
  fromPageRange: { from: number; to: number };
}

export interface StitchResult {
  lines: StitchedStatementLine[];
  /** The first non-null `openingBalance` found, scanning chunks in page order. */
  openingBalance: string | null;
  /** The last non-null `closingBalance` found, scanning chunks in page order. */
  closingBalance: string | null;
  /** Rows excluded because their description matched a balance-marker pattern — see defence 2 above. */
  droppedBoundaryMarkers: number;
  /** Rows excluded because they had neither a usable date nor a usable amount — not a marker, just unreadable. */
  droppedUnreadable: number;
}

function looksLikeBalanceMarker(description: string | null): boolean {
  if (!description) return false;
  return (
    OPENING_BALANCE_PATTERNS.some((r) => r.test(description)) ||
    CLOSING_BALANCE_PATTERNS.some((r) => r.test(description))
  );
}

/**
 * Stitches every chunk's rows into one ordered, de-duplicated statement.
 *
 * Pure and synchronous — no I/O — so it is testable without a model call,
 * the same discipline `classify.ts#classifyExtractedText` follows for the
 * same reason.
 */
export function stitchChunks(chunks: readonly StatementChunkExtraction[]): StitchResult {
  const lines: StitchedStatementLine[] = [];
  let openingBalance: string | null = null;
  let closingBalance: string | null = null;
  let droppedBoundaryMarkers = 0;
  let droppedUnreadable = 0;

  for (const chunk of chunks) {
    if (openingBalance === null && chunk.openingBalance.value !== null) {
      openingBalance = chunk.openingBalance.value;
    }
    if (chunk.closingBalance.value !== null) {
      closingBalance = chunk.closingBalance.value;
    }

    for (const line of chunk.lines) {
      const description = line.description.value;

      // Defence 2 (see this file's header): a straggler balance-marker row
      // that made it into `lines` despite the prompt's rule 3 is dropped
      // here, never inserted as a transaction.
      if (looksLikeBalanceMarker(description)) {
        droppedBoundaryMarkers++;
        continue;
      }

      if (line.amountSigned.value === null) {
        // Not a marker, just nothing usable — a row this unreadable cannot
        // become a `statement_lines.amount_signed` (NOT NULL), so it is
        // dropped and counted rather than silently coerced to zero, which
        // would corrupt the balance check instead of merely failing it.
        droppedUnreadable++;
        continue;
      }

      lines.push({
        lineNumber: lines.length + 1,
        postedDate: line.postedDate.value,
        valueDate: line.valueDate.value,
        descriptionRaw: description,
        amountSigned: line.amountSigned.value,
        runningBalance: line.runningBalance.value,
        cardLast4: line.cardLast4.value,
        fromPageRange: chunk.pageRange,
      });
    }
  }

  return { lines, openingBalance, closingBalance, droppedBoundaryMarkers, droppedUnreadable };
}

export type StatementExtractionOutcome =
  | { ok: true; stitched: StitchResult; chunkCount: number }
  | {
      ok: false;
      /** Mirrors `run.ts#RunFailure.stage` — 'truncated' stops escalation, same reasoning. */
      stage: 'truncated' | 'parse' | 'provider';
      error: string;
      pageRange: { from: number; to: number };
    };

/**
 * Runs every chunk in strict page order and stitches the results.
 *
 * Chunks are awaited sequentially, not `Promise.all`-ed: `chunkSize` pages
 * are read as ONE statement, and row order must reflect page order exactly,
 * which a caller could not guarantee from concurrently-settling promises
 * without re-sorting afterward — sequential is simpler and provably ordered.
 *
 * On any chunk failure, stops immediately and reports which page range
 * failed and why — it does NOT attempt the remaining chunks and stitch a
 * partial statement, because a statement with an unexplained gap in its
 * pages is worse than a statement that visibly failed to read at all (the
 * same "worse than an unrouted one" asymmetry `classify.ts`'s header argues
 * for a different decision in this same ticket).
 */
export async function runStatementExtraction(
  provider: StatementChunkProvider,
  pageTexts: readonly string[],
  dateOrder: 'day_first' | 'month_first',
  currency: string,
  chunkSize: number = STATEMENT_CHUNK_PAGES,
): Promise<StatementExtractionOutcome> {
  const chunks = chunkPageTexts(pageTexts, chunkSize);
  const results: StatementChunkExtraction[] = [];

  for (const c of chunks) {
    try {
      const { chunk } = await provider.extractChunk(c.texts, { from: c.from, to: c.to }, pageTexts.length, dateOrder, currency);
      results.push(chunk);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        // Truncation is kept distinct from a parse failure for the identical
        // reason `run.ts` gives: a stronger model given the same per-chunk
        // cap truncates in the same place, so escalating wastes a call.
        stage: error instanceof TruncatedOutputError ? 'truncated' : /JSON|json|parse/.test(message) ? 'parse' : 'provider',
        error: message,
        pageRange: { from: c.from, to: c.to },
      };
    }
  }

  return { ok: true, stitched: stitchChunks(results), chunkCount: chunks.length };
}
