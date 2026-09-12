import 'server-only';

/**
 * Configuration, validated once, on the server only.
 *
 * Deliberately the same posture as apps/server/src/config.ts: no defaults for
 * secrets, and a failure at startup rather than on the first request that needs
 * the value. A development fallback for a signing key is how a development
 * signing key ends up in production.
 *
 * `server-only` at the top is load-bearing. It makes importing this file from a
 * client component a BUILD error rather than a runtime leak of whatever is in
 * it — which is the difference between a mistake and an incident.
 */

function required(name: string, value: string | undefined): string {
  if (!value || value.trim() === '') {
    throw new Error(
      `${name} is required. See apps/web/.env.example — the web app refuses to start without it.`,
    );
  }
  return value;
}

export const config = {
  /** Where the Nest API lives. Server-to-server, so it may be a private address. */
  apiUrl: process.env.SNAP_API_URL ?? 'http://127.0.0.1:4000',

  /** This site's own public origin, for OAuth redirect URIs. */
  publicUrl: process.env.WEB_PUBLIC_URL ?? 'http://127.0.0.1:3000',

  /**
   * Dev sign-in bypass.
   *
   * Explicitly opt-in and explicitly NOT available when NODE_ENV is production,
   * because the upstream sign-in endpoint takes an email and no password and
   * says in its own comments that it must not ship. Two independent conditions
   * guard it: one you set, and one the build sets.
   */
  devAuthBypass:
    process.env.NODE_ENV !== 'production' && process.env.SNAP_DEV_AUTH_BYPASS === 'true',

  isProduction: process.env.NODE_ENV === 'production',
} as const;

/** Read lazily: only the routes that actually do Google OAuth need these. */
export function googleOauth(): { clientId: string; clientSecret: string; redirectUri: string } {
  return {
    clientId: required('GOOGLE_CLIENT_ID', process.env.GOOGLE_CLIENT_ID),
    clientSecret: required('GOOGLE_CLIENT_SECRET', process.env.GOOGLE_CLIENT_SECRET),
    redirectUri: `${config.publicUrl}/auth/google/callback`,
  };
}
