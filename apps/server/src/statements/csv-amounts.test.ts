import { describe, expect, it } from 'vitest';

import { parseAmount, type AmountFormat } from './csv-amounts.js';

const AU: AmountFormat = { thousandsSeparator: ',', decimalSeparator: '.' };
const ID: AmountFormat = { thousandsSeparator: '.', decimalSeparator: ',' };

describe('parseAmount', () => {
  it('parses a plain AU decimal', () => {
    expect(parseAmount('45.00', AU)).toBe('45.0000');
  });

  it('parses an AU amount with thousands separators and a currency symbol', () => {
    expect(parseAmount('$1,234.56', AU)).toBe('1234.5600');
  });

  it('parses an Indonesian amount — this is the exact §7.1 hazard: "15.000" is fifteen thousand, not fifteen', () => {
    expect(parseAmount('15.000', ID)).toBe('15000.0000');
    expect(parseAmount('Rp 1.234.567,89', ID)).toBe('1234567.8900');
  });

  it('the SAME digits read differently under the two rule sets — this is the whole point of not hardcoding separators', () => {
    expect(parseAmount('1.234', AU)).toBe('1.2340'); // AU: dot is decimal
    expect(parseAmount('1.234', ID)).toBe('1234.0000'); // ID: dot is thousands
  });

  it('recognises a leading minus sign as negative', () => {
    expect(parseAmount('-45.00', AU)).toBe('-45.0000');
  });

  it('recognises accounting-style parentheses as negative', () => {
    expect(parseAmount('(45.00)', AU)).toBe('-45.0000');
  });

  it('returns null for a blank cell', () => {
    expect(parseAmount('', AU)).toBeNull();
    expect(parseAmount('   ', AU)).toBeNull();
  });

  it('returns null for text that is not a number', () => {
    expect(parseAmount('n/a', AU)).toBeNull();
  });
});
