import { ID_2026 } from '@snap/tax-rules';
import { describe, expect, it } from 'vitest';

import { evaluateCandidate, evaluateManualLinkFacts, rankCandidates, type CandidatePairInput } from './matcher.js';

/**
 * `matcher.ts` — pure unit tests, no database.
 *
 * The heart of R5c per `docs/STATEMENTS.md` §5.3.1 Q3: candidate generation
 * is a FILTER ON FACTS WITH NO THRESHOLD. This file proves that directly —
 * card mismatch EXCLUDES (a fact), `date_gap_days` only RANKS (never
 * excludes), and `within_posting_lag` is `null` with no rule set, asserted
 * rather than silently dropped. `R5h`'s QA gate greps `matcher.ts` itself for
 * a numeric threshold beyond exact equality; this file is the behavioural
 * half of that proof.
 */

function pair(overrides: Partial<CandidatePairInput> = {}): CandidatePairInput {
  return {
    lineId: 'line-1',
    documentId: 'doc-1',
    linePostedDate: '2026-08-14',
    lineCardLast4: null,
    documentIssueDate: '2026-08-12',
    documentCardLast4: null,
    merchantSimilarity: 0.5,
    ...overrides,
  };
}

describe('evaluateCandidate — card_last4 is a FACT, never a score', () => {
  it('excludes a pair when both cards are present and differ', () => {
    const result = evaluateCandidate(
      pair({ lineCardLast4: '9021', documentCardLast4: '4417' }),
      null,
    );
    expect(result).toBeNull();
  });

  it('includes a pair when both cards are present and agree, labelled "equal"', () => {
    const result = evaluateCandidate(
      pair({ lineCardLast4: '4417', documentCardLast4: '4417' }),
      null,
    );
    expect(result).not.toBeNull();
    expect(result?.evidence.cardLast4).toBe('equal');
  });

  it('includes a pair when either card is absent, labelled "absent" — not excluded', () => {
    expect(evaluateCandidate(pair({ lineCardLast4: null, documentCardLast4: '4417' }), null)?.evidence.cardLast4).toBe(
      'absent',
    );
    expect(evaluateCandidate(pair({ lineCardLast4: '4417', documentCardLast4: null }), null)?.evidence.cardLast4).toBe(
      'absent',
    );
    expect(evaluateCandidate(pair({ lineCardLast4: null, documentCardLast4: null }), null)?.evidence.cardLast4).toBe(
      'absent',
    );
  });
});

describe('evaluateCandidate — date_gap_days RANKS, never excludes: no date window', () => {
  it('includes a pair with a 400-day gap — there is no window to fall outside of', () => {
    const result = evaluateCandidate(pair({ documentIssueDate: '2025-07-10', linePostedDate: '2026-08-14' }), null);
    expect(result).not.toBeNull();
    expect(result?.evidence.dateGapDays).toBe(400);
  });

  it('a negative gap (line posted BEFORE the receipt\'s issue date) is still included', () => {
    const result = evaluateCandidate(pair({ documentIssueDate: '2026-08-20', linePostedDate: '2026-08-14' }), null);
    expect(result).not.toBeNull();
    expect(result?.evidence.dateGapDays).toBe(-6);
  });

  it('dateGapDays is null when the document has no issue date', () => {
    const result = evaluateCandidate(pair({ documentIssueDate: null }), null);
    expect(result?.evidence.dateGapDays).toBeNull();
  });
});

describe('evaluateCandidate — within_posting_lag: null with no rule set, a real label with one', () => {
  it('is null when no tax rule set is installed — asserted, not omitted', () => {
    const result = evaluateCandidate(pair(), null);
    expect(result).not.toBeNull();
    expect('withinPostingLag' in (result?.evidence ?? {})).toBe(true);
    expect(result?.evidence.withinPostingLag).toBeNull();
  });

  it('is a real boolean once a rule set is installed (id-2026: 0..3 days)', () => {
    const inLag = evaluateCandidate(
      pair({ documentIssueDate: '2026-08-12', linePostedDate: '2026-08-14' }), // gap 2
      ID_2026,
    );
    expect(inLag?.evidence.withinPostingLag).toBe(true);

    const outOfLag = evaluateCandidate(
      pair({ documentIssueDate: '2026-08-12', linePostedDate: '2026-08-20' }), // gap 8
      ID_2026,
    );
    expect(outOfLag?.evidence.withinPostingLag).toBe(false);
  });

  it('is null when there is no issue date to compare, even with a rule set installed', () => {
    const result = evaluateCandidate(pair({ documentIssueDate: null }), ID_2026);
    expect(result?.evidence.withinPostingLag).toBeNull();
  });
});

