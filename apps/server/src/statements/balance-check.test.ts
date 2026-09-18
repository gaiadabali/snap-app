import { money as moneyNs } from '@snap/db';
import { describe, expect, it } from 'vitest';

import {
  computeBalanceCheck,
  describeBalanceGap,
  evaluateBalanceCheck,
  findRunningBalanceGap,
  type CandidateLine,
} from './balance-check.js';

const m = moneyNs.money;

function line(lineNumber: number, amountSigned: string, runningBalance: string | null = null): CandidateLine {
  return { lineNumber, amountSigned: m(amountSigned), runningBalance: runningBalance === null ? null : m(runningBalance) };
}

describe('computeBalanceCheck', () => {
  it('passes when opening + Σlines exactly equals the printed closing balance', () => {
    // opening 1000.00, spend 100.00 (+), receive 250.00 (-) -> net -150.00
    const result = computeBalanceCheck({
      openingBalance: m('1000.00'),
      closingBalance: m('850.00'),
      lines: [line(1, '100.00'), line(2, '-250.00')],
    });
    expect(result.balanceCheck).toBe('pass');
    expect(result.balanceResidual).toBeNull();
  });

  it('reports residual when the identity does not hold, and the exact amount by which it is out', () => {
    const result = computeBalanceCheck({
      openingBalance: m('1000.00'),
      closingBalance: m('900.00'), // should have been 850.00
      lines: [line(1, '100.00'), line(2, '-250.00')],
    });
    expect(result.balanceCheck).toBe('residual');
    expect(result.balanceResidual).toBe('50.0000');
  });

  /* ── The ticket's Done-when (1): this is the whole point of T5 ─────────── */

  it('is unverifiable — NEVER pass — when the file carries no opening or closing balance', () => {
    const result = computeBalanceCheck({
      openingBalance: null,
      closingBalance: null,
      lines: [line(1, '45.00'), line(2, '-2000.00'), line(3, '12.50')],
    });
    expect(result.balanceCheck).toBe('unverifiable');
    expect(result.balanceResidual).toBeNull();
    // The NOT NULL statements.opening_balance/closing_balance columns still
    // get something honest to hold — derived, not claimed as verified.
    expect(result.openingBalance).toBe('0.0000');
    expect(result.closingBalance).toBe(
      moneyNs.add(m('45.00'), m('-2000.00'), m('12.50')),
    );
  });

  it('is unverifiable when only ONE of opening/closing is present — half a check is not a check', () => {
    const withOpeningOnly = computeBalanceCheck({
      openingBalance: m('500.00'),
      closingBalance: null,
      lines: [line(1, '10.00')],
    });
    expect(withOpeningOnly.balanceCheck).toBe('unverifiable');

    const withClosingOnly = computeBalanceCheck({
      openingBalance: null,
      closingBalance: m('500.00'),
      lines: [line(1, '10.00')],
    });
    expect(withClosingOnly.balanceCheck).toBe('unverifiable');
  });
});

describe('findRunningBalanceGap', () => {
  it('returns null when every row\'s running balance follows from the previous one', () => {
    const gap = findRunningBalanceGap([
      line(1, '100.00', '900.00'),
      line(2, '-50.00', '850.00'), // 900.00 - 50.00
      line(3, '25.00', '875.00'), // 850.00 + 25.00
    ]);
    expect(gap).toBeNull();
  });

  /* ── The ticket's Done-when (3): name the first breaking row ────────────── */

  it('names the FIRST row whose running balance disagrees, not a later one', () => {
    const gap = findRunningBalanceGap([
      line(1, '100.00', '900.00'),
      line(2, '-50.00', '999.00'), // should be 850.00 — a row is missing here
      line(3, '25.00', '1024.00'), // consistent with the (wrong) previous balance
    ]);
    expect(gap).not.toBeNull();
    expect(gap!.lineNumber).toBe(2);
    expect(gap!.expected).toBe('850.0000');
    expect(gap!.printed).toBe('999.0000');
  });

  it('skips rows with no printed running balance rather than treating a blank as a break', () => {
    const gap = findRunningBalanceGap([
      line(1, '100.00', '900.00'),
      line(2, '-50.00', null),
      line(3, '25.00', '925.00'),
    ]);
    expect(gap).toBeNull();
  });

  it('records previousLineNumber alongside the disagreeing row, for a row RANGE not a bare row', () => {
    const gap = findRunningBalanceGap([
      line(1, '100.00', '900.00'),
      line(2, '-50.00', '850.00'),
      line(3, '25.00', '999.00'), // should be 875.00
    ]);
    expect(gap).toEqual({ lineNumber: 3, previousLineNumber: 2, expected: '875.0000', printed: '999.0000' });
  });

  it('cannot report a gap on a single balance-bearing row — nothing earlier to compare it to', () => {
    const gap = findRunningBalanceGap([line(1, '100.00', '999.00')]);
    expect(gap).toBeNull();
  });
});

