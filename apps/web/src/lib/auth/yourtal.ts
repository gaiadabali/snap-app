import 'server-only';

import { api } from '@/lib/api/server';

/**
 * Whether "Sign in with YourTal" can be offered on the web. The API answers
 * per client (web, mobile) from its own configuration; this website only
 * needs `web`.
 *
 * Failure-safe by construction: if the API is down or returns something
 * unexpected, the button is simply not shown — a missing button is a far
 * better outcome than one that leads to an error, and the other sign-in
 * methods are unaffected. Cached for a minute; the answer only changes when
 * someone edits server configuration.
 */
export async function isYourtalWebSignInAvailable(): Promise<boolean> {
  try {
    const result = await api<{ web?: unknown }>('/v1/auth/yourtal', {
      anonymous: true,
      revalidate: 60,
    });
    return result?.web === true;
  } catch {
    return false;
  }
}
