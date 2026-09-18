import { randomUUID } from 'node:crypto';

import { withTenantAs, type Tx } from '@snap/db';
import type { StatementBalanceCheck } from '@snap/api-contract';
import { sql } from 'drizzle-orm';

import { getDb } from '../db.js';
import { flagPossibleDuplicate } from '../repo.js';
import { supersedeAndPost } from '../transactions/transactions.repo.js';

/**
 * Database access for statement intake (`docs/STATEMENTS.md` §12 T5).
 *
 * A sibling to `repo.ts`, not an addition to it, for the same reason T3's
 * migration comment gives for a second schema rather than a widened first
 * one: statements are a genuinely different noun, and a domain module
 * (`business.repo.ts`, `taxrules.repo.ts`, ...) already keeps its own writes
 * in its own file in this codebase. `repo.ts` itself is only touched by this
 * ticket to wire the previously-unused `markCaptureStored` — everything new
 * for CSV intake lives here.
 */

/**
 * `financial_accounts` (0031) has no CRUD surface anywhere yet — T3 built the
 * table, nothing populates it. A CSV import cannot wait for that surface to
 * exist (no ticket in `docs/STATEMENTS.md` §12 currently owns it), so this
 * resolves a caller-supplied id when given one, and otherwise lazily
 * provisions ONE placeholder account per tenant — visibly labelled as a
 * placeholder, not a real bank name — so import is never blocked on account
 * setup that has nowhere to happen yet. See the T5 report for why this is a
 * stated, scoped-down decision rather than the real thing.
 */
const DEFAULT_INSTITUTION_LABEL = '(unassigned — auto-created for CSV import)';
const DEFAULT_LEDGER_ACCOUNT_CODE = 'BANK-IMPORT';

export type FinancialAccountRow = {
  id: string;
  currency: string;
  account_type: 'transaction' | 'savings' | 'credit_card' | 'ewallet';
};

/** Looks up a caller-supplied `financialAccountId`. RLS (0031) already
 *  scopes this to the caller's tenant — a mismatched id simply reads back
 *  nothing, the same "not found, not leaked" shape every other lookup in
 *  this codebase uses. */
export async function getFinancialAccount(
  userId: string,
  tenantId: string,
  financialAccountId: string,
): Promise<FinancialAccountRow | null> {
  return withTenantAs(getDb(), userId, tenantId, async (tx) => {
    const rows = await tx.execute<FinancialAccountRow>(sql`
      select id, currency::text as currency, account_type::text as account_type
        from financial_accounts
       where id = ${financialAccountId} and not is_archived
       limit 1
    `);
    return (rows.rows[0] as FinancialAccountRow | undefined) ?? null;
  });
}

/**
 * Finds — or, on the very first CSV import for this tenant, creates — the
 * placeholder financial account and its backing chart-of-accounts row.
 *
 * `financial_accounts.account_id` is `NOT NULL UNIQUE REFERENCES accounts` —
 * "what makes the double-entry side work without a second ledger" (0031's
 * own comment) — so a financial account cannot exist without a ledger
 * account behind it, placeholder or not.
 *
 * NOT concurrency-safe against two simultaneous first imports for the same
 * brand-new tenant (no unique constraint exists to arbitrate a race, and
 * adding one is a migration, outside this ticket's files) — a documented,
 * narrow limitation, not a silent one. Worst case is two placeholder rows,
 * both usable, never a wrong tenant or a lost import.
 */
