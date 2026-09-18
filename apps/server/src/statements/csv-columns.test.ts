import { describe, expect, it } from 'vitest';

import { detectColumnMapping } from './csv-columns.js';

describe('detectColumnMapping', () => {
  it('maps a common AU internet-banking export (Date/Description/Debit/Credit/Balance)', () => {
    const result = detectColumnMapping(['Date', 'Description', 'Debit', 'Credit', 'Balance']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mapping).toEqual({
      date: 0,
      valueDate: null,
      description: 1,
      amount: null,
      debit: 2,
      credit: 3,
      balance: 4,
    });
  });

  it('maps a single-signed-amount export (Transaction Date/Narrative/Amount)', () => {
    const result = detectColumnMapping(['Transaction Date', 'Narrative', 'Amount']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mapping.date).toBe(0);
    expect(result.mapping.description).toBe(1);
    expect(result.mapping.amount).toBe(2);
    expect(result.mapping.debit).toBeNull();
    expect(result.mapping.credit).toBeNull();
  });

  it('maps an Indonesian-vocabulary export (Tanggal/Keterangan/Jumlah/Saldo)', () => {
    const result = detectColumnMapping(['Tanggal', 'Keterangan', 'Jumlah', 'Saldo']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mapping.date).toBe(0);
    expect(result.mapping.description).toBe(1);
    expect(result.mapping.amount).toBe(2);
    expect(result.mapping.balance).toBe(3);
  });

  it('is case- and whitespace-insensitive, and strips a leading BOM off the first header', () => {
    const result = detectColumnMapping(['﻿  DATE  ', '  description ', 'AMOUNT']);
    expect(result.ok).toBe(true);
  });

  /* ── Refusal: this is the ticket's whole point for an unmappable file ──── */

  it('refuses a file with no recognisable date column, naming what is missing', () => {
    const result = detectColumnMapping(['Reference', 'Notes', 'Amount']);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/date column/);
    expect(result.reason).toMatch(/Reference/);
  });

  it('refuses a file with debit but no credit column and no single amount column', () => {
    const result = detectColumnMapping(['Date', 'Description', 'Debit']);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/single amount column, or both a debit and a credit column/);
  });

  it('refuses a completely unrecognisable header row rather than guessing an order', () => {
    const result = detectColumnMapping(['Col A', 'Col B', 'Col C']);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.headers).toEqual(['Col A', 'Col B', 'Col C']);
  });
});