describe('evaluateCandidate — amountExact is always true (the SQL pre-filter already guaranteed it)', () => {
  it('is true for every non-excluded pair', () => {
    expect(evaluateCandidate(pair(), null)?.evidence.amountExact).toBe(true);
  });
});

describe('evaluateManualLinkFacts — never excludes; a human may link what the generator would not suggest', () => {
  it('still records "different cards" as a fact rather than refusing to compute one', () => {
    const evidence = evaluateManualLinkFacts(
      { ...pair({ lineCardLast4: '9021', documentCardLast4: '4417' }), amountExact: false },
      null,
    );
    // No exclusion here — this function has no return-null branch at all,
    // by construction: a manual link is a human's own decision.
    expect(evidence.cardLast4).toBe('absent'); // differing cards -> not "equal", but still a value
    expect(evidence.amountExact).toBe(false);
  });
});

describe('rankCandidates — card equal first, then |date_gap_days| ascending, then similarity descending', () => {
  it('the four-line, two-card worked example (§12 R5c, criterion 1)', () => {
    // One 12.50 receipt with card_last4 4417. Two statement lines on 4417
    // (dates 2 and 5 days out), two on 9021 (excluded before ranking ever
    // runs — the caller filters those out via evaluateCandidate returning
    // null, so they never reach rankCandidates at all).
    const near = evaluateCandidate(
      pair({ lineId: 'near', documentIssueDate: '2026-08-12', linePostedDate: '2026-08-14', lineCardLast4: '4417', documentCardLast4: '4417' }),
      null,
    )!;
    const far = evaluateCandidate(
      pair({ lineId: 'far', documentIssueDate: '2026-08-12', linePostedDate: '2026-08-17', lineCardLast4: '4417', documentCardLast4: '4417' }),
      null,
    )!;

    const ranked = rankCandidates([far, near]);
    expect(ranked.map((c) => c.lineId)).toEqual(['near', 'far']);
  });

  it('card "equal" ranks ahead of "absent" regardless of date gap', () => {
    const equalButFar = evaluateCandidate(
      pair({ lineId: 'equal-far', documentIssueDate: '2026-08-01', linePostedDate: '2026-08-20', lineCardLast4: '4417', documentCardLast4: '4417' }),
      null,
    )!;
    const absentButNear = evaluateCandidate(
      pair({ lineId: 'absent-near', documentIssueDate: '2026-08-12', linePostedDate: '2026-08-13', lineCardLast4: null, documentCardLast4: null }),
      null,
    )!;

    const ranked = rankCandidates([absentButNear, equalButFar]);
    expect(ranked.map((c) => c.lineId)).toEqual(['equal-far', 'absent-near']);
  });

  it('a null dateGapDays sorts after every known gap', () => {
    const known = evaluateCandidate(pair({ lineId: 'known', documentIssueDate: '2026-08-01', linePostedDate: '2026-09-01' }), null)!;
    const unknown = evaluateCandidate(pair({ lineId: 'unknown', documentIssueDate: null }), null)!;

    const ranked = rankCandidates([unknown, known]);
    expect(ranked.map((c) => c.lineId)).toEqual(['known', 'unknown']);
  });

  it('similarity breaks a tie on equal card label and equal date gap', () => {
    const moreSimilar = evaluateCandidate(pair({ lineId: 'more', merchantSimilarity: 0.9 }), null)!;
    const lessSimilar = evaluateCandidate(pair({ lineId: 'less', merchantSimilarity: 0.1 }), null)!;

    const ranked = rankCandidates([lessSimilar, moreSimilar]);
    expect(ranked.map((c) => c.lineId)).toEqual(['more', 'less']);
  });

  it('does not mutate its input array', () => {
    const a = evaluateCandidate(pair({ lineId: 'a', merchantSimilarity: 0.1 }), null)!;
    const b = evaluateCandidate(pair({ lineId: 'b', merchantSimilarity: 0.9 }), null)!;
    const input = [a, b];
    rankCandidates(input);
    expect(input.map((c) => c.lineId)).toEqual(['a', 'b']);
  });
});
