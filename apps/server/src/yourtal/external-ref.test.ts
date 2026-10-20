import { describe, expect, it } from 'vitest';

import { receiptContentRef, type ReceiptContent } from './external-ref.js';

const KEY = 'unit-test-receipt-ref-key-0123456789abcdef';

const base: ReceiptContent = {
  supplierAbn: '51824753556',
  supplierName: 'outbox test cafe',
  issueDate: '2026-10-20',
  payableAmount: '12.50',
  currency: 'AUD',
  documentNumber: 'INV-00123',
};
const ref = (over: Partial<ReceiptContent> = {}, key = KEY) => receiptContentRef({ ...base, ...over }, key);

describe('receiptContentRef', () => {
  it('is rcpt:v1: and 64 lowercase hex', () => {
    expect(ref()).toMatch(/^rcpt:v1:[0-9a-f]{64}$/);
  });

  it('is the same for the same receipt every time', () => {
    expect(ref()).toBe(ref());
  });

  describe('document number', () => {
    it('reads "INV-00123", "inv 123" and "INV0O123" as the same number', () => {
      const a = ref({ documentNumber: 'INV-00123' });
      expect(a).not.toBeNull();
      expect(ref({ documentNumber: 'inv 123' })).toBe(a);
      expect(ref({ documentNumber: 'INV0O123' })).toBe(a);
    });

    it('maps the OCR look-alikes O, I and L, and drops leading zeros', () => {
      expect(ref({ documentNumber: '000123' })).toBe(ref({ documentNumber: '123' }));
      expect(ref({ documentNumber: 'A-1O1' })).toBe(ref({ documentNumber: 'A-101' }));
      expect(ref({ documentNumber: 'AIL9' })).toBe(ref({ documentNumber: 'A119' }));
    });

    it('folds width and case (NFKC, uppercase)', () => {
      expect(ref({ documentNumber: 'ＩＮＶ１２３' })).toBe(ref({ documentNumber: 'inv123' }));
    });

    it('is a different ref for a different number', () => {
      expect(ref({ documentNumber: 'INV-00124' })).not.toBe(ref());
    });

    it('is null with no number, or none usable', () => {
      expect(ref({ documentNumber: null })).toBeNull();
      expect(ref({ documentNumber: '' })).toBeNull();
      expect(ref({ documentNumber: '   ' })).toBeNull();
      expect(ref({ documentNumber: '---' })).toBeNull();
      // Zeros only: nothing is left once they are dropped.
      expect(ref({ documentNumber: '0000' })).toBeNull();
    });

    it('is null when the raw number has no digit, even if look-alikes would make one', () => {
      expect(ref({ documentNumber: 'INVOICE' })).toBeNull();
      expect(ref({ documentNumber: 'OIL' })).toBeNull();
    });
  });

  describe('amount', () => {
    it('is exact decimal text: 12.50, 12.5 and 12.500 agree', () => {
      const a = ref({ payableAmount: '12.50' });
      expect(ref({ payableAmount: '12.5' })).toBe(a);
      expect(ref({ payableAmount: '12.500' })).toBe(a);
      expect(ref({ payableAmount: '+12.5' })).toBe(a);
      expect(ref({ payableAmount: ' 12.50 ' })).toBe(a);
    });

    it('treats 12.00, 12. and 12 as the same, and not as 12.5', () => {
      const a = ref({ payableAmount: '12.00' });
      expect(ref({ payableAmount: '12' })).toBe(a);
      expect(ref({ payableAmount: '12.' })).toBe(a);
      expect(a).not.toBe(ref({ payableAmount: '12.5' }));
    });

    it('keeps a refund apart from the sale', () => {
      expect(ref({ payableAmount: '-12.50' })).not.toBe(ref({ payableAmount: '12.50' }));
      expect(ref({ payableAmount: '-12.50' })).toBe(ref({ payableAmount: '-12.5' }));
    });

    it('does not lose a cent to floating point', () => {
      expect(ref({ payableAmount: '0.10' })).not.toBe(ref({ payableAmount: '0.1000000000000001' }));
      expect(ref({ payableAmount: '9007199254740993.01' })).not.toBe(ref({ payableAmount: '9007199254740993.02' }));
    });

    it('is null when missing or not a plain decimal', () => {
      for (const payableAmount of [null, '', 'abc', '1,234.50', '1e3', '12.5.0', '$12.50', '--1', '.5']) {
        expect(ref({ payableAmount }), String(payableAmount)).toBeNull();
      }
    });

    it('is a different ref for a different total', () => {
      expect(ref({ payableAmount: '12.51' })).not.toBe(ref());
    });
  });

  describe('date and currency', () => {
    it('a different date gives a different ref; no date gives null', () => {
      expect(ref({ issueDate: '2026-10-21' })).not.toBe(ref());
      expect(ref({ issueDate: null })).toBeNull();
      expect(ref({ issueDate: '20/10/2026' })).toBeNull();
    });

    it('a different currency gives a different ref; lower case is folded; not 3 letters is null', () => {
      expect(ref({ currency: 'IDR' })).not.toBe(ref());
      expect(ref({ currency: 'aud' })).toBe(ref());
      expect(ref({ currency: null })).toBeNull();
      expect(ref({ currency: 'AU' })).toBeNull();
      expect(ref({ currency: 'AUD1' })).toBeNull();
    });
  });

  describe('supplier', () => {
    it('uses the ABN when it is given, whatever the name says', () => {
      expect(ref({ supplierName: 'a different spelling' })).toBe(ref());
      expect(ref({ supplierName: null })).toBe(ref());
    });

    it('uses the name when there is no ABN (an invalid one is not passed by the caller)', () => {
      const byName = ref({ supplierAbn: null });
      expect(byName).not.toBeNull();
      expect(byName).not.toBe(ref());
      expect(ref({ supplierAbn: null, supplierName: 'someone else' })).not.toBe(byName);
      // Not an 11-digit ABN: ignored, the name is used.
      expect(ref({ supplierAbn: '1234' })).toBe(byName);
    });

    it('a different ABN gives a different ref', () => {
      expect(ref({ supplierAbn: '53004085616' })).not.toBe(ref());
    });

    it('is null with no supplier at all', () => {
      expect(ref({ supplierAbn: null, supplierName: null })).toBeNull();
      expect(ref({ supplierAbn: null, supplierName: '  ' })).toBeNull();
    });
  });

  describe('key', () => {
    it('a different key gives a different ref', () => {
      expect(ref({}, `${KEY}x`)).not.toBe(ref());
      expect(ref({}, `${KEY}x`)).toMatch(/^rcpt:v1:[0-9a-f]{64}$/);
    });

    it('is not a plain hash of the receipt, so a guess cannot be checked without the key', () => {
      // Two keys, same receipt: nothing in the ref is derivable from the fields alone.
      expect(ref({}, 'a'.repeat(32))).not.toBe(ref({}, 'b'.repeat(32)));
    });
  });
});
