import { describe, expect, it } from 'vitest';

import { allocate, formatAud, splitLinesCents, splitReceipt, splitRestCents, toUnits, type SplitInput } from './receipt-split';

const line = (lineNumber: number, amount: string, categoryId: string | null = null, gstFree = false) => ({
  lineNumber, amount, gstFree, categoryId,
});
const sum = (xs: Array<{ cents: bigint }>) => xs.reduce((a, p) => a + p.cents, 0n);
const byCat = (s: ReturnType<typeof splitReceipt>) =>
  Object.fromEntries(s.parts.map((p) => [`${p.categoryId ?? 'none'}${p.rest ? ':rest' : ''}`, p.cents]));

describe('splitReceipt: a supermarket docket (lines printed with GST in them)', () => {
  // Coles-style: GST-free food, one taxable work item, GST printed for the whole docket.
  const docket: SplitInput = {
    payable: '64.30', taxAmount: '2.27', categoryId: 'groceries',
    lines: [line(1, '3.10', null, true), line(2, '25.00', 'tools'), line(3, '4.20', null, true), line(4, '32.00', null, true)],
  };

  it('takes the work line as printed: never adds GST a docket line already holds', () => {
    const s = splitReceipt(docket);
    expect(s.linesPrinted).toBe('inclusive');
    expect(byCat(s)).toEqual({ tools: 2500n, 'groceries:rest': 3930n });
    expect(sum(s.parts)).toBe(6430n);
    expect(s.totalCents).toBe(6430n);
    expect(splitLinesCents(s)).toBe(2500n);
    expect(splitRestCents(s)).toBe(3930n);
  });

  it('a GST-free line filed on its own is its amount too', () => {
    const s = splitReceipt({ ...docket, lines: docket.lines.map((l) => (l.lineNumber === 3 ? { ...l, categoryId: 'tools' } : l)) });
    expect(byCat(s)).toEqual({ tools: 2920n, 'groceries:rest': 3510n });
  });

  it('cash rounding stays with the rest (total 15.00, lines 15.02)', () => {
    const s = splitReceipt({ payable: '15.00', taxAmount: null, categoryId: 'groceries', lines: [line(1, '10.02', 'tools'), line(2, '5.00')] });
    expect(byCat(s)).toEqual({ tools: 1002n, 'groceries:rest': 498n });
    expect(sum(s.parts)).toBe(1500n);
  });

  it('a receipt with no category of its own: the rest is a part with no category (sent nowhere)', () => {
    const s = splitReceipt({ ...docket, categoryId: null });
    expect(byCat(s)).toEqual({ tools: 2500n, 'none:rest': 3930n });
  });

  it('a line filed in the receipt’s own category stays its own part; the rest follows it', () => {
    const s = splitReceipt({ ...docket, categoryId: 'tools' });
    expect(s.parts).toEqual([
      { categoryId: 'tools', cents: 2500n, lineNumbers: [2], rest: false },
      { categoryId: 'tools', cents: 3930n, lineNumbers: [], rest: true },
    ]);
  });

  it('every line filed: no rest part', () => {
    const s = splitReceipt({ payable: '30.00', taxAmount: null, categoryId: null, lines: [line(1, '10.00', 'a'), line(2, '20.00', 'b')] });
    expect(byCat(s)).toEqual({ a: 1000n, b: 2000n });
  });
});

describe('splitReceipt: a tax invoice that prints its lines before GST', () => {
  it('adds each standard line’s share of the printed GST; GST-free lines get none', () => {
    const s = splitReceipt({
      payable: '185.00', taxAmount: '15.00', categoryId: 'office',
      lines: [line(1, '100.00', 'tools'), line(2, '50.00'), line(3, '20.00', 'books', true)],
    });
    expect(s.linesPrinted).toBe('exclusive');
    expect(byCat(s)).toEqual({ tools: 11000n, books: 2000n, 'office:rest': 5500n });
    expect(s.lines).toEqual([
      { lineNumber: 1, paidCents: 11000n }, { lineNumber: 2, paidCents: 5500n }, { lineNumber: 3, paidCents: 2000n },
    ]);
  });

  it('thirds of a cent: the parts still add up to the total exactly', () => {
    const s = splitReceipt({
      payable: '110.00', taxAmount: '10.00', categoryId: null,
      lines: [line(1, '33.33', 'a'), line(2, '33.33', 'b'), line(3, '33.34')],
    });
    // GST shares 3.333 / 3.333 / 3.334: lines cost 36.663 / 36.663 / 36.674.
    expect(byCat(s)).toEqual({ a: 3666n, b: 3666n, 'none:rest': 3668n });
    expect(sum(s.parts)).toBe(11000n);
  });

  it('a line the reading missed: 10% on the lines it did read, the rest takes the difference', () => {
    // A $50 + GST line is missing: lines 100 + GST 15 do not make 165, so the printed GST
    // cannot be shared out; 10% of the work line is what it cost.
    const s = splitReceipt({ payable: '165.00', taxAmount: '15.00', categoryId: 'office', lines: [line(1, '100.00', 'tools')] });
    expect(s.linesPrinted).toBe('exclusive');
    expect(byCat(s)).toEqual({ tools: 11000n, 'office:rest': 5500n });
  });

  it('a docket whose GST is stated is not mistaken for one printed before GST', () => {
    const s = splitReceipt({ payable: '110.00', taxAmount: '10.00', categoryId: null, lines: [line(1, '110.00', 'tools')] });
    expect(s.linesPrinted).toBe('inclusive');
    expect(byCat(s)).toEqual({ tools: 11000n });
  });
});

