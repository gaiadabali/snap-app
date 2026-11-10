import { describe, expect, it } from 'vitest';
import { decimal, decimalFor, parseExtraction } from './provider.js';

describe('decimalFor — printed amounts under the receipt currency', () => {
  const idr = decimalFor('IDR');
  const aud = decimalFor('AUD');

  it('reads rupiah thousands, not decimals (the es téh misread, 2026-11-10)', () => {
    expect(idr('74.000')).toBe('74000.0000');
    expect(idr('Rp 70.900')).toBe('70900.0000');
    expect(idr('1.234.567')).toBe('1234567.0000');
    expect(idr('29000')).toBe('29000.0000');
  });

  it('reads a rupiah figure with a comma decimal part', () => {
    expect(idr('6.727,27')).toBe('6727.2700');
  });

  it('keeps Australian amounts as they were', () => {
    expect(aud('$1,848.00')).toBe('1848.0000');
    expect(aud('48.50')).toBe('48.5000');
    expect(aud('74.000')).toBe('74.0000');
    expect(aud('1 848,00')).toBe('1848.0000');
    expect(aud('12,5')).toBe('12.5000');
    expect(aud('-12.40')).toBe('-12.4000');
  });

  it('reads a single comma before three digits as thousands', () => {
    expect(aud('1,848')).toBe('1848.0000');
  });

  it('takes JSON numbers as they are, and refuses non-numbers', () => {
    expect(idr(74000)).toBe('74000.0000');
    expect(aud(12.5)).toBe('12.5000');
    expect(aud('n/a')).toBeNull();
  });

  it('the currency-less decimal keeps statement amounts readable', () => {
    expect(decimal('$1,204.50')).toBe('1204.5000');
    expect(decimal('-35.10')).toBe('-35.1000');
  });
});

describe('parseExtraction — reads amounts with the receipt currency', () => {
  it('stores the es téh receipt as Rp 74,000', () => {
    const e = parseExtraction(
      JSON.stringify({
        docType: { value: 'receipt', confidence: 0.9 },
        currency: { value: 'IDR', confidence: 0.8 },
        supplierName: { value: 'es téh', confidence: 0.9 },
        taxExclusiveAmount: { value: '74.000', confidence: 0.7 },
        taxAmount: { value: '6.727,27', confidence: 0.8 },
        payableAmount: { value: '74.000', confidence: 0.9 },
        lines: [
          {
            description: { value: 'Es teh', confidence: 0.9 },
            amount: { value: '74.000', confidence: 0.9 },
            unitPrice: { value: '37.000', confidence: 0.9 },
          },
        ],
      }),
    );
    expect(e.currency.value).toBe('IDR');
    expect(e.payableAmount.value).toBe('74000.0000');
    expect(e.taxAmount.value).toBe('6727.2700');
    expect(e.lines[0]?.amount.value).toBe('74000.0000');
    expect(e.lines[0]?.unitPrice.value).toBe('37000.0000');
  });

  it('leaves an Australian receipt unchanged', () => {
    const e = parseExtraction(
      JSON.stringify({
        currency: { value: 'AUD', confidence: 0.9 },
        payableAmount: { value: '$1,848.00', confidence: 0.9 },
      }),
    );
    expect(e.payableAmount.value).toBe('1848.0000');
  });
});
