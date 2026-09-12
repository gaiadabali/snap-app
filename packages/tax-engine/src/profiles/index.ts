// Occupation profile registry + grouped picker structure + postcode→state.
// Ported from reference/calc.js PROFILES (lines 1239-1386) and reference/data.js
// (OCCUPATIONS, OCCUPATION_GROUPS, postcodeState).
import type { OccupationGroup, OccupationProfile } from './types';
import { apprentice } from './apprentice';
import { award } from './award';
import { carer } from './carer';
import { equipop } from './equipop';
import { factory } from './factory';
import { forklift } from './forklift';
import { miner } from './miner';
import { nurse } from './nurse';
import { rental } from './rental';
import { retail } from './retail';
import { salesrep } from './salesrep';
import { sole } from './sole';
import { teacher } from './teacher';
import { tech } from './tech';
import { tither } from './tither';
import { tradie } from './tradie';
import { truckieLocal } from './truckie-local';
import { truckieLong } from './truckie-long';
import { whitecollar } from './whitecollar';

export * from './types';
export {
  OCC_FLOW,
  occIndustries,
  occRoleAreas,
  occQ3Needed,
  occOccupations,
  occResolve,
  type OccFlowLeaf,
} from './occ-flow';
export { TRADIE_D2_EQUIPMENT, TRADIE_D2_BEDDING, TRADIE_D2_CLOTHING } from './shared-items';
export type { ItemSet, WorksheetItem } from './types';

/** Every worksheet profile calc.js declares, keyed by prototype id.
 * Order mirrors the calc.js PROFILES object. */
export const PROFILES: Record<string, OccupationProfile> = {
  truckie_long: truckieLong,
  truckie_local: truckieLocal,
  tradie,
  miner,
  factory,
  forklift,
  equipop,
  carer,
  award,
  whitecollar,
  sole,
  rental,
  tither,
  nurse,
  teacher,
  salesrep,
  retail,
  tech,
  apprentice,
};

/* Phase 2 occupation picker — grouped into categories with a glyph per group.
   Ported VERBATIM from data.js OCCUPATION_GROUPS, including:
   - the '--' spacer placeholder in 'Overtime & Award';
   - the FIFO / DIDO groups, which map onto the same base profiles
     (truckie_long, truckie_local, tradie, miner, equipop) rather than having
     dedicated worksheets (HANDOFF: FIFO/DIDO → base-profile mapping). */
export const OCCUPATION_GROUPS: readonly OccupationGroup[] = [
  { label: 'Transport & Logistics', icon: 'truck', ids: ['truckie_long', 'truckie_local'] },
  { label: 'Trades & Industrial', icon: 'wrench', ids: ['tradie', 'miner', 'forklift', 'equipop', 'factory'] },
  { label: 'Health & Care', icon: 'heart', ids: ['carer', 'nurse'] },
  { label: 'Overtime & Award', icon: 'wrench', ids: ['award', '--'] },
  { label: 'FIFO (Fly-In Fly-Out)', icon: 'truck', ids: ['truckie_long', 'truckie_local', 'tradie', 'miner', 'equipop'] },
  { label: 'DIDO (Drive-In Drive-Out)', icon: 'car', ids: ['truckie_long', 'truckie_local', 'tradie', 'miner', 'equipop'] },
  { label: 'Education', icon: 'book', ids: ['teacher'] },
  { label: 'Office & Professional', icon: 'laptop', ids: ['tech', 'sole'] },
  { label: 'Sales & Field', icon: 'car', ids: ['salesrep', 'retail'] },
  { label: 'Property & Giving', icon: 'home', ids: ['rental', 'tither'] },
  { label: 'Everyone Else', icon: 'users', ids: ['whitecollar'] },
];

/** Derive the Australian state/territory from a postcode. Ported verbatim from
 * data.js postcodeState() (lines 25-43) — the numeric-range derivation makes
 * the picker complete across ALL valid AU postcodes. Returns '' when the input
 * is not a recognised postcode.
 *
 * TODO(phase3): the curated AU_POSTCODES suburb-preview array (data.js lines
 * 44-76) and the CAR_MAKES make/model dataset (data.js lines 169-201) are UI
 * datasets deliberately NOT ported yet — they live in reference/data.js for
 * the UI phase. Known data bug to fix when porting: postcode '3000' appears
 * TWICE in the curated list ('Melbourne' and 'Melbourne CBD').
 */
export function stateFromPostcode(postcode: string): string {
  const n = parseInt(postcode, 10);
  if (Number.isNaN(n)) return '';
  if (n >= 1000 && n <= 2599) return 'NSW';
  if (n >= 2600 && n <= 2618) return 'ACT';
  if (n >= 2619 && n <= 2899) return 'NSW';
  if (n >= 2900 && n <= 2920) return 'ACT';
  if (n >= 2921 && n <= 2999) return 'NSW';
  if (n >= 3000 && n <= 3999) return 'VIC';
  if (n >= 4000 && n <= 4999) return 'QLD';
  if (n >= 5000 && n <= 5799) return 'SA';
  if (n >= 6000 && n <= 6797) return 'WA';
  if (n >= 7000 && n <= 7799) return 'TAS';
  if (n >= 800 && n <= 899) return 'NT';
  if (n >= 900 && n <= 999) return 'NT';
  if (n >= 8000 && n <= 8999) return 'VIC';
  if (n >= 9000 && n <= 9999) return 'QLD';
  return '';
}
