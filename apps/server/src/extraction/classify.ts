/**
 * T1 — classify a capture as a bank/card statement or leave it a receipt,
 * BEFORE the receipt-shaped extraction pipeline ever sees it.
 *
 * `docs/STATEMENTS.md` §2 names the defect this closes: `documents.doc_type`
 * has carried `'statement'` since the enum was written, the extraction prompt
 * has always offered it as an answer, and nothing has ever branched on it — a
 * statement lands in the receipt pipeline and its closing balance is read as
 * a payable amount. §12 T1 is "classify statements at intake and route them";
 * this module is the classification half. `worker.ts` is the routing half —
 * it calls this BEFORE `providerFor`/`runExtraction` and refuses to run the
 * receipt schema at all when the answer is `'statement'`.
 *
 * ── The signal, and why it is trustworthy ──────────────────────────────
 *
 * The signal is the document's OWN embedded PDF text layer — the same
 * `page.getTextContent()` pdfjs-dist call `pdf.ts` already uses to decide
 * `pdf_native` vs `pdf_render` — searched for the handful of phrases a bank
 * or card statement is structurally required to contain and an ordinary
 * receipt or tax invoice is not: an opening balance paired with a closing
 * balance, a statement heading, a stated period, an account/BSB number.
 *
 * That is trustworthy where the two things this ticket explicitly rules out
 * are not:
 *
 *   - **A filename is not a signal.** Nothing here reads what the file was
 *     called. `worker.ts` never even receives the client's filename.
 *   - **"The uploader said so" is not a signal.** The model's own `docType`
 *     field (`types.ts`) is exactly this — a guess formed AFTER a vision
 *     model has already been asked to read the document as a receipt — and
 *     is not consulted here. Using it would mean paying for the very read
 *     this ticket exists to prevent, and trusting an answer the model formed
 *     under the wrong prompt.
 *   - **The text layer is evidence the document authored ABOUT ITSELF**,
 *     not a claim by whoever uploaded it. A bank's statement-generation
 *     software prints "Opening balance" and "Closing balance" because that
 *     is what the document is; a retailer's POS system does not print those
 *     words on a docket by accident. §1 of `docs/STATEMENTS.md` calls this
 *     "the single most load-bearing fact" in the whole plan: statements are
 *     overwhelmingly digital-native PDFs, so this signal is present on
 *     exactly the population it needs to cover.
 *
 * ── What happens when the signal is weak or absent ─────────────────────
 *
 * Every non-PDF capture (a photographed receipt — the overwhelming majority
 * of intake) never reaches this module at all: `worker.ts` only attempts
 * classification when the capture's original upload was `application/pdf`.
 * A scanned statement with no real text layer (`pdf_render`) also produces
 * no signal here, for the same reason `pdf.ts`'s own native/render split
 * already trusts `getTextContent()` over the file extension.
 *
 * Within the signal itself, a single matched phrase is deliberately NOT
 * enough. `belowStatementBar` below requires at least two of the four
 * independent signal categories, and one of the two STRUCTURAL ones — a
 * statement heading or a genuine opening+closing balance pair — must be
 * among them. A one-off match (an invoice that happens to print "account
 * number" for remittance, a receipt whose footer prints a loyalty "balance")
 * is not enough on its own to flip the branch.
 *
 * Below that bar, or on any error extracting text at all, the document is
 * left a `'receipt'` — the SAME path every document has always taken. This
 * is the asymmetry the ticket asks for by name: "where the signal is
 * ambiguous, prefer routing to the existing receipt path over a confident
 * wrong branch, because a misrouted statement is worse than an unrouted
 * one." A receipt wrongly sent down the statement branch gets NOTHING —
 * T2 (the statement extraction path) does not exist yet, so that branch
 * only records a classification and stops — while a statement wrongly left
 * on the receipt path is exactly today's status quo: visibly wrong (a
 * closing balance read as a total) rather than silently discarded.
 */

export type ClassificationSignal =
  | 'statement_heading'
  | 'balance_pair'
  | 'statement_period'
  | 'account_number';

export type Classification = {
  kind: 'statement' | 'receipt';
  /** Every independent signal category that matched, for the audit trail. */
  signals: ClassificationSignal[];
  /** One line, safe to store verbatim in `extraction_runs.error`. */
  reason: string;
};

