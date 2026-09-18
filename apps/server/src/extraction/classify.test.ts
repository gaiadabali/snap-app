import { describe, expect, it } from 'vitest';

import { classifyExtractedText } from './classify.js';

/**
 * `docs/STATEMENTS.md` §12 T1 — classify.ts's own header explains the signal
 * and the ambiguous-defaults-to-receipt rule at length; these tests hold that
 * design to account. Pure and synchronous, like the function under test: no
 * PDF, no database, no worker.
 */
describe('classifyExtractedText', () => {
  it('classifies a statement heading plus an account number as a statement', () => {
    const result = classifyExtractedText([
      'ACME BANK\nBank Statement\nAccount Number: 123-456\nPage 1 of 3',
    ]);
    expect(result.kind).toBe('statement');
    expect(result.signals).toEqual(expect.arrayContaining(['statement_heading', 'account_number']));
  });

  it('classifies an opening+closing balance pair plus a stated period as a statement', () => {
    const result = classifyExtractedText([
      'Transaction history\nOpening balance 1,204.50\nStatement period: 1 Aug 2026 to 31 Aug 2026\nClosing balance 984.12',
    ]);
    expect(result.kind).toBe('statement');
    expect(result.signals).toEqual(expect.arrayContaining(['balance_pair', 'statement_period']));
  });

  it('classifies the Indonesian phrasing the same way — this is not an AU-only heuristic', () => {
    const result = classifyExtractedText([
      'Bank Negara Indonesia\nREKENING KORAN\nNo. Rekening: 0012345678\nPeriode Laporan: 01/08/2026 - 31/08/2026',
    ]);
    expect(result.kind).toBe('statement');
    expect(result.signals).toEqual(
      expect.arrayContaining(['statement_heading', 'account_number', 'statement_period']),
    );
  });

  it('classifies an Indonesian saldo awal / saldo akhir pair as a statement, given one more signal', () => {
    const result = classifyExtractedText([
      'Mutasi Rekening\nSaldo awal 500.000\nSaldo akhir 620.000\nNomor rekening 998877',
    ]);
    expect(result.kind).toBe('statement');
    expect(result.signals).toEqual(expect.arrayContaining(['statement_heading', 'balance_pair', 'account_number']));
  });

  it('leaves a document with only an account number a receipt — the ordinary invoice case', () => {
    // A tax invoice legitimately prints its own bank details for remittance —
    // "Account Number: 123" alone must not flip this to a statement.
    const result = classifyExtractedText(['Tax Invoice\nAcme Pty Ltd\nAccount Number: 123-456\nTotal $110.00']);
    expect(result.kind).toBe('receipt');
    expect(result.signals).toEqual(['account_number']);
  });

  it('leaves a document with only a stated period a receipt', () => {
    // A service invoice billing "for the period 1-31 August" is not a
    // statement just because it names a date range.
    const result = classifyExtractedText(['Invoice #4471\nFor the period 1-31 August 2026\nAmount due $220.00']);
    expect(result.kind).toBe('receipt');
    expect(result.signals).toEqual(['statement_period']);
  });

  it('leaves a lone opening+closing balance pair a receipt — one structural signal is not enough alone', () => {
    // Below the two-signal bar even though `balance_pair` is structural: the
    // module requires a structural signal PLUS one more, never a structural
    // signal by itself.
    const result = classifyExtractedText(['Opening balance 100.00\nClosing balance 84.20']);
    expect(result.kind).toBe('receipt');
    expect(result.signals).toEqual(['balance_pair']);
  });

  it('requires BOTH an opening and a closing phrase for balance_pair — a lone "balance" is not the pair', () => {
    const result = classifyExtractedText(['Loyalty card balance: 84.20 points']);
    expect(result.kind).toBe('receipt');
    expect(result.signals).toEqual([]);
  });

  it('leaves a document with no signal at all a receipt, and says so in the reason', () => {
    const result = classifyExtractedText(['Corner Store Pty Ltd\nMilk 2%\nBread\nTotal $12.40']);
    expect(result.kind).toBe('receipt');
    expect(result.signals).toEqual([]);
    expect(result.reason).toMatch(/no statement signal found/);
  });

  it('joins every page before matching — a heading on page 1 and a balance pair on page 3 still count together', () => {
    const result = classifyExtractedText([
      'ACME BANK\nBank Statement\nAccount summary follows',
      'Transaction listing continues on next page...',
      'Opening balance 500.00\nClosing balance 410.00',
    ]);
    expect(result.kind).toBe('statement');
    expect(result.signals).toEqual(expect.arrayContaining(['statement_heading', 'balance_pair']));
  });

  it('matches case-insensitively', () => {
    const result = classifyExtractedText(['BANK STATEMENT\nACCOUNT NUMBER 555-1']);
    expect(result.kind).toBe('statement');
  });
});
