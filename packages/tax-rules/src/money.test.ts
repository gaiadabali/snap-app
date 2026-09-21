/**
 * The gap check, counted the way the ledger counts.
 *
 * `linesGap` here is the exact (decimal-string) counterpart of the numeric
 * `linesGap` in `apps/server/src/extraction/validators.ts`: the pre-posting
 * check that decides whether a document's lines reconcile to its total must
 * accumulate in BigInt, because a float sum sitting a tenth of a quadrillionth
 * over the tolerance rejects a docket the ledger itself would accept.
 *
 * These cases sit exactly ON the tolerance edge, where float drift is at its
 * most damaging: the exact answer is on the line, and the float answer is a
 * hair off it.
 */
import { describe, expect, it } from 'vitest';

import { add, compare, linesGap } from './money.js';

const absOf = (gap: string): string => (gap.startsWith('-') ? gap.slice(1) : gap);

describe('the exact gap check', () => {
  it('sums 0.015 + 0.005 to exactly 0.02 — no float drift', () => {
    // In IEEE doubles 0.015 + 0.005 = 0.020000000000000004. The ledger's
    // decimal-string sum is exactly 0.020000, so the gap against a 0.02
    // payable is exactly zero, not a whisper off it.
    expect(add('0.015', '0.005')).toBe('0.020000');
    expect(linesGap('0.020000', '0.02', null)).toBe('0.000000');
  });

  it('a gap of exactly 0.02 sits ON the tolerance and is refused, not a hair inside', () => {
    // The consumer's rule: refuse when |gap| >= 0.02. 0.03 − 0.01 is exactly
    // 0.02 in decimal, so the exact check refuses; in floats it is
    // 0.019999999999999997, a hair under the line, so a Number check accepts
    // a docket the ledger should refuse.
    const gap = absOf(linesGap('0.010000', '0.03', null));
    expect(gap).toBe('0.020000');
    // On the line is not inside it: the refusal comparison holds with equality.
    expect(compare(gap, '0.02')).toBeGreaterThanOrEqual(0);
  });

  it('a 0.005-balance check reads exactly: 1.015 − 0.005 − 1.01 = 0', () => {
    // The linesBalance reading in run.ts accepts when |gap| < 0.005. Exact
    // arithmetic puts this docket exactly on zero; float lands near it.
    expect(linesGap('1.010000', '1.015', '0.005')).toBe('0.000000');
  });
});
