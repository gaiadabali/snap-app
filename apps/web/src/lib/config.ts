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

  /**
   * Whether a magic link can actually be DELIVERED.
   *
   * `apps/server/src/auth/mailer.ts` falls back to a NoopMailer in production:
   * it logs a warning and sends nothing, and the request still answers "ok"
   * because a magic-link endpoint must respond identically whether or not the
   * address exists. Correct for security, and it means an unconfigured mailer
   * shows the user "check your email" for a message that will never arrive.
   *
   * So the UI asks this before offering the option at all. Mirrors the same
   * two variables the server's boot preflight reads.
   */
  mailerConfigured: Boolean(process.env.MAILER_PROVIDER ?? process.env.SMTP_URL),

  /**
   * Whether the real Google OAuth flow has credentials to run at all. When
   * this is true, `googleSignInSimulatorAvailable` below is always false —
   * the genuine flow takes precedence with nothing to configure to prefer it.
   */
  googleOauthConfigured:
    Boolean(process.env.GOOGLE_CLIENT_ID) && Boolean(process.env.GOOGLE_CLIENT_SECRET),

  /**
   * The simulated Google sign-in for the public staging/demo host.
   *
   * Real Google OAuth credentials do not exist yet, and the production
   * mailer is still a no-op (`apps/server/src/auth/mailer.ts`), so without
   * this nobody can sign in on a real deploy at all (docs/DEPLOY.md §3). This
   * trades proof of identity for one of a fixed, server-side allow-listed
   * demo accounts — never an arbitrary address — and everything after that
   * (session cookie, onboarding, workspace selection, RBAC) runs through the
   * exact same code the real flow uses.
   *
   * Mirrors `apps/server/src/config.ts#isGoogleSignInSimulatorEnabled` (read
   * that function's comment for the full rationale) with the SAME three
   * independent conditions, one more than `devAuthBypass`'s two because this
   * one runs on a host anyone can find:
   *
   *   1. `NODE_ENV !== 'production'` OR `DEMO_ENV === 'staging'` — a signal
   *      kept separate from `NODE_ENV` because this app is typically BUILT
   *      with `NODE_ENV=production` even on the demo host.
   *   2. `GOOGLE_SIGNIN_SIMULATOR === 'true'` — a second, independent opt-in.
   *   3. Real Google credentials are NOT configured (`googleOauthConfigured`
   *      above) — the genuine flow always wins the moment they exist.
   *
   * The server enforces the identical three conditions again, independently,
   * on the endpoints that actually mint a session
   * (`/v1/auth/google-simulator/*`) — this flag only decides whether the
   * button is rendered at all, exactly as `devAuthBypass` does for its form.
   */
  googleSignInSimulatorAvailable:
    (process.env.NODE_ENV !== 'production' || process.env.DEMO_ENV === 'staging') &&
    process.env.GOOGLE_SIGNIN_SIMULATOR === 'true' &&
    !(Boolean(process.env.GOOGLE_CLIENT_ID) && Boolean(process.env.GOOGLE_CLIENT_SECRET)),
} as const;

/** Read lazily: only the routes that actually do Google OAuth need these. */
export function googleOauth(): { clientId: string; clientSecret: string; redirectUri: string } {
  return {
    clientId: required('GOOGLE_CLIENT_ID', process.env.GOOGLE_CLIENT_ID),
    clientSecret: required('GOOGLE_CLIENT_SECRET', process.env.GOOGLE_CLIENT_SECRET),
    redirectUri: `${config.publicUrl}/auth/google/callback`,
  };
}