describe('describeBalanceGap', () => {
  it('names a row RANGE, not a single row, when an earlier balance exists to bound it', () => {
    const gap = findRunningBalanceGap([
      line(1, '100.00', '900.00'),
      line(2, '-50.00', '999.00'), // a row is missing between line 1 and line 2
    ]);
    expect(describeBalanceGap(gap!)).toBe('rows 1-2');
  });
});

/* ── T4's own "done when": one row removed → non-zero residual AND a named
 *    row range, from the SAME deliberately-broken statement, in one call ── */
describe('evaluateBalanceCheck — the combined first-class validator', () => {
  it('a statement with one row deliberately removed reports a non-zero residual and names the row range', () => {
    // The ORIGINAL, correct statement (never constructed here — this is
    // what it would have been): opening 1000.00, five rows netting +375.00,
    // closing 1375.00, printed running balance after every row.
    //   row1 +200.00 -> 1200.00
    //   row2  -50.00 -> 1150.00
    //   row3 +300.00 -> 1450.00   <-- this row is the one that goes missing
    //   row4 -100.00 -> 1350.00
    //   row5  +25.00 -> 1375.00
    //
    // What the reader actually sees, with row3 deleted: the bank's own
    // printed running-balance column is untouched by the deletion (it is
    // print, not a formula this tool re-evaluates), so lines renumber
    // 1..4 but keep their ORIGINAL printed balances, and the file's
    // closing balance (1375.00) is likewise unaffected by the deletion.
    const openingBalance = m('1000.00');
    const closingBalance = m('1375.00'); // unchanged — it's what the bank printed
    const lines: CandidateLine[] = [
      line(1, '200.00', '1200.00'),
      line(2, '-50.00', '1150.00'),
      line(3, '-100.00', '1350.00'), // was row4; row3 (+300.00) is gone
      line(4, '25.00', '1375.00'), // was row5
    ];

    const { check, gap } = evaluateBalanceCheck({ openingBalance, closingBalance, lines });

    // The residual: opening 1000.00 + Σ(200 - 50 - 100 + 25 = 75.00) = 1075.00
    // expected vs. 1375.00 printed closing -> residual is exactly the
    // missing row's amount, 300.00.
    expect(check.balanceCheck).toBe('residual');
    expect(check.balanceResidual).toBe('300.0000');

    // The row range: the running balance breaks between line 2 (last row
    // whose printed balance still agrees) and line 3 (the first row whose
    // printed balance no longer follows) — exactly where the missing row
    // used to sit.
    expect(gap).not.toBeNull();
    expect(gap!.lineNumber).toBe(3);
    expect(gap!.previousLineNumber).toBe(2);
    expect(gap!.expected).toBe('1050.0000');
    expect(gap!.printed).toBe('1350.0000');
    expect(describeBalanceGap(gap!)).toBe('rows 2-3');
  });

  it('never lets a broken statement report pass — the honesty rule this ticket exists to enforce', () => {
    // Same scenario as above. Proves the validator does not default to
    // 'pass' when a gap is present but the caller only looked at `check`.
    const { check } = evaluateBalanceCheck({
      openingBalance: m('1000.00'),
      closingBalance: m('1375.00'),
      lines: [
        line(1, '200.00', '1200.00'),
        line(2, '-50.00', '1150.00'),
        line(3, '-100.00', '1350.00'),
        line(4, '25.00', '1375.00'),
      ],
    });
    expect(check.balanceCheck).not.toBe('pass');
  });

  it('a CSV row dump with no opening or closing balance is unverifiable, never pass, even with a clean gap check', () => {
    // §4/D-S3's binding rule: a running-balance gap check passing is NOT
    // evidence of completeness on its own — with no opening/closing
    // balance, the verdict must stay 'unverifiable', never be upgraded to
    // 'pass' just because the gap check found nothing.
    const { check, gap } = evaluateBalanceCheck({
      openingBalance: null,
      closingBalance: null,
      lines: [line(1, '100.00', '900.00'), line(2, '-50.00', '850.00')],
    });
    expect(gap).toBeNull();
    expect(check.balanceCheck).toBe('unverifiable');
  });
});
