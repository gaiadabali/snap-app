import { money as moneyNs } from '@snap/db';
import { describe, expect, it } from 'vitest';

import { computeBalanceCheck, findRunningBalanceGap, type CandidateLine } from './balance-check.js';

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
});
