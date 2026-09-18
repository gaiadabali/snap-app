/**
 * The per-page statement extraction prompt (`docs/STATEMENTS.md` §12 T2).
 *
 * Text, not pixels. `docs/STATEMENTS.md` §1 calls PDF-native intake with a
 * real text layer "the single most load-bearing fact" in the whole statements
 * plan, and §5.2 spells out the cost argument directly: a native-text
 * statement needs no OCR, no rasterisation, no vision model at all — just its
 * own embedded text, which `extraction/pdf.ts#extractPdfText` already reads
 * with zero rasterisation cost. Sending that text to a TEXT-only chat
 * completion (`statement-provider.ts#OllamaCloudStatementProvider`) is
 * therefore a different, and much cheaper, request shape than the receipt
 * path's image_url content blocks — this prompt is written for that shape.
 *
 * One prompt per CHUNK, not per document — see `statement-run.ts`'s header
 * for why. The chunk boundary rule below (balance markers go in
 * opening_balance/closing_balance, never in `lines`) is the load-bearing
 * instruction: it is what stops a "balance brought forward" line, reprinted
 * at the top of every page after the first, from being counted twice when
 * chunks are stitched back together.
 */

export const STATEMENT_PROMPT_VERSION = 'statement-1';

export interface StatementPromptOptions {
  pageFrom: number;
  pageTo: number;
  totalPages: number;
  /** Day-first (AU, ID) or month-first — `TaxRules.documentRules.dateOrder`. */
  dateOrder: 'day_first' | 'month_first';
  currency: string;
}

export function statementChunkPrompt(opts: StatementPromptOptions): string {
  const dateHint =
    opts.dateOrder === 'day_first'
      ? 'Dates on this statement are printed DAY/MONTH/YEAR (03/04/2026 is 3 April 2026, never 4 March).'
      : 'Dates on this statement are printed MONTH/DAY/YEAR (03/04/2026 is 4 March 2026, never 3 April).';

  return `You extract transaction rows from ONE CHUNK of a longer bank or credit-card
statement. This chunk is page${opts.pageTo > opts.pageFrom ? 's' : ''} ${opts.pageFrom}${
    opts.pageTo > opts.pageFrom ? `-${opts.pageTo}` : ''
  } of ${opts.totalPages}. You are given the PLAIN TEXT already extracted from
these pages — read every row it contains, in the order printed. Currency is
${opts.currency}. ${dateHint}

Return ONLY minified JSON. No prose, no code fences.

Shape:
{
 "schemaVersion":"1.0.0",
 "openingBalance":{"value":string|null,"confidence":n,"nullReason":"not_present"|"illegible"|"ambiguous"|null},
 "closingBalance":{"value":string|null,"confidence":n,"nullReason":...},
 "lines":[
   {
     "postedDate":{"value":"YYYY-MM-DD"|null,"confidence":n,"nullReason":...},
     "valueDate":{"value":"YYYY-MM-DD"|null,"confidence":n,"nullReason":...},
     "description":{"value":string|null,"confidence":n,"nullReason":...},
     "amountSigned":{"value":string|null,"confidence":n,"nullReason":...},
     "runningBalance":{"value":string|null,"confidence":n,"nullReason":...},
     "cardLast4":{"value":string|null,"confidence":n,"nullReason":...}
   }
 ],
 "notes":{"legible":true|false,"warnings":[string]}
}

RULES

1. NEVER GUESS. If a row's date, description or amount is not legible, return
   null with a low confidence and a nullReason — a wrong amount is far worse
   than a missing one.

2. "openingBalance" and "closingBalance" are for THIS CHUNK ONLY. Most chunks
   will have BOTH null — only the page that actually prints an opening or
   brought-forward figure (usually page 1) sets openingBalance, and only the
   page that prints a closing or carried-forward figure (usually the last
   page) sets closingBalance.

3. CRITICAL — never double-count a balance marker. If a page's header repeats
   a line like "Balance brought forward" or "Balance carried forward" (common
   at the top of every page after the first), that line is NOT a transaction.
   Put its value in "openingBalance" for this chunk. Do NOT add it to "lines".
   A statement is only read correctly if opening_balance + every line in
   "lines" sums to closing_balance — a brought-forward line counted twice
   breaks that arithmetic.

4. "amountSigned" is the change to the account's OWN PRINTED running balance
   for that row: (the balance shown immediately after this row) minus (the
   balance shown immediately before it). Positive when the balance went up,
   negative when it went down. If the statement instead prints separate
   Debit/Credit columns with no per-row running balance, a Debit is negative
   and a Credit is positive. Do not try to apply any other accounting
   convention — report exactly what the page's own arithmetic says.

5. "description" is as printed, verbatim — do not paraphrase, abbreviate or
   translate it.

6. "cardLast4" is the last 4 digits ONLY, when a card number appears against
   a row. Never return a full or partial PAN beyond 4 digits.

7. Read every row on these pages. Do not skip a row because it looks like a
   fee, an interest charge, or a reversal — every printed movement belongs in
   "lines" unless rule 3 says it is a balance marker instead.`;
}
