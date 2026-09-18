import { money as moneyNs, type Money } from '@snap/db';
import type { StatementBalanceCheck } from '@snap/api-contract';
import type { TaxRules } from '@snap/tax-rules';

import { readTenant } from '../repo.js';
import { rulesFor } from '../taxrules/taxrules.repo.js';
import { runStatementExtraction, type StitchedStatementLine } from '../extraction/statement-run.js';
import type { StatementChunkProvider } from '../extraction/statement-provider.js';
import { evaluateBalanceCheck, type CandidateLine } from './balance-check.js';
import {
  createStatementFromPdf,
  ensureDefaultFinancialAccount,
  getFinancialAccount,
  type FinancialAccountRow,
  type StatementLineInput,
} from './statements.repo.js';

/**
 * PDF statement intake, end to end (`docs/STATEMENTS.md` §12 T2).
 *
 * The PDF-path sibling of `csv-import.ts` — same shape deliberately, per this
 * ticket's own instruction: "A PDF statement and a CSV statement differ in
 * how rows are obtained, not in what a row means or how a date or amount is
 * read." Everything after "how rows are obtained" is reused, not
 * reimplemented:
 *
 *  - `extraction/statement-run.ts#runStatementExtraction` obtains the rows
 *    (chunked per page, stitched, de-duplicated at the boundary) instead of
 *    `csv-text.ts`/`csv-columns.ts` parsing a file.
 *  - `balance-check.ts#evaluateBalanceCheck` (T4) grades the result — the
 *    SAME first-class validator the CSV path calls, not a second one.
 *  - `statements.repo.ts#createStatementFromPdf` (an alias of
 *    `createStatementFromCsv` — see that file's comment) writes the same
 *    three tables the same way.
 *
 * Called from `worker.ts`, never from an HTTP handler: `runStatementExtraction`
 * makes model calls, and `docs/STATEMENTS.md`'s whole reason for a queued
 * worker (rather than the CSV path's synchronous, in-request write) is that a
 * model call takes seconds and a phone's HTTP connection should not be held
 * open for it — the exact reasoning `worker.ts`'s own header gives for the
 * receipt path.
 */

export type PdfStatementImportResult =
  | { ok: true; documentId: string; statementId: string; balanceCheck: StatementBalanceCheck; lineCount: number }
  | { ok: false; stage: 'truncated' | 'parse' | 'provider' | 'unreadable'; reason: string };

export interface ImportPdfStatementParams {
  captureId: string;
  /** Every page's native text, in order — `extraction/pdf.ts#extractPdfText`'s own return shape. */
  pageTexts: string[];
  financialAccountId?: string;
  /** Test-only override of `STATEMENT_CHUNK_PAGES` — see `statement-run.test.ts`. */
  chunkSize?: number;
}

/**
 * Converts one stitched row into ledger convention and a `Money` value, or
 * returns the refusal reason for a row that cannot be trusted as either.
 *
 * The ONE sign conversion this pipeline makes, in ONE place — the same
 * discipline `csv-import.ts#rowAmount`'s header argues for: `statement_lines
 * .amount_signed` matches `transaction_splits.amount` (debits — an ASSET
 * increase — positive). `statement-run.ts` deliberately reports each row in
 * the STATEMENT'S OWN arithmetic (positive when its own printed balance
 * rose), because a per-page reader cannot see `financial_accounts
 * .account_type`. For a transaction/savings/ewallet account (asset-backed) a
 * rising balance already IS a debit — no flip. For a credit_card account the
 * printed balance is what is OWED, so a rise is a purchase, which increases a
 * LIABILITY — negative under this same convention, so it is negated here.
 * This mirrors `csv-import.ts#rowAmount`'s identical rule for a single signed
 * amount column; `statements.opening_balance` / `closing_balance` are left
 * as-read, unnegated, exactly as the CSV path already leaves them — a stated,
 * carried-over limitation for the credit-card case, not solved by this
 * ticket (see the T2 report for why: it is a pre-existing CSV-path decision,
 * out of scope to change here).
 */
function toCandidateLine(
  line: StitchedStatementLine,
  accountType: FinancialAccountRow['account_type'],
): { ok: true; candidate: CandidateLine; raw: StitchedStatementLine } | { ok: false; reason: string } {
  const pages = `page${line.fromPageRange.to > line.fromPageRange.from ? 's' : ''} ${line.fromPageRange.from}${
    line.fromPageRange.to > line.fromPageRange.from ? `-${line.fromPageRange.to}` : ''
  }`;

  if (!line.postedDate) {
    return { ok: false, reason: `A row on ${pages} has no readable date — refusing rather than guessing.` };
  }

  let amount: Money;
  try {
    amount = moneyNs.money(line.amountSigned);
  } catch {
    return { ok: false, reason: `A row on ${pages} has an unreadable amount ("${line.amountSigned}").` };
  }
  const amountSigned = accountType === 'credit_card' ? moneyNs.negate(amount) : amount;

  let runningBalance: Money | null = null;
  if (line.runningBalance !== null) {
    try {
      runningBalance = moneyNs.money(line.runningBalance);
    } catch {
      // A running balance that fails to parse is dropped, not refused — same
      // treatment `csv-import.ts` gives a bad value date: it costs a
      // nullable field (and this row drops out of the gap check below), not
      // the whole import.
      runningBalance = null;
    }
  }

  return {
    ok: true,
    candidate: { lineNumber: line.lineNumber, amountSigned, runningBalance },
    raw: line,
  };
}

