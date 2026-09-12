import 'server-only';

import { config } from '@/lib/config';

/**
 * Whether the development sign-in bypass may be used RIGHT NOW.
 *
 * One function, called from both sides of the boundary it guards: the
 * sign-in page calls it to decide whether to render the bypass form at all,
 * and `devBypassSignInAction` calls it AGAIN before doing anything. A page
 * that merely omits a form is a convenience; an action that re-checks before
 * acting is the actual boundary — the same "don't trust the client, re-check
 * server-side" rule this app applies to everything else.
 *
 * `config.devAuthBypass` already encodes both required conditions
 * (`NODE_ENV !== 'production'` AND the explicit `SNAP_DEV_AUTH_BYPASS=true`
 * opt-in) — this function exists so neither call site has to restate that,
 * and so there is exactly one place to audit for "can this be reached in
 * production". It cannot: `NODE_ENV=production` forces the flag itself to
 * false regardless of what any other environment variable says.
 */
export function isDevBypassAvailable(): boolean {
  return config.devAuthBypass;
}