/**
 * "Bank statement" / "account statement" in the forms an AU or ID
 * institution's own statement-generator prints on itself — `rekening koran`
 * and `mutasi rekening` are the two ordinary Indonesian terms for a bank
 * statement / account transaction history, per D-S1 (both AU and ID are in
 * scope; this is not an AU-only heuristic with an ID gap left in it).
 */
const HEADING_PATTERNS = [
  /\bbank\s+statement\b/i,
  /\bstatement\s+of\s+account\b/i,
  /\baccount\s+statement\b/i,
  /\brekening\s+koran\b/i,
  /\bmutasi\s+rekening\b/i,
];

const OPENING_BALANCE_PATTERNS = [
  /\bopening\s+balance\b/i,
  /\bbalance\s+brought\s+forward\b/i,
  /\bsaldo\s+awal\b/i,
];

const CLOSING_BALANCE_PATTERNS = [
  /\bclosing\s+balance\b/i,
  /\bbalance\s+carried\s+forward\b/i,
  /\bending\s+balance\b/i,
  /\bsaldo\s+akhir\b/i,
];

/**
 * A stated reporting period. `periode\s+(laporan|transaksi)` covers "periode
 * laporan" / "periode transaksi", the ID phrasing; the numeric range covers
 * a bare "01/08/2026 to 31/08/2026" or "1 Aug 2026 - 31 Aug 2026" style
 * range a statement header prints without necessarily labelling it "period"
 * at all.
 */
const PERIOD_PATTERNS = [
  /\bstatement\s+period\b/i,
  /\bfor\s+the\s+period\b/i,
  /\bperiod\s+ending\b/i,
  /\bperiode\s+(laporan|transaksi)\b/i,
  /\b\d{1,2}[/\-. ]\d{1,2}[/\-. ]\d{2,4}\s*(?:to|s\/d|-|–)\s*\d{1,2}[/\-. ]\d{1,2}[/\-. ]\d{2,4}\b/i,
];

/**
 * An account identifier. BSB is AU-specific (six digits, routing a
 * transaction to a branch); "no. rekening" / "nomor rekening" is the ID
 * equivalent of "account number".
 */
const ACCOUNT_PATTERNS = [
  /\baccount\s*(?:no\.?|number)\b/i,
  /\bbsb\b/i,
  /\bno\.?\s*rekening\b/i,
  /\bnomor\s*rekening\b/i,
];

/** Both an opening AND a closing balance — a "balance" credit note is not this. */
function hasBalancePair(text: string): boolean {
  return OPENING_BALANCE_PATTERNS.some((r) => r.test(text)) && CLOSING_BALANCE_PATTERNS.some((r) => r.test(text));
}

/**
 * Classifies a document from its own native PDF text, page order irrelevant
 * — every pattern above is checked against the whole document, because a
 * statement's heading and its balance figures routinely land on different
 * pages (a cover page, then the transaction table).
 *
 * Pure and synchronous on purpose: no I/O, no database, so it is exactly as
 * replayable as `parseExtraction` and testable without a PDF, a page image,
 * or a model call.
 */
export function classifyExtractedText(pageTexts: readonly string[]): Classification {
  const text = pageTexts.join('\n');

  const signals: ClassificationSignal[] = [];
  if (HEADING_PATTERNS.some((r) => r.test(text))) signals.push('statement_heading');
  if (hasBalancePair(text)) signals.push('balance_pair');
  if (PERIOD_PATTERNS.some((r) => r.test(text))) signals.push('statement_period');
  if (ACCOUNT_PATTERNS.some((r) => r.test(text))) signals.push('account_number');

  // At least one STRUCTURAL signal (a heading naming the document, or a real
  // opening+closing pair) and at least one other independent signal — never
  // a lone "account number" or a lone "period", either of which an ordinary
  // invoice can print without being a statement.
  const structural = signals.includes('statement_heading') || signals.includes('balance_pair');
  const isStatement = structural && signals.length >= 2;

  const reason =
    signals.length === 0
      ? 'no statement signal found in the native text layer'
      : isStatement
        ? `native text layer shows ${signals.join(' + ')}`
        : `only ${signals.join(' + ')} found — below the two-signal bar (needs a heading or a ` +
          'balance pair, plus one more), routed to the receipt path rather than a confident guess';

  return { kind: isStatement ? 'statement' : 'receipt', signals, reason };
}
