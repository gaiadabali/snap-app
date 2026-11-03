import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { validateDeductionBundle } from '@snap/api-contract/deduction-bundle';
import { describe, expect, it } from 'vitest';

import { buildDeductionBundle } from './deduction-bundle.js';
import { foldTotals, type DeductionSourceLine } from './deduction-totals.js';

/**
 * Golden fixture for the SnapApp -> Free Tax Returns round trip (plan 4.9.a).
 * Receipts -> real foldTotals + buildDeductionBundle -> bundle.golden.json, which is
 * copied byte for byte to FTR (`src/lib/import/fixtures/round-trip/`), where its test
 * imports it and checks the worksheet totals. Refresh both: see fixtures/ftr-round-trip/README.md.
 */
const GOLDEN = new URL('./fixtures/ftr-round-trip/bundle.golden.json', import.meta.url);
/** Pinned in FTR's `round-trip.test.ts` too. A drift on either side fails that side. */
const GOLDEN_SHA256 = '12069129312186c78ac64192709945b3c892bc1c3243736473a4e060aae0944b';

const ref = (doc: string) => createHash('sha256').update(`golden-receipt-${doc}`).digest('hex');
let n = 0;
/** A confirmed AUD receipt line; `doc` names the receipt (reuse it for two lines of one receipt). */
const L = (label: string, itemId: string, amountCents: bigint, privateUsePercent: number | null, doc = `r${++n}`): DeductionSourceLine => ({
  documentId: doc, label, itemId, privateUsePercent, source: 'user', amountCents, currency: 'AUD', receiptRef: ref(doc),
});

// amountCents are as printed, GST included. Comments: the D-1 work share, halfUp(amount x (100 - p), 100).
const LINES: DeductionSourceLine[] = [
  // D5 tools, 4 receipts, three of them half-cent cases: 1000 + 501 + 223 + 1 = 1725.
  // Summing before rounding would give 1724 (999.5 + 500.5 + 223.11 + 0.5 = 1723.61): the per-line rule matters.
  L('D5', 'tools', 1999n, 50), //   99950 / 100 = 999.5 -> 1000
  L('D5', 'tools', 1001n, 50), //   50050 / 100 = 500.5 -> 501
  L('D5', 'tools', 333n, 33), //    22311 / 100 = 223.11 -> 223
  L('D5', 'tools', 1n, 50), //         50 / 100 = 0.5 -> 1
  L('D5', 'phoneDevices', 89995n, 55), // 4049775 / 100 = 40497.75 -> 40498
  // D3: boots 15995 + 9713 = 25708; washPowder 679.
  L('D3', 'boots', 15995n, null),
  L('D3', 'boots', 12950n, 25), //  971250 / 100 = 9712.5 -> 9713
  L('D3', 'washPowder', 799n, 15), // 67915 / 100 = 679.15 -> 679
  // D1 car: a running cost, three fuel receipts, one improvement.
  L('D1', 'rego', 85000n, 20), //   68000
  L('D1', 'fuelReceiptTotal', 6543n, 20), // 523440 / 100 = 5234.4 -> 5234
  L('D1', 'fuelReceiptTotal', 7021n, 20), // 561680 / 100 = 5616.8 -> 5617
  L('D1', 'fuelReceiptTotal', 4005n, 20), // 320400 / 100 = 3204
  L('D1', 'towBar', 120000n, 30), // 84000
  // D2: tolls 1250 + 875 + 2210 = 4335; parking 1575 p10 -> 141750 / 100 = 1417.5 -> 1418.
  L('D2', 'tollsTotal', 1250n, null),
  L('D2', 'tollsTotal', 875n, null),
  L('D2', 'tollsTotal', 2210n, null),
  L('D2', 'parking', 1575n, 10),
  L('D4', 'fees', 45000n, null),
  L('D10', 'bookkeeping', 33000n, 50), // 16500
  // One receipt carrying two items: the two D5 lines share a document, so receiptCount counts it once.
  L('D5', 'union', 20000n, null, 'shared'),
  L('D5', 'stationery', 1850n, null, 'shared'),
  // Left out of the bundle: a supplier-filed receipt awaiting review, and a foreign-currency one.
  { ...L('D5', 'tools', 99999n, null), source: 'supplier' },
  { ...L('D5', 'tools', 88888n, null), currency: 'USD' },
];

function golden(): string {
  const bundle = buildDeductionBundle(foldTotals('2025-26', LINES, 0), {
    generatedAt: new Date('2026-07-14T03:21:09.000Z'),
    occupation: 'tradie',
  });
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

describe('FTR round-trip golden bundle', () => {
  // UPDATE_GOLDEN=1 pnpm vitest run src/deductions/ftr-round-trip.test.ts, then paste the printed hash above.
  if (process.env.UPDATE_GOLDEN) {
    writeFileSync(GOLDEN, golden());
    console.log(`golden sha256: ${createHash('sha256').update(golden()).digest('hex')}`);
  }

  it('the real exporter reproduces the checked-in bundle', () => {
    expect(golden()).toBe(readFileSync(GOLDEN, 'utf8'));
  });

  it('pins the bytes FTR also pins', () => {
    expect(createHash('sha256').update(readFileSync(GOLDEN)).digest('hex')).toBe(GOLDEN_SHA256);
  });

  it('is a valid bundle with no privateUsePercent and the hand-computed work-share totals per label', () => {
    const r = validateDeductionBundle(JSON.parse(readFileSync(GOLDEN, 'utf8')));
    expect(r.ok).toBe(true);
    const lines = r.ok ? r.bundle.lines : [];
    expect(lines.some((l) => 'privateUsePercent' in l)).toBe(false);
    const cents: Record<string, number> = {};
    for (const l of lines) cents[l.label] = (cents[l.label] ?? 0) + Math.round(Number(l.amount) * 100);
    expect(cents).toEqual({
      D1: 68000 + 5234 + 5617 + 3204 + 84000, // 166055
      D2: 4335 + 1418, // 5753
      D3: 25708 + 679, // 26387
      D4: 45000,
      D5: 1725 + 40498 + 20000 + 1850, // 64073
      D10: 16500,
    });
  });

  it('counts a shared receipt once and keeps per-line receipt counts', () => {
    const r = validateDeductionBundle(JSON.parse(readFileSync(GOLDEN, 'utf8')));
    const get = (item: string) => (r.ok ? r.bundle.lines.find((l) => l.itemId === item) : undefined);
    expect(get('tools')?.receiptCount).toBe(4);
    expect(get('fuelReceiptTotal')?.receiptCount).toBe(3);
    expect(get('union')?.receiptRefs).toEqual(get('stationery')?.receiptRefs);
  });
});