export async function ensureDefaultFinancialAccount(
  userId: string,
  tenantId: string,
  currency: string,
): Promise<FinancialAccountRow> {
  return withTenantAs(getDb(), userId, tenantId, async (tx) => {
    const existing = await tx.execute<FinancialAccountRow>(sql`
      select id, currency::text as currency, account_type::text as account_type
        from financial_accounts
       where tenant_id = ${tenantId} and institution = ${DEFAULT_INSTITUTION_LABEL}
       limit 1
    `);
    const found = existing.rows[0];
    if (found) return found as FinancialAccountRow;

    let ledgerAccountId: string;
    const existingLedger = await tx.execute<{ id: string }>(sql`
      select id from accounts where tenant_id = ${tenantId} and code = ${DEFAULT_LEDGER_ACCOUNT_CODE} limit 1
    `);
    if (existingLedger.rows[0]) {
      ledgerAccountId = existingLedger.rows[0].id;
    } else {
      ledgerAccountId = randomUUID();
      await tx.execute(sql`
        insert into accounts (id, tenant_id, code, name, account_type, external_refs)
        values (${ledgerAccountId}, ${tenantId}, ${DEFAULT_LEDGER_ACCOUNT_CODE},
                'Imported bank transactions (placeholder account)', 'asset', '{}'::jsonb)
      `);
    }

    const financialAccountId = randomUUID();
    await tx.execute(sql`
      insert into financial_accounts (
        id, tenant_id, account_id, institution, account_type, currency
      ) values (
        ${financialAccountId}, ${tenantId}, ${ledgerAccountId},
        ${DEFAULT_INSTITUTION_LABEL}, 'transaction', ${currency}
      )
    `);
    return { id: financialAccountId, currency, account_type: 'transaction' };
  });
}

export interface CsvStatementLineInput {
  lineNumber: number;
  postedDate: string; // ISO
  valueDate: string | null;
  descriptionRaw: string;
  amountSigned: string; // Money (decimal string)
  runningBalance: string | null;
}

export interface CreateStatementFromCsvInput {
  captureId: string;
  financialAccountId: string;
  currency: string;
  documentRetentionYears: number;
  periodStart: string;
  periodEnd: string;
  openingBalance: string;
  closingBalance: string;
  balanceCheck: StatementBalanceCheck;
  balanceResidual: string | null;
  lines: CsvStatementLineInput[];
  createdBy: string;
  /** Free-form provenance recorded on `documents.field_provenance` — what
   *  columns were detected and matched, for anyone later asking "why did the
   *  app read this row this way". */
  fieldProvenance: Record<string, unknown>;
}

/**
 * Writes a CSV-derived statement: a `documents` row (the sibling-schema
 * statement, §5.2), the `statements` row and every `statement_lines` row,
 * in one transaction — and marks the backing `captures` row `'extracted'`,
 * the same terminal state a worker-processed capture reaches, so
 * `getCaptureProgress` (`repo.ts`) reports this capture done the moment the
 * transaction commits, with nothing queued and no worker involved (§5.6:
 * mode (c) needs no extraction at all).
 */
/**
 * Generic aliases (T2, `docs/STATEMENTS.md` §12 Lane T): `createStatementFromCsv`
 * below writes exactly the same three tables regardless of how its `lines`
 * were obtained — nothing in its body reads a CSV, a delimiter, or a column
 * mapping. `statements/pdf-statement-import.ts` (T2's per-page PDF path)
 * calls it under `createStatementFromPdf`, an alias rather than a duplicate
 * implementation, because "a PDF statement and a CSV statement differ in how
 * rows are obtained, not in what a row means or how a date or amount is
 * read" is this ticket's own instruction. The CSV-specific name is left in
 * place, unrenamed, so `csv-import.ts` and its tests are untouched.
 */
export type StatementLineInput = CsvStatementLineInput;
export type CreateStatementInput = CreateStatementFromCsvInput;

