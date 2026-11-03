import { OCCUPATION_IDS } from '@snap/api-contract/deduction-bundle';
import { PROFILES } from '@snap/tax-engine';

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
