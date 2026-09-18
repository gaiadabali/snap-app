/**
 * The CSV statement intake pipeline (`docs/STATEMENTS.md` §12 T5).
 *
 * Orchestrates the pure pieces (`csv-text`, `csv-columns`, `csv-dates`,
 * `csv-amounts`, `balance-check`) against one uploaded file and, on success,
 * writes the result through `statements.repo.ts`. Called directly from
 * `captures.controller.ts`'s `upload()` — SYNCHRONOUSLY, inside the HTTP
 * request, unlike a receipt or PDF. That is a deliberate difference, not an
 * oversight: §5.6 is explicit that mode (c) needs "no extraction at all", so
 * there is no model call to hide behind a queue for. Holding the request
 * open for the time it takes to parse a few thousand text rows is a
 * different, much smaller cost than holding it open for a vision model.
 *
 * THE HONESTY RULE THIS FILE EXISTS TO ENFORCE (D-S3's stated cost, §5.6):
 * a CSV import must never claim `balance_check = 'pass'` unless the file
 * itself carried an independent opening AND closing balance to check
 * against. `balance-check.ts`'s `computeBalanceCheck` is the only place that
 * decides the verdict; this file never overrides it.
 */
import { money as moneyNs } from '@snap/db';
import type { TaxRules } from '@snap/tax-rules';

import { readTenant } from '../repo.js';
import { rulesFor } from '../taxrules/taxrules.repo.js';
import { parseAmount, type AmountFormat } from './csv-amounts.js';
import { computeBalanceCheck, findRunningBalanceGap, type CandidateLine } from './balance-check.js';
import { detectColumnMapping, type ColumnMapping } from './csv-columns.js';
import { parseStatementDate } from './csv-dates.js';
import { decodeCsvBytes, detectDelimiter, parseCsvRows } from './csv-text.js';
import {
  createStatementFromCsv,
  ensureDefaultFinancialAccount,
  getFinancialAccount,
  type FinancialAccountRow,
} from './statements.repo.js';

const { negate, subtract } = moneyNs;

const OPENING_BALANCE_TOKENS = ['opening balance', 'balance brought forward', 'brought forward', 'saldo awal'];
const CLOSING_BALANCE_TOKENS = ['closing balance', 'balance carried forward', 'carried forward', 'saldo akhir'];

export type CsvImportResult =
  | {
      ok: true;
      documentId: string;
      statementId: string;
      balanceCheck: 'pending' | 'pass' | 'residual' | 'unverifiable';
      lineCount: number;
    }
  | { ok: false; reason: string };

export interface ImportCsvStatementParams {
  captureId: string;
  bytes: Buffer;
  financialAccountId?: string;
}

function matchesAny(haystack: string, tokens: string[]): boolean {
  return tokens.some((t) => haystack.includes(t));
}

/**
 * One data row's signed amount, or `null` when neither expected cell had a
 * usable number in it (a genuinely blank amount — not this row's business,
 * not a parse failure).
 *
 * Sign convention: `0006_ledger.sql`, verbatim — "Assets and expenses
 * increase positive; liabilities, equity and income increase negative."
 * `financial_accounts` of type `transaction`/`savings`/`ewallet` back an
 * ASSET ledger account (§5.1: "what makes the double-entry side work"), so a
 * DEPOSIT (the balance goes up) is POSITIVE and a WITHDRAWAL (the balance
 * goes down) is NEGATIVE — this is `docs/STATEMENTS.md` §6's "debits
 * positive, credits negative" read the way it has to be read for the ledger
 * it is borrowed from, not the colloquial "a debit card purchase" sense.
 *
 * Separate debit/credit columns: whichever column THE FILE calls "credit" is
 * money in (positive here), "debit" is money out (negative) — the ordinary
 * naming on a transaction/savings export, assumed uniformly rather than
 * re-derived per file (a credit-card export using two columns instead of one
 * signed amount is rare enough that this is a stated limitation, not solved
 * here).
 *
 * A single signed "amount" column is where §5.6's named hazard actually
 * bites: a transaction/savings export already prints a deposit positive and
 * a withdrawal negative — the SAME sign this ledger wants, so no flip. A
 * credit-card export is the stated exception: it prints a PURCHASE as
 * positive, but a purchase INCREASES what is owed — a LIABILITY increase,
 * which is NEGATIVE under this same convention — so a credit-card
 * single-amount column is negated and everything else passes through
 * unchanged.
 */
