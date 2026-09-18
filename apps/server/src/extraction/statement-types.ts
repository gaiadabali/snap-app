/**
 * The shape a text model must return for ONE CHUNK of a statement.
 *
 * `docs/STATEMENTS.md` §12 T2: `docs/extraction-schema.json` is receipt-shaped
 * (goods, GST categories, a single payable amount) and a statement is a
 * genuinely different noun — a period, a running balance, a sequence of
 * movements (§5.1, §5.2). This is the sibling schema's TypeScript mirror, the
 * same relationship `extraction/types.ts` has to `docs/extraction-schema.json`:
 * "a narrowed, flattened view... the fields the validators and the ledger
 * actually consume."
 *
 * The unit here is a CHUNK, not a document. `docs/STATEMENTS.md` §5.2 names
 * output truncation as a real, specific hazard for statements — a 300-row,
 * 12-page statement cannot go to a model in one request — so the statement
 * path reads PER PAGE (`extraction/statement-run.ts`'s chunker) and this type
 * is what one page's worth of reading produces before the chunks are stitched
 * back into one statement.
 */

export type StatementField<T> = {
  value: T | null;
  /** 0-1. The model's own estimate; treated as advisory, never as truth. */
  confidence: number;
};

export type StatementChunkLine = {
  /** ISO. The date this row is destined to become `transactions.settled_date` via (§5.1). */
  postedDate: StatementField<string>;
  /** ISO, or null — not every statement prints both a posted and a value date. */
  valueDate: StatementField<string>;
  /** As printed, never normalised — `statement_lines.description_raw` is the record. */
  description: StatementField<string>;
  /**
   * The change to the account's OWN PRINTED running balance for this row —
   * (running balance after this row) minus (running balance before it), i.e.
   * exactly what the page's own arithmetic says, positive when the balance
   * rose and negative when it fell. Deliberately NOT pre-converted to any
   * ledger sign convention: that conversion (asset vs credit-card) needs the
   * `financial_accounts.account_type` this chunk-level reader has no view of,
   * and belongs to `statements/pdf-statement-import.ts`, which does the one
   * conversion in one place rather than asking a per-page model call to guess
   * at an account type it cannot see.
   */
  amountSigned: StatementField<string>;
  /** The balance printed AFTER this row, when the statement prints one at all. */
  runningBalance: StatementField<string>;
  /** ALWAYS ≤ 4 digits or null — masked at parse time exactly as the receipt path does. */
  cardLast4: StatementField<string>;
};

export type StatementChunkExtraction = {
  schemaVersion: string;
  pageRange: { from: number; to: number };
  /**
   * Populated only when THIS chunk shows an opening/brought-forward balance
   * — typically page 1's header, or the top of a later page restating the
   * carried-forward figure. null everywhere else. See `statement-run.ts`'s
   * header for why a "balance brought forward" line is captured HERE and not
   * as a row in `lines` — putting it in `lines` would double-count it.
   */
  openingBalance: StatementField<string>;
  /** Populated only when THIS chunk shows a closing/carried-forward balance. */
  closingBalance: StatementField<string>;
  lines: StatementChunkLine[];
  notes: {
    legible: boolean;
    warnings: string[];
  };
};
