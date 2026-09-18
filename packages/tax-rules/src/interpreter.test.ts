import { describe, expect, it } from 'vitest';

import { ID_2026 } from './rules/id-2026.js';
import { daysBetween, withinPostingLag } from './interpreter.js';

/**
 * `daysBetween` and `withinPostingLag` — added for `docs/STATEMENTS.md` §5.3.1
 * (Lane R, R5c), the first reader of `statementRules.postingLagDays` (S4).
 *
 * `withinPostingLag` is a LABEL, not a filter and not a threshold the matcher
 * invents: it reads a window the rule set already states
 * (`ID_2026.statementRules.postingLagDays` = `{min: 0, max: 3}`,
 * `id-2026.test.ts`). Reconciliation's own no-threshold rule lives in
 * `apps/server/src/reconciliation/matcher.ts`, not here — this file only
 * answers "does this rule set say so", the same shape as every other function
 * in `interpreter.ts`.
 */
describe('daysBetween', () => {
  it('counts whole calendar days, signed', () => {
    expect(daysBetween('2026-08-12', '2026-08-14')).toBe(2);
    expect(daysBetween('2026-08-14', '2026-08-12')).toBe(-2);
    expect(daysBetween('2026-08-12', '2026-08-12')).toBe(0);
  });

  it('crosses a month boundary correctly', () => {
    expect(daysBetween('2026-08-30', '2026-09-02')).toBe(3);
  });

  it('crosses a leap-year February correctly', () => {
    // 2028 is a leap year.
    expect(daysBetween('2028-02-27', '2028-03-01')).toBe(3);
    // 2026 is not.
    expect(daysBetween('2026-02-27', '2026-03-01')).toBe(2);
  });
});

describe('withinPostingLag', () => {
  it('true at both edges of the rule set\'s window (id-2026: 0..3 days)', () => {
    expect(ID_2026.statementRules.postingLagDays).toEqual({ min: 0, max: 3 });
    expect(withinPostingLag(ID_2026, '2026-08-12', '2026-08-12')).toBe(true); // gap 0
    expect(withinPostingLag(ID_2026, '2026-08-12', '2026-08-15')).toBe(true); // gap 3
  });

  it('false one day past the window, false for a negative gap', () => {
    expect(withinPostingLag(ID_2026, '2026-08-12', '2026-08-16')).toBe(false); // gap 4
    expect(withinPostingLag(ID_2026, '2026-08-12', '2026-08-11')).toBe(false); // gap -1
  });

  it('reads the window from the rule set rather than a number baked in here', () => {
    const widened = {
      ...ID_2026,
      statementRules: { ...ID_2026.statementRules, postingLagDays: { min: 0, max: 10 } },
    };
    // The SAME gap (4 days) that failed above under the narrower window now
    // passes under a wider one — proof this reads `rules`, not a constant.
    expect(withinPostingLag(widened, '2026-08-12', '2026-08-16')).toBe(true);
  });
});
