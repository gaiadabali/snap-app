import { OCCUPATION_IDS } from '@snap/api-contract/deduction-bundle';
import { OCCUPATION_GROUPS, PROFILES } from '@snap/tax-engine';

/**
 * Which occupations a workspace may hold (docs/DEDUCTIONS.md).
 *
 * A PERSONAL workspace is scoped to employee deductions and rentals (founder
 * decision 0.5), so it may hold only the 18 ids the deduction bundle spec
 * accepts (`OCCUPATION_IDS`, FTR's profiles minus `sole`). A BUSINESS
 * workspace keeps every `PROFILES` id.
 */
export function occupationAllowed(kind: 'business' | 'personal', id: string): boolean {
  if (kind === 'personal') return (OCCUPATION_IDS as readonly string[]).includes(id);
  return PROFILES[id] !== undefined;
}

/** The message for a refused id, or null when it is fine. Empty and null clear the occupation. */
export function occupationProblem(
  kind: 'business' | 'personal',
  id: string | null | undefined,
): string | null {
  if (id == null || id === '') return null;
  if (occupationAllowed(kind, id)) return null;
  const expected =
    kind === 'personal' ? [...OCCUPATION_IDS] : Object.keys(PROFILES);
  return `Unknown occupation for a ${kind} workspace. Expected one of: ${expected.join(', ')}.`;
}

export type OccupationGroupView = { group: string; profiles: Array<{ id: string; label: string }> };

/**
 * The occupations a workspace of `kind` may choose, grouped for a picker.
 *
 * '--' is a spacer in the source data, and a group can name a profile that has
 * no worksheet of its own (FIFO maps onto a base profile), so both are
 * filtered rather than rendered as an empty row. A personal workspace is not
 * offered the sole trader (`sole`). A group left empty is dropped.
 *
 * The source data lists some ids under more than one group (the FIFO and DIDO
 * groups repeat the trades and transport ids), which would show the same job
 * two or three times in a picker. Each id is kept under the FIRST group that
 * names it, so FIFO and DIDO fall away and their jobs stay under their trade.
 */
export function occupationGroupsFor(kind: 'business' | 'personal'): OccupationGroupView[] {
  const seen = new Set<string>();
  return OCCUPATION_GROUPS.map((g) => ({
    group: g.label,
    profiles: g.ids
      .filter((id: string) => {
        if (PROFILES[id] === undefined || !occupationAllowed(kind, id) || seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .map((id: string) => ({ id, label: PROFILES[id]!.label })),
  })).filter((g) => g.profiles.length > 0);
}
