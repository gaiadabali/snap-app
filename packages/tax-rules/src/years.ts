/**
 * One country, several years: which rule set a DATE belongs to.
 *
 * A rule set states the law of one country for one year (`au-2025` is
 * 1 July 2025 to 30 June 2026). A workspace does not live in one year, though:
 * in November 2026 an Australian is lodging the 2025–26 return with receipts
 * from 2025, while photographing receipts that belong to 2026–27. So the
 * workspace records its COUNTRY (through the rule set it installed), and each
 * document is assessed under the year its own date falls in.
 *
 * The rules here, after Free Tax Returns' `ratesFor(fy)`:
 *
 *  1. **Exact year first.** The held rule set whose `effectiveFrom ..
 *     effectiveTo` window covers the date.
 *  2. **A date after every held year → the latest held year.** A new year's
 *     file is written when its law is known; until then the newest law we hold
 *     is the best statement of it. `match: 'latest_held'` says so.
 *  3. **A date before every held year → the earliest held year.** Older than
 *     our history; `match: 'earliest_held'` says so.
 *
 * Every answer names the rule set it chose, and the interpreter stamps that
 * rule set's `id` and `version` into each result (README principle 2), so a
 * 2025–26 receipt stays re-derivable under `au-2025` / `2025.1.0` however
 * many years are added after it. History is never edited: a corrected year is
 * a new `version`, and a new year is a new file.
 *
 * A *family* is every held rule set for one country and one taxpayer scope.
 * `inspectFamily` refuses a family whose windows overlap or leave a gap,
 * because then a date would have two answers, or none.
 */

import type { TaxRules } from './contract.js';
import type { RulesProblem } from './verify.js';

/** How a date was matched to a rule set. Anything but `exact` is a fallback. */
export type RulesMatch = 'exact' | 'latest_held' | 'earliest_held';

export interface RulesForDate {
  rules: TaxRules;
  /** The date that was resolved, `YYYY-MM-DD`. */
  onDate: string;
  match: RulesMatch;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The family a rule set belongs to: one country, one taxpayer scope. */
export function familyKey(rules: Pick<TaxRules, 'country' | 'scope'>): string {
  return `${rules.country}:${rules.scope}`;
}

/**
 * Every held rule set in the same family as `member`, oldest first.
 *
 * `member` may be a rule set or a held id — the id a workspace stored when it
 * installed a rule set. Throws when the id is not held: an unknown id is not
 * a country we can guess.
 */
export function familyOf(held: readonly TaxRules[], member: TaxRules | string): TaxRules[] {
  const anchor = typeof member === 'string' ? held.find((r) => r.id === member) : member;
  if (!anchor) {
    throw new Error(`no held rule set has the id ${JSON.stringify(member)}`);
  }
  const key = familyKey(anchor);
  return held
    .filter((r) => familyKey(r) === key)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : 0));
}

/**
 * The rule set of one family that applies on `isoDate`.
 *
 * The family must be one country and scope (`familyOf` builds one); this is
 * checked, not assumed, because resolving across two countries would hand an
 * Indonesian receipt Australian law whenever the dates happened to line up.
 */
export function rulesForDate(family: readonly TaxRules[], isoDate: string): RulesForDate {
  if (!ISO_DATE.test(isoDate)) throw new Error(`not a date: ${JSON.stringify(isoDate)}`);
  if (family.length === 0) throw new Error('no rule sets to choose from');
  const key = familyKey(family[0]!);
  if (family.some((r) => familyKey(r) !== key)) {
    throw new Error(`rule sets from more than one family (${[...new Set(family.map(familyKey))].join(', ')})`);
  }

  const sorted = [...family].sort((a, b) =>
    a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : 0,
  );

  const exact = sorted.find(
    (r) => r.effectiveFrom <= isoDate && (r.effectiveTo == null || isoDate <= r.effectiveTo),
  );
  if (exact) return { rules: exact, onDate: isoDate, match: 'exact' };

  // Not covered. The newest year that started on or before the date — which,
  // for a family with no gaps, is the latest held year and the date is after
  // it. Nothing started by then: the date is older than our history.
  const started = sorted.filter((r) => r.effectiveFrom <= isoDate);
  if (started.length > 0) {
    return { rules: started[started.length - 1]!, onDate: isoDate, match: 'latest_held' };
  }
  return { rules: sorted[0]!, onDate: isoDate, match: 'earliest_held' };
}

/**
 * One rule set per family: the one covering `isoDate`, in the order each
 * family first appears in `held`.
 *
 * What an onboarding catalogue shows — one Australia, not three — and what a
 * settings screen calls "the current tax year".
 */
export function currentRules(held: readonly TaxRules[], isoDate: string): TaxRules[] {
  const seen = new Set<string>();
  const out: TaxRules[] = [];
  for (const r of held) {
    const key = familyKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rulesForDate(familyOf(held, r), isoDate).rules);
  }
  return out;
}

/**
 * Problems with a family of years, or `[]`.
 *
 * Shape checks on each rule set are `verify.ts`'s job; this checks how the
 * years fit together:
 *  - one country and one scope;
 *  - no two ids or versions the same (a stamp must name exactly one rule set);
 *  - no overlap — a date with two years is a receipt with two answers;
 *  - no gap — a date with no year would fall back while a real year exists;
 *  - only the newest year may be open-ended.
 */
export function inspectFamily(family: readonly TaxRules[]): RulesProblem[] {
  const p: RulesProblem[] = [];
  if (family.length === 0) return [{ path: '', message: 'a family needs at least one rule set' }];

  const keys = new Set(family.map(familyKey));
  if (keys.size > 1) {
    p.push({ path: 'country', message: `one country and scope per family, found ${[...keys].join(', ')}` });
  }
  const ids = family.map((r) => r.id);
  for (const id of new Set(ids)) {
    if (ids.filter((x) => x === id).length > 1) p.push({ path: 'id', message: `${id} appears twice` });
  }
  const versions = family.map((r) => r.version);
  for (const v of new Set(versions)) {
    if (versions.filter((x) => x === v).length > 1) {
      p.push({ path: 'version', message: `version ${v} is used by more than one year` });
    }
  }

  const sorted = [...family].sort((a, b) =>
    a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : 0,
  );
  sorted.forEach((r, i) => {
    const next = sorted[i + 1];
    if (!next) return;
    if (r.effectiveTo == null) {
      p.push({ path: `${r.id}.effectiveTo`, message: `open-ended, but ${next.id} starts after it` });
      return;
    }
    const dayAfter = addOneDay(r.effectiveTo);
    if (next.effectiveFrom < dayAfter) {
      p.push({ path: `${next.id}.effectiveFrom`, message: `${next.effectiveFrom} overlaps ${r.id}, which runs to ${r.effectiveTo}` });
    } else if (next.effectiveFrom > dayAfter) {
      p.push({ path: `${next.id}.effectiveFrom`, message: `gap: ${r.id} ends ${r.effectiveTo} but ${next.id} starts ${next.effectiveFrom}` });
    }
  });
  return p;
}

/** Families present in `held`, keyed by `familyKey`, each oldest first. */
export function familiesOf(held: readonly TaxRules[]): Map<string, TaxRules[]> {
  const out = new Map<string, TaxRules[]>();
  for (const r of held) {
    const key = familyKey(r);
    if (!out.has(key)) out.set(key, familyOf(held, r));
  }
  return out;
}

function addOneDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