export async function createStatementFromCsv(
  userId: string,
  tenantId: string,
  input: CreateStatementFromCsvInput,
): Promise<{ documentId: string; statementId: string }> {
  return withTenantAs(getDb(), userId, tenantId, async (tx: Tx) => {
    const documentId = randomUUID();
    // `'pass'` is the only verdict this ticket lets earn `auto_accepted` —
    // T4 (not yet built) may refine this once it exists as a first-class
    // validator; `'residual'` and `'unverifiable'` both mean a person should
    // look, which `needs_review` already says honestly.
    const reviewStatus = input.balanceCheck === 'pass' ? 'auto_accepted' : 'needs_review';

    // R5e (`docs/STATEMENTS.md` §12 Lane R): the statement-side fingerprint —
    // over (account, period, opening balance, closing balance) — computed at
    // insert time and 0031's own note that a re-uploaded statement flags
    // "through the EXISTING `documents.dedup_group_id` path rather than a
    // second statement-shaped one." Every part here is a required column on
    // this input, so it is never NULL for a statement the way it can be for
    // a receipt missing a field — but the same NULL-poisoning `||`
    // concatenation is used regardless, so that stays true even if a future
    // caller loosens one of these to optional.
    const inserted = await tx.execute<{ dedup_group_id: string | null }>(sql`
      insert into documents (
        id, tenant_id, capture_id, doc_type, is_tax_invoice, ato_compliance,
        issue_date, currency, rounding_amount, review_status, field_provenance,
        locked_fields, created_by, retention_until, dedup_group_id
      ) values (
        ${documentId}, ${tenantId}, ${input.captureId}, 'statement', false, '{}'::jsonb,
        ${input.periodEnd}::date, ${input.currency}, '0.0000', ${reviewStatus},
        ${JSON.stringify(input.fieldProvenance)}::jsonb, '{}'::text[], ${input.createdBy},
        (${input.periodEnd}::date + make_interval(years => ${input.documentRetentionYears}))::date,
        md5(
          ${tenantId}::text || '|' ||
          ${input.financialAccountId}::text || '|' ||
          ${input.periodStart}::text || '|' ||
          ${input.periodEnd}::text || '|' ||
          ${input.openingBalance}::text || '|' ||
          ${input.closingBalance}::text
        )::uuid
      )
      returning dedup_group_id
    `);
    await flagPossibleDuplicate(tx, tenantId, documentId, inserted.rows[0]?.dedup_group_id ?? null);

    const statementId = randomUUID();
    await tx.execute(sql`
      insert into statements (
        id, tenant_id, document_id, financial_account_id, period_start, period_end,
        opening_balance, closing_balance, balance_check, balance_residual
      ) values (
        ${statementId}, ${tenantId}, ${documentId}, ${input.financialAccountId},
        ${input.periodStart}::date, ${input.periodEnd}::date,
        ${input.openingBalance}, ${input.closingBalance}, ${input.balanceCheck}::statement_balance_check,
        ${input.balanceResidual}
      )
    `);

    for (const line of input.lines) {
      await tx.execute(sql`
        insert into statement_lines (
          id, tenant_id, statement_id, line_number, posted_date, value_date,
          description_raw, description_normalised, amount_signed, running_balance
        ) values (
          ${randomUUID()}, ${tenantId}, ${statementId}, ${line.lineNumber},
          ${line.postedDate}::date, ${line.valueDate}::date,
          ${line.descriptionRaw}, ${normaliseDescription(line.descriptionRaw)},
          ${line.amountSigned}, ${line.runningBalance}
        )
      `);
    }

    await tx.execute(sql`update captures set status = 'extracted' where id = ${input.captureId}`);

    return { documentId, statementId };
  });
}

/** The function-level half of the generic alias documented above the type aliases. */
export const createStatementFromPdf = createStatementFromCsv;

/**
 * Records a balance-check verdict onto an already-existing `statements` row
 * (`docs/STATEMENTS.md` §12 T4 — "T3's author named T4 as the writer of the
 * computed verdict").
 *
 * `createStatementFromCsv` above already writes `balance_check` /
 * `balance_residual` at INSERT time, because the CSV path computes the
 * verdict before the row exists at all. This function is the other shape:
 * an UPDATE for a caller that inserts `statements` (and its lines) first and
 * only then runs `evaluateBalanceCheck` — the PDF path (T2), whenever it
 * lands, is expected to look like that, since its lines arrive from a
 * multi-page extraction run rather than one synchronous parse. Both shapes
 * write through the SAME two columns, so `'pending'` (0031's column default)
 * never survives to a statement nobody's checked, and `'unverifiable'` is
 * written exactly when the honesty rule says to write it — never silently
 * left as `'pending'` and never upgraded to `'pass'` by a caller that forgot
 * to call this.
 *
 * RLS (0031, forced) already scopes the UPDATE to the caller's tenant; a
 * `statementId` from another tenant simply matches zero rows, the same
 * "not found, not leaked" shape `getFinancialAccount` above uses.
 */
