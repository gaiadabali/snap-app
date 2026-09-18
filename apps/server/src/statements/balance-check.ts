/**
 * The balance-check verdict for a CSV-imported statement, and the
 * running-balance gap check that is a CSV's best substitute for it.
 *
 * `docs/STATEMENTS.md` §4 is unambiguous about what a real balance check is:
 * `opening_balance + Σ amount_signed = closing_balance`. T4 (not yet built)
 * owns that check as a first-class validator for every intake mode. This
 * file exists because T5 cannot wait for T4 to land: a CSV either carries
 * both balances — in which case the SAME identity applies and this computes
 * it — or it does not, in which case §5.6 requires an explicit
 * `'unverifiable'` verdict rather than silence or a default `'pending'`
 * that never resolves. If T4 lands later with its own, more general
 * validator, this function is a candidate for the CSV path to call into it
 * instead; until then it is not a duplicate of a check that already exists
 * anywhere in the server.
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
  for (const line of lines) {
    if (line.runningBalance === null) continue;
    if (previous !== null) {
      const expected = add(previous, line.amountSigned);
      if (compare(expected, line.runningBalance) !== 0) {
        return { lineNumber: line.lineNumber, expected, printed: line.runningBalance };
      }
    }
    previous = line.runningBalance;
  }
  return null;
}
