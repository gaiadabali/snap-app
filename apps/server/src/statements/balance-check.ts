/**
 * The balance-check verdict for a CSV-imported statement, and the
 * running-balance gap check that is a CSV's best substitute for it.
 *
 * `docs/STATEMENTS.md` §4 is unambiguous about what a real balance check is:
 * `opening_balance + Σ amount_signed = closing_balance`. T4 owns that check
 * as a first-class validator for every intake mode — CSV today (T5),
 * whatever the PDF path (T2) becomes later. `evaluateBalanceCheck` below is
 * that validator's single entry point: it runs the identity check AND the
 * running-balance gap check together and hands back one verdict, so a
 * caller adopts it rather than re-deriving the combination itself. T5
 * predates T4 landing and originally called `computeBalanceCheck` /
 * `findRunningBalanceGap` directly; `csv-import.ts` now calls
 * `evaluateBalanceCheck` instead, with no change in behaviour — this file
 * was never a duplicate of a check that exists elsewhere, and T4 did not
 * rebuild it, only completed it.
 *
 * THE ONE THING THIS FILE REFUSES TO DO: report `'pass'` for a statement
 * that never had an independent closing balance to check against. Deriving
 * `closing = opening + Σlines` when the file gave neither is bookkeeping
 * convenience for the NOT NULL columns in `statements` (0031) — it is not
 * evidence, and `'unverifiable'` says so.
 *
 * All arithmetic goes through `@snap/db`'s `money` module: scaled BigInt,
 * never a float, matching `money_amount NUMERIC(19,4)` exactly.
 */
import { money as moneyNs, type Money } from '@snap/db';
import type { StatementBalanceCheck } from '@snap/api-contract';

const { add, compare, isZero, money, subtract } = moneyNs;

export interface CandidateLine {
  lineNumber: number;
  amountSigned: Money;
  runningBalance: Money | null;
}

export interface BalanceCheckInput {
  /** From the file, when a marker row or metadata carried one. */
  openingBalance: Money | null;
  closingBalance: Money | null;
  lines: CandidateLine[];
}

export interface BalanceCheckResult {
  balanceCheck: StatementBalanceCheck;
  balanceResidual: Money | null;
  /** Always populated — derived when the file gave nothing, so the NOT NULL
   *  `statements.opening_balance` / `closing_balance` columns have something
   *  honest to hold either way. */
  openingBalance: Money;
  closingBalance: Money;
}

export function computeBalanceCheck(input: BalanceCheckInput): BalanceCheckResult {
  const sum = add(...input.lines.map((l) => l.amountSigned));

  if (input.openingBalance !== null && input.closingBalance !== null) {
    const expectedClosing = add(input.openingBalance, sum);
    const residual = subtract(input.closingBalance, expectedClosing);
    const exact = isZero(residual);
    return {
      balanceCheck: exact ? 'pass' : 'residual',
      balanceResidual: exact ? null : residual,
      openingBalance: input.openingBalance,
      closingBalance: input.closingBalance,
    };
  }

  const opening = input.openingBalance ?? money(0);
  const closing = input.closingBalance ?? add(opening, sum);
  return {
    balanceCheck: 'unverifiable',
    balanceResidual: null,
    openingBalance: opening,
    closingBalance: closing,
  };
}

export interface RunningBalanceGap {
  /** 1-based `statement_lines.line_number` of the FIRST row whose printed
   *  running balance disagrees with the previous row plus this row's amount. */
  lineNumber: number;
  /** `line_number` of the last row before it that carried a printed running
   *  balance — `null` when the disagreeing row is the first one with a
   *  balance at all (nothing earlier to compare against). Together with
   *  `lineNumber` this is the row RANGE a human should go and look at: the
   *  break sits somewhere between these two printed rows, not necessarily
   *  at `lineNumber` itself — a missing row lands its shortfall on the next
   *  row that happens to print a balance. */
  previousLineNumber: number | null;
  expected: Money;
  printed: Money;
}

/**
 * §5.6's compensating control for a CSV with no opening/closing balance: gap
 * detection on the running-balance column, where one exists.
 *
 * Returns the FIRST disagreement only — `docs/STATEMENTS.md` §4's own
 * framing is that the failure is localisable, not merely present, and a
 * caller refusing an import names one row, not a list nobody will read.
 * Rows lacking a running balance (the column is genuinely optional per row,
 * not just per file, on some exports) are skipped rather than treated as a
 * break — a blank cell is not a disagreement.
 */
export function findRunningBalanceGap(lines: CandidateLine[]): RunningBalanceGap | null {
  let previous: Money | null = null;
  let previousLineNumber: number | null = null;
  for (const line of lines) {
    if (line.runningBalance === null) continue;
    if (previous !== null) {
      const expected = add(previous, line.amountSigned);
      if (compare(expected, line.runningBalance) !== 0) {
        return { lineNumber: line.lineNumber, previousLineNumber, expected, printed: line.runningBalance };
      }
    }
    previous = line.runningBalance;
    previousLineNumber = line.lineNumber;
  }
  return null;
}

/** Human-readable row RANGE for a `RunningBalanceGap` — "rows 4-5" when there
 *  is an earlier printed balance to bound the range with, "row 2 (no earlier
 *  printed balance to compare against)" when the very first balance-bearing
 *  row is already wrong. Never a single bare row number: a human counting
 *  lines in their file needs to know a row is missing BETWEEN two rows, and
 *  a bare "row 5" reads as "row 5 is the culprit" rather than "something
 *  between here and the last good row is missing". */
export function describeBalanceGap(gap: RunningBalanceGap): string {
  if (gap.previousLineNumber === null) {
    return `row ${gap.lineNumber} (no earlier printed balance to compare against)`;
  }
  return `rows ${gap.previousLineNumber}-${gap.lineNumber}`;
}

export interface StatementBalanceVerdict {
  check: BalanceCheckResult;
  gap: RunningBalanceGap | null;
}

/**
 * The first-class validator (`docs/STATEMENTS.md` §12 T4): runs the balance
 * IDENTITY check and the running-balance GAP check together, in one call, so
 * every statement intake path — CSV today, the PDF path (T2) whenever it
 * lands — gets the full verdict (pass / residual / unverifiable, AND, when
 * a running-balance column exists, the localised row range) without having
 * to remember to call two separate primitives and combine them correctly
 * itself. `computeBalanceCheck` and `findRunningBalanceGap` stay exported
 * directly too — this is a composition on top of them, not a replacement.
 */
export function evaluateBalanceCheck(input: BalanceCheckInput): StatementBalanceVerdict {
  return {
    check: computeBalanceCheck(input),
    gap: findRunningBalanceGap(input.lines),
  };
}
