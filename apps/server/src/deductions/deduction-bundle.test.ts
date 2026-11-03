import { AMOUNT_PATTERN, ITEM_IDS, MAX_LINES, validateDeductionBundle } from '@snap/api-contract/deduction-bundle';
import { describe, expect, it } from 'vitest';

import { buildDeductionBundle, centsToAmount } from './deduction-bundle.js';
import { parseFy } from './deduction-bundle.controller.js';
import type { DeductionItemTotal, DeductionTotals } from './deduction-totals.js';

const at = new Date('2026-07-14T03:21:09.123Z');
const hash = (n: number) => n.toString(16).padStart(64, '0');
const item = (o: Partial<DeductionItemTotal>): DeductionItemTotal => ({
  label: 'D5', itemId: 'tools', receiptCount: 1, workCents: 1000n, receiptRefs: [hash(1)], ...o,
});
const totals = (items: DeductionItemTotal[], km = 0): DeductionTotals => ({
  financialYear: '2025-26', items, totalCents: 0n, workKilometres: km,
  toReview: { receiptCount: 0, amountCents: 0n, foreignCurrencyCount: 0 },
} as unknown as DeductionTotals);

describe('centsToAmount', () => {
  it.each([[1n, '0.01'], [9n, '0.09'], [10n, '0.10'], [100n, '1.00'], [12345n, '123.45'], [99_999_999_999n, '999999999.99']])(
    '%s -> %s and matches the FTR amount pattern', (c, s) => {
      expect(centsToAmount(c)).toBe(s);
      expect(AMOUNT_PATTERN.test(s)).toBe(true);
    });
});

describe('buildDeductionBundle', () => {
  it('has the exact v1 shape, passes the validator, and omits privateUsePercent', () => {
    const b = buildDeductionBundle(totals([item({ workCents: 551n, receiptCount: 2, receiptRefs: [hash(2), hash(1)] })], 21), {
      generatedAt: at, occupation: 'teacher',
    });
    expect(b).toEqual({
      schemaVersion: 1,
      financialYear: '2025-26',
      generatedAt: '2026-07-14T03:21:09.123Z',
      source: { app: 'snapapp', appVersion: '0.1.0' },
      occupation: 'teacher',
      workKilometres: 21,
      lines: [{
        label: 'D5', itemId: 'tools', description: 'Tools', amount: '5.51', gstInclusive: true,
        receiptCount: 2, receiptRefs: [hash(2), hash(1)],
      }],
    });
    expect(validateDeductionBundle(JSON.parse(JSON.stringify(b)))).toEqual({ ok: true, bundle: b });
  });

  it('leaves out zero, negative and unknown-catalogue lines, and unknown occupations and zero km', () => {
    const b = buildDeductionBundle(
      totals([item({ workCents: 0n }), item({ itemId: 'licences', workCents: -5n }), item({ itemId: 'notAnItem' }),
        item({ label: 'D6', itemId: 'tools' }), item({ label: 'D3', itemId: 'washPowder', workCents: 1n })]),
      { generatedAt: at, occupation: 'sole' },
    );
    expect(b.lines.map((l) => `${l.label}/${l.itemId}/${l.amount}`)).toEqual(['D3/washPowder/0.01']);
    expect(b).not.toHaveProperty('occupation');
    expect(b).not.toHaveProperty('workKilometres');
    expect(validateDeductionBundle(b).ok).toBe(true);
  });

  it('cites at most 20 receipts but keeps the whole amount and count', () => {
    const refs = Array.from({ length: 35 }, (_, i) => hash(i + 1));
    const b = buildDeductionBundle(totals([item({ receiptCount: 35, receiptRefs: refs, workCents: 123456n })]), { generatedAt: at, occupation: null });
    expect(b.lines[0]!.receiptRefs).toEqual(refs.slice(0, 20));
    expect(b.lines[0]!.receiptCount).toBe(35);
    expect(b.lines[0]!.amount).toBe('1234.56');
    expect(validateDeductionBundle(b).ok).toBe(true);
  });

  it('never cites more receipts than it counts', () => {
    const b = buildDeductionBundle(totals([item({ receiptCount: 1, receiptRefs: [hash(1), hash(2)] })]), { generatedAt: at, occupation: null });
    expect(validateDeductionBundle(b).ok).toBe(true);
  });

  it('caps the amount and the kilometres at the format limits', () => {
    const b = buildDeductionBundle(totals([item({ workCents: 10n ** 12n })], 500_000), { generatedAt: at, occupation: null });
    expect(b.lines[0]!.amount).toBe('999999999.99');
    expect(b.workKilometres).toBe(200_000);
    expect(validateDeductionBundle(b).ok).toBe(true);
  });

  it('every catalogue item fits in one bundle, so the line cap cannot bite', () => {
    const all = Object.entries(ITEM_IDS).flatMap(([label, ids]) => ids.map((itemId) => item({ label, itemId })));
    expect(all.length).toBeLessThanOrEqual(MAX_LINES);
    const b = buildDeductionBundle(totals(all), { generatedAt: at, occupation: null });
    expect(b.lines).toHaveLength(all.length);
    expect(validateDeductionBundle(b).ok).toBe(true);
  });
});

describe('parseFy', () => {
  it('accepts a known year, defaults to the current one, and refuses the rest', () => {
    expect(parseFy('2025-26')).toBe(2025);
    expect(typeof parseFy(undefined)).toBe('number');
    for (const bad of ['2025-27', '2025/26', '2024-25', '2099-00', '', '2025', 'x', '2025-26 ']) expect(parseFy(bad)).toBeNull();
  });
});

import { receiptRefOf } from './deduction-totals.js';
import { itemDescription } from './deduction-item-labels.js';
import { defaultFyStart } from './deduction-bundle.controller.js';

describe('receiptRefOf', () => {
  const h = 'ab' + '0'.repeat(62);
  it('uses a photographed page, never a PDF render', () => {
    expect(receiptRefOf(h, 'image/jpeg', null)).toBe(h);
    expect(receiptRefOf(h, 'application/pdf', `t/originals/ab/${h}`)).toBe(h);
    expect(receiptRefOf(h, 'application/pdf', 't/o/x')).toBeNull();
    expect(receiptRefOf(null, 'application/pdf', `t/originals/cd/${h}`)).toBeNull(); // prefix must match
    expect(receiptRefOf(null, 'image/png', 't/o/x')).toBeNull();
  });
});

describe('item descriptions', () => {
  it('uses the catalogue label for every item, within the limit', () => {
    expect(itemDescription('D1', 'repairsPartsDIY1')).toBe('Repairs — parts only (you did the work)');
    expect(itemDescription('D9', 'd9')).toBe('Gifts and donations');
    for (const [label, ids] of Object.entries(ITEM_IDS)) {
      for (const id of ids) {
        const d = itemDescription(label, id);
        expect(d.length).toBeGreaterThan(0);
        expect(d.length).toBeLessThanOrEqual(200);
      }
    }
  });
});

describe('defaultFyStart', () => {
  it('is the newest started year we hold: 2025-26 in Nov 2026', () => {
    expect(defaultFyStart('2026-11-03')).toBe(2025);
    expect(defaultFyStart('2026-06-30')).toBe(2025);
    expect(defaultFyStart('2020-01-01')).toBe(2025);
  });
});