describe('splitReceipt: discounts, over-reads and odd inputs', () => {
  it('a discount line filed with its item comes off it', () => {
    const s = splitReceipt({ payable: '40.00', taxAmount: null, categoryId: null, lines: [line(1, '20.00', 'tools'), line(2, '-5.00', 'tools'), line(3, '25.00')] });
    expect(byCat(s)).toEqual({ tools: 1500n, 'none:rest': 2500n });
  });

  it('a discount line filed on its own is not split off (it stays with the rest)', () => {
    const s = splitReceipt({ payable: '40.00', taxAmount: null, categoryId: 'g', lines: [line(1, '20.00', 'tools'), line(2, '-5.00', 'other'), line(3, '25.00')] });
    expect(byCat(s)).toEqual({ tools: 2000n, 'g:rest': 2000n });
    expect(s.ignoredLineNumbers).toEqual([2]);
  });

  it('lines that add up to more than the total are scaled down to it', () => {
    const s = splitReceipt({ payable: '20.00', taxAmount: null, categoryId: 'g', lines: [line(1, '15.00', 'a'), line(2, '10.00', 'b')] });
    expect(s.capped).toBe(true);
    expect(byCat(s)).toEqual({ a: 1200n, b: 800n });
    expect(sum(s.parts)).toBe(2000n);
  });

  it('a total with no cents to spare rounds half up, and the parts follow it', () => {
    const s = splitReceipt({ payable: '30.5050', taxAmount: null, categoryId: 'g', lines: [line(1, '10.0050', 'a'), line(2, '20.50')] });
    expect(s.totalCents).toBe(3051n);
    expect(sum(s.parts)).toBe(3051n);
  });

  it('no total: nothing to split', () => {
    for (const payable of [null, '', '0', '0.0000']) {
      const s = splitReceipt({ payable, taxAmount: null, categoryId: 'g', lines: [line(1, '10.00', 'a')] });
      expect(s.parts).toEqual([]);
      expect(s.totalCents).toBe(0n);
    }
  });

  it('lines with no amount are left out', () => {
    const s = splitReceipt({ payable: '10.00', taxAmount: null, categoryId: 'g', lines: [{ lineNumber: 1, amount: null, gstFree: false, categoryId: 'a' }] });
    expect(byCat(s)).toEqual({ 'g:rest': 1000n });
  });
});

describe('splitReceipt: the parts always add up to the total (seeded random receipts)', () => {
  // A small deterministic generator, so a failure names the case that broke.
  let seed = 20261126;
  const rnd = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  const money = (maxCents: number, dp4 = false) => {
    const c = rnd(maxCents);
    return dp4 ? `${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}${String(rnd(100)).padStart(2, '0')}` : `${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`;
  };

  it('2 000 receipts: exact sum, no negative part, rest never below zero', () => {
    for (let i = 0; i < 2000; i++) {
      const n = 1 + rnd(8);
      const cats = ['a', 'b', 'c', null, null];
      const lines = Array.from({ length: n }, (_, k) => ({
        lineNumber: k + 1,
        amount: rnd(10) === 0 ? `-${money(500)}` : money(20000, rnd(4) === 0),
        gstFree: rnd(3) === 0,
        categoryId: cats[rnd(cats.length)]!,
      }));
      const lineSum = lines.reduce((a, l) => a + toUnits(l.amount), 0n);
      const style = rnd(4);
      // Inclusive docket, exclusive invoice (lines + 10%), or a total that disagrees with the lines.
      const tax = style === 1 ? (lineSum > 0n ? lineSum / 10n : 0n) : style === 0 ? lineSum / 11n : 0n;
      const payableUnits = style === 1 ? lineSum + tax : style === 2 ? BigInt(rnd(5000000)) : lineSum;
      const fmt = (u: bigint) => `${u < 0n ? '-' : ''}${(u < 0n ? -u : u) / 10000n}.${((u < 0n ? -u : u) % 10000n).toString().padStart(4, '0')}`;
      const input: SplitInput = { payable: fmt(payableUnits), taxAmount: style === 3 ? null : fmt(tax), categoryId: rnd(2) ? 'r' : null, lines };
      const s = splitReceipt(input);
      const label = JSON.stringify(input);
      if (payableUnits <= 0n) {
        expect(s.parts, label).toEqual([]);
        continue;
      }
      expect(sum(s.parts), label).toBe(s.totalCents);
      expect(s.totalCents, label).toBe((payableUnits + 50n) / 100n);
      for (const p of s.parts) expect(p.cents >= 0n, label).toBe(true);
      expect(splitLinesCents(s) <= s.totalCents, label).toBe(true);
    }
  });
});

describe('allocate', () => {
  it('shares exactly, largest remainder, ties to the earlier one', () => {
    expect(allocate(100n, [1n, 1n, 1n])).toEqual([34n, 33n, 33n]);
    expect(allocate(10n, [3n, 3n, 4n])).toEqual([3n, 3n, 4n]);
    expect(allocate(7n, [5n, -1n])).toEqual([9n, -2n]);
    expect(() => allocate(1n, [0n])).toThrow();
  });
});

describe('toUnits / formatAud', () => {
  it('reads decimal strings exactly; past 4 dp rounds half away from zero', () => {
    expect(toUnits('12.34')).toBe(123400n);
    expect(toUnits('-5')).toBe(-50000n);
    expect(toUnits('.5')).toBe(5000n);
    expect(toUnits('1.00005')).toBe(10001n);
    expect(() => toUnits('abc')).toThrow();
  });
  it('prints dollars', () => {
    expect(formatAud(123456n)).toBe('$1,234.56');
    expect(formatAud(5n)).toBe('$0.05');
    expect(formatAud(-500n)).toBe('-$5.00');
  });
});
