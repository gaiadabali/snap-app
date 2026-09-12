import 'server-only';

import { NOW } from '../_fixtures/seed';

/**
 * The fixture's reference clock, in epoch ms.
 *
 * Pages use this instead of `Date.now()` so relative timestamps ("3d ago")
 * stay stable against the fixed dataset in `_fixtures/seed.ts`. A real
 * backend swap removes this file entirely — every page then uses the actual
 * wall clock, because timestamps from a live API are already correct.
 */
export function fixtureNow(): number {
  return NOW.getTime();
}