function rowAmount(
  row: string[],
  mapping: ColumnMapping,
  format: AmountFormat,
  accountType: FinancialAccountRow['account_type'],
): { value: ReturnType<typeof parseAmount>; sawDebitCredit: boolean } {
  if (mapping.debit !== null && mapping.credit !== null) {
    const debit = parseAmount(row[mapping.debit] ?? '', format);
    const credit = parseAmount(row[mapping.credit] ?? '', format);
    if (debit === null && credit === null) return { value: null, sawDebitCredit: true };
    const d = debit ?? moneyNs.money(0);
    const c = credit ?? moneyNs.money(0);
    return { value: subtract(c, d), sawDebitCredit: true };
  }
  const raw = row[mapping.amount!] ?? '';
  const amount = parseAmount(raw, format);
  if (amount === null) return { value: null, sawDebitCredit: false };
  return { value: accountType === 'credit_card' ? negate(amount) : amount, sawDebitCredit: false };
}

export async function importCsvStatement(
  userId: string,
  tenantId: string,
  params: ImportCsvStatementParams,
): Promise<CsvImportResult> {
  const decoded = decodeCsvBytes(params.bytes);
  if (!decoded.ok) return { ok: false, reason: decoded.reason };

  const firstLine = decoded.text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = detectDelimiter(firstLine);
  const parsed = parseCsvRows(decoded.text, delimiter);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  if (parsed.rows.length < 2) {
    return { ok: false, reason: 'That CSV has no data rows to import (a header row and nothing else).' };
  }

  const [headerRow, ...dataRows] = parsed.rows;
  const mappingResult = detectColumnMapping(headerRow!);
  if (!mappingResult.ok) return { ok: false, reason: mappingResult.reason };
  const mapping = mappingResult.mapping;

  const tenant = await readTenant(userId, tenantId);
  if (!tenant) return { ok: false, reason: 'No such workspace.' };

  let rules: TaxRules;
  try {
    rules = await rulesFor(tenant);
  } catch (error) {
    return {
      ok: false,
      reason: `Cannot import a CSV statement: ${(error as Error).message}`,
    };
  }

  let account: FinancialAccountRow;
  if (params.financialAccountId) {
    const found = await getFinancialAccount(userId, tenantId, params.financialAccountId);
    if (!found) return { ok: false, reason: 'No such financial account in this workspace.' };
    account = found;
  } else {
    account = await ensureDefaultFinancialAccount(userId, tenantId, tenant.base_currency);
  }

  const format: AmountFormat = {
    thousandsSeparator: rules.currency.thousandsSeparator,
    decimalSeparator: rules.currency.decimalSeparator,
  };

  let openingBalance: ReturnType<typeof parseAmount> = null;
  let closingBalance: ReturnType<typeof parseAmount> = null;
  // `sourceRow` is the CSV FILE row number (header = row 1) — kept alongside
  // `lineNumber` (the transaction-sequence number that becomes
  // `statement_lines.line_number`) so a refusal can name the row a person
  // actually sees in their spreadsheet, not an internal count that silently
  // diverges from it the moment a balance-marker or blank row is skipped.
  const lines: (CandidateLine & {
    sourceRow: number;
    postedDate: string;
    valueDate: string | null;
    descriptionRaw: string;
  })[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i]!;
    // A CSV can end in blank trailing cells that survive `skip_empty_lines`
    // (a row of empty strings after trimming, from a trailing delimiter
    // line) — genuinely nothing to read, not a refusal.
    if (row.every((cell) => cell.trim() === '')) continue;

    const descriptionRaw = (row[mapping.description] ?? '').trim();
    const normalisedDescription = descriptionRaw.toLowerCase();
    const rowNumber = i + 2; // +1 for header, +1 for 1-based

    const isOpeningMarker = matchesAny(normalisedDescription, OPENING_BALANCE_TOKENS);
    const isClosingMarker = matchesAny(normalisedDescription, CLOSING_BALANCE_TOKENS);
    if (isOpeningMarker || isClosingMarker) {
      const balanceCell = mapping.balance !== null ? row[mapping.balance] : undefined;
      const amountCell = mapping.amount !== null ? row[mapping.amount] : undefined;
      const markerValue = parseAmount(balanceCell ?? amountCell ?? '', format);
      if (markerValue !== null) {
        if (isOpeningMarker) openingBalance = markerValue;
        else closingBalance = markerValue;
        continue;
      }
      // A row that LOOKS like a balance marker but carries no readable
      // number falls through and is read as an ordinary row instead of
      // being silently dropped — better an odd-looking transaction line
      // than a missing one.
    }

    const dateRaw = row[mapping.date] ?? '';
    if (dateRaw.trim() === '') {
      return { ok: false, reason: `Row ${rowNumber}: no date in the date column — refusing rather than guessing.` };
    }
    const dateResult = parseStatementDate(dateRaw, rules);
    if (!dateResult.ok) {
      return { ok: false, reason: `Row ${rowNumber}: ${dateResult.reason}` };
    }

    const amountResult = rowAmount(row, mapping, format, account.account_type);
    if (amountResult.value === null) {
      const which = amountResult.sawDebitCredit ? 'debit or credit amount' : 'amount';
      return { ok: false, reason: `Row ${rowNumber}: could not read a usable ${which}.` };
    }
    const amountSigned = amountResult.value;

    let valueDate: string | null = null;
    if (mapping.valueDate !== null) {
      const raw = (row[mapping.valueDate] ?? '').trim();
      if (raw !== '') {
        const parsedValueDate = parseStatementDate(raw, rules);
        if (parsedValueDate.ok) valueDate = parsedValueDate.iso;
        // A value date that fails to parse is dropped, not refused — it is
        // never what `posted_date` (settled_date, Lane R) or the balance
        // check reads, so a bad cell here costs a nullable field, not the
        // import.
      }
    }

    const runningBalance =
      mapping.balance !== null ? parseAmount(row[mapping.balance] ?? '', format) : null;

    lines.push({
      lineNumber: lines.length + 1,
      sourceRow: rowNumber,
      postedDate: dateResult.iso,
      valueDate,
      descriptionRaw: descriptionRaw || '(no description)',
      amountSigned,
      runningBalance,
    });
  }

  if (lines.length === 0) {
    return { ok: false, reason: 'That CSV has no readable transaction rows.' };
  }

  const gap = findRunningBalanceGap(lines);
  if (gap) {
    // `gap.lineNumber` is 1-based into `lines`, so it addresses the same
    // array position `sourceRow` was recorded at — translated back to the
    // CSV file's own row number for the message, not the internal count.
    const sourceRow = lines[gap.lineNumber - 1]!.sourceRow;
    return {
      ok: false,
      reason:
        `Row ${sourceRow}: the printed running balance does not follow from the previous row ` +
        `plus this row's amount (expected ${gap.expected}, the file says ${gap.printed}). ` +
        'This usually means a row is missing from the export — refusing rather than importing a gap silently.',
    };
  }

  const balance = computeBalanceCheck({ openingBalance, closingBalance, lines });

  const postedDates = lines.map((l) => l.postedDate).sort();
  const periodStart = postedDates[0]!;
  const periodEnd = postedDates[postedDates.length - 1]!;

  const { documentId, statementId } = await createStatementFromCsv(userId, tenantId, {
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
      source: 'csv_import',
      delimiter,
      columnMapping: mapping,
      rowCount: lines.length,
      openingBalanceFromFile: openingBalance !== null,
      closingBalanceFromFile: closingBalance !== null,
    },
    lines: lines.map((l) => ({
      lineNumber: l.lineNumber,
      postedDate: l.postedDate,
      valueDate: l.valueDate,
      descriptionRaw: l.descriptionRaw,
      amountSigned: l.amountSigned,
      runningBalance: l.runningBalance,
    })),
  });

  return { ok: true, documentId, statementId, balanceCheck: balance.balanceCheck, lineCount: lines.length };
}