export async function recordBalanceCheckVerdict(
  userId: string,
  tenantId: string,
  statementId: string,
  verdict: { balanceCheck: StatementBalanceCheck; balanceResidual: string | null },
): Promise<{ updated: boolean }> {
  return withTenantAs(getDb(), userId, tenantId, async (tx) => {
    const result = await tx.execute(sql`
      update statements
         set balance_check = ${verdict.balanceCheck}::statement_balance_check,
             balance_residual = ${verdict.balanceResidual},
             updated_at = now()
       where id = ${statementId}
    `);
    return { updated: (result.rowCount ?? 0) > 0 };
  });
}

/** Lower-cased, whitespace-collapsed — the same derivation `0031`'s comment
 *  describes for `description_normalised`, written here because T5 is the
 *  first writer of a `statement_lines` row at all. */
function normaliseDescription(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

/* ── R5d: a statement line stands alone ─────────────────────────────────────
 * `docs/STATEMENTS.md` §12 Lane R, ticket R5d, as changed by D-S7 (§14.1c):
 * "not every bank line will ever have a receipt... those are real money and
 * the tracker has to be able to record them from the bank alone." A single or
 * bulk post is the human act D-S7 requires before a line becomes a LEDGER
 * TRANSACTION — the line already counts as SPENDING the moment it is read
 * (that reading is `M9`'s, not this file's: it queries `statement_lines`
 * directly and subtracts what `event_observations` already accounts for).
 *
 * This does not open a second posting road. `supersedeAndPost`
 * (`../transactions/transactions.repo.ts`, R5b) already runs
 * `mergeObservations` with `document: null` — §5.3.1's Purchases/Receipts
 * split, `source = 'import'` — and posts in the same commit as R5c's
 * `document_id`-only supersede does with `statementLineId` only. Calling it
 * with `documentId: null` IS this ticket's posting path; the only thing this
 * file adds is the "already has a live observation → skip, do not
 * re-supersede an unchanged evidence set" guard R5d's own acceptance
 * criteria (2) requires and `supersedeAndPost` does not provide on its own —
 * left to its caller on purpose, because R5c's accept legitimately WANTS to
 * supersede a line that already carries a standalone observation (criterion
 * 3, `§5.3.1` Q4), and a single shared function cannot mean both "skip" and
 * "replace" for the same precondition.
 */

export type PostStandaloneOutcome =
  | { ok: true; transactionId: string }
  | { ok: false; reason: 'missing_statement_line' }
  | { ok: false; reason: 'already_observed'; transactionId: string };

/**
 * A statement line's live `event_observations` row, if any — `kind =
 * 'statement_line'` is the only kind a line can carry (0032's
 * `event_observations_pointer_matches_kind`), and `event_observations_line_once`
 * (0032, plain UNIQUE, NOT deferred) means at most one row can ever exist for
 * it at a time, and only ever pointing at a LIVE transaction (0032's trigger 1
 * — a void transaction carries no observation, checked at every commit that
 * touches either). So "does this line have a live observation" is exactly
 * "does a row exist here", no join to `transactions.status` required.
 */
async function liveObservationForLine(
  t: Tx,
  tenantId: string,
  statementLineId: string,
): Promise<string | null> {
  const rows = await t.execute<{ transaction_id: string }>(sql`
    select transaction_id from event_observations
     where tenant_id = ${tenantId} and statement_line_id = ${statementLineId} and kind = 'statement_line'
  `);
  return rows.rows[0]?.transaction_id ?? null;
}

/**
 * Posts one statement line as spending on its own, with no document —
 * acceptance criterion (1): a −84.20 line posts as
 * `Uncategorised Purchases +84.20 / account −84.20`, a +2,500.00 line as
 * `account +2,500.00 / Uncategorised Receipts −2,500.00` (`mergeObservations`'s
 * own no-document branch, unchanged by this file). `txn_date` is
 * `value_date ?? posted_date` and `settled_date` is `posted_date` — again
 * `mergeObservations`'s existing rule for a statement-line-only evidence set,
 * not re-derived here.
 *
 * Refuses `already_observed` rather than superseding, so a second call
 * against the same already-posted (or already-matched) line is a no-op from
 * the caller's point of view, not a silent re-post — the same "silently
 * skipping is how somebody concludes the button did nothing" the bulk path
 * below reports a count for.
 */
export async function postStatementLineStandalone(
  userId: string,
  tenantId: string,
  statementLineId: string,
): Promise<PostStandaloneOutcome> {
  const precheck = await withTenantAs(getDb(), userId, tenantId, async (t) => {
    const line = await t.execute<{ id: string }>(sql`
      select id from statement_lines where id = ${statementLineId} and tenant_id = ${tenantId}
    `);
    if (!line.rows[0]) return { ok: false as const, reason: 'missing_statement_line' as const };

    const liveTransactionId = await liveObservationForLine(t, tenantId, statementLineId);
    if (liveTransactionId) {
      return { ok: false as const, reason: 'already_observed' as const, transactionId: liveTransactionId };
    }
    return { ok: true as const };
  });
  if (!precheck.ok) return precheck;

  // `supersedeAndPost` opens its own `withTenantAs` — the precheck above
  // cannot be extended into the same database transaction without duplicating
  // its evidence-loading/tax-code/account-resolution machinery, which is
  // exactly the "second posting path" this ticket was told not to write. The
  // narrow race this leaves (two concurrent standalone posts of the same
  // freshly-unmatched line) is not a correctness gap: `mergeObservations` is
  // pure and deterministic for one evidence set, so the loser of that race
  // supersedes the winner's transaction with an IDENTICAL split set — one
  // extra void row, never a wrong balance, never two live transactions for
  // one line (`event_observations_line_once` still refuses that, immediately,
  // not deferred).
  const outcome = await supersedeAndPost(userId, tenantId, { documentId: null, statementLineId });
  if (outcome.ok) return outcome;

  if (outcome.reason === 'missing_statement_line') return outcome;

  // Every other `SupersedeOutcome` refusal requires a document (
  // `document_not_confirmed`, `ambiguous_tax_categories`, `lines_dont_reconcile`)
  // or requires BOTH sides present (`amount_disagreement`, `currency_mismatch`),
  // and `no_evidence` requires neither — unreachable with `documentId: null` and
  // a real `statementLineId`, exactly as `draftTransactionFromDocument`'s own
  // "unreachable" branch documents for its own call into `mergeObservations`.
  throw new Error(
    `postStatementLineStandalone: unexpected refusal for line ${statementLineId}: ${JSON.stringify(outcome)}`,
  );
}

export interface PostUnmatchedOutcome {
  /** Every transaction id created by this call, one per newly-posted line. */
  posted: string[];
  /** Lines this call left untouched because they already carried a live
   *  observation — named as a COUNT, per acceptance criterion (2), so the
   *  caller can report "N posted, M already recorded" rather than letting a
   *  skip disappear silently. */
  skipped: number;
}

/**
 * Bulk sibling of `postStatementLineStandalone`: every line on a statement
 * that has no live observation yet is posted standalone; every line that
 * already has one — whether from a previous standalone post or an R5c
 * match — is left alone and counted, never silently dropped.
 *
 * Sequential, one `postStatementLineStandalone` call per line, rather than one
 * giant transaction: R5b's "one economic event, one road" already treats each
 * line as its own event with its own commit, and a 300-line statement failing
 * halfway through should leave the lines before the failure posted, not roll
 * every one of them back for one bad row.
 */
export async function postUnmatchedStatementLines(
  userId: string,
  tenantId: string,
  statementId: string,
): Promise<PostUnmatchedOutcome> {
  const lineIds = await withTenantAs(getDb(), userId, tenantId, async (t) => {
    const rows = await t.execute<{ id: string }>(sql`
      select id from statement_lines
       where statement_id = ${statementId} and tenant_id = ${tenantId}
       order by line_number
    `);
    return rows.rows.map((r) => r.id);
  });

  const posted: string[] = [];
  let skipped = 0;
  for (const lineId of lineIds) {
    const outcome = await postStatementLineStandalone(userId, tenantId, lineId);
    if (outcome.ok) {
      posted.push(outcome.transactionId);
    } else {
      // `already_observed` is the expected skip; `missing_statement_line`
      // cannot happen here (the id came from this same statement moments
      // earlier) short of a concurrent hard delete — counted the same way
      // rather than thrown, so one vanished line cannot fail an entire
      // 300-line bulk post.
      skipped += 1;
    }
  }
  return { posted, skipped };
}
