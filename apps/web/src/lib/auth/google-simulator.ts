import 'server-only';

import { config } from '@/lib/config';

/**
 * Whether the simulated Google sign-in may be used RIGHT NOW.
 *
 * Same shape as `isDevBypassAvailable` (`./dev-bypass.ts`) and for the same
 * reason: one function, called from both sides of the boundary it guards —
 * the page that renders the fake consent screen calls it to decide whether
 * to render anything at all, and the server action that actually signs
 * someone in calls it AGAIN before doing anything. The server endpoint that
 * mints the session (`POST /v1/auth/google-simulator/sign-in`) enforces the
 * identical three conditions completely independently — see
 * `apps/server/src/config.ts#isGoogleSignInSimulatorEnabled` — so this is a
 * convenience that keeps the button off the page, never the actual boundary.
 *
 * `config.googleSignInSimulatorAvailable` already encodes all three required
 * conditions (`apps/web/src/lib/config.ts`); this exists only so there is one
 * place to audit "can this run right now" on the web side.
 */
export function isGoogleSignInSimulatorAvailable(): boolean {
  return config.googleSignInSimulatorAvailable;
}
