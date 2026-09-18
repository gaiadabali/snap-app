import type { MatchEvidence } from '@snap/api-contract';
import { daysBetween, withinPostingLag, type TaxRules } from '@snap/tax-rules';

/**
 * The candidate generator: a FILTER ON FACTS, with no score and no threshold.
 *
 * `docs/STATEMENTS.md` §5.3.1 Q3, read literally — this file exists to keep
 * that literal: "the candidate generator is a filter on facts, ranked for
 * display, with no score." R7 owns the threshold that eventually decides
 * whether a candidate should auto-accept; nothing here anticipates that
 * number. **If a change to this file ever wants to compare a fact against a
 * cutoff other than exact equality, that change belongs in R7, not here** —
 * `R5h`'s QA gate greps this file for exactly that and for
 * `LOW_CONFIDENCE_THRESHOLD`.
 *
 * Pure by design, same as `transactions/merge.ts`: every SQL fetch (the
 * exact-amount, same-currency pre-filter the two `documents_payable_amount_idx`
 * / `statement_lines_amount_idx` indexes exist for — migration 0032) happens in
 * `reconciliation.repo.ts`; this file only decides, from already-fetched rows,
 * which pairs are excluded, what their facts are, and how to order them.
 */

/** One statement-line/document pair already known to share the same tenant,
 *  currency and exact (signed, direction-adjusted) amount — the SQL-level
 *  pre-filter `reconciliation.repo.ts` runs before this function ever sees a
 *  row. Everything past that point is this file's job. */
export interface CandidatePairInput {
  lineId: string;
  documentId: string;
  /** The line's `posted_date`, `YYYY-MM-DD`. */
  linePostedDate: string;
  lineCardLast4: string | null;
  /** The document's `issue_date`, or `null` — not every receipt has one. */
  documentIssueDate: string | null;
  documentCardLast4: string | null;
  /** `pg_trgm` `similarity()` of the line's and the document's normalised
   *  names — computed in SQL (`reconciliation.repo.ts`), not here: this file
   *  has no database access, by design. */
  merchantSimilarity: number;
}

export interface GeneratedCandidate {
  lineId: string;
  documentId: string;
  evidence: MatchEvidence;
}

/**
 * Facts and exclusion for ONE pair. Returns `null` when the pair is EXCLUDED
 * — `card_last4` both present and different, §5.3.1's own words: "a fact —
 * the card ending 9021 did not pay a docket that says 4417." That is a filter
 * on a fact, not a low rank; an excluded pair never becomes a
 * `match_candidates` row at all.
 *
 * `rules` is `null` for a tenant with no installed tax rule set (every
 * Australian tenant, today — `rulesFor` throws for one, per
 * `taxrules.repo.ts`) and is the caller's job to resolve; this function only
 * decides what to do with `null` once it has it: `withinPostingLag` is
 * `null` too, asserted rather than silently omitted, because §5.3.1 is
 * explicit that "a match suggestion is not a statutory figure" and does not
 * inherit the tax engine's "no rule set -> refuse" discipline.
 */
export function evaluateCandidate(
  input: CandidatePairInput,
  rules: TaxRules | null,
): GeneratedCandidate | null {
  const bothCardsPresent = Boolean(input.lineCardLast4) && Boolean(input.documentCardLast4);
  if (bothCardsPresent && input.lineCardLast4 !== input.documentCardLast4) {
    return null; // EXCLUDED — a fact, not a low rank.
  }
  const cardLast4: MatchEvidence['cardLast4'] =
    bothCardsPresent && input.lineCardLast4 === input.documentCardLast4 ? 'equal' : 'absent';

  const dateGapDays = input.documentIssueDate
    ? daysBetween(input.documentIssueDate, input.linePostedDate)
    : null;

  const withinLag =
    rules && input.documentIssueDate
      ? withinPostingLag(rules, input.documentIssueDate, input.linePostedDate)
      : null;

  return {
    lineId: input.lineId,
    documentId: input.documentId,
    evidence: {
      // Always true: the SQL pre-filter this function's caller runs is an
      // EXACT amount match (§5.3.1: "same currency; exact amount"), so any
      // pair reaching this function already satisfies it. Kept as a named
      // fact, not dropped, because `evaluateManualLinkFacts` below computes
      // the same evidence shape for a manual link, where it is not
      // guaranteed — and a `false` there is meaningful to R7.
      amountExact: true,
      dateGapDays,
      cardLast4,
      merchantSimilarity: input.merchantSimilarity,
      withinPostingLag: withinLag,
    },
  };
}

/**
 * The same facts, for a MANUAL link (`POST /v1/reconciliation/matches`) —
 * never filtered, because a human may deliberately link a pair the generator
 * would have excluded (a different card on file, a variance). `amountExact`
 * is computed here rather than assumed, because a manual link is not
 * guaranteed to be an exact match the way a generated candidate is.
 */
export function evaluateManualLinkFacts(
  input: CandidatePairInput & { amountExact: boolean },
  rules: TaxRules | null,
): MatchEvidence {
  const bothCardsPresent = Boolean(input.lineCardLast4) && Boolean(input.documentCardLast4);
  const cardLast4: MatchEvidence['cardLast4'] =
    bothCardsPresent && input.lineCardLast4 === input.documentCardLast4 ? 'equal' : 'absent';

  const dateGapDays = input.documentIssueDate
    ? daysBetween(input.documentIssueDate, input.linePostedDate)
    : null;

  const withinLag =
    rules && input.documentIssueDate
      ? withinPostingLag(rules, input.documentIssueDate, input.linePostedDate)
      : null;

  return {
    amountExact: input.amountExact,
    dateGapDays,
    cardLast4,
    merchantSimilarity: input.merchantSimilarity,
    withinPostingLag: withinLag,
  };
}

/**
 * Ranking for display — §5.3.1: "card equal first, then `|date_gap_days|`
 * ascending, then similarity descending. Every candidate is shown; the page
 * size is a UI choice, not a threshold." Nothing here removes a candidate;
 * it only orders the array the caller already has.
 *
 * A `null` `dateGapDays` (no issue date to compare) sorts after every known
 * gap — an unknown gap is not evidence of a CLOSE match, so it never
 * outranks one that is actually known to be close.
 */
export function rankCandidates<T extends { evidence: MatchEvidence }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const ae = a.evidence;
    const be = b.evidence;

    if (ae.cardLast4 !== be.cardLast4) {
      return ae.cardLast4 === 'equal' ? -1 : 1;
    }

    if (ae.dateGapDays === null && be.dateGapDays !== null) return 1;
    if (ae.dateGapDays !== null && be.dateGapDays === null) return -1;
    if (ae.dateGapDays !== null && be.dateGapDays !== null) {
      const gapDiff = Math.abs(ae.dateGapDays) - Math.abs(be.dateGapDays);
      if (gapDiff !== 0) return gapDiff;
    }

    return be.merchantSimilarity - ae.merchantSimilarity;
  });
}