export async function importPdfStatement(
  userId: string,
  tenantId: string,
  provider: StatementChunkProvider,
  params: ImportPdfStatementParams,
): Promise<PdfStatementImportResult> {
  const tenant = await readTenant(userId, tenantId);
  if (!tenant) return { ok: false, stage: 'unreadable', reason: 'No such workspace.' };

  let rules: TaxRules;
  try {
    rules = await rulesFor(tenant);
  } catch (error) {
    return { ok: false, stage: 'unreadable', reason: `Cannot import a statement: ${(error as Error).message}` };
  }

  let account: FinancialAccountRow;
  if (params.financialAccountId) {
    const found = await getFinancialAccount(userId, tenantId, params.financialAccountId);
    if (!found) return { ok: false, stage: 'unreadable', reason: 'No such financial account in this workspace.' };
    account = found;
  } else {
    account = await ensureDefaultFinancialAccount(userId, tenantId, tenant.base_currency);
  }

  const outcome = await runStatementExtraction(
    provider,
    params.pageTexts,
    rules.documentRules.dateOrder,
    account.currency,
    params.chunkSize,
  );
  if (!outcome.ok) {
    return {
      ok: false,
      stage: outcome.stage,
      reason: `pages ${outcome.pageRange.from}-${outcome.pageRange.to}: ${outcome.error}`,
    };
  }

  const { stitched } = outcome;
  if (stitched.lines.length === 0) {
    return { ok: false, stage: 'unreadable', reason: 'No readable transaction rows were found on this statement.' };
  }

  const candidates: (CandidateLine & { raw: StitchedStatementLine })[] = [];
  for (const line of stitched.lines) {
    const result = toCandidateLine(line, account.account_type);
    if (!result.ok) return { ok: false, stage: 'unreadable', reason: result.reason };
    candidates.push({ ...result.candidate, raw: result.raw });
  }

  let openingBalance: Money | null = null;
  let closingBalance: Money | null = null;
  try {
    if (stitched.openingBalance !== null) openingBalance = moneyNs.money(stitched.openingBalance);
    if (stitched.closingBalance !== null) closingBalance = moneyNs.money(stitched.closingBalance);
  } catch {
    return { ok: false, stage: 'unreadable', reason: "The statement's opening or closing balance could not be read as a number." };
  }

  // T4's first-class validator (`balance-check.ts`) — the SAME call
  // `csv-import.ts` makes, not a second implementation of the identity check.
  const { check: balance, gap } = evaluateBalanceCheck({ openingBalance, closingBalance, lines: candidates });
  if (gap) {
    const brokenAt = candidates[gap.lineNumber - 1]!.raw.fromPageRange;
    return {
      ok: false,
      stage: 'unreadable',
      reason:
        `pages ${brokenAt.from}-${brokenAt.to}: the printed running balance does not follow from the ` +
        `previous row plus this row's amount (expected ${gap.expected}, the statement says ${gap.printed}). ` +
        'This usually means a row was missed during reading — refusing rather than importing a gap silently.',
    };
  }

  const postedDates = candidates.map((c) => c.raw.postedDate!).sort();
  const periodStart = postedDates[0]!;
  const periodEnd = postedDates[postedDates.length - 1]!;

  const lines: StatementLineInput[] = candidates.map((c) => ({
    lineNumber: c.lineNumber,
    postedDate: c.raw.postedDate!,
    valueDate: c.raw.valueDate,
    descriptionRaw: c.raw.descriptionRaw ?? '(no description)',
    amountSigned: c.amountSigned,
    runningBalance: c.runningBalance,
  }));

  const { documentId, statementId } = await createStatementFromPdf(userId, tenantId, {
    captureId: params.captureId,
    financialAccountId: account.id,
    currency: account.currency,
    documentRetentionYears: rules.documentRules.retentionYears,
    periodStart,
    periodEnd,
    openingBalance: balance.openingBalance,
    closingBalance: balance.closingBalance,
    balanceCheck: balance.balanceCheck,
    balanceResidual: balance.balanceResidual,
    createdBy: userId,
    fieldProvenance: {
      source: 'pdf_extraction',
      provider: provider.name,
      model: provider.model,
      pageCount: params.pageTexts.length,
      chunkCount: outcome.chunkCount,
      rowCount: lines.length,
      droppedBoundaryMarkers: stitched.droppedBoundaryMarkers,
      droppedUnreadableRows: stitched.droppedUnreadable,
      openingBalanceFromStatement: stitched.openingBalance !== null,
      closingBalanceFromStatement: stitched.closingBalance !== null,
    },
    lines,
  });

  return { ok: true, documentId, statementId, balanceCheck: balance.balanceCheck, lineCount: lines.length };
}
